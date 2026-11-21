// Clips, garments, drying sessions and records from the server — real and demo alike.
// Demo rows are stored on the server with is_demo = true; they are only requested
// (?demo=include) while the demo data setting is on, and every row keeps its `demo` flag
// so pages can label it. Writes go to the server; the page changes only after they succeed.
//
// Module-level store: pages call useDrying() from setup; polling runs while one is mounted.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Material, StyleKey } from '../constants/garments';
import type { Field } from './useClothesData';
import { useSettings } from './useSettings';

export interface Garment {
  id: string; name: string; style: StyleKey; color: string; material: Material;
  demo: boolean; dryCount: number; busy: boolean;
}
export type GarmentDraft = Pick<Garment, 'name' | 'style' | 'color' | 'material'>;
export interface Session { id: string; clipId: string; garmentId: string; startedAt: number; totalMin: number; demo: boolean }
export interface DryRecord {
  id: string; clipId: string; garmentId: string; startedAt: number; endedAt: number;
  actualMin: number | null; predictedMin: number; outcome: 'dry' | 'early'; demo: boolean;
}
export interface Clip { id: string; name: string; topic: string | null; demo: boolean; predictMethod: Field; airboxId: string | null }

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
    const response = await fetch(path, {
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
const toClip = (c: any): Clip => ({ id: c.id, name: c.name, topic: c.topic, demo: c.is_demo, predictMethod: c.predict_method, airboxId: c.airbox_id });
const toGarment = (g: any): Garment => ({
  id: g.id, name: g.name, style: g.style, color: g.color, material: g.material, demo: g.is_demo, dryCount: g.dry_count ?? 0, busy: !!g.busy,
});
const toSession = (s: any): Session => ({
  id: s.id, clipId: s.clip_id, garmentId: s.garment_id, startedAt: ms(s.started_at), totalMin: s.predicted_min, demo: s.is_demo,
});
const toRecord = (s: any): DryRecord => ({
  id: s.id, clipId: s.clip_id, garmentId: s.garment_id, startedAt: ms(s.started_at), endedAt: ms(s.ended_at),
  actualMin: s.actual_min, predictedMin: s.predicted_min, outcome: s.outcome, demo: s.is_demo,
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
  async startSession(clipId: string, garment: { id: string } | GarmentDraft) {
    const body = 'id' in garment ? { clip_id: clipId, garment_id: garment.id } : { clip_id: clipId, garment };
    const data = await write<{ session: unknown }>('/sessions', 'POST', body);
    return toSession(data.session);
  },
  swapGarment: (sessionId: string, garmentId: string) =>
    write(`/sessions/${encodeURIComponent(sessionId)}/garment`, 'PATCH', { garment_id: garmentId }),
  endSession: (sessionId: string, outcome: 'dry' | 'early' | 'cancel') =>
    write(`/sessions/${encodeURIComponent(sessionId)}/end`, 'POST', { outcome }),
  setClipMethod: (clipId: string, method: Field) => write(`/clips/${encodeURIComponent(clipId)}`, 'PATCH', { predict_method: method }),
  removeClip: (clipId: string) => write(`/clips/${encodeURIComponent(clipId)}`, 'DELETE'),
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
