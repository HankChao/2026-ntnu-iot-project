<template>
  <div class="card device-card" @click="$router.push(`/devices/${device.device_id}`)">
    <div class="card-header">
      <div class="title-group">
        <h3 class="device-name">{{ device.display_name || device.device_id }}</h3>
        <span class="device-id">{{ device.device_id }}</span>
      </div>
      <StatusBadge :online="device.online" />
    </div>

    <div class="metrics-grid">
      <div class="metric-item">
        <span class="metric-label">溫度</span>
        <span class="metric-val text-temp">{{ latestSensor?.temp != null ? `${latestSensor.temp} °C` : '--' }}</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">濕度</span>
        <span class="metric-val text-humi">{{ latestSensor?.humi != null ? `${latestSensor.humi} %` : '--' }}</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">CO2</span>
        <span class="metric-val text-co2">{{ latestSensor?.co2 != null ? `${latestSensor.co2} ppm` : '--' }}</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">PM2.5</span>
        <span class="metric-val text-pm25">{{ latestSensor?.pm25_ae != null ? `${latestSensor.pm25_ae} µg` : '--' }}</span>
      </div>
    </div>

    <div class="card-footer">
      <span class="version-tag">v{{ device.version || '8.0.0' }}</span>
      <span class="time-tag">{{ lastSeenText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import StatusBadge from './StatusBadge.vue';

const props = defineProps<{
  device: {
    device_id: string;
    display_name?: string;
    version?: string;
    online: boolean;
    last_seen?: string;
  };
  latestSensor?: {
    temp?: number;
    humi?: number;
    co2?: number;
    pm25_ae?: number;
  };
}>();

const lastSeenText = computed(() => {
  if (!props.device.last_seen) return '從未回報';
  const d = new Date(props.device.last_seen);
  return d.toLocaleTimeString();
});
</script>

<style scoped>
.device-card {
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.device-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.device-name {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 2px;
}

.device-id {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--color-muted);
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  background: var(--color-canvas-soft);
  padding: 12px;
  border-radius: 6px;
}

.metric-item {
  display: flex;
  flex-direction: column;
}

.metric-label {
  font-size: 12px;
  color: var(--color-body);
}

.metric-val {
  font-size: 15px;
  font-weight: 600;
  font-family: var(--font-mono);
}

.text-temp { color: #e11d48; }
.text-humi { color: #0284c7; }
.text-co2 { color: #16a34a; }
.text-pm25 { color: #d97706; }

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--color-muted);
}

.version-tag {
  background: var(--color-hairline);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
}
</style>
