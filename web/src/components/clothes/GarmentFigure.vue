<template>
  <svg class="garment" viewBox="0 0 300 370" preserveAspectRatio="xMidYMin meet" role="img" :aria-label="label">
    <defs v-if="garment">
      <clipPath :id="ids.clip"><path :d="shape.d" /></clipPath>
      <pattern :id="ids.pat" :width="mat.w" :height="mat.h" patternUnits="userSpaceOnUse" :patternTransform="mat.rot || undefined">
        <path :d="mat.d" fill="none" :stroke="ink" :stroke-width="mat.sw" :stroke-opacity="mat.op" />
      </pattern>
      <linearGradient :id="ids.shade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#000000" stop-opacity="0.2" />
        <stop offset="0.32" stop-color="#FFFFFF" :stop-opacity="mat.sheen" />
        <stop offset="0.58" stop-color="#FFFFFF" stop-opacity="0" />
        <stop offset="1" stop-color="#000000" stop-opacity="0.22" />
      </linearGradient>
    </defs>

    <path :d="HANGER_HOOK" fill="none" :stroke="palette.tx2" stroke-width="3.5" stroke-linecap="round" />
    <path :d="HANGER_BAR" fill="none" :stroke="palette.tx2" stroke-width="3.5" stroke-linejoin="round" />

    <!-- Tops are lifted so the shoulders rest on the hanger arms; pants and towels fold over its bar. -->
    <g v-if="garment" :transform="`translate(0,${-shape.lift})`">
      <g :clip-path="`url(#${ids.clip})`">
        <path :d="shape.d" :fill="garment.color" />
        <rect x="0" y="0" width="300" height="370" :fill="`url(#${ids.pat})`" />
        <rect x="40" y="60" width="220" height="280" :fill="`url(#${ids.shade})`" />
        <path :d="shape.folds" fill="none" :stroke="ink" stroke-opacity="0.12" stroke-width="3" stroke-linecap="round" />
        <template v-if="level != null">
          <path class="wave-back" :d="wave(level - 3, -385)" :fill="palette.ac" fill-opacity="0.25" />
          <path class="wave" :d="wave(level, -330)" fill="#06121A" fill-opacity="0.26" />
          <path class="wave" :d="wave(level, -330)" :fill="palette.ac" fill-opacity="0.42" />
          <path class="wave" :d="crest(level, -330)" fill="none" stroke="#FFFFFF" stroke-opacity="0.6" stroke-width="2" />
        </template>
      </g>
      <path :d="shape.details" fill="none" :stroke="edge" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path :d="shape.d" fill="none" :stroke="edge" stroke-width="2.5" stroke-linejoin="round" />
      <template v-if="dripping">
        <g :transform="`translate(${shape.drips[0]},${shape.bottom + 10})`"><path class="drip" :d="DROP" :fill="palette.ac" /></g>
        <g :transform="`translate(${shape.drips[1]},${shape.bottom + 10})`"><path class="drip drip-late" :d="DROP" :fill="palette.ac" /></g>
      </template>
    </g>
    <!-- Clip hanger: two clips on the bar grip the waistband. -->
    <template v-if="garment && shape.clips">
      <g v-for="x in shape.clips" :key="x">
        <rect :x="x - 6" y="88" width="12" height="20" rx="3" :fill="palette.tx2" :stroke="edge" stroke-width="1.5" />
        <path :d="`M${x - 3},102 h6`" fill="none" :stroke="edge" stroke-width="1.5" stroke-linecap="round" />
      </g>
    </template>
    <path v-else-if="!garment" :d="SHAPES.tee.d" fill="none" :stroke="palette.bd2" stroke-width="2.5" stroke-dasharray="8 6" stroke-linejoin="round" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { DROP, HANGER_BAR, HANGER_HOOK, MATS, SHAPES, crest, lum, mix, wave, type Material, type StyleKey } from '../../constants/garments';
import { useTheme } from '../../composables/useTheme';

const props = defineProps<{
  garment: { style: StyleKey; color: string; material: Material } | null;
  moist?: number | null;   // remaining moisture %, null = no water level
  uid: string;             // unique per figure on the page (SVG ids)
  label?: string;
}>();

const { palette } = useTheme();
const ids = computed(() => ({ clip: `gclip-${props.uid}`, pat: `gpat-${props.uid}`, shade: `gshade-${props.uid}` }));
const shape = computed(() => SHAPES[props.garment?.style ?? 'tee'] ?? SHAPES.tee);
const mat = computed(() => MATS[props.garment?.material ?? '棉'] ?? MATS['棉']);
const ink = computed(() => props.garment && lum(props.garment.color) > 0.45 ? '#000000' : '#FFFFFF');
const edge = computed(() => {
  const c = props.garment?.color ?? '#F2F1EC';
  return lum(c) > 0.3 ? mix(c, 0, 0.45) : mix(c, 255, 0.4);
});
const level = computed(() => props.moist == null ? null
  : Math.round(shape.value.bottom - (Math.max(0, Math.min(100, props.moist)) / 100) * (shape.value.bottom - shape.value.top)));
const dripping = computed(() => props.moist != null && props.moist > 15);
const label = computed(() => props.label ?? (props.garment ? '衣物插圖' : '衣架上沒有衣服'));
</script>

<style scoped>
.garment { display: block; width: 100%; max-width: 380px; height: auto; margin: 0 auto; }
.wave { animation: wave-move 4s linear infinite; }
.wave-back { animation: wave-move 7s linear infinite reverse; }
@keyframes wave-move { from { transform: translateX(0); } to { transform: translateX(110px); } }
.drip { opacity: 0; animation: drip 2.6s ease-in infinite; }
.drip-late { animation-delay: 1.3s; }
@keyframes drip { 0% { transform: translateY(0); opacity: 0; } 15% { opacity: 1; } 75% { opacity: 1; } 100% { transform: translateY(36px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .wave, .wave-back, .drip { animation: none; } .drip { opacity: 1; } }
</style>
