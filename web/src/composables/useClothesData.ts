// Real clothes-clip data from the server: latest reading, air box picker and history window.
// Moved out of the old ClothesView so the header,
// the overview and the clip detail page share one copy (logic unchanged).
//
// It is a module-level store. Each consumer calls useClothesLive() / useClothesHistory()
// from setup; polling runs only while at least one consumer is mounted.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { DAY_MS, fromTaipeiInput, toTaipeiInput } from '../utils/format';

export type Field = 'hx711_raw' | 'ads1115_raw' | 'touch_raw';
export type Reading = { id: string; timestamp: string } & Record<Field, number | null>;
export type SensorKind = 'm1' | 'wa' | 'm3';
export type Sensor = { key: Field; title: string; method: string; hardware: string; color: SensorKind; description: string };

export const SENSORS: Sensor[] = [
  { key: 'hx711_raw', title: '重量感測', method: '重量法', hardware: 'HX711', color: 'm1', description: 'GPIO4 / GPIO5 · 尚未換算公克' },
  { key: 'ads1115_raw', title: '電阻感測', method: '電阻法', hardware: 'ADS1115', color: 'wa', description: 'A0 通道 · 原始 ADC 讀值' },
  { key: 'touch_raw', title: '電容感測', method: '電容法', hardware: 'ESP32-S3 Touch', color: 'm3', description: 'GPIO10 · 原始 touch 讀值' },
];

export type AirReading = { timestamp: string; temp: number | null; humi: number | null };
export type AirLatest = Partial<AirReading> & { device_id: string; age_ms: number | null; stale: boolean };
export type Airbox = { device_id: string; display_name: string | null; last_reading: string | null; connected: boolean };

// ---------------------------------------------------------------- live state
const latest = ref<Reading | null>(null);
const error = ref('');
const ingestionError = ref<string | null>(null);
const mqttConnected = ref(false);
const stale = ref(true);
const staleAfterMs = ref(3 * 60000);  // from the server: no report for this long = interrupted
const loaded = ref(false);
const air = ref<AirLatest | null>(null);  // null: no air box has ever reported

// Air box picker: '' follows the server default (CLOTHES_AIRBOX_ID or the one that reported last).
const airboxes = ref<Airbox[]>([]);
const defaultAirboxId = ref<string | null>(null);
const AIRBOX_KEY = 'clothes-airbox';
const airboxChoice = ref((() => { try { return localStorage.getItem(AIRBOX_KEY) ?? ''; } catch { return ''; } })());
const airboxOptions = computed(() => {
  const shown = airboxes.value.filter((box) => box.connected);
  const picked = airboxes.value.find((box) => box.device_id === airboxChoice.value);
  if (picked && !picked.connected) shown.push(picked);  // keep the current choice visible even if it dropped off
  return shown;
});
export const airboxLabel = (box: Airbox) =>
  `${box.display_name ? `${box.display_name}（${box.device_id}）` : box.device_id}${box.connected ? '' : '（離線）'}`;
// Adds ?airbox= only for an explicit choice, so "auto" keeps following the server default.
export const withAirbox = (params: URLSearchParams) => { if (airboxChoice.value) params.set('airbox', airboxChoice.value); return params; };

const controllers = new Set<AbortController>();
export async function request(path: string) {
  const controller = new AbortController();
  controllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(path, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Request failed');
    return data;
  } finally { clearTimeout(timeout); controllers.delete(controller); }
}

let airboxesLoaded = 0;
async function loadAirboxes() {
  try {
    const data = await request('/api/v1/clothes/airboxes');
    if (!liveUsers) return;
    airboxes.value = data.airboxes; defaultAirboxId.value = data.default_id; airboxesLoaded = Date.now();
  } catch { /* the picker keeps its last list */ }
}

async function loadLatest() {
  try {
    const choice = airboxChoice.value;
    const query = withAirbox(new URLSearchParams()).toString();
    const data = await request(`/api/v1/clothes/latest${query ? `?${query}` : ''}`);
    if (!liveUsers || choice !== airboxChoice.value) return;  // the user switched air box meanwhile
    latest.value = data.data; stale.value = data.stale;
    if (typeof data.stale_after_ms === 'number') staleAfterMs.value = data.stale_after_ms;
    mqttConnected.value = data.mqtt_connected; ingestionError.value = data.ingestion_error;
    air.value = data.air ?? null;
    error.value = ''; loaded.value = true;
  } catch { if (liveUsers) error.value = '無法取得最新資料'; }
}

const connectionTone = computed<'live' | 'waiting' | 'failed'>(() =>
  error.value || ingestionError.value ? 'failed' : !latest.value || stale.value || !mqttConnected.value ? 'waiting' : 'live');
const connectionText = computed(() => {
  if (error.value) return 'Server／資料庫連線異常';
  if (ingestionError.value) return '資料寫入異常';
  if (!loaded.value) return '正在連線';
  if (!mqttConnected.value) return 'MQTT 尚未連線';
  if (!latest.value) return '等待衣夾資料';
  return stale.value ? `資料中斷（超過 ${Math.round(staleAfterMs.value / 60000)} 分鐘）` : '正在接收資料';
});
// The real clip counts as online while it is sending fresh data.
const clipOnline = computed(() => !!latest.value && !stale.value);

// ---------------------------------------------------------------- history window
const records = ref<Reading[]>([]);
const airRecords = ref<AirReading[]>([]);
const historyError = ref('');
const historyLoading = ref(true);
const truncated = ref(false);
const bucketSeconds = ref(0);

export const PRESETS = [
  { minutes: 5, label: '5 分' }, { minutes: 15, label: '15 分' }, { minutes: 60, label: '1 小時' },
  { minutes: 360, label: '6 小時' }, { minutes: 1440, label: '24 小時' },
];
const mode = ref('15');  // preset minutes as text, or 'custom'
const customStart = ref('');
const customEnd = ref('');
const rangeError = ref('');
const range = ref({ start: new Date(Date.now() - 15 * 60000), end: new Date() });
let historyUpdated = 0;
let historyRequest = 0;
const refreshSeconds = computed(() => Number(mode.value) > 60 ? 30 : 5);

async function loadHistory(start: Date, end: Date) {
  const id = ++historyRequest;  // ignore responses for a range the user already left
  try {
    const params = withAirbox(new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), limit: '5000' }));
    const data = await request(`/api/v1/clothes/history?${params}`);
    if (!historyUsers || id !== historyRequest) return;
    range.value = { start, end };
    records.value = data.records; truncated.value = data.truncated; bucketSeconds.value = data.bucket_seconds ?? 0;
    airRecords.value = data.air?.records ?? [];
    historyError.value = ''; historyUpdated = Date.now();
  } catch { if (historyUsers && id === historyRequest) historyError.value = '歷史資料更新失敗，正在等待重新連線。'; }
  finally { if (historyUsers && id === historyRequest) historyLoading.value = false; }
}

function loadPreset() {
  const end = new Date();
  return loadHistory(new Date(end.getTime() - Number(mode.value) * 60000), end);
}

function applyCustom() {
  const start = fromTaipeiInput(customStart.value), end = fromTaipeiInput(customEnd.value);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) rangeError.value = '請輸入開始與結束時間。';
  else if (start >= end) rangeError.value = '結束時間必須晚於開始時間。';
  else if (end.getTime() - start.getTime() > DAY_MS) rangeError.value = '一次最多查詢 24 小時。';
  else {
    rangeError.value = ''; historyLoading.value = true; records.value = [];
    void loadHistory(start, end);
  }
}

watch(mode, (value) => {
  rangeError.value = '';
  if (value === 'custom') {
    // Start from the window currently on screen so the user only adjusts it.
    customStart.value = toTaipeiInput(range.value.start); customEnd.value = toTaipeiInput(range.value.end);
    return;
  }
  historyUpdated = 0; historyLoading.value = true; records.value = [];
});
watch(airboxChoice, (value) => {
  try { localStorage.setItem(AIRBOX_KEY, value); } catch { /* choice just lasts for this visit */ }
  air.value = null; airRecords.value = [];
  if (liveUsers) void loadLatest();
  // Reload the same window with the new air box (presets refresh on the next poll).
  if (!historyUsers) return;
  if (mode.value === 'custom') void loadHistory(range.value.start, range.value.end); else historyUpdated = 0;
});

// ---------------------------------------------------------------- polling (ref-counted)
let liveUsers = 0;
let historyUsers = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

async function poll() {
  const historyDue = historyUsers > 0 && mode.value !== 'custom' && Date.now() - historyUpdated >= refreshSeconds.value * 1000;
  const listDue = Date.now() - airboxesLoaded >= 30000;
  await Promise.all([loadLatest(), historyDue ? loadPreset() : Promise.resolve(), listDue ? loadAirboxes() : Promise.resolve()]);
  if (liveUsers) timer = setTimeout(poll, 1000); else running = false;
}
function ensurePolling() {
  if (running) return;
  running = true;
  void poll();
}
function stopIfIdle() {
  if (liveUsers) return;
  clearTimeout(timer); running = false;
  controllers.forEach((controller) => controller.abort());
}

// ---------------------------------------------------------------- public API
const liveState = {
  latest, error, ingestionError, mqttConnected, stale, staleAfterMs, loaded, air, clipOnline,
  airboxes, defaultAirboxId, airboxChoice, airboxOptions, connectionTone, connectionText,
};

// Read-only access without registering a consumer; it only updates while a page uses
// useClothesLive() or useClothesHistory().
export const clothesLiveState = liveState;

export function useClothesLive() {
  onMounted(() => { liveUsers++; ensurePolling(); });
  onUnmounted(() => { liveUsers--; stopIfIdle(); });
  return liveState;
}

// History also needs the live poll, so it registers as a live user too.
export function useClothesHistory() {
  onMounted(() => {
    liveUsers++; historyUsers++;
    if (mode.value !== 'custom') historyUpdated = 0;  // refresh as soon as a page opens
    ensurePolling();
  });
  onUnmounted(() => { liveUsers--; historyUsers--; stopIfIdle(); });
  return {
    ...liveState,
    records, airRecords, historyError, historyLoading, truncated, bucketSeconds,
    mode, customStart, customEnd, rangeError, range, refreshSeconds, applyCustom, loadHistory,
  };
}
