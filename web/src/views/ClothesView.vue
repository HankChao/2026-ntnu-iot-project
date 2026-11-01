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

    <section class="dry-section" aria-labelledby="dry-title">
      <div class="verdict" :class="verdict.tone" aria-live="polite">
        <div class="verdict-text">
          <p class="eyebrow">乾燥判斷 · 暫定</p>
          <h2 id="dry-title">{{ verdict.title }}</h2>
          <p class="verdict-tip">{{ verdict.tip }}</p>
        </div>
        <div class="meter">
          <div class="track" role="progressbar" aria-label="乾燥進度" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="verdict.progress ?? undefined">
            <div class="fill" :style="{ width: (verdict.progress ?? 0) + '%' }"></div>
          </div>
          <div class="meter-row"><span>乾燥進度 <b>{{ verdict.progress == null ? '—' : Math.round(verdict.progress) + '%' }}</b></span><span>{{ verdict.eta }}</span></div>
        </div>
      </div>

      <div class="dry-grid">
        <article v-for="sensor in sensors" :key="sensor.key" class="dry-card" :style="{ '--sensor-color': sensor.color }">
          <div class="reading-label"><span>{{ sensor.title }}</span><span class="hardware">{{ sensor.hardware }}</span></div>
          <template v-if="stats[sensor.key].dryness != null">
            <div class="dry-value">{{ Math.round(stats[sensor.key].dryness!) }}<small>% 乾燥</small></div>
            <div class="track small"><div class="fill" :style="{ width: stats[sensor.key].dryness + '%' }"></div></div>
          </template>
          <template v-else>
            <div class="dry-value muted">{{ formatChange(stats[sensor.key].change) }}<small>相對起始</small></div>
            <div class="reading-note">尚未設定全乾／全濕基準，只顯示變化量</div>
          </template>
          <div class="dry-meta">
            <span>變化速度 <b>{{ formatRate(stats[sensor.key]) }}</b></span>
            <span class="chip" :class="{ steady: stats[sensor.key].trend === '趨於穩定' }">{{ stats[sensor.key].trend }}</span>
          </div>
        </article>
      </div>

      <details class="calib">
        <summary>校正基準（暫定，存在這台瀏覽器）<span v-if="usingDefaultCalib" class="calib-default">目前是模擬資料預設值</span></summary>
        <p class="calib-help">做實驗時，把乾燥的布料夾好、等讀值穩定後按「目前值→全乾」；布料完全濕的時候按「目前值→全濕」。三個感測器可以分開設定，沒設定的不會參與判斷。方向（變濕時讀值上升或下降）會自動由兩個基準推出來。</p>
        <div class="calib-row" v-for="sensor in sensors" :key="sensor.key">
          <strong :style="{ color: sensor.color }">{{ sensor.title }}</strong>
          <label>全乾 <input type="number" step="any" :value="calib[sensor.key].dry ?? ''" @change="setRef(sensor.key, 'dry', ($event.target as HTMLInputElement).value)" /></label>
          <button type="button" :disabled="stats[sensor.key].current == null" @click="setRef(sensor.key, 'dry', stats[sensor.key].current)">目前值→全乾</button>
          <label>全濕 <input type="number" step="any" :value="calib[sensor.key].wet ?? ''" @change="setRef(sensor.key, 'wet', ($event.target as HTMLInputElement).value)" /></label>
          <button type="button" :disabled="stats[sensor.key].current == null" @click="setRef(sensor.key, 'wet', stats[sensor.key].current)">目前值→全濕</button>
          <span class="calib-now">目前 {{ formatRaw(stats[sensor.key].current == null ? null : Math.round(stats[sensor.key].current!)) }}</span>
        </div>
        <button type="button" class="calib-clear" @click="clearCalib">清除全部基準</button>
        <button type="button" class="calib-clear" @click="resetCalib">還原模擬預設</button>
      </details>
    </section>

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
    <footer class="page-note">原始數值為感測器直接讀值；乾燥判斷為暫定演算法，需先在上方設定全乾／全濕基準，門檻與公式待實驗資料確認後調整。</footer>
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

// ===== 乾燥判斷（暫定）：參數待實驗資料確認 =====
const CONFIG = {
  SPEED_WINDOW_MIN: 15,   // 計算變化速度用最近幾分鐘的資料
  MIN_SAMPLES: 30,        // 至少幾筆才計算速度
  MIN_SPAN_MIN: 2,        // 資料至少涵蓋幾分鐘才計算速度
  DONE_WEIGHT: 95,        // 重量法乾燥程度達此 % 視為整件乾了
  DONE_SURFACE: 90,       // 電阻、電容達此 % 視為夾子附近乾了
  STEADY_RATE: 1,         // 變化速度低於此值（%/小時）視為趨於穩定
  MIN_RATE: 0.5,          // 預估剩餘時間所需的最小速度（%/小時）
  SMOOTH_N: 5,            // 取最近／最早幾筆的中位數當作目前值／起始值
};
type Ref = { dry: number | null; wet: number | null };
type Calib = Record<Field, Ref>;
const CALIB_KEY = 'clothes-calib-v1';
// 預設基準：目前是「模擬資料」的範圍，只用來確認畫面運作。
// TODO 實驗後請改成真實布料的全乾／全濕讀值（或直接在頁面的校正基準面板設定，瀏覽器會優先使用面板存的值）。
const DEFAULT_CALIB: Calib = {
  hx711_raw: { dry: 85600, wet: 86400 },
  ads1115_raw: { dry: 6800, wet: 8800 },
  touch_raw: { dry: 31200, wet: 32400 },
};
const cloneCalib = (c: Calib): Calib => JSON.parse(JSON.stringify(c));
const emptyCalib = (): Calib => ({
  hx711_raw: { dry: null, wet: null }, ads1115_raw: { dry: null, wet: null }, touch_raw: { dry: null, wet: null },
});
function loadCalib(): Calib {
  const base = emptyCalib();
  try {
    const saved = JSON.parse(localStorage.getItem(CALIB_KEY) || 'null');
    if (!saved) return cloneCalib(DEFAULT_CALIB);   // 這台瀏覽器還沒存過 → 用預設
    for (const k of Object.keys(base) as Field[]) {
      for (const w of ['dry', 'wet'] as const) {
        const v = saved?.[k]?.[w];
        base[k][w] = typeof v === 'number' && Number.isFinite(v) ? v : null;
      }
    }
  } catch { /* 無法讀取就用空基準 */ }
  return base;
}
const calib = ref<Calib>(loadCalib());
watch(calib, (value) => { try { localStorage.setItem(CALIB_KEY, JSON.stringify(value)); } catch { /* 無法儲存就只留在記憶體 */ } }, { deep: true });
function setRef(key: Field, which: 'dry' | 'wet', value: unknown) {
  const n = value === '' || value == null ? null : Number(value);
  calib.value[key][which] = n != null && Number.isFinite(n) ? n : null;
}
function clearCalib() { calib.value = emptyCalib(); }
function resetCalib() { calib.value = cloneCalib(DEFAULT_CALIB); }
const usingDefaultCalib = computed(() => JSON.stringify(calib.value) === JSON.stringify(DEFAULT_CALIB));

type Stat = {
  current: number | null; change: number | null; dryness: number | null;
  rate: number | null; rawRate: number | null; trend: string;
};
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y), m = a.length >> 1;
  return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null;
};
function computeStat(key: Field): Stat {
  const pts: { t: number; v: number }[] = [];
  for (const r of records.value) { const v = r[key]; if (v != null) pts.push({ t: new Date(r.timestamp).getTime(), v }); }
  const out: Stat = { current: null, change: null, dryness: null, rate: null, rawRate: null, trend: '資料累積中' };
  if (!pts.length) return out;
  const current = median(pts.slice(-CONFIG.SMOOTH_N).map((p) => p.v))!;
  const start = median(pts.slice(0, CONFIG.SMOOTH_N).map((p) => p.v))!;
  out.current = current;
  out.change = start !== 0 ? (current - start) / Math.abs(start) * 100 : null;

  const { dry, wet } = calib.value[key];
  const span = dry != null && wet != null && dry !== wet ? dry - wet : null;   // 方向由兩個基準自動決定
  if (span != null) out.dryness = Math.max(0, Math.min(100, (current - wet!) / span * 100));

  const last = pts[pts.length - 1].t;
  const win = pts.filter((p) => last - p.t <= CONFIG.SPEED_WINDOW_MIN * 60000);
  if (win.length < CONFIG.MIN_SAMPLES || (last - win[0].t) / 60000 < CONFIG.MIN_SPAN_MIN) return out;
  const n = win.length, mt = win.reduce((a, p) => a + p.t, 0) / n, mv = win.reduce((a, p) => a + p.v, 0) / n;
  let num = 0, den = 0;
  for (const p of win) { num += (p.t - mt) * (p.v - mv); den += (p.t - mt) ** 2; }
  if (den === 0) return out;
  const slope = num / den;                       // 每毫秒變化的計數
  out.rawRate = slope * 60000;                   // 計數／分鐘
  if (span != null) {
    out.rate = slope * 3600000 / span * 100;     // 乾燥進度 %／小時（正值 = 越來越乾）
    out.trend = Math.abs(out.rate) < CONFIG.STEADY_RATE ? '趨於穩定' : out.rate > 0 ? '持續變乾' : '正在變濕';
  } else {
    out.trend = '尚未校正';
  }
  return out;
}
const stats = computed<Record<Field, Stat>>(() => ({
  hx711_raw: computeStat('hx711_raw'), ads1115_raw: computeStat('ads1115_raw'), touch_raw: computeStat('touch_raw'),
}));
const formatChange = (v: number | null) => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%';
const formatRate = (s: Stat) => s.rate != null ? s.rate.toFixed(1) + ' %/小時' : s.rawRate != null ? s.rawRate.toFixed(2) + ' 計數/分' : '—';
function formatDuration(hours: number) {
  const min = Math.round(hours * 60), h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} 小時 ${m} 分` : `${m} 分`;
}
const verdict = computed(() => {
  const w = stats.value.hx711_raw.dryness;
  const surface = [stats.value.ads1115_raw.dryness, stats.value.touch_raw.dryness].filter((v): v is number => v != null);
  if (!records.value.length) return { tone: 'idle', title: '等待資料', tip: '衣夾送出資料後，這裡會顯示乾燥判斷。', progress: null as number | null, eta: '預估 —' };
  if (w == null && !surface.length) return { tone: 'idle', title: '尚未設定校正基準',
    tip: '先在下方「校正基準」記錄全乾與全濕的讀值，才能算出乾燥程度。目前只顯示各感測器的變化。', progress: null as number | null, eta: '預估 —' };
  const surfaceAvg = surface.length ? surface.reduce((a, b) => a + b, 0) / surface.length : null;
  const progress = (w ?? surfaceAvg)!;
  const surfaceDry = surface.every((v) => v >= CONFIG.DONE_SURFACE);
  const done = (w == null || w >= CONFIG.DONE_WEIGHT) && surfaceDry;
  const title = done ? '可以收衣服了' : progress >= 70 ? '快乾了' : progress >= 30 ? '慢慢變乾中' : '還很濕';
  let tip = '依目前已校正的感測器綜合判斷。';
  if (w != null && w >= CONFIG.DONE_WEIGHT && !surfaceDry) tip = '整件衣服的水差不多蒸發完了，但夾子附近還有點濕，厚的地方可能還沒乾。';
  else if (w != null && w < 70 && surface.length && surfaceDry) tip = '夾子附近可能乾了，但衣服裡面還有不少水。';
  else if (w == null) tip = '尚未設定重量法基準，只用電阻、電容判斷夾子附近，無法確認整件衣服。';
  else if (!surface.length) tip = '尚未設定電阻、電容基準，只用重量判斷整件衣服，無法確認夾子附近。';
  if (done) tip = w == null ? '電阻、電容都確認乾了。' : '重量和布料濕度都確認乾了。';
  if (stale.value || !mqttConnected.value) tip = '資料中斷，以下為最後收到的資料。' + tip;
  const ref = w != null ? stats.value.hx711_raw : stats.value.ads1115_raw.dryness != null ? stats.value.ads1115_raw : stats.value.touch_raw;
  const eta = done ? '已經乾了' : ref.rate != null && ref.rate > CONFIG.MIN_RATE ? '預估再 ' + formatDuration((100 - progress) / ref.rate) : '預估 —';
  return { tone: done ? 'done' : 'active', title, tip, progress, eta };
});

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
.dry-section { margin-bottom: 34px; }
.verdict { display: grid; grid-template-columns: 1.3fr 1fr; gap: 20px 32px; padding: 24px 26px; border-radius: 16px; background: #eef3ee; border: 1px solid #dfe7e0; margin-bottom: 18px; }
.verdict.active { background: #f7efdc; border-color: #eadbb8; }.verdict.done { background: #e3f2e8; border-color: #bfdcc9; }
.verdict h2 { font-size: 28px; margin: 4px 0 8px; letter-spacing: -.02em; }.verdict-tip { font-size: 14px; color: #55685f; }
.meter { align-self: center; display: flex; flex-direction: column; gap: 10px; }
.track { height: 14px; border-radius: 999px; background: rgba(255,255,255,.8); overflow: hidden; border: 1px solid #dfe7e0; }.track.small { height: 8px; margin-top: 4px; }
.fill { height: 100%; background: var(--sensor-color, #238575); border-radius: 999px; transition: width .6s ease; }
.meter-row { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 13px; color: #55685f; font-variant-numeric: tabular-nums; }.meter-row b { font-size: 17px; color: #233d35; }
.dry-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.dry-card { background: white; border: 1px solid #dfe7e0; border-radius: 14px; padding: 18px 22px; border-top: 3px solid var(--sensor-color); }
.dry-value { font-size: 32px; font-weight: 700; color: var(--sensor-color); margin: 14px 0 6px; font-variant-numeric: tabular-nums; }.dry-value.muted { color: #5b6e65; }
.dry-value small { font-size: 12px; font-weight: 400; color: #7a877f; margin-left: 8px; }
.dry-meta { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 14px; font-size: 12px; color: #6b7a72; }.dry-meta b { color: #233d35; font-weight: 600; }
.chip { padding: 3px 10px; border-radius: 999px; background: #f2f5f1; color: #6b7a72; }.chip.steady { background: #dcebd6; color: #3e6a3c; }
.calib { margin-top: 18px; background: #fff; border: 1px solid #dfe7e0; border-radius: 12px; padding: 14px 18px; font-size: 13px; }
.calib summary { cursor: pointer; font-weight: 600; }.calib-help { color: #738078; margin: 10px 0 14px; line-height: 1.6; }
.calib-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 8px 0; border-top: 1px solid #eef1ed; }.calib-row strong { min-width: 70px; }
.calib-row input { width: 110px; border: 1px solid #d6e0d8; border-radius: 6px; padding: 5px 8px; font: inherit; }
.calib button { border: 1px solid #cfdad2; background: #f7faf6; border-radius: 6px; padding: 5px 10px; font: inherit; font-size: 12px; cursor: pointer; color: #345142; }
.calib button:disabled { opacity: .45; cursor: not-allowed; }.calib-now { color: #839087; font-variant-numeric: tabular-nums; }
.calib-clear { margin-top: 12px; margin-right: 8px; }
.calib-default { margin-left: 10px; font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 999px; background: #faf1de; color: #866324; }
@media (max-width: 800px) { .verdict, .dry-grid { grid-template-columns: 1fr; }.intro { align-items: flex-start; flex-direction: column; gap: 14px; }.reading-grid { grid-template-columns: 1fr; }.value { font-size: 32px; }.history-heading { align-items: flex-start; flex-direction: column; }.clothes-page { padding: 24px 16px; }h1 span { display: block; margin: 4px 0 0; }.chart-title span { font-size: 10px; } }
</style>
