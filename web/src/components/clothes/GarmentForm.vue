<template>
  <div class="garment-form">
    <div class="ui-field">
      <label :for="`${idPrefix}-name`">名稱</label>
      <input :id="`${idPrefix}-name`" class="ui-input" type="text" :value="modelValue.name" :placeholder="placeholder"
        @input="patch({ name: ($event.target as HTMLInputElement).value })" />
    </div>
    <fieldset class="group">
      <legend class="ui-legend">樣式</legend>
      <div class="options">
        <button v-for="key in STYLE_KEYS" :key="key" type="button" class="ui-btn chip" :aria-pressed="modelValue.style === key"
          @click="patch({ style: key })">{{ SHAPES[key].label }}</button>
      </div>
    </fieldset>
    <fieldset class="group">
      <legend class="ui-legend">顏色</legend>
      <div class="options">
        <button v-for="c in COLORS" :key="c.hex" type="button" class="swatch" :aria-pressed="modelValue.color === c.hex"
          :aria-label="c.label" :title="c.label" :style="{ background: c.hex }" @click="patch({ color: c.hex })"></button>
      </div>
    </fieldset>
    <div class="ui-field">
      <label :for="`${idPrefix}-material`">材質</label>
      <select :id="`${idPrefix}-material`" class="ui-select" :value="modelValue.material"
        @change="patch({ material: ($event.target as HTMLSelectElement).value as Material })">
        <option v-for="m in MATERIALS" :key="m" :value="m">{{ m }}</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { COLORS, MATERIALS, SHAPES, STYLE_KEYS, type Material } from '../../constants/garments';
import type { GarmentDraft } from '../../composables/useClothesMock';

const props = defineProps<{ modelValue: GarmentDraft; idPrefix: string; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: GarmentDraft] }>();
const patch = (change: Partial<GarmentDraft>) => emit('update:modelValue', { ...props.modelValue, ...change });
</script>

<style scoped>
.garment-form { display: flex; flex-direction: column; gap: 22px; }
.group { border: 0; display: flex; flex-direction: column; gap: 8px; }
.group legend { margin-bottom: 8px; }
.options { display: flex; flex-wrap: wrap; gap: 8px; }
.chip[aria-pressed='true'] { background: var(--inv); border-color: var(--inv); color: var(--inv-tx); }
.swatch { width: 44px; height: 44px; border-radius: 50%; border: 3px solid var(--bd2); box-shadow: inset 0 0 0 2px var(--bg); cursor: pointer; }
.swatch[aria-pressed='true'] { border-color: var(--ac); }
</style>
