<template>
  <div class="main-container">
    <div class="header-nav">
      <router-link to="/" class="back-link">← 返回即時儀表板</router-link>
      <div class="header-nav-right">
        <router-link :to="`/history?id=${deviceId}`" class="btn btn-primary btn-sm">
          查看歷史時序圖表 →
        </router-link>
      </div>
    </div>

    <div v-if="loading" class="loading-state">載入盒子即時資料中...</div>

    <div v-else-if="device" class="detail-container">
      <!-- Device Header Card -->
      <div class="card device-header-card">
        <div class="device-header-top">
          <div class="title-area">
            <div v-if="!isEditingName" class="name-row">
              <h1 class="device-name">{{ device.display_name || device.device_id }}</h1>
              <button class="btn-icon" @click="startEditName" title="修改顯示名稱">✏️</button>
            </div>
            <div v-else class="name-edit-row">
              <input
                type="text"
                v-model="nameInput"
                class="name-input"
                placeholder="輸入站點名稱"
                @keyup.enter="saveName"
              />
              <button class="btn btn-primary btn-xs" @click="saveName" :disabled="savingName">
                {{ savingName ? '儲存中...' : '儲存' }}
              </button>
              <button class="btn btn-subtle btn-xs" @click="isEditingName = false">取消</button>
            </div>
            <div class="device-id-row">
              <span class="device-mac font-mono">{{ device.device_id }}</span>
              <span class="device-app-ver">MAPS v{{ device.version || '8.0.0' }}</span>
              <span class="device-mcu-ver">MCU fw: {{ device.mcu_firmware || '2.1.0' }}</span>
            </div>
          </div>

          <div class="status-action-area">
            <StatusBadge :online="device.online" />
            <button
              class="btn btn-subtle btn-xs refresh-btn"
              @click="loadLatestSensor"
              :disabled="refreshing"
            >
              {{ refreshing ? '更新中...' : '⟳ 手動更新' }}
            </button>
          </div>
        </div>

        <!-- Hardware specs strip -->
        <div class="specs-strip">
          <div class="spec-item">
            <span class="spec-label">網路位址 (IP)</span>
            <span class="spec-val font-mono">{{ device.network?.ip || '無連線' }}</span>
          </div>
          <div class="spec-item">
            <span class="spec-label">Wi-Fi SSID</span>
            <span class="spec-val">{{ device.network?.ssid || '-' }}</span>
          </div>
          <div class="spec-item">
            <span class="spec-label">運轉時間 (Uptime)</span>
            <span class="spec-val">{{ formatUptime(device.uptime_sec) }}</span>
          </div>
          <div class="spec-item">
            <span class="spec-label">最新回報時間</span>
            <span class="spec-val font-mono">{{ formatTimestamp(latestTimestamp || device.last_seen) }}</span>
          </div>
          <div class="spec-item modules-spec">
            <span class="spec-label">運行模組</span>
            <div class="module-chips">
              <span v-for="m in activeModules" :key="m" class="mod-chip">● {{ m }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Real-time 23-Metric Telemetry Section -->
      <div class="section-block">
        <div class="section-header-row">
          <div>
            <h2 class="section-title">即時全感測器監測數據 (23 項指標全覽)</h2>
            <p class="section-desc">即時反映 ATmega2560 下位機採集之全部 22 項環境指標與樹莓派主機溫度</p>
          </div>
          <div class="auto-refresh-pill">
            <span class="pulse-indicator" :class="{ online: device.online }"></span>
            <span>即時同步中</span>
          </div>
        </div>

        <div v-if="!latestSensor" class="card empty-sensor-card">
          <span>尚未收到此盒子的感測器回報封包</span>
        </div>

        <div v-else class="metrics-grid-container">
          <!-- Group 1: Weather (SHT3x) -->
          <div class="card metric-group-card">
            <div class="group-header">
              <span class="group-title">氣候溫濕度</span>
              <span class="group-chip">SHT3x</span>
            </div>
            <div class="metric-items-grid">
              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #e11d48;"></span>
                  <span class="metric-box-label">環境溫度</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatNum(latestSensor.temp) }}</span>
                  <span class="metric-box-unit">°C</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #0284c7;"></span>
                  <span class="metric-box-label">相對濕度</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatNum(latestSensor.humi) }}</span>
                  <span class="metric-box-unit">%RH</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Group 2: Particulate Matter (PMS7003) - 6 Items -->
          <div class="card metric-group-card">
            <div class="group-header">
              <span class="group-title">懸浮微粒 (大氣環境 AE / 標準顆粒 SP)</span>
              <span class="group-chip">PMS7003 (6項)</span>
            </div>
            <div class="metric-items-grid cols-3">
              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #64748b;"></span>
                  <span class="metric-box-label">PM1.0 (大氣 AE)</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.pm1_ae) }}</span>
                  <span class="metric-box-unit">µg/m³</span>
                </div>
              </div>

              <div class="metric-box highlight">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #d97706;"></span>
                  <span class="metric-box-label">PM2.5 (大氣 AE)</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.pm25_ae) }}</span>
                  <span class="metric-box-unit">µg/m³</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #ca8a04;"></span>
                  <span class="metric-box-label">PM10 (大氣 AE)</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.pm10_ae) }}</span>
                  <span class="metric-box-unit">µg/m³</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #78716c;"></span>
                  <span class="metric-box-label">PM1.0 (標準 SP)</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.pm1_sp) }}</span>
                  <span class="metric-box-unit">µg/m³</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #b45309;"></span>
                  <span class="metric-box-label">PM2.5 (標準 SP)</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.pm25_sp) }}</span>
                  <span class="metric-box-unit">µg/m³</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #a16207;"></span>
                  <span class="metric-box-label">PM10 (標準 SP)</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.pm10_sp) }}</span>
                  <span class="metric-box-unit">µg/m³</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Group 3: Gas & Air Quality (Senseair S8 & Sensirion SGP30) - 8 Items -->
          <div class="card metric-group-card">
            <div class="group-header">
              <span class="group-title">氣體與空氣品質指標</span>
              <span class="group-chip">Senseair S8 / SGP30 (8項)</span>
            </div>
            <div class="metric-items-grid cols-4">
              <div class="metric-box highlight">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #16a34a;"></span>
                  <span class="metric-box-label">即時 CO2</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatCO2(latestSensor.co2) }}</span>
                  <span class="metric-box-unit">ppm</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #059669;"></span>
                  <span class="metric-box-label">滾動平均 CO2</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.ave_co2) }}</span>
                  <span class="metric-box-unit">ppm</span>
                </div>
              </div>

              <div class="metric-box highlight">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #9333ea;"></span>
                  <span class="metric-box-label">TVOC 揮發有機物</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.tvoc) }}</span>
                  <span class="metric-box-unit">ppb</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #7c3aed;"></span>
                  <span class="metric-box-label">eCO2 等效 CO2</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.eco2) }}</span>
                  <span class="metric-box-unit">ppm</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #8b5cf6;"></span>
                  <span class="metric-box-label">H2 氫氣訊號 (Raw)</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.s_h2) }}</span>
                  <span class="metric-box-unit">Raw</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #a855f7;"></span>
                  <span class="metric-box-label">Ethanol 乙醇 (Raw)</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.s_ethanol) }}</span>
                  <span class="metric-box-unit">Raw</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #c084fc;"></span>
                  <span class="metric-box-label">TVOC 基線 (Raw)</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.baseline_tvoc) }}</span>
                  <span class="metric-box-unit">Raw</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #d8b4fe;"></span>
                  <span class="metric-box-label">eCO2 基線 (Raw)</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.baseline_eco2) }}</span>
                  <span class="metric-box-unit">Raw</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Group 4: Optical & Colors (TCS34725) - 6 Items -->
          <div class="card metric-group-card">
            <div class="group-header">
              <span class="group-title">光學色彩與照度</span>
              <span class="group-chip">TCS34725 (6項)</span>
            </div>
            <div class="metric-items-grid cols-3">
              <div class="metric-box highlight">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #2563eb;"></span>
                  <span class="metric-box-label">環境照度</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.illuminance) }}</span>
                  <span class="metric-box-unit">Lux</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #0d9488;"></span>
                  <span class="metric-box-label">相關色溫</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.color_temp) }}</span>
                  <span class="metric-box-unit">K</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #dc2626;"></span>
                  <span class="metric-box-label">紅光 Red 通道</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.ch_r) }}</span>
                  <span class="metric-box-unit">Raw</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #16a34a;"></span>
                  <span class="metric-box-label">綠光 Green 通道</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.ch_g) }}</span>
                  <span class="metric-box-unit">Raw</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #2563eb;"></span>
                  <span class="metric-box-label">藍光 Blue 通道</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.ch_b) }}</span>
                  <span class="metric-box-unit">Raw</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #475569;"></span>
                  <span class="metric-box-label">全光 Clear 通道</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatInt(latestSensor.ch_c) }}</span>
                  <span class="metric-box-unit">Raw</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Group 5: Host Raspberry Pi System Metric -->
          <div class="card metric-group-card">
            <div class="group-header">
              <span class="group-title">主機系統監控</span>
              <span class="group-chip">Raspberry Pi</span>
            </div>
            <div class="metric-items-grid">
              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #ea580c;"></span>
                  <span class="metric-box-label">樹莓派 CPU 溫度</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono">{{ formatNum(latestSensor.cpu_temp) }}</span>
                  <span class="metric-box-unit">°C</span>
                </div>
              </div>

              <div class="metric-box">
                <div class="metric-box-top">
                  <span class="color-dot" style="background-color: #64748b;"></span>
                  <span class="metric-box-label">系統連續運轉</span>
                </div>
                <div class="metric-box-val-row">
                  <span class="metric-box-val font-mono" style="font-size: 16px;">
                    {{ formatUptime(device.uptime_sec) }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Management & Maintenance Section (2 Columns) -->
      <div class="management-layout">
        <!-- Remote Config Panel -->
        <div class="card config-card">
          <h3 class="section-title">遠端傳輸頻率與雲端上傳設定</h3>
          <p class="section-desc">修改後即時透過 MQTT Command 通道推播並儲存至盒子</p>

          <div class="config-field">
            <label class="field-label">感測器回報頻率 (Sensor Interval)</label>
            <IntervalSlider v-model="config.sensor_interval" :min="5" :max="600" />
          </div>

          <div class="config-field">
            <label class="field-label">狀態回報頻率 (Status Interval)</label>
            <IntervalSlider v-model="config.status_interval" :min="30" :max="1800" />
          </div>

          <div class="toggles-grid">
            <label class="checkbox-label">
              <input type="checkbox" v-model="config.lass_upload" />
              <span>啟用 LASS HTTP 雲端上傳</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" v-model="config.mqtt_upload" />
              <span>啟用中央 MQTT 即時串流</span>
            </label>
          </div>

          <div class="config-actions">
            <button @click="saveConfig" class="btn btn-primary" :disabled="saving">
              {{ saving ? '套用中...' : '儲存並推送至盒子' }}
            </button>
            <span v-if="saveSuccess" class="save-msg">✓ 設定已成功推送！</span>
          </div>
        </div>

        <!-- Right: Hardware Maintenance & Dates -->
        <div class="maintenance-column">
          <!-- Hardware Maintenance Actions -->
          <div class="card maintenance-card">
            <h3 class="section-title">硬體現場維護指令</h3>
            <p class="section-desc">直接向 ATmega2560 MCU 或主機發送硬體維護控制訊號</p>

            <div v-if="actionNotice" class="action-banner" :class="actionNotice.type">
              {{ actionNotice.msg }}
            </div>

            <div class="action-buttons">
              <button @click="confirmCommand('trigger_co2_cal')" class="btn btn-sm">
                Senseair S8 CO2 歸零校正
              </button>
              <button @click="confirmCommand('trigger_pms_reset')" class="btn btn-sm">
                PMS7003 感測器硬體重置
              </button>
              <button @click="confirmCommand('trigger_backfill')" class="btn btn-sm">
                觸發歷史資料補傳
              </button>
              <button
                @click="confirmCommand('reboot')"
                class="btn btn-sm btn-danger"
              >
                遠端重啟主機
              </button>
            </div>
          </div>

          <!-- Data Coverage Calendar -->
          <div class="card coverage-card">
            <div class="coverage-header">
              <h3 class="section-title">歷史數據儲存日曆</h3>
              <span class="coverage-count">累計 {{ storedDates.length }} 天</span>
            </div>
            <p class="section-desc">點選任一日期即可跳轉至歷史時序圖表檢視</p>

            <div class="date-tags-grid">
              <router-link
                v-for="d in storedDates"
                :key="d"
                :to="`/history?id=${deviceId}&date=${d}`"
                class="date-tag-link"
              >
                {{ d }}
              </router-link>
              <span v-if="storedDates.length === 0" class="no-dates-hint">
                資料庫中尚無歷史日誌紀錄
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import StatusBadge from '../components/StatusBadge.vue';
import IntervalSlider from '../components/IntervalSlider.vue';

const route = useRoute();
const deviceId = route.params.id as string;

const device = ref<any>(null);
const latestSensor = ref<any>(null);
const latestTimestamp = ref<string>('');
const storedDates = ref<string[]>([]);

const config = ref({
  sensor_interval: 60,
  status_interval: 300,
  lass_upload: true,
  mqtt_upload: true,
});

const loading = ref(true);
const refreshing = ref(false);
const saving = ref(false);
const saveSuccess = ref(false);

const isEditingName = ref(false);
const nameInput = ref('');
const savingName = ref(false);

const actionNotice = ref<{ type: 'success' | 'error'; msg: string } | null>(null);

let pollTimer: any = null;

const activeModules = computed<string[]>(() => {
  if (device.value?.modules && typeof device.value.modules === 'object') {
    const mods: string[] = [];
    for (const [k, v] of Object.entries(device.value.modules)) {
      if (v) mods.push(k);
    }
    if (mods.length > 0) return mods;
  }
  return ['wifi', 'mqtt', 'storage_local'];
});

async function loadDetail() {
  try {
    const res = await fetch(`/api/v1/devices/${deviceId}`);
    const data = await res.json();
    if (data.success) {
      device.value = data.device;
      nameInput.value = data.device.display_name || data.device.device_id;
      if (data.config) {
        config.value = { ...config.value, ...data.config };
      }
    }
  } catch (err) {
    console.error('Failed to load device details:', err);
  } finally {
    loading.value = false;
  }
}

async function loadLatestSensor() {
  refreshing.value = true;
  try {
    const res = await fetch(`/api/v1/devices/${deviceId}/sensor/latest`);
    const data = await res.json();
    if (data.success && data.data) {
      const s = data.data.sensor || data.data;
      latestSensor.value = s;
      latestTimestamp.value = data.data.timestamp || '';
    }
  } catch (err) {
    console.error('Failed to load latest sensor:', err);
  } finally {
    refreshing.value = false;
  }
}

async function loadDates() {
  try {
    const res = await fetch(`/api/v1/devices/${deviceId}/dates`);
    const data = await res.json();
    if (data.success) {
      storedDates.value = data.dates || [];
    }
  } catch (err) {
    console.error('Failed to load dates:', err);
  }
}

function startEditName() {
  nameInput.value = device.value.display_name || device.value.device_id;
  isEditingName.value = true;
}

async function saveName() {
  if (!nameInput.value.trim()) return;
  savingName.value = true;
  try {
    const res = await fetch(`/api/v1/devices/${deviceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: nameInput.value.trim() }),
    });
    const data = await res.json();
    if (data.success) {
      device.value = data.device;
      isEditingName.value = false;
    }
  } catch (err) {
    alert(`儲存名稱失敗: ${err}`);
  } finally {
    savingName.value = false;
  }
}

async function saveConfig() {
  saving.value = true;
  saveSuccess.value = false;
  try {
    const res = await fetch(`/api/v1/devices/${deviceId}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config.value),
    });
    const data = await res.json();
    if (data.success) {
      saveSuccess.value = true;
      setTimeout(() => (saveSuccess.value = false), 4000);
    }
  } catch (err) {
    alert(`儲存設定失敗: ${err}`);
  } finally {
    saving.value = false;
  }
}

async function confirmCommand(action: string) {
  let promptText = '';
  switch (action) {
    case 'trigger_co2_cal':
      promptText = '確定要觸發 Senseair S8 大氣 400ppm 歸零校正？\n請確認盒子位於戶外新鮮空氣中至少 20 分鐘！';
      break;
    case 'trigger_pms_reset':
      promptText = '確定要觸發 PMS7003 感測器硬體 Reset 重啟脈衝？';
      break;
    case 'trigger_backfill':
      promptText = '確定要觸發盒子補傳歷史 CSV 資料？盒子將自動比對伺服器缺漏日誌並上傳。';
      break;
    case 'reboot':
      promptText = '【警告】確定要遠端重啟樹莓派主機？重啟期間所有監測與通訊將中斷約 1 分鐘。';
      break;
    default:
      promptText = `確定要向盒子發送指令 [${action}]？`;
  }

  if (!confirm(promptText)) return;

  actionNotice.value = null;
  try {
    const res = await fetch(`/api/v1/devices/${deviceId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (data.success) {
      actionNotice.value = { type: 'success', msg: `✓ 指令 [${action}] 已成功透過 MQTT 送達盒子！` };
    } else {
      actionNotice.value = { type: 'error', msg: `指令發送失敗: ${data.error || '未知錯誤'}` };
    }
  } catch (err) {
    actionNotice.value = { type: 'error', msg: `連線失敗: ${err}` };
  }

  setTimeout(() => {
    if (actionNotice.value?.type === 'success') {
      actionNotice.value = null;
    }
  }, 5000);
}

function formatNum(v?: number | null): string {
  if (v === undefined || v === null) return '-';
  return Number(v).toFixed(1);
}

function formatInt(v?: number | null): string {
  if (v === undefined || v === null) return '-';
  return String(Math.round(v));
}

function formatCO2(v?: number | null): string {
  if (v === undefined || v === null || v < 0 || v > 10000) return '暖機中';
  return String(Math.round(v));
}

function formatUptime(sec?: number): string {
  if (!sec) return '-';
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days}天 ${hours}時 ${mins}分`;
  return `${hours} 小時 ${mins} 分鐘`;
}

function formatTimestamp(ts?: string): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString('zh-TW', { hour12: false });
}

onMounted(async () => {
  await loadDetail();
  await loadLatestSensor();
  await loadDates();

  // Auto poll latest sensor every 5 seconds
  pollTimer = setInterval(() => {
    loadLatestSensor();
  }, 5000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
.header-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.back-link {
  font-size: 14px;
  color: var(--color-body);
  text-decoration: none;
}

.back-link:hover {
  color: var(--color-ink);
}

.detail-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.device-header-card {
  padding: 20px 24px;
}

.device-header-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

.title-area {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.device-name {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.btn-icon {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  opacity: 0.6;
}

.btn-icon:hover {
  opacity: 1;
}

.name-edit-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.name-input {
  padding: 4px 8px;
  font-size: 16px;
  border: 1px solid var(--color-hairline-strong);
  border-radius: 4px;
  width: 200px;
}

.device-id-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.device-mac {
  font-size: 13px;
  color: var(--color-muted);
}

.device-app-ver,
.device-mcu-ver {
  font-size: 11px;
  background: var(--color-canvas-subtle, #f1f5f9);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--color-body);
  font-family: var(--font-mono);
}

.status-action-area {
  display: flex;
  align-items: center;
  gap: 12px;
}

.specs-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  padding-top: 14px;
  border-top: 1px dashed var(--color-hairline);
}

.spec-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.spec-label {
  font-size: 11px;
  color: var(--color-muted);
  font-weight: 500;
}

.spec-val {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
}

.module-chips {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.mod-chip {
  font-size: 11px;
  font-family: var(--font-mono);
  background: var(--color-canvas-subtle, #f1f5f9);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--color-hairline);
}

.section-block {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.section-header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
}

.section-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.3px;
}

.section-desc {
  font-size: 13px;
  color: var(--color-body);
  margin-top: 2px;
}

.auto-refresh-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-body);
  background: var(--color-canvas);
  border: 1px solid var(--color-hairline-strong);
  padding: 4px 10px;
  border-radius: 16px;
}

.pulse-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--color-muted);
}

.pulse-indicator.online {
  background-color: var(--color-success, #16a34a);
  box-shadow: 0 0 6px #22c55e;
}

.metrics-grid-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.metric-group-card {
  padding: 18px 20px;
}

.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-hairline);
}

.group-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-ink);
}

.group-chip {
  font-size: 11px;
  font-family: var(--font-mono);
  background: var(--color-canvas-subtle, #f1f5f9);
  padding: 2px 8px;
  border-radius: 12px;
  color: var(--color-muted);
  border: 1px solid var(--color-hairline-strong);
}

.metric-items-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.metric-items-grid.cols-3 {
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
}

.metric-items-grid.cols-4 {
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
}

.metric-box {
  background: var(--color-canvas-subtle, #f8fafc);
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 0.15s;
}

.metric-box:hover {
  border-color: var(--color-hairline-strong);
}

.metric-box.highlight {
  background: #ffffff;
  border-color: var(--color-hairline-strong);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.metric-box-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.metric-box-label {
  font-size: 12px;
  color: var(--color-body);
  font-weight: 500;
}

.metric-box-val-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.metric-box-val {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-ink);
}

.metric-box-unit {
  font-size: 12px;
  color: var(--color-muted);
}

.color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.management-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

@media (max-width: 900px) {
  .management-layout {
    grid-template-columns: 1fr;
  }
}

.maintenance-column {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.config-card,
.maintenance-card,
.coverage-card {
  padding: 20px;
}

.config-field {
  margin-bottom: 16px;
}

.field-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 8px;
}

.toggles-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding: 12px;
  background: var(--color-canvas-subtle, #f8fafc);
  border-radius: 6px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.config-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.save-msg {
  color: var(--color-success);
  font-size: 13px;
  font-weight: 500;
}

.action-banner {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 12px;
}

.action-banner.success {
  background: #f0fdf4;
  color: #166534;
  border: 1px solid #bbf7d0;
}

.action-banner.error {
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.action-buttons {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.btn-danger {
  color: var(--color-danger, #e11d48);
  border-color: #fecdd3;
}

.btn-danger:hover {
  background: #ffe4e6;
}

.coverage-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.coverage-count {
  font-size: 12px;
  color: var(--color-muted);
  font-family: var(--font-mono);
}

.date-tags-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.date-tag-link {
  display: inline-block;
  background: var(--color-hairline);
  border: 1px solid var(--color-hairline-strong);
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--color-ink);
  text-decoration: none;
  transition: all 0.15s;
}

.date-tag-link:hover {
  background: var(--color-primary, #2563eb);
  color: #ffffff;
  border-color: var(--color-primary, #2563eb);
}

.no-dates-hint {
  font-size: 12px;
  color: var(--color-muted);
}

.empty-sensor-card {
  padding: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-muted);
  font-size: 14px;
}

.btn-xs {
  padding: 2px 8px;
  font-size: 12px;
}

.btn-subtle {
  background: transparent;
  border: 1px solid var(--color-hairline-strong);
  color: var(--color-body);
  border-radius: 4px;
  cursor: pointer;
}

.btn-subtle:hover {
  background: var(--color-hairline);
  color: var(--color-ink);
}
</style>
