<template>
  <div class="main-container">
    <div class="header-row">
      <div>
        <h1 class="page-title">即時環境監控儀表板</h1>
        <p class="page-desc">全站盒子即時遙測與上線狀態</p>
      </div>
      <div class="connection-status">
        <span class="status-indicator" :class="{ connected: isConnected }"></span>
        <span>{{ isConnected ? '即時串流已連線' : '即時串流重連中...' }}</span>
      </div>
    </div>

    <!-- Filter & Search Toolbar -->
    <div class="toolbar-row">
      <div class="filter-tabs">
        <button
          :class="['tab-btn', currentFilter === 'all' ? 'active' : '']"
          @click="currentFilter = 'all'"
        >
          全部 ({{ devices.length }})
        </button>
        <button
          :class="['tab-btn', currentFilter === 'online' ? 'active' : '']"
          @click="currentFilter = 'online'"
        >
          在線 ({{ onlineCount }})
        </button>
        <button
          :class="['tab-btn', currentFilter === 'offline' ? 'active' : '']"
          @click="currentFilter = 'offline'"
        >
          離線 ({{ devices.length - onlineCount }})
        </button>
      </div>

      <div class="search-wrap">
        <input
          type="text"
          v-model="searchQuery"
          placeholder="搜尋盒子名稱或 MAC..."
          class="search-input"
        />
      </div>
    </div>

    <div v-if="loading" class="empty-state">
      載入盒子資料中...
    </div>

    <div v-else-if="filteredDevices.length === 0" class="empty-state">
      {{ searchQuery ? '未找到符合搜尋條件的盒子。' : '目前尚無任何監測盒子連線回報。' }}
    </div>

    <div v-else class="devices-grid">
      <DeviceCard
        v-for="dev in filteredDevices"
        :key="dev.device_id"
        :device="dev"
        :latestSensor="latestSensors[dev.device_id]"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import DeviceCard from '../components/DeviceCard.vue';
import { useWebSocket } from '../composables/useWebSocket';

interface DeviceItem {
  device_id: string;
  display_name?: string;
  version?: string;
  online: boolean;
  last_seen?: string;
}

const devices = ref<DeviceItem[]>([]);
const latestSensors = ref<Record<string, any>>({});
const loading = ref(true);
const currentFilter = ref<'all' | 'online' | 'offline'>('all');
const searchQuery = ref('');

const onlineCount = computed(() => devices.value.filter((d) => d.online).length);

const filteredDevices = computed(() => {
  return devices.value.filter((d) => {
    // Filter by online status
    if (currentFilter.value === 'online' && !d.online) return false;
    if (currentFilter.value === 'offline' && d.online) return false;

    // Filter by search query
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.trim().toLowerCase();
      const name = (d.display_name || '').toLowerCase();
      const id = d.device_id.toLowerCase();
      return name.includes(q) || id.includes(q);
    }

    return true;
  });
});

// Fetch initial list & latest sensor readings
async function fetchDevices() {
  try {
    const res = await fetch('/api/v1/devices');
    const data = await res.json();
    if (data.success) {
      devices.value = data.devices;

      // Parallel fetch latest sensor for each device
      await Promise.all(
        data.devices.map(async (dev: DeviceItem) => {
          try {
            const sRes = await fetch(`/api/v1/devices/${dev.device_id}/sensor/latest`);
            const sData = await sRes.json();
            if (sData.success && sData.data) {
              latestSensors.value[dev.device_id] = sData.data;
            }
          } catch {
            // Ignore individual fetch failure
          }
        })
      );
    }
  } catch (err) {
    console.error('Fetch devices failed:', err);
  } finally {
    loading.value = false;
  }
}

// WebSocket Live Telemetry Stream
const { isConnected } = useWebSocket((msg) => {
  if (msg.type === 'sensor' && msg.device_id) {
    latestSensors.value[msg.device_id] = msg.sensor;
  } else if (msg.type === 'online' && msg.device_id) {
    const target = devices.value.find((d) => d.device_id === msg.device_id);
    if (target) {
      target.online = Boolean(msg.online);
      target.last_seen = msg.timestamp;
    } else {
      fetchDevices();
    }
  } else if (msg.type === 'status' && msg.device_id) {
    const target = devices.value.find((d) => d.device_id === msg.device_id);
    if (target) {
      target.version = msg.version;
    }
  }
});

onMounted(() => {
  fetchDevices();
});
</script>

<style scoped>
.header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.page-desc {
  font-size: 14px;
  color: var(--color-body);
  margin-top: 4px;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-body);
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-danger);
}

.status-indicator.connected {
  background: var(--color-success);
}

.toolbar-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.filter-tabs {
  display: flex;
  background: var(--color-hairline);
  padding: 4px;
  border-radius: 8px;
  gap: 4px;
}

.tab-btn {
  border: none;
  background: transparent;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-body);
  cursor: pointer;
  transition: all 0.15s;
}

.tab-btn.active {
  background: var(--color-canvas);
  color: var(--color-ink);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.search-wrap {
  flex: 1;
  max-width: 320px;
}

.search-input {
  width: 100%;
  padding: 8px 14px;
  border: 1px solid var(--color-hairline-strong);
  border-radius: 8px;
  font-size: 14px;
  background: var(--color-canvas);
}

.devices-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.empty-state {
  text-align: center;
  padding: 60px 0;
  color: var(--color-muted);
}
</style>
