<template>
  <div v-if="!detail" class="page">
    <router-link to="/sessions" class="back">← 全部晾衣紀錄</router-link>
    <h1>{{ loadError || '正在讀取晾衣紀錄…' }}</h1>
  </div>

  <div v-else class="page">
    <div class="head">
      <router-link :to="`/garments/${detail.garmentId}`" class="back">← {{ detail.garment.name }}</router-link>
      <div class="page-head">
        <div class="title">
          <h1>晾衣紀錄</h1>
          <DemoTag v-if="detail.demo" />
          <span class="result" :class="resultTone">{{ resultText }}</span>
        </div>
        <div class="head-btns">
          <button type="button" class="ui-btn" :disabled="detail.demo || exporting" @click="exportCsv">{{ exporting ? '匯出中…' : '匯出 CSV' }}</button>
          <router-link v-if="ended" :to="`/sessions/${detail.id}/time`" class="ui-btn">修改時間</router-link>
          <button v-if="ended" type="button" class="ui-btn ui-btn--ghost" @click="remove">刪除紀錄</button>
        </div>
      </div>
      <p v-if="mock.actionError.value" class="ui-note ui-note--error" role="alert">{{ mock.actionError.value }}</p>
      <p v-if="exportMessage" class="ui-note" :class="{ 'ui-note--error': exportFailed }" role="status">{{ exportMessage }}</p>
    </div>

    <section aria-label="這次晾衣" class="ui-stats">
      <div class="ui-stat"><span class="ui-stat__label">開始</span><span class="ui-stat__value sm">{{ when(detail.startedAt) }}</span></div>
      <div class="ui-stat"><span class="ui-stat__label">結束</span><span class="ui-stat__value sm">{{ detail.endedAt ? when(detail.endedAt) : '晾衣中' }}</span></div>
      <div class="ui-stat"><span class="ui-stat__label">實際</span><span class="ui-stat__value sm">{{ detail.actualMin == null ? (ended ? '提早收起' : `已 ${shortDuration(elapsedMin)}`) : shortDuration(detail.actualMin) }}</span></div>
      <div class="ui-stat"><span class="ui-stat__label">預測</span><span class="ui-stat__value sm">{{ shortDuration(detail.predictedMin) }}<small v-if="errorMin != null"> 誤差 {{ shortDuration(errorMin) }}</small></span></div>
    </section>

    <div class="layout">
      <div class="main-col">
        <section class="panel panel--sm">
          <div class="range-row">
            <h2>感測曲線</h2>
            <span class="muted small">{{ formatTime(chartRange.start) }} – {{ formatTime(chartRange.end) }}</span>
          </div>
          <p v-if="detail.demo" class="ui-note ui-note--info">這是示範紀錄，沒有實體感測器；曲線是依五次真實晾衣實驗模擬的。</p>
          <template v-else>
            <p v-if="clipped" class="ui-note">這筆紀錄超過 48 小時，曲線只顯示開始後的 48 小時；CSV 匯出整段。</p>
            <p v-if="historyError" class="ui-note ui-note--error" role="alert">{{ historyError }}</p>
            <p v-if="history?.bucketSeconds" class="ui-note">範圍較長，曲線以每 {{ history.bucketSeconds }} 秒的平均值顯示；CSV 是原始資料。</p>
            <p class="muted small">重量（HX711）、電容（觸控）是原始計數；電阻設定過分壓電阻後顯示為歐姆；溫濕度來自衣夾配對的空氣盒子。{{ ended ? '' : '晾衣中每分鐘更新。' }}</p>
          </template>
        </section>

        <div v-if="!history?.records.length" class="panel empty">
          <strong>{{ historyLoading ? '正在讀取感測資料…' : '這段時間沒有感測資料' }}</strong>
        </div>
        <RawCharts v-else-if="history" :records="history.records" :air-records="history.air" :range="chartRange"
          :stale-after-ms="history.staleAfterMs" :bucket-seconds="history.bucketSeconds" :air-device-id="history.airDeviceId"
          :dividers="detail.demo ? demoDividers(detail.clipId) : clip?.dividers"
          :scales="detail.demo ? demoScales(detail.clipId) : clip?.scales" />
      </div>

      <aside class="side-col">
        <section class="panel panel--sm">
          <h2>衣物</h2>
          <router-link :to="`/garments/${detail.garmentId}`" class="garment-link">
            <i :style="{ background: detail.garment.color }"></i>
            <span><b>{{ detail.garment.name }}</b><small class="muted">{{ detail.garment.material }} · {{ SHAPES[detail.garment.style].label }}</small></span>
          </router-link>
          <div class="ui-field">
            <label for="sd-garment">改成其他衣物</label>
            <select id="sd-garment" :key="selectKey" class="ui-select" :value="detail.garmentId" :disabled="moving" @change="move(($event.target as HTMLSelectElement).value)">
              <option v-for="g in garmentChoices" :key="g.id" :value="g.id" :disabled="g.disabled">{{ g.label }}</option>
            </select>
          </div>
          <p class="muted small">{{ ended ? '紀錄會移到選擇的衣物，當時的預測和實際時間不變。' : '晾衣中更換衣物會依新衣物重新預測。' }}</p>
        </section>

        <section class="panel panel--sm">
          <h2>裝置</h2>
          <dl class="kv">
            <div><dt>衣夾</dt><dd>{{ clip?.name ?? '—' }}</dd></div>
            <div v-if="history?.airDeviceId"><dt>空氣盒子</dt><dd class="mono">{{ history.airDeviceId }}</dd></div>
          </dl>
        </section>
      </aside>
    </div>

    <p v-if="detail.demo" class="demo-note">示範資料：這筆紀錄、衣物與衣夾都是示範資料（存在伺服器，以 is_demo 標記），可在設定關閉示範資料。</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import DemoTag from '../components/clothes/DemoTag.vue';
import RawCharts from '../components/clothes/RawCharts.vue';
import { demoDividers, demoHistory, demoScales } from '../utils/demoSensor';
import { SHAPES } from '../constants/garments';
import { HISTORY_MAX_MS, downloadRawCsv, fetchRawHistory, type RawHistory } from '../composables/useClothesData';
import { useClothesMock, type SessionDetail } from '../composables/useClothesMock';
import { dryingApi } from '../composables/useDrying';
import { clock, formatTime, monthDay, shortDuration } from '../utils/format';

const MIN = 60000;
const route = useRoute();
const router = useRouter();
const mock = useClothesMock();

const id = computed(() => String(route.params.id));
const detail = ref<SessionDetail | null>(null);
const loadError = ref('');
const ended = computed(() => !!detail.value?.endedAt);
const clip = computed(() => detail.value ? mock.clipById(detail.value.clipId) : undefined);
const when = (at: number) => `${monthDay(at)} ${clock(at)}`;

async function loadDetail() {
  try {
    detail.value = await dryingApi.getSession(id.value);
    loadError.value = '';
  } catch (err) {
    detail.value = null;
    loadError.value = `無法讀取這筆紀錄：${(err as Error).message}`;
  }
}

const elapsedMin = computed(() => detail.value ? Math.max(0, Math.round((mock.now.value - detail.value.startedAt) / MIN)) : 0);
const errorMin = computed(() => detail.value?.actualMin == null ? null : Math.abs(detail.value.actualMin - detail.value.predictedMin));
const resultText = computed(() => !detail.value ? '' : !ended.value ? '晾衣中' : detail.value.outcome === 'dry' ? '已乾' : '提早收起');
const resultTone = computed(() => !ended.value ? 'ac-tx' : detail.value?.outcome === 'dry' ? '' : 'muted');

// ---------------------------------------------------------------- sensor history (only this record's time)
const history = ref<RawHistory | null>(null);
const historyError = ref('');
const historyLoading = ref(false);
const fullEnd = computed(() => detail.value ? detail.value.endedAt ?? Date.now() : 0);
const clipped = computed(() => !!detail.value && fullEnd.value - detail.value.startedAt > HISTORY_MAX_MS);
const chartRange = computed(() => {
  const start = detail.value?.startedAt ?? Date.now();
  return { start: new Date(start), end: new Date(Math.max(start + 1000, Math.min(fullEnd.value, start + HISTORY_MAX_MS))) };
});
// Demo records have no real readings: their curves come from the generator (utils/demoSensor.ts).
function demoHistoryFor(clipId: string, start: Date, end: Date): RawHistory {
  const sim = demoHistory(clipId, mock.demoSessionsOf(clipId), start.getTime(), end.getTime());
  return { records: sim.records, air: [], airDeviceId: null, bucketSeconds: sim.bucketSeconds, staleAfterMs: 3 * 60000 };
}
let historyRequest = 0;
async function loadHistory() {
  if (!detail.value) { history.value = null; return; }
  if (detail.value.demo) { history.value = demoHistoryFor(detail.value.clipId, chartRange.value.start, chartRange.value.end); return; }
  const request = ++historyRequest;
  historyLoading.value = true;
  try {
    const { start, end } = chartRange.value;
    const result = await fetchRawHistory(start, end, detail.value.clipId);
    if (request === historyRequest) { history.value = result; historyError.value = ''; }
  } catch (err) {
    if (request === historyRequest) historyError.value = `感測資料讀取失敗：${(err as Error).message}`;
  } finally { if (request === historyRequest) historyLoading.value = false; }
}

watch(id, async () => { await loadDetail(); await loadHistory(); }, { immediate: true });
// A drying session keeps growing: refresh it every minute (the clip reports about once a minute).
const timer = setInterval(() => { if (detail.value && !ended.value) void loadDetail().then(loadHistory); }, 60000);
onUnmounted(() => clearInterval(timer));

// ---------------------------------------------------------------- CSV
const exporting = ref(false);
const exportMessage = ref('');
const exportFailed = ref(false);
async function exportCsv() {
  if (!detail.value) return;
  if (detail.value.demo) { exportFailed.value = true; exportMessage.value = '示範紀錄沒有真的原始資料，所以不提供匯出。'; return; }
  exporting.value = true; exportMessage.value = '';
  try {
    const { name, rows } = await downloadRawCsv(new Date(detail.value.startedAt), new Date(fullEnd.value), detail.value.clipId);
    exportFailed.value = rows === 0;
    exportMessage.value = rows ? `已下載 ${name}（${rows.toLocaleString()} 筆）。` : '這段時間沒有資料，未下載檔案。';
  } catch (err) {
    exportFailed.value = true; exportMessage.value = `匯出失敗：${(err as Error).message}`;
  } finally { exporting.value = false; }
}

// ---------------------------------------------------------------- garment
// Only garments of the same kind (real or demo); while drying, ones on another clip can't be picked.
const garmentChoices = computed(() => {
  const d = detail.value;
  if (!d) return [];
  return mock.state.garments.filter((g) => g.demo === d.demo).map((g) => {
    const busyElsewhere = !ended.value && g.id !== d.garmentId && mock.busyGarmentIds.value.has(g.id);
    return { id: g.id, label: `${g.name}（${g.material}）${busyElsewhere ? '・晾衣中' : ''}`, disabled: busyElsewhere };
  });
});
const moving = ref(false);
const selectKey = ref(0);  // bumped to put the select back on the saved garment after a failed move
async function move(garmentId: string) {
  const d = detail.value;
  if (!d || garmentId === d.garmentId) return;
  moving.value = true;
  try {
    const done = ended.value ? await mock.updateRecord(d.id, { garment_id: garmentId }) : await mock.swapGarment(d.id, garmentId);
    if (done) await loadDetail();
    else selectKey.value++;
  } finally { moving.value = false; }
}

// ---------------------------------------------------------------- delete
async function remove() {
  const d = detail.value;
  if (!d || !ended.value) return;
  if (!window.confirm(`確定要刪除這筆「${d.garment.name}」的晾衣紀錄嗎？刪除後無法復原，這件衣物的預測也會重新計算。`)) return;
  if (await mock.deleteRecord(d.id)) void router.push(`/garments/${d.garmentId}`);
}
</script>

<style scoped>
.head { display: flex; flex-direction: column; gap: 12px; }
.back { align-self: flex-start; font-size: 0.9375rem; color: var(--tx2); text-decoration: none; min-height: 32px; display: inline-flex; align-items: center; }
.back:hover { color: var(--tx); }
.title { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.result { font-weight: 700; }
.head-btns { display: flex; flex-wrap: wrap; gap: 12px; }
.ui-stat__value.sm { font-size: 1.375rem; }
.ui-stat__value.sm small { font-size: 0.875rem; color: var(--mu); }

.layout { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.main-col { flex: 999 1 560px; min-width: 0; display: flex; flex-direction: column; gap: 24px; }
.side-col { flex: 1 1 320px; min-width: 0; display: flex; flex-direction: column; gap: 24px; }
.range-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.empty { align-items: center; text-align: center; padding: 64px 20px; border-style: dashed; }
.small { font-size: 0.875rem; }

.garment-link { display: flex; align-items: center; gap: 12px; color: var(--tx); text-decoration: none; }
.garment-link i { width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--bd2); flex: 0 0 auto; }
.garment-link span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.garment-link small { font-size: 0.8125rem; }
.kv { display: flex; flex-direction: column; gap: 10px; }
.kv div { display: flex; justify-content: space-between; gap: 12px; }
.kv dt { color: var(--mu); }
.kv dd { text-align: right; overflow-wrap: anywhere; }
</style>
