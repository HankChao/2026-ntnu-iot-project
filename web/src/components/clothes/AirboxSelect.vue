<template>
  <select :id="id" class="ui-select" :class="{ 'ui-select--sm': small }" :value="current" :disabled="!options.length"
    @change="airboxChoice = ($event.target as HTMLSelectElement).value">
    <option v-if="!options.length" value="">目前沒有空氣盒子</option>
    <option v-for="box in options" :key="box.device_id" :value="box.device_id">{{ airboxLabel(box) }}</option>
  </select>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { airboxLabel, clothesLiveState, type Airbox } from '../../composables/useClothesData';

defineProps<{ id: string; small?: boolean }>();

const { airboxChoice, airboxOptions, airboxes, defaultAirboxId } = clothesLiveState;

// Without an explicit choice the server picks a box (CLOTHES_AIRBOX_ID or the last one that reported);
// show that box by name instead of "自動".
const current = computed(() => airboxChoice.value || defaultAirboxId.value || '');
const options = computed<Airbox[]>(() => {
  const list = [...airboxOptions.value];
  const id = current.value;
  if (id && !list.some((box) => box.device_id === id)) {
    // The box in use may be offline (so not in the connected list); keep it visible.
    list.push(airboxes.value.find((box) => box.device_id === id) ?? { device_id: id, display_name: null, last_reading: null, connected: false });
  }
  return list;
});
</script>
