<template>
  <div class="clothes-page">
    <section class="intro">
      <div>
        <p class="eyebrow">NTNU · 2026 物聯網專題</p>
        <h1>智慧衣夾 <span>原始資料觀測</span></h1>
        <p class="subtitle">一個夾子，三種感測方式。觀察掛重、接觸與布料乾濕時的數值變化。</p>
      </div>
      <div class="connection" :class="connectionClass" role="status">
        <i></i>{{ connectionText }}
      </div>
    </section>

    <div v-if="error" class="notice error" role="alert">{{ error }}　畫面保留最後成功取得的資料。</div>
    <div v-if="ingestionError" class="notice error" role="alert">資料寫入失敗，請檢查後端與資料庫。</div>

    <section class="reading-grid">
      <article v-for="sensor in sensors" :key="sensor.key" class="reading" :style="{ '--sensor-color': sensor.color }">
        <div class="reading-label"><span>{{ sensor.title }}</span><span class="hardware">{{ sensor.hardware }}</span></div>
        <div class="value">{{ formatRaw(latest?.[sensor.key]) }}<small>原始計數</small></div>
        <div class="reading-note">{{ latest && latest[sensor.key] === null ? '本筆讀取失敗' : sensor.description }}</div>
      </article>
    </section>

    <div class="meta-row">
      <span>最後接收時間：<strong>{{ latest ? formatTime(latest.timestamp) : '尚未收到資料' }}</strong></span>
      <span>每秒一筆 · 時間由 server 記錄 · 顯示時區：台北</span>
    </div>

    <section class="history-section">
      <div class="history-heading">
        <div><h2>原始值歷史曲線</h2><p>各感測器使用獨立刻度；缺值或資料中斷顯示為斷線。</p></div>
        <label>時間範圍
          <select v-model.number="minutes" aria-label="歷史時間範圍">
            <option :value="5">最近 5 分鐘</option>
            <option :value="15">最近 15 分鐘</option>
            <option :value="60">最近 1 小時</option>
          </select>
        </label>
      </div>
      <p v-if="historyError" class="notice error" role="alert">{{ historyError }}</p>
      <p v-if="truncated" class="notice">資料較多，目前顯示最近 5,000 筆。</p>
      <div v-if="!records.length" class="empty-state">
        <strong>{{ historyLoading ? '正在讀取歷史資料…' : '這段時間還沒有資料' }}</strong>
        <p>衣夾送出資料並成功儲存後，曲線會自動出現。</p>
      </div>
      <article v-for="sensor in sensors" v-else :key="sensor.key" class="chart-card">
        <div class="chart-title"><h3><i :style="{ background: sensor.color }"></i>{{ sensor.title }}</h3><span>{{ sensor.key }} · 原始計數</span></div>
        <div class="chart"><Line :data="chartData(sensor)" :options="chartOptions" /></div>
      </article>
      <div class="history-footer">已載入 {{ records.length.toLocaleString() }} 筆 · 歷史曲線每 5 秒更新</div>
    </section>
    <footer class="page-note">目前顯示感測器原始數值。重量、電壓、含水率與乾燥預測將在後續校正與實驗階段加入。</footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Line } from 'vue-chartjs';
import { Chart as ChartJS, LinearScale, PointElement, LineElement, Tooltip, Legend, type ChartOptions } from 'chart.js';

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);
type Field = 'hx711_raw' | 'ads1115_raw' | 'touch_raw';
type Reading = { id: string; timestamp: string } & Record<Field, number | null>;
type Sensor = { key: Field; title: string; hardware: string; color: string; description: string };
const sensors: Sensor[] = [
  { key: 'hx711_raw', title: '重量感測', hardware: 'HX711', color: '#238575', description: 'GPIO4 / GPIO5 · 尚未換算公克' },
  { key: 'ads1115_raw', title: '電阻感測', hardware: 'ADS1115', color: '#b57628', description: 'A0 通道 · 原始 ADC 讀值' },
  { key: 'touch_raw', title: '電容感測', hardware: 'ESP32-S3 Touch', color: '#7763b6', description: 'GPIO10 · 原始 touch 讀值' },
];
const latest = ref<Reading | null>(null);
const records = ref<Reading[]>([]);
const error = ref('');
const historyError = ref('');
const ingestionError = ref<string | null>(null);
const mqttConnected = ref(false);
const stale = ref(true);
const loaded = ref(false);
const historyLoading = ref(true);
const truncated = ref(false);
const minutes = ref(15);
let timer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;
let historyUpdated = 0;
const controllers = new Set<AbortController>();

const connectionClass = computed(() => error.value || ingestionError.value ? 'failed' : !latest.value || stale.value || !mqttConnected.value ? 'waiting' : 'live');
const connectionText = computed(() => {
  if (error.value) return 'Server／資料庫連線異常';
  if (ingestionError.value) return '資料寫入異常';
  if (!loaded.value) return '正在連線';
  if (!mqttConnected.value) return 'MQTT 尚未連線';
  if (!latest.value) return '等待衣夾資料';
  return stale.value ? '資料中斷（超過 10 秒）' : '正在接收資料';
});
const formatRaw = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('en-US');
const formatTime = (value: string) => new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
const timeTick = (value: number) => new Date(value).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });

function chartData(sensor: Sensor) {
  const points: { x: number; y: number | null }[] = [];
  let previous: number | undefined;
  for (const record of records.value) {
    const time = new Date(record.timestamp).getTime();
    if (previous !== undefined && time - previous > 3000) points.push({ x: previous + 1, y: null });
    points.push({ x: time, y: record[sensor.key] });
    previous = time;
  }
  return { datasets: [{ label: sensor.title, data: points, borderColor: sensor.color, backgroundColor: sensor.color,
    borderWidth: 2, pointRadius: records.value.length === 1 ? 3 : 0, pointHitRadius: 8, spanGaps: false, tension: 0 }] };
}

const chartOptions: ChartOptions<'line'> = {
  responsive: true, maintainAspectRatio: false, animation: false,
  interaction: { mode: 'nearest', intersect: false },
  plugins: { legend: { display: false }, tooltip: { callbacks: {
    title: (items) => items.length ? formatTime(new Date(items[0].parsed.x).toISOString()) : '',
  } } },
  scales: {
    x: { type: 'linear', ticks: { maxTicksLimit: 6, callback: (value) => timeTick(Number(value)) }, grid: { display: false } },
    y: { title: { display: true, text: '原始計數' }, ticks: { precision: 0 } },
  },
};

async function request(path: string) {
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

async function loadLatest() {
  try {
    const data = await request('/api/v1/clothes/latest');
    if (stopped) return;
    latest.value = data.data; stale.value = data.stale;
    mqttConnected.value = data.mqtt_connected; ingestionError.value = data.ingestion_error;
    error.value = ''; loaded.value = true;
  } catch { if (!stopped) error.value = '無法取得最新資料'; }
}

async function loadHistory() {
  const selectedMinutes = minutes.value;
  const end = new Date();
  const start = new Date(end.getTime() - selectedMinutes * 60000);
  try {
    const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), limit: '5000' });
    const data = await request(`/api/v1/clothes/history?${params}`);
    if (stopped || selectedMinutes !== minutes.value) return;
    records.value = data.records; truncated.value = data.truncated;
    historyError.value = ''; historyUpdated = Date.now();
  } catch { if (!stopped) historyError.value = '歷史資料更新失敗，正在等待重新連線。'; }
  finally { if (!stopped) historyLoading.value = false; }
}

async function poll() {
  await Promise.all([loadLatest(), Date.now() - historyUpdated >= 5000 ? loadHistory() : Promise.resolve()]);
  if (!stopped) timer = setTimeout(poll, 1000);
}
watch(minutes, () => { historyUpdated = 0; historyLoading.value = true; });
onMounted(poll);
onUnmounted(() => { stopped = true; clearTimeout(timer); controllers.forEach((controller) => controller.abort()); });
</script>

<style scoped>
.clothes-page { max-width: 1200px; margin: auto; padding: 38px 28px; color: #233d35; }
.intro { display: flex; justify-content: space-between; align-items: center; gap: 24px; margin-bottom: 30px; }
.eyebrow { font-size: 12px; letter-spacing: .12em; color: #688276; margin-bottom: 8px; }
h1 { font-size: 32px; letter-spacing: -.04em; font-weight: 750; }
h1 span { font-size: 16px; font-weight: 400; margin-left: 12px; color: #61756d; letter-spacing: 0; }
.subtitle { color: #65786f; margin-top: 10px; font-size: 14px; }
.connection { flex-shrink: 0; display: flex; gap: 8px; align-items: center; padding: 9px 13px; border-radius: 999px; font-size: 13px; background: #edf1ed; }
.connection i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.connection.live { background: #e6f4eb; color: #28744e; }.connection.waiting { color: #866324; background: #faf1de; }.connection.failed { color: #ad3d39; background: #fdeceb; }
.reading-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.reading { background: white; border: 1px solid #dfe7e0; border-radius: 14px; padding: 22px; border-top: 3px solid var(--sensor-color); }
.reading-label { display: flex; justify-content: space-between; gap: 8px; font-size: 15px; font-weight: 650; }
.hardware { color: #738078; font-size: 11px; font-weight: 500; background: #f2f5f1; padding: 3px 6px; border-radius: 4px; }
.value { font-size: clamp(25px, 3vw, 38px); color: var(--sensor-color); font-variant-numeric: tabular-nums; margin: 20px 0 12px; font-weight: 700; }
.value small { font-size: 12px; font-weight: 400; color: #7a877f; margin-left: 9px; }
.reading-note { font-size: 12px; color: #7a877f; }
.meta-row { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 12px; color: #76857a; padding: 18px 0 28px; }
.meta-row strong { font-weight: 500; color: #425c4f; }
.history-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; gap: 16px; }
h2 { font-size: 20px; }.history-heading p { font-size: 13px; color: #738078; margin-top: 6px; }
label { display: flex; gap: 10px; align-items: center; font-size: 13px; white-space: nowrap; }
select { border: 1px solid #d6e0d8; padding: 8px 12px; border-radius: 7px; color: #345142; background: white; font: inherit; }
.chart-card { background: #fff; border: 1px solid #dfe7e0; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
.chart-title { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 14px; }
h3 { font-size: 14px; display: flex; gap: 8px; align-items: center; }h3 i { width: 8px; height: 8px; border-radius: 50%; }
.chart-title span { font-size: 11px; color: #839087; }.chart { height: 195px; }
.history-footer, .page-note { color: #7b887e; font-size: 12px; }.page-note { margin-top: 26px; border-top: 1px solid #e0e6df; padding-top: 18px; }
.empty-state { border: 1px dashed #cbd8cf; border-radius: 12px; padding: 70px 20px; text-align: center; background: #f7faf6; }.empty-state p { font-size: 13px; color: #7b887e; margin-top: 10px; }
.notice { padding: 12px 16px; background: #faf2df; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }.notice.error { background: #fff0ed; color: #9b4641; }
@media (max-width: 800px) { .intro { align-items: flex-start; flex-direction: column; gap: 14px; }.reading-grid { grid-template-columns: 1fr; }.value { font-size: 32px; }.history-heading { align-items: flex-start; flex-direction: column; }.clothes-page { padding: 24px 16px; }h1 span { display: block; margin: 4px 0 0; }.chart-title span { font-size: 10px; } }
</style>
