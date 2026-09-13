<template>
  <div class="interval-slider">
    <div class="slider-row">
      <input
        type="range"
        :min="min"
        :max="max"
        :step="1"
        :value="modelValue"
        @input="onSliderChange"
        class="slider"
      />
      <div class="input-wrap">
        <input
          type="number"
          :min="min"
          :max="max"
          :value="modelValue"
          @input="onNumberChange"
          class="num-input"
        />
        <span class="unit">秒</span>
      </div>
    </div>

    <!-- Presets -->
    <div class="preset-ticks">
      <button
        v-for="tick in ticks"
        :key="tick.value"
        type="button"
        :class="['preset-btn', modelValue === tick.value ? 'active' : '']"
        @click="$emit('update:modelValue', tick.value)"
      >
        {{ tick.label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: number;
    min?: number;
    max?: number;
  }>(),
  {
    min: 5,
    max: 600,
  }
);

const emit = defineEmits<{
  (e: 'update:modelValue', val: number): void;
}>();

const ticks = [
  { label: '10s', value: 10 },
  { label: '30s', value: 30 },
  { label: '60s', value: 60 },
  { label: '2m', value: 120 },
  { label: '5m', value: 300 },
];

function onSliderChange(e: Event) {
  const val = Number((e.target as HTMLInputElement).value);
  emit('update:modelValue', val);
}

function onNumberChange(e: Event) {
  let val = Number((e.target as HTMLInputElement).value);
  if (isNaN(val)) return;
  if (val < props.min) val = props.min;
  if (val > props.max) val = props.max;
  emit('update:modelValue', val);
}
</script>

<style scoped>
.interval-slider {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.slider {
  flex: 1;
  accent-color: var(--color-primary);
  cursor: pointer;
}

.input-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}

.num-input {
  width: 70px;
  padding: 6px 8px;
  border: 1px solid var(--color-hairline-strong);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 14px;
  text-align: right;
}

.unit {
  font-size: 13px;
  color: var(--color-body);
}

.preset-ticks {
  display: flex;
  gap: 6px;
}

.preset-btn {
  padding: 2px 8px;
  border: 1px solid var(--color-hairline-strong);
  background: var(--color-canvas);
  border-radius: 4px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--color-body);
  cursor: pointer;
  transition: all 0.15s;
}

.preset-btn:hover {
  background: var(--color-hairline);
  color: var(--color-ink);
}

.preset-btn.active {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
</style>
