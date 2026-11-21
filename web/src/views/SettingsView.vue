<template>
  <div class="main-container">
    <div class="header-row">
      <h1 class="page-title">系統設定與健康狀態</h1>
      <p class="page-desc">檢視 MQTT Broker、資料庫及中央服務連線資訊</p>
    </div>

    <div class="settings-grid">
      <!-- Demo data -->
      <div class="card">
        <h3 class="section-title">示範資料</h3>
        <label class="switch-row" for="demo-switch">
          <span>顯示示範資料</span>
          <input id="demo-switch" class="switch" type="checkbox" role="switch" :checked="demoEnabled" :disabled="saving"
            @change="toggleDemo($event.target as HTMLInputElement)" />
        </label>
        <p class="switch-note">
          {{ demoEnabled
            ? '目前一起顯示示範的衣夾-02～08、衣物、晾衣紀錄與天氣，並標上「示範」；統計只算實際資料。關閉後只留下實際的資料。'
            : '目前只顯示實際的衣夾、衣物與晾衣紀錄。示範資料仍保留在伺服器，重新開啟就會回來。' }}
        </p>
        <p v-if="demoError || settingsError" class="ui-note ui-note--error" role="alert">{{ demoError || settingsError }}</p>
        <p class="switch-note muted">這個開關、衣物與晾衣紀錄都存在伺服器，所有瀏覽器都一樣。示範資料以 is_demo 標記，第一次使用請執行 make seed 建立。</p>
      </div>

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
import { useClothesMock } from '../composables/useClothesMock';
import { useSettings } from '../composables/useSettings';

const { demoEnabled, setDemoEnabled } = useClothesMock();
const { settingsError } = useSettings();
const saving = ref(false);
const demoError = ref('');

// The switch only moves once the server has stored the setting.
async function toggleDemo(input: HTMLInputElement) {
  const wanted = input.checked;
  saving.value = true; demoError.value = '';
  try { await setDemoEnabled(wanted); } catch (err) {
    demoError.value = (err as Error).message;  // the server says what was not stored
  } finally {
    saving.value = false;
    input.checked = demoEnabled.value;
  }
}

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
  font-size: 1.5rem;
  font-weight: 700;
}

.page-desc {
  font-size: 0.875rem;
  color: var(--color-body);
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 20px;
}

.section-title {
  font-size: 1rem;
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
  font-size: 0.875rem;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-hairline);
}

.info-label {
  color: var(--color-body);
}

.font-mono {
  font-family: var(--font-mono);
}

.switch-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  min-height: 44px;
  font-weight: 600;
  cursor: pointer;
}

.switch-note {
  margin-top: 8px;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--tx2);
}

.switch-note.muted { color: var(--mu); }

/* Native checkbox drawn as a switch; keyboard and screen readers keep working. */
.switch {
  appearance: none;
  flex: 0 0 auto;
  position: relative;
  width: 48px;
  height: 28px;
  margin: 0;
  border-radius: 14px;
  background: var(--bd2);
  cursor: pointer;
  transition: background 0.2s;
}

.switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--tx);
  transition: transform 0.2s;
}

.switch:checked { background: var(--ac); }
.switch:checked::after { transform: translateX(20px); background: var(--bg); }
.switch:focus-visible { outline: 2px solid var(--ac); outline-offset: 2px; }
</style>
