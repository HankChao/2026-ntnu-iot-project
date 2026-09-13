<template>
  <div class="main-container">
    <div class="header-row">
      <h1 class="page-title">系統設定與健康狀態</h1>
      <p class="page-desc">檢視 MQTT Broker、資料庫及中央服務連線資訊</p>
    </div>

    <div class="settings-grid">
      <!-- Health Card -->
      <div class="card">
        <h3 class="section-title">服務健康檢測</h3>
        <div class="service-list">
          <div class="service-item">
            <span>PostgreSQL 資料庫</span>
            <span :class="['badge', health.services?.database === 'connected' ? 'badge-online' : 'badge-offline']">
              {{ health.services?.database === 'connected' ? '已連線' : '中斷' }}
            </span>
          </div>
          <div class="service-item">
            <span>MQTT 遙測接收器 (Subscriber)</span>
            <span :class="['badge', health.services?.mqtt_subscriber === 'connected' ? 'badge-online' : 'badge-offline']">
              {{ health.services?.mqtt_subscriber === 'connected' ? '已連線' : '中斷' }}
            </span>
          </div>
          <div class="service-item">
            <span>MQTT 指令發布器 (Publisher)</span>
            <span :class="['badge', health.services?.mqtt_publisher === 'connected' ? 'badge-online' : 'badge-offline']">
              {{ health.services?.mqtt_publisher === 'connected' ? '已連線' : '中斷' }}
            </span>
          </div>
        </div>
      </div>

      <!-- Server Info Card -->
      <div class="card">
        <h3 class="section-title">伺服器環境規格</h3>
        <div class="info-list">
          <div class="info-item">
            <span class="info-label">執行環境 (Runtime)</span>
            <span class="info-val font-mono">Bun / Docker Compose</span>
          </div>
          <div class="info-item">
            <span class="info-label">MQTT 通訊協定版本</span>
            <span class="info-val font-mono">MQTT v3.1.1 (Mosquitto 2.0)</span>
          </div>
          <div class="info-item">
            <span class="info-label">資料庫引擎</span>
            <span class="info-val font-mono">PostgreSQL 18 Alpine</span>
          </div>
          <div class="info-item">
            <span class="info-label">前端控制台架構</span>
            <span class="info-val font-mono">Vue 3 + Vite + Chart.js</span>
          </div>
        </div>
      </div>

      <!-- Server Stats Card -->
      <div class="card">
        <h3 class="section-title">資料量與運作統計</h3>
        <div class="info-list">
          <div class="info-item">
            <span class="info-label">註冊盒子總數</span>
            <span class="info-val font-mono">{{ stats.total_devices ?? 0 }} 台</span>
          </div>
          <div class="info-item">
            <span class="info-label">目前在線盒子</span>
            <span class="info-val font-mono text-success">{{ stats.online_devices ?? 0 }} 台</span>
          </div>
          <div class="info-item">
            <span class="info-label">資料庫感測時序筆數</span>
            <span class="info-val font-mono">{{ stats.total_records ?? 0 }} 筆</span>
          </div>
          <div class="info-item" v-if="stats.newest_record">
            <span class="info-label">最新資料時間</span>
            <span class="info-val font-mono">{{ new Date(stats.newest_record).toLocaleString() }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const health = ref<any>({});
const stats = ref<any>({});

async function checkHealthAndStats() {
  try {
    const [hRes, sRes] = await Promise.all([
      fetch('/api/v1/system/health'),
      fetch('/api/v1/system/stats'),
    ]);
    health.value = await hRes.json();
    const sData = await sRes.json();
    if (sData.stats) {
      stats.value = sData.stats;
    }
  } catch (err) {
    console.error('Fetch health/stats failed:', err);
  }
}

onMounted(() => {
  checkHealthAndStats();
});
</script>

<style scoped>
.header-row {
  margin-bottom: 24px;
}

.page-title {
  font-size: 24px;
  font-weight: 700;
}

.page-desc {
  font-size: 14px;
  color: var(--color-body);
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 20px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
}

.service-list, .info-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.service-item, .info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-hairline);
}

.info-label {
  color: var(--color-body);
}

.font-mono {
  font-family: var(--font-mono);
}
</style>
