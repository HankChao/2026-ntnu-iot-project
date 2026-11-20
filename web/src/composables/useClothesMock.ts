// Demo data for features the server does not have yet: garment library, extra clips,
// drying sessions, history records, connection events and outdoor weather.
// Everything here is front-end only and kept in localStorage; pages that show it carry
// a "示範資料" note. 衣夾-01 is the real clip (live: true) — its online state comes from
// the server, see useClothesData.ts.
//
// 設定 → 示範資料 turns the demo off: only the real clip is listed, there is no demo
// weather, and garments / sessions / records come from a separate, initially empty store
// (clothes-local-v1) that holds what the user actually records. The demo store is kept, so
// turning the demo back on restores it. Both stores move to the server later.
import { computed, reactive, ref, watch } from 'vue';
import { BASE_MINUTES, type Material, type StyleKey } from '../constants/garments';
import { DAY_MS, TAIPEI_MS } from '../utils/format';
import { clothesLiveState } from './useClothesData';

const SENSOR_KEYS = ['hx711_raw', 'ads1115_raw', 'touch_raw'] as const;

export interface Garment { id: string; name: string; style: StyleKey; color: string; material: Material }
export type GarmentDraft = Omit<Garment, 'id'>;
export interface Session { id: string; clipId: string; garmentId: string; startedAt: number; totalMin: number }
export interface DryRecord { id: string; garmentId: string; startedAt: number; actualMin: number | null; predictedMin: number; outcome: 'dry' | 'early' }
export type Method = 'hx711_raw' | 'ads1115_raw' | 'touch_raw';

export interface ClipDevice {
  id: string; name: string; live: boolean; topic: string; chip: string; ip: string | null; fw: string | null;
  signal: '良好' | '偏弱'; bootMinAgo: number; offlineMinAgo: number | null; issue: string | null; lastBox: string;
}

// Fixed device list (demo). Offline / issue states are part of the demo.
export const CLIP_DEVICES: ClipDevice[] = [
  { id: 'c1', name: '衣夾-01', live: true, topic: 'clothes/raw', chip: 'ESP32-S3', ip: null, fw: null, signal: '良好', bootMinAgo: 0, offlineMinAgo: null, issue: null, lastBox: '' },
  { id: 'c2', name: '衣夾-02', live: false, topic: 'clothes/02/raw', chip: 'ESP32-S3', ip: '192.168.0.43', fw: '0.3.1', signal: '偏弱', bootMinAgo: 47, offlineMinAgo: null, issue: '重量感測連續 12 筆讀取失敗，請檢查秤重感測器排線', lastBox: '' },
  { id: 'c3', name: '衣夾-03', live: false, topic: 'clothes/03/raw', chip: 'ESP32-S3', ip: '192.168.0.44', fw: '0.3.1', signal: '良好', bootMinAgo: 130, offlineMinAgo: null, issue: null, lastBox: '' },
  { id: 'c4', name: '衣夾-04', live: false, topic: 'clothes/04/raw', chip: 'ESP32-S3', ip: '192.168.0.45', fw: '0.3.1', signal: '良好', bootMinAgo: 150, offlineMinAgo: null, issue: null, lastBox: '' },
  { id: 'c5', name: '衣夾-05', live: false, topic: 'clothes/05/raw', chip: 'ESP32-S3', ip: '192.168.0.46', fw: '0.3.0', signal: '良好', bootMinAgo: 95, offlineMinAgo: null, issue: null, lastBox: '' },
  { id: 'c6', name: '衣夾-06', live: false, topic: 'clothes/06/raw', chip: 'ESP32-S3', ip: '192.168.0.47', fw: '0.3.1', signal: '良好', bootMinAgo: 1440, offlineMinAgo: null, issue: null, lastBox: '陽台' },
  { id: 'c7', name: '衣夾-07', live: false, topic: 'clothes/07/raw', chip: 'ESP32-S3', ip: '192.168.0.48', fw: '0.3.1', signal: '偏弱', bootMinAgo: 380, offlineMinAgo: null, issue: null, lastBox: '浴室' },
  { id: 'c8', name: '衣夾-08', live: false, topic: 'clothes/08/raw', chip: 'ESP32-S3', ip: null, fw: '0.2.4', signal: '偏弱', bootMinAgo: 0, offlineMinAgo: 2 * 1440 + 90, issue: null, lastBox: '陽台' },
];

// Demo prediction error per sensing method (minutes).
export const METHOD_ERROR: Record<Method, number> = { hx711_raw: 18, ads1115_raw: 31, touch_raw: 47 };

const DRYNESS_EXP = 1.25;
export const DRY_THRESHOLD = 5;  // % remaining moisture counted as dry

interface State {
  v: 1;
  seededAt: number;
  garments: Garment[];
  sessions: Session[];
  records: DryRecord[];
  removed: string[];          // clip ids the user removed from the device list
  methods: Record<string, Method>;
  focus: string | null;       // session to show first on the overview
}

const DEMO_KEY = 'clothes-demo-v1';
const LOCAL_KEY = 'clothes-local-v1';
const ENABLED_KEY = 'clothes-demo-enabled';  // TODO: becomes a server-side setting
const MIN = 60000;

function seed(now = Date.now()): State {
  const garments: Garment[] = [
    { id: 'g1', name: '白色班服', style: 'tee', color: '#F2F1EC', material: '棉' },
    { id: 'g2', name: '牛仔褲', style: 'pants', color: '#4A6FA5', material: '牛仔布' },
    { id: 'g3', name: '運動背心', style: 'tank', color: '#2A2B30', material: '聚酯纖維' },
    { id: 'g4', name: '亞麻襯衫', style: 'shirt', color: '#D8CBB0', material: '麻' },
    { id: 'g5', name: '黃色浴巾', style: 'towel', color: '#E9C46A', material: '毛巾布' },
    { id: 'g6', name: '黑色運動褲', style: 'pants', color: '#2A2B30', material: '聚酯纖維' },
    { id: 'g7', name: '條紋毛巾', style: 'towel', color: '#4A6FA5', material: '毛巾布' },
    { id: 'g8', name: '灰色帽 T', style: 'shirt', color: '#9AA3AD', material: '棉' },
  ];
  // [clip, garment, elapsed min, remaining min]
  const active: [string, string, number, number][] = [
    ['c1', 'g1', 205, 135], ['c2', 'g2', 205, 295], ['c3', 'g3', 110, 40], ['c4', 'g4', 130, 185], ['c5', 'g5', 80, 345],
  ];
  const sessions = active.map(([clipId, garmentId, elapsed, left], i) => ({
    id: `s${i + 1}`, clipId, garmentId, startedAt: now - elapsed * MIN, totalMin: elapsed + left,
  }));
  // [days ago, start hour, garment, actual min (null = taken in early), predicted min]
  const past: [number, number, string, number | null, number][] = [
    [1, 9.5, 'g1', 280, 265], [1, 10, 'g2', 455, 420], [2, 8, 'g7', 320, 340], [3, 13, 'g3', 110, 115],
    [4, 9, 'g4', 350, 310], [5, 9, 'g1', 295, 300], [6, 10, 'g6', 150, 140], [7, 11, 'g7', 335, 320],
    [8, 9, 'g1', 270, 290], [9, 14, 'g3', 105, 100], [10, 9, 'g8', 300, 285], [11, 10, 'g6', null, 160],
    [12, 9, 'g2', 470, 450], [13, 8, 'g8', 275, 290],
  ];
  const todayStart = Math.floor((now + TAIPEI_MS) / DAY_MS) * DAY_MS - TAIPEI_MS;
  const records: DryRecord[] = past.map(([days, hour, garmentId, actualMin, predictedMin], i) => ({
    id: `r${i + 1}`, garmentId, startedAt: todayStart - days * DAY_MS + hour * 60 * MIN,
    actualMin, predictedMin, outcome: actualMin == null ? 'early' : 'dry',
  }));
  return { v: 1, seededAt: now, garments, sessions, records, removed: [], methods: {}, focus: null };
}

// Real use starts empty; only what the user records goes in here.
const empty = (now = Date.now()): State => ({ v: 1, seededAt: now, garments: [], sessions: [], records: [], removed: [], methods: {}, focus: null });

function load(key: string, fallback: () => State): State {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved && saved.v === 1 && Array.isArray(saved.garments) && Array.isArray(saved.sessions)) return saved as State;
  } catch { /* fall back to fresh data */ }
  return fallback();
}
function save(key: string, value: State) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* data just resets on reload */ }
}

const demoEnabled = ref((() => { try { return localStorage.getItem(ENABLED_KEY) !== 'false'; } catch { return true; } })());
const storeKey = () => (demoEnabled.value ? DEMO_KEY : LOCAL_KEY);
const loadStore = () => (demoEnabled.value ? load(DEMO_KEY, seed) : load(LOCAL_KEY, empty));

const state = reactive<State>(loadStore());
watch(state, (value) => save(storeKey(), value), { deep: true });

function setDemoEnabled(on: boolean) {
  if (on === demoEnabled.value) return;
  save(storeKey(), state);  // keep the store being left
  demoEnabled.value = on;
  try { localStorage.setItem(ENABLED_KEY, String(on)); } catch { /* setting just resets on reload */ }
  Object.assign(state, loadStore());
}

// Clock for time-based demo values; coarse on purpose.
const now = ref(Date.now());
setInterval(() => { now.value = Date.now(); }, 15000);

let counter = 0;
const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

// ---------------------------------------------------------------- derived helpers
// Remaining moisture reaches DRY_THRESHOLD exactly at startedAt + totalMin.
const DRY_K = 1 - (DRY_THRESHOLD / 100) ** (1 / DRYNESS_EXP);
export function moistureAt(session: Session, at: number) {
  const p = Math.max(0, (at - session.startedAt) / (session.totalMin * MIN));
  return Math.round(100 * Math.max(0, 1 - p * DRY_K) ** DRYNESS_EXP);
}
export const dryAt = (session: Session) => session.startedAt + session.totalMin * MIN;

const garmentById = (id: string) => state.garments.find((g) => g.id === id);
const dryCount = (garmentId: string) => state.records.filter((r) => r.garmentId === garmentId && r.outcome === 'dry').length;

function predictMinutes(garment: GarmentDraft & { id?: string }) {
  const past = garment.id ? state.records.filter((r) => r.garmentId === garment.id && r.actualMin != null) : [];
  if (past.length) return Math.round(past.reduce((sum, r) => sum + r.actualMin!, 0) / past.length);
  return BASE_MINUTES[garment.material];
}

// Demo weather: rain from 17:00 Taipei today (or tomorrow once 17:00 has passed).
// There is no real weather source yet, so it is null with the demo off.
const weather = computed(() => {
  if (!demoEnabled.value) return null;
  const dayStart = Math.floor((now.value + TAIPEI_MS) / DAY_MS) * DAY_MS - TAIPEI_MS;
  let rainAt = dayStart + 17 * 60 * MIN;
  if (rainAt <= now.value) rainAt += DAY_MS;
  return { summary: '戶外晴 31°', rainAt, rainChance: 60 };
});

export type ClipTone = 'on' | 'warn' | 'off';
export interface ClipStatus { online: boolean; tone: ClipTone; label: string; lastSeenMs: number | null; uptimeMin: number | null }

// Online state per clip: the real clip from the server, the others from the demo list.
function clipStatus(d: ClipDevice): ClipStatus {
  if (d.live) {
    const { latest, clipOnline } = clothesLiveState;
    const lastSeenMs = latest.value ? Math.max(0, now.value - new Date(latest.value.timestamp).getTime()) : null;
    const online = clipOnline.value;
    const issue = online && latest.value && SENSOR_KEYS.some((k) => latest.value![k] === null);
    return { online, tone: !online ? 'off' : issue ? 'warn' : 'on', label: !online ? (latest.value ? '資料中斷' : '離線') : issue ? '感測異常' : '在線', lastSeenMs, uptimeMin: null };
  }
  if (d.offlineMinAgo != null) return { online: false, tone: 'off', label: '離線', lastSeenMs: d.offlineMinAgo * MIN, uptimeMin: null };
  return { online: true, tone: d.issue ? 'warn' : 'on', label: d.issue ? '感測異常' : '在線',
    lastSeenMs: (1 + (d.id.charCodeAt(1) % 3)) * 1000, uptimeMin: d.bootMinAgo + Math.round((now.value - state.seededAt) / MIN) };
}

const activeClipIds = computed(() => new Set(state.sessions.map((s) => s.clipId)));
const busyGarmentIds = computed(() => new Set(state.sessions.map((s) => s.garmentId)));
// With the demo off only the real clip exists.
const shownClip = (d: ClipDevice) => demoEnabled.value || d.live;
const devices = computed(() => CLIP_DEVICES.filter((d) => shownClip(d) && !state.removed.includes(d.id)));

// ---------------------------------------------------------------- mutations
function updateGarment(id: string, patch: Partial<GarmentDraft>) {
  const g = garmentById(id);
  if (g) Object.assign(g, patch);
}
function addGarment(draft: GarmentDraft) {
  const g: Garment = { id: uid('g'), ...draft };
  state.garments.push(g);
  return g;
}
function swapGarment(sessionId: string, garmentId: string) {
  const s = state.sessions.find((x) => x.id === sessionId);
  const g = garmentById(garmentId);
  if (!s || !g) return;
  const elapsed = (now.value - s.startedAt) / MIN;
  s.garmentId = garmentId;
  s.totalMin = Math.max(Math.round(elapsed) + 10, predictMinutes(g));  // re-predict for the new garment
}
function startSession(clipId: string, garment: { id: string } | GarmentDraft) {
  const g = 'id' in garment ? garmentById(garment.id) : addGarment(garment);
  if (!g) return null;
  const s: Session = { id: uid('s'), clipId, garmentId: g.id, startedAt: Date.now(), totalMin: predictMinutes(g) };
  state.sessions.push(s);
  state.focus = s.id;
  return s;
}
function endSession(sessionId: string, how: 'dry' | 'early' | 'cancel') {
  const i = state.sessions.findIndex((x) => x.id === sessionId);
  if (i < 0) return;
  const [s] = state.sessions.splice(i, 1);
  if (how === 'cancel') return;
  const actual = Math.round((Date.now() - s.startedAt) / MIN);
  state.records.push({ id: uid('r'), garmentId: s.garmentId, startedAt: s.startedAt,
    actualMin: how === 'dry' ? actual : null, predictedMin: s.totalMin, outcome: how });
}
function setMethod(clipId: string, method: Method) { state.methods[clipId] = method; }
function removeDevice(clipId: string) { if (!state.removed.includes(clipId)) state.removed.push(clipId); }
function clearFocus() { state.focus = null; }
function reset() { Object.assign(state, demoEnabled.value ? seed() : empty()); }

export function useClothesMock() {
  return {
    state, now, weather, devices, activeClipIds, busyGarmentIds, demoEnabled,
    garmentById, dryCount, predictMinutes, clipStatus,
    clipById: (id: string) => CLIP_DEVICES.find((d) => d.id === id && shownClip(d)),
    updateGarment, addGarment, swapGarment, startSession, endSession, setMethod, removeDevice, clearFocus, reset, setDemoEnabled,
  };
}
