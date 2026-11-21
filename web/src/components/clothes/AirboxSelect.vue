<template>
  <select :id="id" class="ui-select" :class="{ 'ui-select--sm': small }" :value="current" :disabled="!options.length"
    :title="clipSettingError || undefined" @change="pick($event.target as HTMLSelectElement)">
    <option v-if="!options.length" value="">目前沒有空氣盒子</option>
    <option v-for="box in options" :key="box.device_id" :value="box.device_id">{{ airboxLabel(box) }}</option>
  </select>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { airboxLabel, clothesLiveState, type Airbox } from '../../composables/useClothesData';

defineProps<{ id: string; small?: boolean }>();

const { airboxOptions, airboxes, defaultAirboxId, clipSettingError, setClipAirbox } = clothesLiveState;

// The pairing is a per-clip setting on the server. Without one the server still picks a box
// (CLOTHES_AIRBOX_ID or the last one that reported); show that box by name instead of "自動".
const current = computed(() => defaultAirboxId.value || '');

async function pick(select: HTMLSelectElement) {
  const ok = await setClipAirbox(select.value);
  if (!ok) select.value = current.value;  // not stored: show the pairing that is really in use
}
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
