<template>
  <div class="curve-wrap">
    <svg width="100%" height="320" viewBox="0 0 1000 300" preserveAspectRatio="none" role="img" :aria-label="ariaLabel" class="curve">
      <g :stroke="palette.grid" stroke-width="1">
        <line v-for="y in [20, 80, 140, 200, 260]" :key="y" x1="40" :y1="y" x2="980" :y2="y" />
      </g>
      <rect :x="nowX" y="20" :width="Math.max(0, 980 - nowX)" height="240" :fill="palette.future" />
      <polygon :points="areaPoints" :fill="palette.ac" fill-opacity="0.1" />
      <line x1="40" :y1="yOf(DRY_THRESHOLD)" x2="980" :y2="yOf(DRY_THRESHOLD)" :stroke="palette.mu" stroke-width="1.5" stroke-dasharray="5 5" vector-effect="non-scaling-stroke" />
      <polyline :points="pts(measured)" fill="none" :stroke="palette.ac" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
      <polyline v-if="predicted.length > 1" :points="pts(predicted)" fill="none" :stroke="palette.wa" stroke-width="3" stroke-dasharray="8 6" vector-effect="non-scaling-stroke" />
      <g font-family="JetBrains Mono, monospace" font-size="13" :fill="palette.mu">
        <text x="30" y="24" text-anchor="end">100%</text><text x="30" y="144" text-anchor="end">50%</text><text x="30" y="264" text-anchor="end">0</text>
        <text v-for="(tick, i) in ticks" :key="tick.t" :x="tick.x" y="288" :text-anchor="i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'">{{ tick.label }}</text>
      </g>
    </svg>
    <!-- markers are HTML so circles stay round and labels stay crisp while the SVG stretches -->
    <span class="marker" :style="markerStyle(nowX, yOf(moistNow), palette.ac)"></span>
    <span class="tag" :style="tagStyle(nowX, yOf(moistNow) - 18)"><b :style="{ color: palette.acTx }">現在 {{ Math.round(moistNow) }}%</b></span>
    <template v-if="dryX != null">
      <span class="marker" :style="markerStyle(dryX, yOf(DRY_THRESHOLD), palette.wa)"></span>
      <span class="tag" :style="tagStyle(dryX, dryX - nowX < 150 ? yOf(DRY_THRESHOLD) + 22 : yOf(DRY_THRESHOLD) - 24)"><b :style="{ color: palette.waTx }">{{ clock(dryTime!) }} 乾</b></span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTheme } from '../../composables/useTheme';
import { DRY_THRESHOLD } from '../../composables/useClothesMock';
import { clock } from '../../utils/format';

const props = defineProps<{
  startedAt: number;
  now: number;
  moistNow: number;          // remaining moisture % at `now`
  dryTime: number | null;    // when it should reach the dry threshold, null = unknown
}>();

const { palette } = useTheme();
const HOUR = 3600000;

// Always this drying session: from the start to a bit past the predicted dry time.
const window = computed(() => {
  const end = Math.max(props.dryTime ?? props.now, props.now);
  const span = Math.max(end - props.startedAt, HOUR);
  return { t0: props.startedAt, t1: end + span * 0.25 };
});
const xOf = (t: number) => 40 + ((t - window.value.t0) / (window.value.t1 - window.value.t0)) * 940;
const yOf = (m: number) => 260 - (Math.max(0, Math.min(100, m)) / 100) * 240;

// Concave drying shape: fast at first, slowing down near the end.
const ease = (x: number) => 1 - (1 - Math.max(0, Math.min(1, x))) ** 1.6;

const measured = computed(() => {
  const out: { t: number; m: number }[] = [];
  const from = Math.max(props.startedAt, window.value.t0);
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = from + ((props.now - from) * i) / steps;
    const x = props.now > props.startedAt ? (t - props.startedAt) / (props.now - props.startedAt) : 1;
    out.push({ t, m: 100 - (100 - props.moistNow) * ease(x) });
  }
  return out;
});

const predicted = computed(() => {
  if (props.dryTime == null) return [];
  const out: { t: number; m: number }[] = [];
  const end = window.value.t1;
  const span = Math.max(props.dryTime - props.now, 60000);
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = props.now + ((end - props.now) * i) / steps;
    const x = (t - props.now) / span;
    const target = x <= 1 ? props.moistNow - (props.moistNow - DRY_THRESHOLD) * ease(x) : DRY_THRESHOLD * Math.max(0, 1 - (x - 1) * 0.8);
    out.push({ t, m: Math.max(0, target) });
  }
  return out;
});

const pts = (list: { t: number; m: number }[]) => list.map((p) => `${xOf(p.t).toFixed(1)},${yOf(p.m).toFixed(1)}`).join(' ');
const nowX = computed(() => Math.min(980, Math.max(40, xOf(props.now))));
const dryX = computed(() => props.dryTime == null ? null : xOf(props.dryTime) <= 980 ? xOf(props.dryTime) : null);
const areaPoints = computed(() => {
  const m = measured.value;
  if (!m.length) return '';
  return `${pts(m)} ${xOf(m[m.length - 1].t).toFixed(1)},260 ${xOf(m[0].t).toFixed(1)},260`;
});

const ticks = computed(() => {
  const { t0, t1 } = window.value;
  return [0, 0.25, 0.5, 0.75, 1].map((k) => { const t = t0 + (t1 - t0) * k; return { t, x: xOf(t), label: clock(t) }; });
});

// Positions as % of the SVG box (1000×300 stretched to 100% × 320px).
const markerStyle = (x: number, y: number, color: string) => ({ left: `${x / 10}%`, top: `${(y / 300) * 100}%`, borderColor: color });
const tagStyle = (x: number, y: number) => ({ left: `${x / 10}%`, top: `${(Math.max(0, y) / 300) * 100}%`, transform: x > 820 ? 'translate(-100%, -50%)' : 'translate(10px, -50%)' });

const ariaLabel = computed(() => `剩餘水分從開始的 100% 降至目前 ${Math.round(props.moistNow)}%` +
  (props.dryTime ? `，預測約 ${clock(props.dryTime)} 降到乾燥門檻` : ''));
</script>

<style scoped>
.curve-wrap { position: relative; min-width: 640px; }
.curve { display: block; }
.marker { position: absolute; width: 12px; height: 12px; border-radius: 50%; border: 3px solid; background: var(--sf); transform: translate(-50%, -50%); pointer-events: none; }
.tag { position: absolute; font-size: 0.9375rem; white-space: nowrap; pointer-events: none; }
</style>
