// What the clothes pages read: clips, garments, sessions and records from the server
// (useDrying.ts), plus the parts of the demo that are not records and so stay in the front end:
// how the demo clips 衣夾-02～06 look (chip, IP, signal, faults), the demo weather, the demo
// moisture curve and the demo error per sensing method.
//
// Real or demo is decided per clip: 衣夾-01 is the real clip; the demo clips, garments, sessions
// and records are stored on the server with is_demo = true and written by `make seed`. Every item
// carries `demo` so pages can label it. With the demo setting off, the server sends real data only.
import { computed, reactive, ref } from 'vue';
import { BASE_MINUTES } from '../constants/garments';
import { DAY_MS, TAIPEI_MS } from '../utils/format';
import { clothesLiveState, type Field } from './useClothesData';
import { dryAtOf, dryingApi, dryingState, useDrying, type ClipReading, type Garment, type GarmentDraft, type RecordPatch, type Session } from './useDrying';
import { loadSettings, saveSettings, useSettings } from './useSettings';
import type { Divider } from '../utils/resistance';
import type { Scale } from '../utils/weight';
import { demoLatest, demoMoisture, type DemoSession } from '../utils/demoSensor';

export type { DryRecord, Garment, GarmentDraft, RecordPatch, Session, SessionDetail } from './useDrying';
export type Method = Field;

const SENSOR_KEYS = ['hx711_raw', 'ads1115_raw', 'touch_raw'] as const;
const MIN = 60000;

export interface ClipDevice {
  id: string; name: string; live: boolean; demo: boolean; topic: string; chip: string; ip: string | null; fw: string | null;
  deviceId: string | null; online: boolean; latest: ClipReading | null;  // real clips: from the server
  dividers: Divider[];
  scales: Scale[];
  signal: '良好' | '偏弱'; bootMinAgo: number; offlineMinAgo: number | null; issue: string | null; lastBox: string;
}
type ClipLook = Omit<ClipDevice, 'id' | 'name' | 'live' | 'demo' | 'deviceId' | 'online' | 'latest' | 'dividers' | 'scales'>;

// How each clip looks on the device page. Only 衣夾-01 is real; the rest is part of the demo.
// Clip ids are UUIDs, so the demo looks are found by the demo clip's name.
const REAL_LOOK: ClipLook = { topic: '—', chip: 'ESP32-S3', ip: null, fw: null, signal: '良好', bootMinAgo: 0, offlineMinAgo: null, issue: null, lastBox: '' };
const DEMO_LOOK: Record<string, ClipLook> = {
  '衣夾-02': { topic: 'clothes/02/raw', chip: 'ESP32-S3', ip: '192.168.0.43', fw: '0.5.0', signal: '偏弱', bootMinAgo: 47, offlineMinAgo: null, issue: null, lastBox: '' },
  '衣夾-03': { topic: 'clothes/03/raw', chip: 'ESP32-S3', ip: '192.168.0.44', fw: '0.3.1', signal: '良好', bootMinAgo: 130, offlineMinAgo: null, issue: null, lastBox: '' },
  '衣夾-04': { topic: 'clothes/04/raw', chip: 'ESP32-S3', ip: '192.168.0.45', fw: '0.3.1', signal: '良好', bootMinAgo: 150, offlineMinAgo: null, issue: null, lastBox: '' },
  '衣夾-05': { topic: 'clothes/05/raw', chip: 'ESP32-S3', ip: '192.168.0.46', fw: '0.3.0', signal: '良好', bootMinAgo: 95, offlineMinAgo: null, issue: null, lastBox: '' },
  '衣夾-06': { topic: 'clothes/06/raw', chip: 'ESP32-S3', ip: '192.168.0.47', fw: '0.3.1', signal: '良好', bootMinAgo: 1440, offlineMinAgo: null, issue: null, lastBox: '陽台' },
};
const PLAIN_DEMO_LOOK: ClipLook = { ...REAL_LOOK, topic: '—' };

// Demo prediction error per sensing method (minutes).
export const METHOD_ERROR: Record<Method, number> = { hx711_raw: 18, ads1115_raw: 31, touch_raw: 47 };

export const DRY_THRESHOLD = 5;  // % remaining moisture counted as dry

// ---------------------------------------------------------------- settings
const { settings } = useSettings();
const demoEnabled = computed(() => settings.demo_data);
// Stored on the server first; the page only switches once that worked. Throws on failure.
async function setDemoEnabled(on: boolean) {
  if (on !== settings.demo_data) await saveSettings({ demo_data: on });
}

// Clock for time-based values; coarse on purpose.
const now = ref(Date.now());
setInterval(() => { now.value = Date.now(); }, 15000);
const loadedAt = Date.now();

// ---------------------------------------------------------------- derived helpers
// Demo moisture only (the real clip has no moisture estimate yet): the water left in the simulated
// weight curve of the session (utils/demoSensor.ts), which reaches DRY_THRESHOLD at startedAt + totalMin.
export function moistureAt(session: Session, at: number) {
  return Math.round(demoMoisture(session, at));
}
export const moistureCurve = (session: Session) => (at: number) => demoMoisture(session, at);
export const dryAt = dryAtOf;

const { clips, garments, sessions, records, garmentMap } = dryingState;
const garmentById = (id: string): Garment | undefined => garmentMap.value.get(id);
const dryCount = (garmentId: string) => garmentById(garmentId)?.dryCount ?? 0;

// Same rule as the server (app/src/clothes/prediction.ts): this garment's average 'dry' time,
// or the material default. Used for previews; the stored prediction comes from the server.
function predictMinutes(garment: GarmentDraft & { id?: string }) {
  const past = garment.id ? records.value.filter((r) => r.garmentId === garment.id && r.outcome === 'dry' && r.actualMin != null) : [];
  if (past.length) return Math.max(1, Math.round(past.reduce((sum, r) => sum + r.actualMin!, 0) / past.length));
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
export interface ClipStatus {
  online: boolean; tone: ClipTone; label: string; lastSeenMs: number | null; uptimeMin: number | null;
  latest: ClipReading | null;  // newest reading of a real clip
}

// Online state per clip: the real clip from the server, the demo clips simulated.
function clipStatus(d: ClipDevice): ClipStatus {
  if (d.live) {
    // The clip the live poll follows is fresher than the clip list (which reloads every 30 s).
    const live = clothesLiveState;
    const followed = live.clipSettings.value?.id === d.id && live.loaded.value;
    const latest = followed ? live.latest.value : d.latest;
    const lastSeenMs = latest ? Math.max(0, now.value - new Date(latest.timestamp).getTime()) : null;
    const online = followed ? live.clipOnline.value : d.online && lastSeenMs !== null && lastSeenMs <= live.staleAfterMs.value;
    const issue = online && latest && SENSOR_KEYS.some((k) => latest[k] === null);
    return { online, tone: !online ? 'off' : issue ? 'warn' : 'on', label: !online ? (latest ? '資料中斷' : '離線') : issue ? '感測異常' : '在線', lastSeenMs, uptimeMin: null, latest };
  }
  if (d.offlineMinAgo != null) return { online: false, tone: 'off', label: '離線', lastSeenMs: d.offlineMinAgo * MIN, uptimeMin: null, latest: null };
  // Demo clips "report" the simulated reading of the current minute.
  return { online: true, tone: d.issue ? 'warn' : 'on', label: d.issue ? '感測異常' : '在線', latest: demoLatest(d.id, demoSessionsOf(d.id), now.value),
    lastSeenMs: (1 + (d.name.charCodeAt(d.name.length - 1) % 3)) * 1000, uptimeMin: d.bootMinAgo + Math.round((now.value - loadedAt) / MIN) };
}

// Clips from the server, dressed with how they look. The server leaves demo clips out with the demo off.
const devices = computed<ClipDevice[]>(() => clips.value.map((c) => ({
  ...(c.demo ? DEMO_LOOK[c.name] ?? PLAIN_DEMO_LOOK : { ...REAL_LOOK, topic: c.topic ?? '—' }),
  id: c.id, name: c.name, live: !c.demo, demo: c.demo, deviceId: c.deviceId, online: c.online, latest: c.latest, dividers: c.dividers, scales: c.scales,
})));
const clipById = (id: string) => devices.value.find((d) => d.id === id);
// All sessions of a demo clip (drying and ended), for its simulated readings.
function demoSessionsOf(clipId: string): DemoSession[] {
  return [
    ...sessions.value.filter((s) => s.clipId === clipId && s.demo).map((s) => ({ id: s.id, startedAt: s.startedAt, totalMin: s.totalMin, seed: s.seed })),
    ...records.value.filter((r) => r.clipId === clipId && r.demo)
      .map((r) => ({ id: r.id, startedAt: r.startedAt, totalMin: r.predictedMin, endedAt: r.endedAt, seed: r.seed })),
  ];
}
const methodOf = (clipId: string): Method => clips.value.find((c) => c.id === clipId)?.predictMethod ?? 'hx711_raw';

// Same rule as the server: names repeat neither among real nor among demo garments
// (case and surrounding spaces ignored). Used to warn before saving; the server checks again.
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const garmentNameTaken = (name: string, demo: boolean, exceptId?: string) =>
  !!name.trim() && garments.value.some((g) => g.demo === demo && g.id !== exceptId && sameName(g.name, name));

const activeClipIds = computed(() => new Set(sessions.value.map((s) => s.clipId)));
const busyGarmentIds = computed(() => new Set(sessions.value.map((s) => s.garmentId)));

// Pages read these like the old local store did.
const focus = ref<string | null>(null);  // session to show first on the overview
const state = reactive({ garments, sessions, records, focus });

// ---------------------------------------------------------------- writes
// Every write goes to the server. On failure the error is kept in actionError (pages show it)
// and the call returns null; nothing is changed locally.
const actionError = ref('');
async function attempt<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    const result = await work();
    actionError.value = '';
    return result;
  } catch (err) {
    actionError.value = `沒有儲存：${(err as Error).message}`;
    return null;
  }
}

const updateGarment = (id: string, patch: Partial<GarmentDraft>) => attempt(() => dryingApi.updateGarment(id, patch));
const addGarment = (draft: GarmentDraft, demo: boolean) => attempt(() => dryingApi.addGarment(draft, demo));
const deleteGarment = (id: string) => attempt(() => dryingApi.deleteGarment(id));
const updateRecord = (id: string, patch: RecordPatch) => attempt(() => dryingApi.updateRecord(id, patch));
const deleteRecord = (id: string) => attempt(() => dryingApi.deleteRecord(id));
const swapGarment = (sessionId: string, garmentId: string) => attempt(() => dryingApi.swapGarment(sessionId, garmentId));
async function startSession(clipId: string, garment: { id: string } | GarmentDraft, demo?: { seed: number; elapsed_min: number }) {
  const session = await attempt(() => dryingApi.startSession(clipId, garment, demo));
  if (session) focus.value = session.id;
  return session;
}
const endSession = (sessionId: string, how: 'dry' | 'early' | 'cancel') => attempt(() => dryingApi.endSession(sessionId, how));
const setMethod = (clipId: string, method: Method) => attempt(() => dryingApi.setClipMethod(clipId, method));
const removeDevice = (clipId: string) => attempt(() => dryingApi.removeClip(clipId));
const addDivider = (clipId: string, divider: { since: string; divider_ohm: number; open_count: number }) =>
  attempt(() => dryingApi.addDivider(clipId, divider));
const deleteDivider = (clipId: string, dividerId: string) => attempt(() => dryingApi.deleteDivider(clipId, dividerId));
const addScale = (clipId: string, scale: { since: string; tare_count: number; counts_per_gram: number }) =>
  attempt(() => dryingApi.addScale(clipId, scale));
const deleteScale = (clipId: string, scaleId: string) => attempt(() => dryingApi.deleteScale(clipId, scaleId));
const reset = () => attempt(() => dryingApi.resetDemo());
function clearFocus() { focus.value = null; }

// Call from a page's setup: it also keeps the server data fresh while the page is open.
export function useClothesMock() {
  void loadSettings();
  useDrying();
  return {
    state, now, weather, devices, activeClipIds, busyGarmentIds, demoEnabled, actionError, loaded: dryingState.loaded, loadError: dryingState.loadError,
    garmentById, dryCount, predictMinutes, clipStatus, clipById, methodOf, garmentNameTaken, demoSessionsOf,
    updateGarment, addGarment, deleteGarment, updateRecord, deleteRecord, swapGarment, startSession, endSession, setMethod, removeDevice, addDivider, deleteDivider, addScale, deleteScale, clearFocus, reset, setDemoEnabled,
  };
}
