<template>
  <section v-for="s in sensors" :key="s.key" class="panel sensor" :class="{ chosen: s.key === chosen }">
    <div class="sensor-head">
      <h2><i :style="{ background: palette[s.color] }"></i>{{ s.method }} <small class="muted">{{ s.hardware }}</small>
        <em v-if="s.key === chosen" class="chosen-tag">預測使用</em></h2>
    </div>
    <p v-if="latest && latest[s.key] === null" class="wa-tx small">本筆讀取失敗</p>
    <div class="chart" :class="{ selectable }" :title="selectable ? '按住拖曳可選取時段' : undefined">
      <Line :data="chartDatasets[s.key]" :options="ohm(s.key) ? ohmChartOptions : gram(s.key) ? gramChartOptions : chartOptions" :plugins="plugins" />
    </div>
    <span v-if="gram(s.key)" class="muted small">由 HX711 讀值換算（{{ scaleNote }}）· 原始讀值 {{ formatRaw(latest?.hx711_raw) }}</span>
    <span v-else-if="s.key === 'hx711_raw'" class="muted small">{{ s.key }} · {{ s.description }} · 還沒設定重量校正，所以顯示原始計數</span>
    <span v-else-if="ohm(s.key)" class="muted small">由 ADS1115 讀值換算（{{ dividerNote }}）· 對數刻度 · 原始讀值 {{ formatRaw(latest?.ads1115_raw) }}</span>
    <span v-else-if="s.key === 'ads1115_raw'" class="muted small">{{ s.key }} · {{ s.description }} · 還沒設定分壓電阻，所以顯示原始計數</span>
    <span v-else class="muted small">{{ s.key }} · {{ s.description }}</span>
  </section>

  <section v-if="airRecords.length" class="panel sensor">
    <div class="sensor-head">
      <h2><i :style="{ background: palette.temp }"></i>環境溫度 <i :style="{ background: palette.humi }"></i>環境濕度</h2>
      <span class="muted small">空氣盒子 {{ airDeviceId ?? '—' }} · 約每分鐘一筆</span>
    </div>
    <div class="chart" :class="{ selectable }" :title="selectable ? '按住拖曳可選取時段' : undefined">
      <Line :data="envChartData" :options="envChartOptions" :plugins="plugins" />
    </div>
  </section>
</template>

<script setup lang="ts">
// Raw sensor curves (weight / resistance / capacitance as raw counts) plus the paired air box's
// temperature and humidity, over a fixed time window. Pass a range-select plugin to make them selectable.
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import { Chart as ChartJS, LinearScale, LogarithmicScale, PointElement, LineElement, Tooltip, Legend, type ChartOptions, type Plugin } from 'chart.js';
import { useTheme } from '../../composables/useTheme';
import { SENSORS, type AirReading, type Field, type Reading, type Sensor } from '../../composables/useClothesData';
import { formatAir, formatRaw, formatTime } from '../../utils/format';
import { countToOhm, dividerAt, formatOhm, ohmMax, type Divider } from '../../utils/resistance';
import { countToGram, formatGram, scaleAt, type Scale } from '../../utils/weight';

ChartJS.register(LinearScale, LogarithmicScale, PointElement, LineElement, Tooltip, Legend);

const props = withDefaults(defineProps<{
  records: Reading[];
  airRecords: AirReading[];
  range: { start: Date; end: Date };
  staleAfterMs: number;
  bucketSeconds?: number;
  sensors?: Sensor[];
  chosen?: Field;
  latest?: Reading | null;  // newest reading: flags a failed read and gives the raw count in the note
  airDeviceId?: string | null;
  plugins?: Plugin<'line'>[];
  // The clip's divider settings: with any, the resistance chart shows ohms on a log scale.
  dividers?: Divider[] | null;
  // The clip's HX711 calibrations: with any, the weight chart shows grams.
  scales?: Scale[] | null;
}>(), { bucketSeconds: 0, sensors: () => SENSORS, chosen: undefined, latest: undefined, airDeviceId: null, plugins: () => [], dividers: null, scales: null });

const { palette } = useTheme();
const selectable = computed(() => props.plugins.length > 0);

const timeTick = (value: number) => {
  const span = props.range.end.getTime() - props.range.start.getTime();
  // Several days: dates only (ticks fall on Taipei midnight).
  if (span > 3 * DAY) return new Date(value).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });
  const long = span > 6 * 60 * 60000;
  return new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false,
    ...(long ? { month: 'numeric', day: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', ...(long ? {} : { second: '2-digit' }) });
};

// ---------------------------------------------------------------- resistance in ohms
const DAY = 24 * 60 * 60000;
const hasDividers = computed(() => !!props.dividers?.length);
const ohm = (key: Field) => key === 'ads1115_raw' && hasDividers.value;
// The settings used inside the window on screen (not just the newest one), each with its own limit.
const shortTime = (time: number) => new Date(time).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false,
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dividerNote = computed(() => {
  const list = props.dividers ?? [];
  const start = props.range.start.getTime(), end = props.range.end.getTime();
  const used = list
    .map((d, i) => ({ d, from: new Date(d.since).getTime(), to: i + 1 < list.length ? new Date(list[i + 1].since).getTime() : Infinity }))
    .filter((x) => x.from < end && x.to > start);
  const describe = (d: Divider) => `分壓 ${formatOhm(d.divider_ohm)}、上限 ${formatOhm(ohmMax(d))}`;
  const parts: string[] = [];
  if (list.length && new Date(list[0].since).getTime() > start) parts.push(`${shortTime(new Date(list[0].since).getTime())} 前沒有設定，不換算`);
  if (used.length === 1 && !parts.length) return `${describe(used[0].d)}，超過上限時顯示為上限`;
  used.forEach((x, i) => {
    const before = i + 1 < used.length ? `${shortTime(x.to)} 前` : '';
    const after = i > 0 || parts.length ? `${shortTime(x.from)} 起` : '';
    parts.push(`${after}${after && before ? '、' : ''}${before}${describe(x.d)}`);
  });
  return `${parts.join('；')}；超過上限時顯示為上限`;
});
// ---------------------------------------------------------------- weight in grams
const gram = (key: Field) => key === 'hx711_raw' && !!props.scales?.length;
const scaleNote = computed(() => {
  const list = props.scales ?? [];
  const start = props.range.start.getTime(), end = props.range.end.getTime();
  const used = list.filter((s, i) => new Date(s.since).getTime() < end && (i + 1 >= list.length || new Date(list[i + 1].since).getTime() > start));
  const describe = (s: Scale) => `空勾 ${s.tare_count.toLocaleString()}、每克 ${s.counts_per_gram}`;
  const parts = used.map((s) => describe(s));
  if (list.length && new Date(list[0].since).getTime() > start) parts.unshift(`${shortTime(new Date(list[0].since).getTime())} 前沒有校正，不換算`);
  return parts.join('；');
});
const plotGram = (count: number | null, time: number) => {
  const s = scaleAt(props.scales, time);
  return s ? countToGram(count, s) : null;
};

// Plotted value: ohms with the setting in force at that time; open readings sit at that setting's
// upper limit (shown as "> limit"); nothing before the first setting.
function plotOhm(count: number | null, time: number): number | null {
  const d = dividerAt(props.dividers, time);
  if (!d || count == null) return null;
  const value = countToOhm(count, d)!;
  return Number.isFinite(value) ? Math.max(value, 1000) : ohmMax(d);
}

function chartData(sensor: Sensor) {
  const points: { x: number; y: number | null }[] = [];
  let previous: number | undefined;
  // Break the line only where data was interrupted (the clip reports about once a minute),
  // or across more than ~2 averaged buckets.
  const gapMs = Math.max(props.staleAfterMs, props.bucketSeconds * 2500);
  for (const record of props.records) {
    const time = new Date(record.timestamp).getTime();
    if (previous !== undefined && time - previous > gapMs) points.push({ x: previous + 1, y: null });
    const raw = record[sensor.key];
    points.push({ x: time, y: ohm(sensor.key) ? plotOhm(raw, time) : gram(sensor.key) ? plotGram(raw, time) : raw });
    previous = time;
  }
  const color = palette.value[sensor.color];
  return { datasets: [{ label: sensor.title, data: points, borderColor: color, backgroundColor: color,
    borderWidth: 2, pointRadius: props.records.length === 1 ? 3 : 0, pointHitRadius: 8, spanGaps: false, tension: 0 }] };
}
// Built once per data change, so typing in a form or dragging never rebuilds the charts.
const chartDatasets = computed(() => Object.fromEntries(SENSORS.map((s) => [s.key, chartData(s)])) as Record<Field, ReturnType<typeof chartData>>);

// The resistance chart in ohms: log scale (fabric goes from kΩ when wet to tens of MΩ when dry).
const ohmChartOptions = computed<ChartOptions<'line'>>(() => {
  const p = palette.value;
  const base = chartOptions.value;
  return {
    ...base,
    plugins: { ...base.plugins, tooltip: { backgroundColor: p.tooltip, callbacks: {
      title: (items) => items.length && items[0].parsed.x != null ? formatTime(items[0].parsed.x) : '',
      label: (item) => {
        const d = dividerAt(props.dividers, item.parsed.x ?? 0);
        const y = item.parsed.y;
        if (y == null) return '';
        return d && y >= ohmMax(d) ? `布料電阻 > ${formatOhm(ohmMax(d))}（接近乾布）` : `布料電阻 ${formatOhm(y)}`;
      },
    } } },
    scales: {
      x: base.scales!.x!,
      y: { type: 'logarithmic', title: { display: true, text: '布料電阻（對數）', color: p.mu },
        ticks: { color: p.mu, callback: (value) => {
          const v = Number(value);
          return /^[1]$/.test(String(v / 10 ** Math.floor(Math.log10(v)))) ? formatOhm(v) : '';
        } },
        grid: { color: p.grid }, border: { color: p.bd } },
    },
  };
});

// The weight chart in grams (linear, like the raw counts).
const gramChartOptions = computed<ChartOptions<'line'>>(() => {
  const p = palette.value;
  const base = chartOptions.value;
  return {
    ...base,
    plugins: { ...base.plugins, tooltip: { backgroundColor: p.tooltip, callbacks: {
      title: (items) => items.length && items[0].parsed.x != null ? formatTime(items[0].parsed.x) : '',
      label: (item) => item.parsed.y == null ? '' : `重量 ${formatGram(item.parsed.y)}`,
    } } },
    scales: {
      x: base.scales!.x!,
      y: { title: { display: true, text: '重量（g）', color: p.mu }, ticks: { color: p.mu, callback: (value) => formatGram(Number(value)) },
        grid: { color: p.grid }, border: { color: p.bd } },
    },
  };
});

const envChartData = computed(() => {
  const series = (key: 'temp' | 'humi') => {
    const points: { x: number; y: number | null }[] = [];
    let previous: number | undefined;
    for (const reading of props.airRecords) {
      const time = new Date(reading.timestamp).getTime();
      // The box reports about once a minute; break the line if it went quiet for over 5 minutes.
      if (previous !== undefined && time - previous > 5 * 60000) points.push({ x: previous + 1, y: null });
      points.push({ x: time, y: reading[key] });
      previous = time;
    }
    const color = palette.value[key];
    return { label: key === 'temp' ? '環境溫度' : '環境濕度', data: points, yAxisID: key === 'temp' ? 'y' : 'y1', borderColor: color,
      backgroundColor: color, borderWidth: 2, pointRadius: props.airRecords.length === 1 ? 3 : 0, pointHitRadius: 8, spanGaps: false, tension: 0 };
  };
  return { datasets: [series('temp'), series('humi')] };
});

// Round tick spacing (whole minutes/hours/days) so labels read 10:00, 12:00 … rather than 10:26.
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440].map((m) => m * 60000);
// Tick positions on a step from Taipei midnight, so day ticks land on 00:00 local time.
const TAIPEI_OFFSET = 8 * 60 * 60000;
const tickStep = (spanMs: number) => TICK_STEPS.find((step) => spanMs / step <= 7) ?? TICK_STEPS[TICK_STEPS.length - 1];

// Fixed x range: the axis shows the whole requested window, even when data covers only part of it.
const chartOptions = computed<ChartOptions<'line'>>(() => {
  const p = palette.value;
  const { start, end } = props.range;
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'nearest', intersect: false },
    events: ['mousemove', 'mouseout', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchmove', 'touchend'],
    plugins: { legend: { display: false }, tooltip: { backgroundColor: p.tooltip, callbacks: {
      title: (items) => items.length && items[0].parsed.x != null ? formatTime(items[0].parsed.x) : '',
    } } },
    scales: {
      x: { type: 'linear', min: start.getTime(), max: end.getTime(),
        afterBuildTicks: (axis) => {
          const step = tickStep(end.getTime() - start.getTime());
          const first = Math.ceil((start.getTime() + TAIPEI_OFFSET) / step) * step - TAIPEI_OFFSET;
          const ticks = [];
          for (let t = first; t <= end.getTime() && ticks.length < 12; t += step) ticks.push({ value: t });
          axis.ticks = ticks;
        },
        ticks: { color: p.mu, callback: (value) => timeTick(Number(value)) }, grid: { display: false }, border: { color: p.bd } },
      y: { title: { display: true, text: '原始計數', color: p.mu }, ticks: { color: p.mu, precision: 0 }, grid: { color: p.grid }, border: { color: p.bd } },
    },
  };
});
const envChartOptions = computed<ChartOptions<'line'>>(() => {
  const p = palette.value;
  return {
    ...chartOptions.value,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: p.tooltip, callbacks: {
      title: (items) => items.length && items[0].parsed.x != null ? formatTime(items[0].parsed.x) : '',
      label: (item) => `${item.dataset.label}：${formatAir(item.parsed.y)} ${item.datasetIndex === 0 ? '°C' : '%'}`,
    } } },
    scales: {
      x: chartOptions.value.scales!.x!,
      y: { position: 'left', title: { display: true, text: '溫度 °C', color: p.temp }, ticks: { color: p.temp }, grid: { color: p.grid } },
      y1: { position: 'right', title: { display: true, text: '濕度 %', color: p.humi }, ticks: { color: p.humi }, grid: { display: false } },
    },
  };
});
</script>

<style scoped>
.sensor.chosen { border-color: var(--ac-bd); }
.sensor-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; }
.sensor-head h2 { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.sensor-head h2 i { width: 12px; height: 12px; flex: 0 0 auto; }
.sensor-head h2 small { font-size: 0.875rem; font-weight: 400; }
.chosen-tag { font-style: normal; font-size: 0.75rem; font-weight: 500; padding: 2px 8px; border-radius: 999px; background: var(--ac-soft); color: var(--ac-tx); }
.chart { height: 195px; }
.chart.selectable { cursor: crosshair; user-select: none; }
.chart.selectable :deep(canvas) { touch-action: pan-y; }  /* horizontal finger drags select; vertical ones still scroll */
.small { font-size: 0.875rem; }
</style>
