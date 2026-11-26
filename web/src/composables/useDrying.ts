// Clips, garments, drying sessions and records from the server — real and demo alike.
// Demo rows are stored on the server with is_demo = true; they are only requested
// (?demo=include) while the demo data setting is on, and every row keeps its `demo` flag
// so pages can label it. Writes go to the server; the page changes only after they succeed.
//
// Module-level store: pages call useDrying() from setup; polling runs while one is mounted.
import type { Divider } from '../utils/resistance';
import type { Scale } from '../utils/weight';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Material, StyleKey } from '../constants/garments';
import type { Field } from './useClothesData';
import { useSettings } from './useSettings';
import { apiFetch } from './useAuth';

export interface Garment {
  id: string; name: string; style: StyleKey; color: string; material: Material;
  demo: boolean; dryCount: number; sessionCount: number; busy: boolean;
}
export type GarmentDraft = Pick<Garment, 'name' | 'style' | 'color' | 'material'>;
// seed: demo sessions only, the seed of their simulated sensor curves (utils/demoSensor.ts).
export interface Session { id: string; clipId: string; garmentId: string; startedAt: number; totalMin: number; demo: boolean; seed: number | null }
export interface DryRecord {
  id: string; clipId: string; garmentId: string; startedAt: number; endedAt: number;
  actualMin: number | null; predictedMin: number; outcome: 'dry' | 'early'; demo: boolean; seed: number | null;
}
// One session from GET /sessions/:id: drying (endedAt null) or ended.
export interface SessionDetail {
  id: string; clipId: string; garmentId: string; startedAt: number; endedAt: number | null; predictedMin: number;
  actualMin: number | null; outcome: 'dry' | 'early' | null; demo: boolean; seed: number | null;
  garment: { id: string; name: string; style: StyleKey; color: string; material: Material };
}
export interface RecordPatch { garment_id?: string; started_at?: string; ended_at?: string }
export interface ClipReading { timestamp: string; hx711_raw: number | null; ads1115_raw: number | null; touch_raw: number | null }
// deviceId: the ESP32's id once the clip has reported; online/latest come from the server per clip.
export interface Clip {
  id: string; name: string; topic: string | null; demo: boolean; predictMethod: Field; airboxId: string | null;
  deviceId: string | null; online: boolean; latest: ClipReading | null;
  dividers: Divider[];  // divider resistor settings for showing the resistance in ohms (oldest first)
  scales: Scale[];      // HX711 calibrations for showing the weight in grams (oldest first)
}

const MIN = 60000;
const API = '/api/v1/clothes';

const clips = ref<Clip[]>([]);
const garments = ref<Garment[]>([]);
const sessions = ref<Session[]>([]);
const records = ref<DryRecord[]>([]);
const loaded = ref(false);
const loadError = ref('');

const { settings } = useSettings();
const demoQuery = () => (settings.demo_data ? '?demo=include' : '');
// Own fetch helper (not useClothesData's request), so leaving a live page never aborts a write here.
async function request(path: string, init: { method?: string; body?: unknown } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await apiFetch(path, {
      cache: 'no-store', signal: controller.signal, method: init.method,
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) throw new Error(data?.error || `HTTP ${response.status}`);
    return data;
  } catch (err) {
    throw (err as Error).name === 'AbortError' ? new Error('伺服器沒有回應') : err;
  } finally { clearTimeout(timeout); }
}

const ms = (value: string | null) => (value ? new Date(value).getTime() : 0);

/* eslint-disable @typescript-eslint/no-explicit-any */
const toClip = (c: any): Clip => ({
  id: c.id, name: c.name, topic: c.topic, demo: c.is_demo, predictMethod: c.predict_method, airboxId: c.airbox_id,
  deviceId: c.device_id ?? null, online: !!c.online, latest: c.latest ?? null, dividers: c.dividers ?? [], scales: c.scales ?? [],
});
const toGarment = (g: any): Garment => ({
  id: g.id, name: g.name, style: g.style, color: g.color, material: g.material, demo: g.is_demo, dryCount: g.dry_count ?? 0,
  sessionCount: g.session_count ?? 0, busy: !!g.busy,
});
const toSession = (s: any): Session => ({
  id: s.id, clipId: s.clip_id, garmentId: s.garment_id, startedAt: ms(s.started_at), totalMin: s.predicted_min, demo: s.is_demo, seed: s.demo_seed ?? null,
});
const toRecord = (s: any): DryRecord => ({
  id: s.id, clipId: s.clip_id, garmentId: s.garment_id, startedAt: ms(s.started_at), endedAt: ms(s.ended_at),
  actualMin: s.actual_min, predictedMin: s.predicted_min, outcome: s.outcome, demo: s.is_demo, seed: s.demo_seed ?? null,
});
const toDetail = (s: any): SessionDetail => ({
  id: s.id, clipId: s.clip_id, garmentId: s.garment_id, startedAt: ms(s.started_at), endedAt: s.ended_at ? ms(s.ended_at) : null,
  predictedMin: s.predicted_min, actualMin: s.actual_min, outcome: s.outcome, demo: s.is_demo, seed: s.demo_seed ?? null, garment: s.garment,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

let loadId = 0;
export async function refreshDrying() {
  const id = ++loadId;
  const q = demoQuery();
  try {
    const [c, g, a, r] = await Promise.all([
      request(`${API}/clips${q}`), request(`${API}/garments${q}`),
      request(`${API}/sessions/active${q}`), request(`${API}/sessions${q ? `${q}&` : '?'}limit=1000`),
    ]);
    if (id !== loadId) return;  // a newer load (e.g. after the demo switch) already started
    clips.value = c.clips.map(toClip);
    garments.value = g.garments.map(toGarment);
    sessions.value = a.sessions.map(toSession);
    records.value = r.records.map(toRecord);
    loaded.value = true; loadError.value = '';
  } catch (err) {
    if (id === loadId) loadError.value = `無法讀取衣物與晾衣紀錄：${(err as Error).message}`;
  }
}
// The demo switch changes what the server sends.
watch(() => settings.demo_data, () => { void refreshDrying(); });

// Every write reloads everything afterwards, so counts and predictions come from the server.
async function write<T>(path: string, method: string, body?: unknown): Promise<T> {
  const data = await request(`${API}${path}`, { method, body });
  await refreshDrying();
  return data as T;
}

export const dryingApi = {
  async addGarment(draft: GarmentDraft, demo: boolean) {
    const data = await write<{ garment: unknown }>('/garments', 'POST', { ...draft, is_demo: demo });
    return toGarment(data.garment);
  },
  updateGarment: (id: string, patch: Partial<GarmentDraft>) => write(`/garments/${encodeURIComponent(id)}`, 'PATCH', patch),
  deleteGarment: (id: string) => write(`/garments/${encodeURIComponent(id)}`, 'DELETE'),
  async getSession(id: string) {
    const data = await request(`${API}/sessions/${encodeURIComponent(id)}`);
    return toDetail(data.session);
  },
  async updateRecord(id: string, patch: RecordPatch) {
    const data = await write<{ session: unknown }>(`/sessions/${encodeURIComponent(id)}`, 'PATCH', patch);
    return toDetail(data.session);
  },
  deleteRecord: (id: string) => write(`/sessions/${encodeURIComponent(id)}`, 'DELETE'),
  // demo (demo clips only): curve seed, and how many minutes ago the garment was hung up.
  async startSession(clipId: string, garment: { id: string } | GarmentDraft, demo?: { seed: number; elapsed_min: number }) {
    const body = { ...('id' in garment ? { clip_id: clipId, garment_id: garment.id } : { clip_id: clipId, garment }), ...(demo ? { demo } : {}) };
    const data = await write<{ session: unknown }>('/sessions', 'POST', body);
    return toSession(data.session);
  },
  swapGarment: (sessionId: string, garmentId: string) =>
    write(`/sessions/${encodeURIComponent(sessionId)}/garment`, 'PATCH', { garment_id: garmentId }),
  endSession: (sessionId: string, outcome: 'dry' | 'early' | 'cancel') =>
    write(`/sessions/${encodeURIComponent(sessionId)}/end`, 'POST', { outcome }),
  setClipMethod: (clipId: string, method: Field) => write(`/clips/${encodeURIComponent(clipId)}`, 'PATCH', { predict_method: method }),
  removeClip: (clipId: string) => write(`/clips/${encodeURIComponent(clipId)}`, 'DELETE'),
  addDivider: (clipId: string, divider: { since: string; divider_ohm: number; open_count: number }) =>
    write(`/clips/${encodeURIComponent(clipId)}/dividers`, 'POST', divider),
  deleteDivider: (clipId: string, dividerId: string) =>
    write(`/clips/${encodeURIComponent(clipId)}/dividers/${encodeURIComponent(dividerId)}`, 'DELETE'),
  addScale: (clipId: string, scale: { since: string; tare_count: number; counts_per_gram: number }) =>
    write(`/clips/${encodeURIComponent(clipId)}/scales`, 'POST', scale),
  deleteScale: (clipId: string, scaleId: string) =>
    write(`/clips/${encodeURIComponent(clipId)}/scales/${encodeURIComponent(scaleId)}`, 'DELETE'),
  resetDemo: () => write('/demo/reset', 'POST'),
};

// ---------------------------------------------------------------- polling (ref-counted)
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((item) => [item.id, item]));
const garmentMap = computed(() => byId(garments.value));

export function useDrying() {
  onMounted(() => {
    users++;
    void refreshDrying();
    if (users === 1) timer = setInterval(() => { void refreshDrying(); }, 30000);
  });
  onUnmounted(() => {
    users--;
    if (!users) clearInterval(timer);
  });
  return { clips, garments, sessions, records, loaded, loadError, garmentMap, refreshDrying, ...dryingApi };
}

// Read-only access without starting the poll (for composables).
export const dryingState = { clips, garments, sessions, records, loaded, loadError, garmentMap };
export const dryAtOf = (session: Session) => session.startedAt + session.totalMin * MIN;
