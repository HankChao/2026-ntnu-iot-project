<template>
  <div class="sensor-chart-root">
    <div class="chart-wrapper">
      <div v-if="!hasData" class="chart-empty">
        <span>{{ emptyText || '暫無資料或尚未選擇指標' }}</span>
      </div>
      <Line
        v-else
        ref="chartRef"
        :data="computedChartData"
        :options="computedChartOptions"
        :plugins="chartPlugins"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { Line } from 'vue-chartjs';
import { METRIC_DEFINITIONS, type MetricDefinition } from '../constants/metrics';

ChartJS.register(LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const props = withDefaults(
  defineProps<{
    records?: any[];
    activeMetrics?: string[];
    customYMin?: Record<string, number | null | undefined>;
    customYMax?: Record<string, number | null | undefined>;
    gapThresholdMinutes?: number;
    emptyText?: string;
    // Fallback for simple direct datasets
    labels?: string[];
    datasets?: Array<{
      label: string;
      data: any[];
      borderColor?: string;
      backgroundColor?: string;
    }>;
  }>(),
  {
    records: () => [],
    activeMetrics: () => ['pm25_ae', 'temp', 'humi', 'co2'],
    customYMin: () => ({}),
    customYMax: () => ({}),
    gapThresholdMinutes: 15,
    emptyText: '暫無資料或尚未勾選指標',
  }
);

const chartRef = ref<any>(null);

// White background plugin for clean PNG exports
const customCanvasBackgroundPlugin = {
  id: 'customCanvasBackground',
  beforeDraw: (chart: any) => {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};
const chartPlugins = [customCanvasBackgroundPlugin];

const hasData = computed(() => {
  if (props.records && props.records.length > 0 && props.activeMetrics.length > 0) {
    return true;
  }
  if (props.datasets && props.datasets.length > 0 && props.datasets.some((d) => d.data.length > 0)) {
    return true;
  }
  return false;
});

// Process records with null gap breaking
const processedMetricsData = computed(() => {
  if (!props.records || props.records.length === 0 || props.activeMetrics.length === 0) {
    return { dataByMetric: {}, startEpoch: 0, endEpoch: 0 };
  }

  const gapThresholdMs = (props.gapThresholdMinutes || 15) * 60 * 1000;
  const dataByMetric: Record<string, Array<{ x: number; y: number | null }>> = {};

  for (const key of props.activeMetrics) {
    dataByMetric[key] = [];
  }

  let prevEpoch: number | null = null;
  let startEpoch = 0;
  let endEpoch = 0;

  for (let i = 0; i < props.records.length; i++) {
    const r = props.records[i];
    const currEpoch = new Date(r.timestamp).getTime();
    if (isNaN(currEpoch)) continue;

    if (startEpoch === 0) startEpoch = currEpoch;
    endEpoch = currEpoch;

    // Detect time gap > threshold, insert null break
    if (prevEpoch !== null && currEpoch - prevEpoch > gapThresholdMs) {
      const nullEpoch = prevEpoch + 60000;
      for (const key of props.activeMetrics) {
        dataByMetric[key].push({ x: nullEpoch, y: null });
      }
    }

    // Push data points
    for (const key of props.activeMetrics) {
      let val: number | null = null;
      if (r[key] !== undefined && r[key] !== null) {
        const num = parseFloat(r[key]);
        if (!isNaN(num)) {
          // Special case for CO2: 65535 or -1 represents sensor warming up
          if (key === 'co2' && (num < 0 || num > 10000)) {
            val = null;
          } else {
            val = num;
          }
        }
      }
      dataByMetric[key].push({ x: currEpoch, y: val });
    }

    prevEpoch = currEpoch;
  }

  return { dataByMetric, startEpoch, endEpoch };
});

const computedChartData = computed<ChartData<'line'>>(() => {
  // If records mode
  if (props.records && props.records.length > 0) {
    const { dataByMetric } = processedMetricsData.value;
    const datasets = props.activeMetrics.map((key) => {
      const def = METRIC_DEFINITIONS[key] || {
        label: key,
        color: '#6366f1',
      };
      return {
        label: def.label,
        data: (dataByMetric[key] || []) as any,
        borderColor: def.color,
        backgroundColor: def.color,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.2,
        spanGaps: false,
        yAxisID: `y_${key}`,
      };
    });

    return { datasets };
  }

  // Fallback to simple datasets
  return {
    labels: props.labels,
    datasets: (props.datasets || []).map((ds) => ({
      ...ds,
      tension: 0.3,
      pointRadius: 2,
    })),
  };
});

function generateCalendarTicks(startEpoch: number, endEpoch: number) {
  if (!startEpoch || !endEpoch || endEpoch <= startEpoch) return [];
  const ticks: Array<{ value: number; label: string }> = [];
  const days = (endEpoch - startEpoch) / (86400 * 1000);
  const startDate = new Date(startEpoch);

  if (days > 14) {
    // Every 5 days
    const curr = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0);
    while (curr.getTime() <= endEpoch) {
      if (curr.getDate() % 5 === 1 || curr.getDate() === 1) {
        const m = String(curr.getMonth() + 1).padStart(2, '0');
        const d = String(curr.getDate()).padStart(2, '0');
        ticks.push({ value: curr.getTime(), label: `${m}-${d}` });
      }
      curr.setDate(curr.getDate() + 1);
    }
  } else if (days > 2) {
    // Daily midnight
    const curr = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0);
    while (curr.getTime() <= endEpoch) {
      const m = String(curr.getMonth() + 1).padStart(2, '0');
      const d = String(curr.getDate()).padStart(2, '0');
      ticks.push({ value: curr.getTime(), label: `${m}-${d}` });
      curr.setDate(curr.getDate() + 1);
    }
  } else if (days > 0.8) {
    // Every 6 hours
    const curr = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0);
    while (curr.getTime() <= endEpoch + 86400000) {
      for (const h of [0, 6, 12, 18]) {
        const t = curr.getTime() + h * 3600 * 1000;
        if (t >= startEpoch && t <= endEpoch) {
          const m = String(curr.getMonth() + 1).padStart(2, '0');
          const d = String(curr.getDate()).padStart(2, '0');
          ticks.push({ value: t, label: `${m}-${d} ${String(h).padStart(2, '0')}:00` });
        }
      }
      curr.setDate(curr.getDate() + 1);
    }
  } else {
    // Single day: 2-hour increments
    const base = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0).getTime();
    for (let h = 0; h <= 24; h += 2) {
      const t = base + h * 3600 * 1000;
      if (t >= startEpoch - 3600000 && t <= endEpoch + 3600000) {
        ticks.push({ value: t, label: `${String(h).padStart(2, '0')}:00` });
      }
    }
  }

  return ticks;
}

const computedChartOptions = computed<ChartOptions<'line'>>(() => {
  const isRecordsMode = props.records && props.records.length > 0;
  const { startEpoch, endEpoch } = processedMetricsData.value;

  const scalesConfig: Record<string, any> = {
    x: {
      type: isRecordsMode ? 'linear' : 'category',
      min: isRecordsMode && startEpoch ? startEpoch : undefined,
      max: isRecordsMode && endEpoch ? endEpoch : undefined,
      grid: { color: '#f0f0f3' },
      ticks: {
        font: { family: "'JetBrains Mono', monospace", size: 11 },
        maxRotation: 0,
        autoSkip: !isRecordsMode,
        callback: isRecordsMode
          ? function (this: any, _val: any, index: number, ticks: any[]) {
              const tick = ticks[index];
              return tick && tick.label ? tick.label : '';
            }
          : undefined,
      },
      afterBuildTicks: isRecordsMode
        ? (axis: any) => {
            if (startEpoch && endEpoch) {
              axis.ticks = generateCalendarTicks(startEpoch, endEpoch);
            }
          }
        : undefined,
    },
  };

  if (isRecordsMode) {
    props.activeMetrics.forEach((key, index) => {
      const def = METRIC_DEFINITIONS[key] || { label: key, color: '#6366f1' };
      const isEven = index % 2 === 0;

      const yAxisConfig: any = {
        type: 'linear',
        display: true,
        position: isEven ? 'left' : 'right',
        title: {
          display: props.activeMetrics.length <= 4,
          text: def.label,
          color: def.color,
          font: { family: "'Inter', sans-serif", size: 11, weight: '600' },
        },
        ticks: {
          color: def.color,
          font: { family: "'JetBrains Mono', monospace", size: 10 },
        },
        grid: {
          drawOnChartArea: index === 0,
          color: '#f0f0f3',
        },
      };

      if (props.customYMin[key] !== undefined && props.customYMin[key] !== null) {
        yAxisConfig.min = Number(props.customYMin[key]);
      }
      if (props.customYMax[key] !== undefined && props.customYMax[key] !== null) {
        yAxisConfig.max = Number(props.customYMax[key]);
      }

      scalesConfig[`y_${key}`] = yAxisConfig;
    });
  } else {
    scalesConfig.y = {
      grid: { color: '#f0f0f3' },
      ticks: { font: { family: "'JetBrains Mono', monospace" } },
    };
  }

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          font: { family: "'Inter', sans-serif", size: 12 },
          usePointStyle: true,
          boxWidth: 8,
        },
      },
      tooltip: {
        backgroundColor: '#171717',
        titleFont: { family: "'JetBrains Mono', monospace", size: 12 },
        bodyFont: { family: "'JetBrains Mono', monospace", size: 12 },
        padding: 10,
        cornerRadius: 6,
        callbacks: {
          title: function (tooltipItems: any[]) {
            if (!tooltipItems.length) return '';
            const raw = tooltipItems[0].raw;
            const epoch = typeof raw === 'object' && raw ? raw.x : null;
            if (epoch) {
              const d = new Date(epoch);
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              const h = String(d.getHours()).padStart(2, '0');
              const min = String(d.getMinutes()).padStart(2, '0');
              const s = String(d.getSeconds()).padStart(2, '0');
              return `${y}-${m}-${day} ${h}:${min}:${s}`;
            }
            return tooltipItems[0].label || '';
          },
        },
      },
    },
    scales: scalesConfig,
  };
});

function exportImage(filename: string = 'maps6_sensor_chart.png') {
  if (!chartRef.value || !chartRef.value.chart) return;
  const chartInstance = chartRef.value.chart;
  const srcCanvas = chartInstance.canvas;

  const offscreen = document.createElement('canvas');
  offscreen.width = srcCanvas.width;
  offscreen.height = srcCanvas.height;
  const ctx = offscreen.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, offscreen.width, offscreen.height);
  ctx.drawImage(srcCanvas, 0, 0);

  const imageUri = offscreen.toDataURL('image/png', 1.0);
  const link = document.createElement('a');
  link.download = filename;
  link.href = imageUri;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

defineExpose({
  exportImage,
  chartRef,
});
</script>

<style scoped>
.sensor-chart-root {
  width: 100%;
  position: relative;
}

.chart-wrapper {
  height: 420px;
  position: relative;
  width: 100%;
}

.chart-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-muted);
  font-size: 14px;
  background: var(--color-canvas-subtle, #f9fafb);
  border-radius: 8px;
  border: 1px dashed var(--color-hairline-strong);
}
</style>
