<template>
  <div v-if="!detail" class="page">
    <router-link :to="`/sessions/${id}`" class="back">← 晾衣紀錄</router-link>
    <h1>{{ loadError || '正在讀取晾衣紀錄…' }}</h1>
  </div>

  <div v-else-if="!detail.endedAt" class="page">
    <router-link :to="`/sessions/${id}`" class="back">← 晾衣紀錄</router-link>
    <h1>晾衣中的紀錄不能修改時間</h1>
    <p class="muted">請先在總覽結束這次晾衣，再回來修改開始與結束時間。</p>
  </div>

  <div v-else class="page">
    <div class="head">
      <router-link :to="`/sessions/${id}`" class="back">← 晾衣紀錄</router-link>
      <div class="page-head">
        <div class="title"><h1>修改時間</h1><DemoTag v-if="detail.demo" /><span class="muted">{{ detail.garment.name }}</span></div>
      </div>
      <p v-if="mock.actionError.value" class="ui-note ui-note--error" role="alert">{{ mock.actionError.value }}</p>
    </div>

    <div class="layout">
      <div class="main-col">
        <section class="panel panel--sm">
          <h2>圖表範圍</h2>
          <form class="inline-form" @submit.prevent="applyWindow">
            <div class="ui-field"><label for="te-win-start">開始（台北）</label><input id="te-win-start" v-model="winStartText" class="ui-input ui-input--sm" type="datetime-local" required /></div>
            <div class="ui-field"><label for="te-win-end">結束（台北）</label><input id="te-win-end" v-model="winEndText" class="ui-input ui-input--sm" type="datetime-local" required /></div>
            <button type="submit" class="ui-btn">顯示</button>
            <span class="muted hint">最長 2 天</span>
          </form>
          <p v-if="windowError" class="ui-note ui-note--error" role="alert">{{ windowError }}</p>
          <p v-if="detail.demo" class="ui-note ui-note--info">這是示範紀錄，沒有感測資料，請直接在右邊輸入時間。</p>
          <template v-else>
            <p class="muted hint">在任一張曲線上按住拖曳選取這筆紀錄的時段，再拖曳兩側直線微調；選取範圍會填入右邊的開始與結束。</p>
            <p v-if="historyError" class="ui-note ui-note--error" role="alert">{{ historyError }}</p>
            <p v-if="history?.bucketSeconds" class="ui-note">範圍較長，曲線以每 {{ history.bucketSeconds }} 秒的平均值顯示。</p>
          </template>
        </section>

        <template v-if="detail">
          <div v-if="!history?.records.length" class="panel empty">
            <strong>{{ historyLoading ? '正在讀取感測資料…' : '這段時間沒有感測資料' }}</strong>
            <p class="muted">可以把圖表範圍拉大，或直接在右邊輸入時間。</p>
          </div>
          <RawCharts v-else :records="history.records" :air-records="history.air" :range="win" :stale-after-ms="history.staleAfterMs"
            :bucket-seconds="history.bucketSeconds" :air-device-id="history.airDeviceId" :plugins="[selectPlugin]"
            :dividers="detail.demo ? demoDividers(detail.clipId) : mock.clipById(detail.clipId)?.dividers"
            :scales="detail.demo ? demoScales(detail.clipId) : mock.clipById(detail.clipId)?.scales" />
        </template>
      </div>

      <aside class="side-col">
        <form class="panel panel--sm sticky" @submit.prevent="save">
          <h2>紀錄時間</h2>
          <div class="ui-field"><label for="te-start">開始（台北）</label><input id="te-start" v-model="startText" class="ui-input ui-input--sm" type="datetime-local" step="1" required /></div>
          <div class="ui-field"><label for="te-end">結束（台北）</label><input id="te-end" v-model="endText" class="ui-input ui-input--sm" type="datetime-local" step="1" required /></div>
          <dl class="kv">
            <div><dt>原本</dt><dd>{{ formatTime(detail.startedAt) }} – {{ formatTime(detail.endedAt) }}</dd></div>
            <div><dt>{{ detail.outcome === 'dry' ? '實際乾燥時間' : '長度' }}</dt><dd>{{ newMinutes == null ? '—' : shortDuration(newMinutes) }}
              <small v-if="detail.actualMin != null && newMinutes != null && newMinutes !== detail.actualMin" class="muted">（原本 {{ shortDuration(detail.actualMin) }}）</small></dd></div>
          </dl>
          <p class="small" :class="problem ? 'err' : 'muted'">{{ problem || (detail.outcome === 'dry' ? '儲存後，實際乾燥時間和這件衣物的預測會重新計算。' : '提早收起的紀錄不列入預測。') }}</p>
          <div class="btns">
            <button type="submit" class="ui-btn ui-btn--primary ui-btn--lg" :disabled="!!problem || !changed || saving">{{ saving ? '儲存中…' : '儲存' }}</button>
            <button type="button" class="ui-btn" :disabled="!changed" @click="resetTimes">復原</button>
            <router-link :to="`/sessions/${id}`" class="ui-btn ui-btn--ghost">取消</router-link>
          </div>
        </form>
      </aside>
    </div>

    <p v-if="detail.demo" class="demo-note">示範資料：這筆紀錄是示範資料（存在伺服器，以 is_demo 標記），可在設定關閉示範資料。</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import DemoTag from '../components/clothes/DemoTag.vue';
import RawCharts from '../components/clothes/RawCharts.vue';
import { demoDividers, demoHistory, demoScales } from '../utils/demoSensor';
import { HISTORY_MAX_MS, fetchRawHistory, type RawHistory } from '../composables/useClothesData';
import { useClothesMock, type SessionDetail } from '../composables/useClothesMock';
import { dryingApi } from '../composables/useDrying';
import { useRangeSelect } from '../composables/useRangeSelect';
import { formatTime, fromTaipeiInput, shortDuration, toTaipeiInput } from '../utils/format';

const MIN = 60000;
const MARGIN_MS = 60 * MIN;  // the chart opens with an hour on each side of the record
const route = useRoute();
const router = useRouter();
const mock = useClothesMock();

const id = computed(() => String(route.params.id));
const detail = ref<SessionDetail | null>(null);
const loadError = ref('');

// ---------------------------------------------------------------- record times (the form)
const startText = ref('');
const endText = ref('');
const parsed = (text: string) => fromTaipeiInput(text).getTime();
const second = (ms: number) => Math.round(ms / 1000) * 1000;  // the form has whole seconds
const newStart = computed(() => parsed(startText.value));
const newEnd = computed(() => parsed(endText.value));
const newMinutes = computed(() => Number.isFinite(newStart.value) && Number.isFinite(newEnd.value) && newEnd.value > newStart.value
  ? Math.round((newEnd.value - newStart.value) / MIN) : null);
const changed = computed(() => !!detail.value?.endedAt
  && (newStart.value !== second(detail.value.startedAt) || newEnd.value !== second(detail.value.endedAt)));
// Same rules as the server (PATCH /sessions/:id).
const problem = computed(() => {
  if (!Number.isFinite(newStart.value) || !Number.isFinite(newEnd.value)) return '請輸入開始與結束時間。';
  if (newEnd.value <= newStart.value) return '結束時間必須晚於開始時間。';
  if (newEnd.value - newStart.value > HISTORY_MAX_MS) return '一筆紀錄最長 48 小時。';
  if (newEnd.value > mock.now.value + MIN) return '結束時間不能晚於現在。';
  return '';
});
function setTimes(start: number, end: number) {
  startText.value = toTaipeiInput(new Date(second(start)), true);
  endText.value = toTaipeiInput(new Date(second(end)), true);
}
function resetTimes() { if (detail.value?.endedAt) setTimes(detail.value.startedAt, detail.value.endedAt); }

// ---------------------------------------------------------------- chart window (at most two days)
const win = ref({ start: new Date(), end: new Date() });
const winStartText = ref('');
const winEndText = ref('');
const windowError = ref('');
function defaultWindow(d: SessionDetail) {
  const span = d.endedAt! - d.startedAt;
  const margin = Math.max(0, Math.min(MARGIN_MS, (HISTORY_MAX_MS - span) / 2));
  const end = Math.min(Date.now(), d.endedAt! + margin);
  const start = Math.max(d.startedAt - margin, end - HISTORY_MAX_MS);
  return { start: new Date(start), end: new Date(end) };
}
function showWindow(range: { start: Date; end: Date }) {
  win.value = range;
  winStartText.value = toTaipeiInput(range.start); winEndText.value = toTaipeiInput(range.end);
  void loadHistory();
}
function applyWindow() {
  const start = fromTaipeiInput(winStartText.value), end = fromTaipeiInput(winEndText.value);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) windowError.value = '請輸入圖表的開始與結束時間。';
  else if (start >= end) windowError.value = '結束時間必須晚於開始時間。';
  else if (end.getTime() - start.getTime() > HISTORY_MAX_MS) windowError.value = '圖表範圍最長 2 天。';
  else { windowError.value = ''; showWindow({ start, end }); }
}

const history = ref<RawHistory | null>(null);
const historyError = ref('');
const historyLoading = ref(false);
// Demo records have no real readings: their curves come from the generator (utils/demoSensor.ts).
function demoHistoryFor(clipId: string, start: Date, end: Date): RawHistory {
  const sim = demoHistory(clipId, mock.demoSessionsOf(clipId), start.getTime(), end.getTime());
  return { records: sim.records, air: [], airDeviceId: null, bucketSeconds: sim.bucketSeconds, staleAfterMs: 3 * 60000 };
}
let historyRequest = 0;
async function loadHistory() {
  if (!detail.value) return;
  if (detail.value.demo) { history.value = demoHistoryFor(detail.value.clipId, win.value.start, win.value.end); return; }
  const request = ++historyRequest;
  historyLoading.value = true;
  try {
    const result = await fetchRawHistory(win.value.start, win.value.end, detail.value.clipId);
    if (request === historyRequest) { history.value = result; historyError.value = ''; }
  } catch (err) {
    if (request === historyRequest) historyError.value = `感測資料讀取失敗：${(err as Error).message}`;
  } finally { if (request === historyRequest) historyLoading.value = false; }
}

// ---------------------------------------------------------------- drag to select ↔ form
const { selection, plugin: selectPlugin, dragging } = useRangeSelect({
  onMove: (picked) => setTimes(picked.start, picked.end),
  onPick: (picked) => setTimes(picked.start, picked.end),
});
// Typing valid times moves the selection lines too, so both always agree.
watch([newStart, newEnd], ([start, end]) => {
  if (dragging()) return;
  selection.value = Number.isFinite(start) && Number.isFinite(end) && start < end ? { start, end } : null;
});

// ---------------------------------------------------------------- load / save
watch(id, async () => {
  try {
    const d = await dryingApi.getSession(id.value);
    detail.value = d; loadError.value = '';
    if (d.endedAt) { setTimes(d.startedAt, d.endedAt); showWindow(defaultWindow(d)); }
  } catch (err) {
    detail.value = null; loadError.value = `無法讀取這筆紀錄：${(err as Error).message}`;
  }
}, { immediate: true });

const saving = ref(false);
async function save() {
  if (!detail.value || problem.value || !changed.value) return;
  saving.value = true;
  const saved = await mock.updateRecord(detail.value.id, {
    started_at: new Date(newStart.value).toISOString(), ended_at: new Date(newEnd.value).toISOString(),
  });
  saving.value = false;
  if (saved) void router.push(`/sessions/${detail.value.id}`);
}
</script>

<style scoped>
.head { display: flex; flex-direction: column; gap: 12px; }
.back { align-self: flex-start; font-size: 0.9375rem; color: var(--tx2); text-decoration: none; min-height: 32px; display: inline-flex; align-items: center; }
.back:hover { color: var(--tx); }
.title { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }

.layout { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.main-col { flex: 999 1 560px; min-width: 0; display: flex; flex-direction: column; gap: 24px; }
.side-col { flex: 1 1 320px; min-width: 0; display: flex; flex-direction: column; gap: 24px; align-self: stretch; }
.sticky { position: sticky; top: 16px; }
.inline-form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
.inline-form .ui-field { flex: 1 1 200px; }
.hint { font-size: 0.875rem; }
.empty { align-items: center; text-align: center; padding: 64px 20px; border-style: dashed; }
.small { font-size: 0.875rem; }
.err { color: var(--err-tx); }
.kv { display: flex; flex-direction: column; gap: 10px; font-size: 0.9375rem; }
.kv div { display: flex; justify-content: space-between; gap: 12px; }
.kv dt { color: var(--mu); flex: 0 0 auto; }
.kv dd { text-align: right; overflow-wrap: anywhere; }
.btns { display: flex; flex-wrap: wrap; gap: 12px; }
</style>
