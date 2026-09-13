<template>
  <div class="main-container">
    <div class="header-row">
      <div>
        <h1 class="page-title">歷程數據查詢與視覺化 (支援全部 23 項感測器指標)</h1>
        <p class="page-desc">查詢環境感測器時序數據、全部 23 項指標自由疊加對比與歷史 CSV 匯出</p>
      </div>
      <div class="header-actions">
        <button
          class="btn btn-secondary"
          @click="exportCSV"
          :disabled="historyData.length === 0 || loading"
        >
          匯出全欄位 CSV (23項)
        </button>
        <button
          class="btn btn-primary"
          @click="exportImage"
          :disabled="historyData.length === 0 || loading"
        >
          下載圖表 PNG
        </button>
      </div>
    </div>

    <!-- Filter Card -->
    <div class="card filter-card">
      <div class="filter-row">
        <div class="filter-group">
          <label class="label">監測盒子</label>
          <select v-model="selectedDeviceId" class="select-input" @change="onDeviceChange">
            <option v-for="d in devices" :key="d.device_id" :value="d.device_id">
              {{ d.display_name || d.device_id }} ({{ d.device_id }})
            </option>
          </select>
        </div>

        <div class="filter-group">
          <label class="label">開始日期</label>
          <input type="date" v-model="startDate" class="date-input" />
        </div>

        <div class="filter-group">
          <label class="label">結束日期</label>
          <input type="date" v-model="endDate" class="date-input" />
        </div>

        <div class="filter-group">
          <label class="label">取樣步進</label>
          <select v-model="step" class="select-input">
            <option :value="1">1x (原始數據)</option>
            <option :value="5">5x (快速 5 倍)</option>
            <option :value="10">10x (極速 10 倍)</option>
            <option :value="30">30x (高效能 30 倍)</option>
          </select>
        </div>

        <button @click="queryHistory" class="btn btn-primary query-btn" :disabled="loading">
          {{ loading ? '查詢中...' : '查詢資料' }}
        </button>
      </div>

      <!-- Quick Date Presets -->
      <div class="quick-presets-row">
        <span class="preset-label">快速選取：</span>
        <button class="btn btn-subtle btn-xs" @click="applyDateRange('today')">今天</button>
        <button class="btn btn-subtle btn-xs" @click="applyDateRange('last3')">最近 3 天</button>
        <button class="btn btn-subtle btn-xs" @click="applyDateRange('last7')">最近 7 天</button>
        <button class="btn btn-subtle btn-xs" @click="applyDateRange('month')">本月</button>

        <!-- Device Available Dates Chips -->
        <span v-if="availableDates.length > 0" class="dates-sep">|</span>
        <span v-if="availableDates.length > 0" class="preset-label">已存日期：</span>
        <div class="date-chips-wrap">
          <button
            v-for="date in availableDates.slice(-7)"
            :key="date"
            class="chip-date"
            :class="{ active: startDate === date && endDate === date }"
            @click="selectSingleDate(date)"
          >
            {{ date }}
          </button>
          <span v-if="availableDates.length > 7" class="more-dates-hint">
            (+{{ availableDates.length - 7 }} 天)
          </span>
        </div>
      </div>
    </div>

    <!-- Metrics Control Card (All 23 Items Grouped) -->
    <div class="card metrics-control-card">
      <div class="control-header">
        <div>
          <span class="control-title">指標疊加勾選 (共 23 項感測器指標)</span>
          <span class="selected-count-badge font-mono">已選取: {{ activeMetrics.length }} / 23</span>
        </div>
        <div class="preset-buttons">
          <button class="btn btn-subtle btn-xs" @click="applyMetricPreset('all')">全選 23 項</button>
          <button class="btn btn-subtle btn-xs" @click="applyMetricPreset('common')">常用推薦</button>
          <button class="btn btn-subtle btn-xs" @click="applyMetricPreset('temp_rh')">溫濕度</button>
          <button class="btn btn-subtle btn-xs" @click="applyMetricPreset('pm')">懸浮微粒 (6項)</button>
          <button class="btn btn-subtle btn-xs" @click="applyMetricPreset('gas')">氣體空氣 (8項)</button>
          <button class="btn btn-subtle btn-xs" @click="applyMetricPreset('light')">光學照度 (6項)</button>
          <button class="btn btn-subtle btn-xs" @click="applyMetricPreset('clear')">清除</button>
        </div>
      </div>

      <!-- Grouped Metric Toggle Rows -->
      <div class="groups-container">
        <div v-for="g in METRIC_GROUPS" :key="g.id" class="metric-group-row">
          <div class="group-row-header">
            <span class="group-row-title">{{ g.label }}</span>
            <div class="group-quick-actions">
              <button class="btn-link-action" @click="selectGroupMetrics(g.id)">選取本組</button>
              <span class="sep-dot">·</span>
              <button class="btn-link-action" @click="unselectGroupMetrics(g.id)">取消本組</button>
            </div>
          </div>
          <div class="metric-chips-wrap">
            <div
              v-for="def in getMetricsByGroup(g.id)"
              :key="def.key"
              class="metric-chip"
              :class="{ active: activeMetrics.includes(def.key) }"
              @click="toggleMetric(def.key)"
            >
              <span class="color-dot" :style="{ backgroundColor: def.color }"></span>
              <span>{{ def.label }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Manual Y-Axis Ranges -->
      <div v-if="activeMetrics.length > 0" class="ranges-section">
        <div class="ranges-header">
          <span class="ranges-title">Y 軸自訂上下限 (留空則自動縮放)</span>
          <button class="btn btn-subtle btn-xs" @click="resetYRanges">重設上下限</button>
        </div>
        <div class="ranges-grid">
          <div v-for="key in activeMetrics" :key="'range-' + key" class="range-item">
            <span class="color-dot" :style="{ backgroundColor: METRIC_DEFINITIONS[key]?.color }"></span>
            <span class="range-metric-name">{{ METRIC_DEFINITIONS[key]?.shortLabel || key }}</span>
            <input
              type="number"
              placeholder="Min"
              v-model.number="customYMin[key]"
              class="range-input"
            />
            <span class="range-dash">-</span>
            <input
              type="number"
              placeholder="Max"
              v-model.number="customYMax[key]"
              class="range-input"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Summary Statistics Bar -->
    <div v-if="statsSummary.length > 0" class="stats-summary-grid">
      <div v-for="s in statsSummary" :key="s.key" class="card stat-card">
        <div class="stat-top">
          <span class="color-dot" :style="{ backgroundColor: s.color }"></span>
          <span class="stat-name">{{ s.label }}</span>
        </div>
        <div class="stat-val-row">
          <span class="stat-curr">{{ s.latest !== null ? s.latest : '-' }}</span>
          <span class="stat-unit">{{ s.unit }}</span>
        </div>
        <div class="stat-minmax">
          <span>Min: {{ s.min !== null ? s.min : '-' }}</span>
          <span>Avg: {{ s.avg !== null ? s.avg : '-' }}</span>
          <span>Max: {{ s.max !== null ? s.max : '-' }}</span>
        </div>
      </div>
    </div>

    <!-- Chart Card -->
    <div class="card chart-card">
      <div class="chart-header">
        <div class="chart-title-group">
          <span class="chart-title">感測器時序趨勢圖</span>
          <span v-if="selectedDevice" class="chart-device-tag">
            {{ selectedDevice.display_name || selectedDevice.device_id }}
          </span>
          <span v-if="startDate" class="chart-date-tag">
            {{ startDate }} {{ startDate !== endDate ? '至 ' + endDate : '' }}
          </span>
        </div>
        <span class="chart-count font-mono">資料筆數: {{ historyData.length }}</span>
      </div>

      <SensorChart
        ref="sensorChartRef"
        :records="historyData"
        :active-metrics="activeMetrics"
        :custom-y-min="customYMin"
        :custom-y-max="customYMax"
        empty-text="查無資料或尚未勾選任何指標"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, reactive } from 'vue';
import { useRoute } from 'vue-router';
import SensorChart from '../components/SensorChart.vue';
import { METRIC_DEFINITIONS, METRIC_GROUPS, type MetricGroup } from '../constants/metrics';

const route = useRoute();
const sensorChartRef = ref<any>(null);

const devices = ref<any[]>([]);
const selectedDeviceId = ref('');
const availableDates = ref<string[]>([]);
const startDate = ref('');
const endDate = ref('');
const step = ref(1);
const loading = ref(false);
const historyData = ref<any[]>([]);

const activeMetrics = ref<string[]>(['pm25_ae', 'temp', 'humi', 'co2']);
const customYMin = reactive<Record<string, number | null>>({});
const customYMax = reactive<Record<string, number | null>>({});

const selectedDevice = computed(() => {
  return devices.value.find((d) => d.device_id === selectedDeviceId.value);
});

function getMetricsByGroup(group: MetricGroup) {
  return Object.values(METRIC_DEFINITIONS).filter((m) => m.group === group);
}

function selectGroupMetrics(group: MetricGroup) {
  const keys = getMetricsByGroup(group).map((m) => m.key);
  for (const k of keys) {
    if (!activeMetrics.value.includes(k)) {
      activeMetrics.value.push(k);
    }
  }
}

function unselectGroupMetrics(group: MetricGroup) {
  const keys = new Set(getMetricsByGroup(group).map((m) => m.key));
  activeMetrics.value = activeMetrics.value.filter((k) => !keys.has(k));
}

// Format today as YYYY-MM-DD
function getTodayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function loadDevices() {
  try {
    const res = await fetch('/api/v1/devices');
    const data = await res.json();
    if (data.success && data.devices.length > 0) {
      devices.value = data.devices;

      // Handle route query param
      const queryId = route.query.id as string;
      const queryDate = route.query.date as string;

      if (queryId && devices.value.some((d) => d.device_id === queryId)) {
        selectedDeviceId.value = queryId;
      } else {
        selectedDeviceId.value = data.devices[0].device_id;
      }

      await loadAvailableDates();

      if (queryDate) {
        startDate.value = queryDate;
        endDate.value = queryDate;
      } else if (availableDates.value.length > 0) {
        // Default to newest available date
        const newest = availableDates.value[availableDates.value.length - 1];
        startDate.value = newest;
        endDate.value = newest;
      } else {
        const today = getTodayString();
        startDate.value = today;
        endDate.value = today;
      }

      await queryHistory();
    }
  } catch (err) {
    console.error('Failed to load devices:', err);
  }
}

async function loadAvailableDates() {
  if (!selectedDeviceId.value) return;
  try {
    const res = await fetch(`/api/v1/devices/${selectedDeviceId.value}/dates`);
    const data = await res.json();
    if (data.success) {
      availableDates.value = data.dates || [];
    }
  } catch (err) {
    console.error('Failed to load available dates:', err);
  }
}

async function onDeviceChange() {
  await loadAvailableDates();
  if (availableDates.value.length > 0) {
    const newest = availableDates.value[availableDates.value.length - 1];
    startDate.value = newest;
    endDate.value = newest;
  }
  await queryHistory();
}

function selectSingleDate(date: string) {
  startDate.value = date;
  endDate.value = date;
  queryHistory();
}

function applyDateRange(range: 'today' | 'last3' | 'last7' | 'month') {
  const end = new Date();
  const start = new Date();

  if (range === 'today') {
    // start and end is today
  } else if (range === 'last3') {
    start.setDate(end.getDate() - 2);
  } else if (range === 'last7') {
    start.setDate(end.getDate() - 6);
  } else if (range === 'month') {
    start.setDate(1);
  }

  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  startDate.value = fmt(start);
  endDate.value = fmt(end);
  queryHistory();
}

async function queryHistory() {
  if (!selectedDeviceId.value) return;
  loading.value = true;
  try {
    const query = new URLSearchParams({
      start: startDate.value,
      end: endDate.value,
      step: String(step.value),
    });
    const res = await fetch(`/api/v1/devices/${selectedDeviceId.value}/sensor/history?${query}`);
    const data = await res.json();
    if (data.success) {
      historyData.value = data.records || [];
    }
  } catch (err) {
    console.error('Failed to query history:', err);
  } finally {
    loading.value = false;
  }
}

function toggleMetric(key: string) {
  const idx = activeMetrics.value.indexOf(key);
  if (idx >= 0) {
    activeMetrics.value.splice(idx, 1);
  } else {
    activeMetrics.value.push(key);
  }
}

function applyMetricPreset(preset: 'all' | 'common' | 'temp_rh' | 'pm' | 'gas' | 'light' | 'clear') {
  switch (preset) {
    case 'all':
      activeMetrics.value = Object.keys(METRIC_DEFINITIONS);
      break;
    case 'common':
      activeMetrics.value = ['temp', 'humi', 'pm25_ae', 'co2', 'tvoc'];
      break;
    case 'temp_rh':
      activeMetrics.value = ['temp', 'humi'];
      break;
    case 'pm':
      activeMetrics.value = ['pm1_ae', 'pm25_ae', 'pm10_ae', 'pm1_sp', 'pm25_sp', 'pm10_sp'];
      break;
    case 'gas':
      activeMetrics.value = ['co2', 'ave_co2', 'tvoc', 'eco2', 's_h2', 's_ethanol', 'baseline_tvoc', 'baseline_eco2'];
      break;
    case 'light':
      activeMetrics.value = ['illuminance', 'color_temp', 'ch_r', 'ch_g', 'ch_b', 'ch_c'];
      break;
    case 'clear':
      activeMetrics.value = [];
      break;
  }
}

function resetYRanges() {
  Object.keys(customYMin).forEach((k) => delete customYMin[k]);
  Object.keys(customYMax).forEach((k) => delete customYMax[k]);
}

// Summary statistics for each active metric
const statsSummary = computed(() => {
  if (historyData.value.length === 0 || activeMetrics.value.length === 0) return [];

  return activeMetrics.value.map((key) => {
    const def = METRIC_DEFINITIONS[key] || { label: key, unit: '', color: '#6366f1' };
    const values: number[] = [];

    for (const r of historyData.value) {
      if (r[key] !== undefined && r[key] !== null) {
        const val = parseFloat(r[key]);
        if (!isNaN(val)) {
          if (key === 'co2' && (val < 0 || val > 10000)) continue;
          values.push(val);
        }
      }
    }

    if (values.length === 0) {
      return {
        key,
        label: def.label,
        unit: def.unit,
        color: def.color,
        latest: null,
        min: null,
        max: null,
        avg: null,
      };
    }

    const latest = values[values.length - 1];
    let min = values[0];
    let max = values[0];
    let sum = 0;

    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }

    const avg = Number((sum / values.length).toFixed(1));

    return {
      key,
      label: def.shortLabel || def.label,
      unit: def.unit,
      color: def.color,
      latest,
      min: Number(min.toFixed(1)),
      max: Number(max.toFixed(1)),
      avg,
    };
  });
});

function exportImage() {
  const filename = `${selectedDeviceId.value}_${startDate.value}_to_${endDate.value}_chart.png`;
  sensorChartRef.value?.exportImage(filename);
}

function exportCSV() {
  if (historyData.value.length === 0) return;

  const headers = [
    'timestamp',
    'temp',
    'humi',
    'cpu_temp',
    'co2',
    'ave_co2',
    'tvoc',
    'eco2',
    's_h2',
    's_ethanol',
    'baseline_tvoc',
    'baseline_eco2',
    'illuminance',
    'color_temp',
    'ch_r',
    'ch_g',
    'ch_b',
    'ch_c',
    'pm1_ae',
    'pm25_ae',
    'pm10_ae',
    'pm1_sp',
    'pm25_sp',
    'pm10_sp',
  ];

  const csvRows: string[] = [];
  csvRows.push(headers.join(','));

  for (const r of historyData.value) {
    const row = headers.map((h) => (r[h] !== undefined && r[h] !== null ? r[h] : ''));
    csvRows.push(row.join(','));
  }

  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csvRows.join('\n'));
  const link = document.createElement('a');
  link.setAttribute('href', csvContent);
  link.setAttribute('download', `${selectedDeviceId.value}_${startDate.value}_to_${endDate.value}_all_sensors.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

onMounted(() => {
  loadDevices();
});
</script>

<style scoped>
.header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.page-desc {
  font-size: 13px;
  color: var(--color-body);
  margin-top: 4px;
}

.filter-card {
  padding: 20px;
  margin-bottom: 20px;
}

.filter-row {
  display: flex;
  gap: 16px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-body);
}

.select-input,
.date-input {
  padding: 8px 12px;
  border: 1px solid var(--color-hairline-strong);
  border-radius: 6px;
  font-family: inherit;
  font-size: 14px;
  background: var(--color-canvas);
}

.query-btn {
  height: 38px;
}

.quick-presets-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px dashed var(--color-hairline);
  font-size: 13px;
}

.preset-label {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 500;
}

.dates-sep {
  color: var(--color-hairline-strong);
  margin: 0 4px;
}

.date-chips-wrap {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

.chip-date {
  background: var(--color-hairline);
  border: 1px solid var(--color-hairline-strong);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  font-family: var(--font-mono);
  cursor: pointer;
  color: var(--color-ink);
  transition: all 0.15s;
}

.chip-date:hover {
  background: var(--color-primary-light, #eff6ff);
  border-color: var(--color-primary, #2563eb);
}

.chip-date.active {
  background: var(--color-primary, #2563eb);
  color: #ffffff;
  border-color: var(--color-primary, #2563eb);
}

.more-dates-hint {
  font-size: 11px;
  color: var(--color-muted);
}

.metrics-control-card {
  padding: 20px;
  margin-bottom: 20px;
}

.control-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 10px;
}

.control-title {
  font-size: 14px;
  font-weight: 700;
}

.selected-count-badge {
  margin-left: 8px;
  font-size: 11px;
  background: var(--color-canvas-subtle, #f1f5f9);
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid var(--color-hairline-strong);
  color: var(--color-body);
}

.preset-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.groups-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.metric-group-row {
  background: var(--color-canvas-subtle, #f8fafc);
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  padding: 12px 16px;
}

.group-row-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.group-row-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-ink);
}

.group-quick-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-link-action {
  background: none;
  border: none;
  padding: 0;
  font-size: 11px;
  color: var(--color-primary, #2563eb);
  cursor: pointer;
  text-decoration: underline;
}

.btn-link-action:hover {
  color: #1d4ed8;
}

.sep-dot {
  color: var(--color-muted);
  font-size: 10px;
}

.metric-chips-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.metric-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-radius: 16px;
  border: 1px solid var(--color-hairline-strong);
  background: var(--color-canvas);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  transition: all 0.15s;
}

.metric-chip:hover {
  border-color: var(--color-body);
}

.metric-chip.active {
  background: #ffffff;
  border-color: var(--color-ink);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  font-weight: 600;
}

.color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.ranges-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed var(--color-hairline);
}

.ranges-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.ranges-title {
  font-size: 12px;
  color: var(--color-muted);
  font-weight: 500;
}

.ranges-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.range-item {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #ffffff;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-hairline);
}

.range-metric-name {
  font-size: 12px;
  font-weight: 500;
}

.range-input {
  width: 60px;
  padding: 3px 6px;
  font-size: 12px;
  border: 1px solid var(--color-hairline-strong);
  border-radius: 4px;
  text-align: center;
  font-family: var(--font-mono);
}

.range-dash {
  color: var(--color-muted);
}

.stats-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.stat-card {
  padding: 12px 16px;
}

.stat-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.stat-name {
  font-size: 12px;
  color: var(--color-body);
  font-weight: 500;
}

.stat-val-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-bottom: 6px;
}

.stat-curr {
  font-size: 20px;
  font-weight: 700;
  font-family: var(--font-mono);
}

.stat-unit {
  font-size: 12px;
  color: var(--color-muted);
}

.stat-minmax {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--color-muted);
  font-family: var(--font-mono);
  border-top: 1px dashed var(--color-hairline);
  padding-top: 4px;
}

.chart-card {
  padding: 24px;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.chart-title-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.chart-title {
  font-weight: 700;
  font-size: 16px;
}

.chart-device-tag,
.chart-date-tag {
  background: var(--color-hairline);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-body);
}

.chart-count {
  font-size: 13px;
  color: var(--color-muted);
}

.btn-xs {
  padding: 2px 8px;
  font-size: 12px;
}

.btn-subtle {
  background: transparent;
  border: 1px solid var(--color-hairline-strong);
  color: var(--color-body);
  border-radius: 4px;
  cursor: pointer;
}

.btn-subtle:hover {
  background: var(--color-hairline);
  color: var(--color-ink);
}
</style>
