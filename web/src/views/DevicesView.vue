<template>
  <div class="page">
    <div class="page-head"><h1>設備狀況</h1></div>

    <section aria-label="系統摘要" class="ui-stats">
      <div class="ui-stat"><span class="ui-stat__label">在線設備</span><span class="ui-stat__value">{{ onlineCount }}<small> / {{ totalCount }}</small></span></div>
      <div class="ui-stat"><span class="ui-stat__label">訊息速率</span><span class="ui-stat__value">{{ rate }}<small> 筆/分</small></span></div>
      <div class="ui-stat" :class="{ 'ui-stat--warn': attention > 0 }"><span class="ui-stat__label">需要注意</span><span class="ui-stat__value">{{ attention }}<small> 台</small></span></div>
    </section>

    <p v-if="mock.actionError.value" class="ui-note ui-note--error" role="alert">{{ mock.actionError.value }}</p>
    <section aria-label="衣夾" class="grid">
      <article v-for="c in clips" :key="c.device.id" class="dev" :class="{ warn: c.status.tone === 'warn', off: c.status.tone === 'off' }">
        <div class="dev-head">
          <h2>{{ c.device.name }} <small v-if="c.device.live" class="real">實體裝置</small><DemoTag v-else /></h2>
          <span class="status" :class="`status--${c.status.tone}`"><i></i>{{ c.status.label }}</span>
        </div>
        <div class="facts">
          <div><span>最後回報</span><b>{{ c.status.lastSeenMs == null ? '尚未收到' : agoText(c.status.lastSeenMs) }}</b></div>
          <template v-if="c.status.online">
            <div v-if="c.device.live"><span>重量 / 電阻 / 電容</span><b class="mono raw">{{ rawLine }}</b></div>
            <template v-else>
              <div><span>訊號</span><b>{{ c.device.signal }}</b></div>
              <div><span>運行時間</span><b>{{ c.status.uptimeMin == null ? '—' : minutesText(c.status.uptimeMin) }}</b></div>
            </template>
          </template>
          <div v-if="c.session"><span>正在晾</span><b>{{ c.session }}</b></div>
        </div>
        <p v-if="c.device.issue && c.status.online" class="issue">{{ c.device.issue }}</p>
        <p v-else-if="c.status.tone === 'warn'" class="issue">有感測器本筆讀取失敗，請檢查排線</p>
        <p v-else-if="!c.status.online" class="muted-2">{{ c.device.live ? connectionText : '可能沒電或不在 Wi-Fi 範圍內，重新上線後會自動恢復' }}</p>
        <p v-else class="muted-2">重量、電阻、電容感測皆正常</p>
        <div class="dev-foot">
          <code class="mono muted">{{ c.device.topic }}</code>
          <div class="foot-btns">
            <button v-if="!c.status.online && !c.device.live" type="button" class="ui-btn" @click="removeClip(c.device)">移除</button>
            <router-link :to="`/clips/${c.device.id}`" class="ui-btn">詳細資料</router-link>
          </div>
        </div>
      </article>
    </section>

    <section aria-label="空氣盒子" class="section">
      <div class="row-head">
        <h2 class="section-title">空氣盒子</h2>
        <span class="stream muted" role="status"><i :class="{ on: wsConnected }"></i>{{ wsConnected ? '即時串流已連線' : '即時串流重連中…' }}</span>
      </div>
      <div v-if="airDevices.length" class="air-tools">
        <div class="ui-seg" role="group" aria-label="篩選空氣盒子">
          <button type="button" :aria-pressed="airFilter === 'all'" @click="airFilter = 'all'">全部 {{ airDevices.length }}</button>
          <button type="button" :aria-pressed="airFilter === 'online'" @click="airFilter = 'online'">在線 {{ airOnline }}</button>
          <button type="button" :aria-pressed="airFilter === 'offline'" @click="airFilter = 'offline'">離線 {{ airDevices.length - airOnline }}</button>
        </div>
        <label for="air-search" class="sr-only">搜尋空氣盒子</label>
        <input id="air-search" v-model="airQuery" class="ui-input ui-input--sm search" type="search" placeholder="搜尋盒子名稱或 MAC" />
      </div>
      <p v-if="airLoading" class="muted">正在讀取空氣盒子…</p>
      <p v-else-if="airError" class="ui-note ui-note--error" role="alert">{{ airError }}</p>
      <p v-else-if="!airDevices.length" class="muted">尚未有空氣盒子連線過</p>
      <p v-else-if="!shownAir.length" class="muted">{{ airQuery ? '找不到符合搜尋條件的盒子' : '這個分類沒有盒子' }}</p>
      <div v-else class="grid">
        <article v-for="d in shownAir" :key="d.device_id" class="dev" :class="{ off: !d.online }">
          <div class="dev-head">
            <h2>{{ d.display_name || d.device_id }}</h2>
            <span class="status" :class="d.online ? 'status--on' : 'status--off'"><i></i>{{ d.online ? '在線' : '離線' }}</span>
          </div>
          <div class="facts">
            <div><span>最後回報</span><b>{{ d.last_seen ? agoText(mock.now.value - new Date(d.last_seen).getTime()) : '—' }}</b></div>
            <div><span>溫度</span><b>{{ formatAir(airLatest[d.device_id]?.temp) }} °C</b></div>
            <div><span>濕度</span><b>{{ formatAir(airLatest[d.device_id]?.humi) }} %</b></div>
            <div><span>CO2</span><b>{{ airLatest[d.device_id]?.co2 ?? '—' }} ppm</b></div>
            <div><span>PM2.5</span><b>{{ airLatest[d.device_id]?.pm25_ae ?? '—' }} µg/m³</b></div>
          </div>
          <p class="muted-2">MAPS6 {{ d.device_id }}{{ d.version ? ` · ${/^\d/.test(d.version) ? 'v' : ''}${d.version}` : '' }}</p>
          <div class="dev-foot">
            <code class="mono muted">MAPS/{{ d.device_id }}/sensor</code>
            <router-link :to="`/devices/${d.device_id}`" class="ui-btn">詳細資料</router-link>
          </div>
        </article>
      </div>
    </section>

    <!-- The connection log is demo only; there is no real event source yet. -->
    <section v-if="mock.demoEnabled.value" class="panel">
      <h2>連線事件</h2>
      <div class="ui-table-wrap">
        <table class="ui-table">
          <thead><tr><th scope="col">時間</th><th scope="col">設備</th><th scope="col">事件</th></tr></thead>
          <tbody>
            <tr v-for="e in events" :key="e.key">
              <td class="mono muted-2">{{ e.time }}</td><td>{{ e.device }}</td><td :class="e.tone">{{ e.text }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <p v-if="mock.demoEnabled.value" class="demo-note">標了「示範」的衣夾（衣夾-02～08）和連線事件是示範資料，狀態為模擬；衣夾-01 與空氣盒子為實際資料。可在設定關閉示範資料。</p>
    <p v-else class="demo-note">示範資料已關閉，只顯示實際的衣夾與空氣盒子。</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useClothesLive } from '../composables/useClothesData';
import { useClothesMock } from '../composables/useClothesMock';
import DemoTag from '../components/clothes/DemoTag.vue';
import { useWebSocket } from '../composables/useWebSocket';
import { agoText, clock, dayLabel, formatAir, formatRaw, minutesText } from '../utils/format';

const { latest, connectionText } = useClothesLive();
const mock = useClothesMock();
const MIN = 60000;

function removeClip(device: { id: string; name: string }) {
  if (window.confirm(`移除示範的${device.name}？它的示範晾衣紀錄也會一起刪除，重設示範資料後會回來。`)) void mock.removeDevice(device.id);
}

const clips = computed(() => mock.devices.value.map((device) => {
  const session = mock.state.sessions.find((s) => s.clipId === device.id);
  return { device, status: mock.clipStatus(device), session: session ? mock.garmentById(session.garmentId)?.name ?? '' : '' };
}));
const rawLine = computed(() => latest.value
  ? [latest.value.hx711_raw, latest.value.ads1115_raw, latest.value.touch_raw].map((v) => formatRaw(v)).join(' / ') : '—');

// ----- real air boxes (moved here from the old /air dashboard)
interface AirDevice { device_id: string; display_name?: string; version?: string; online: boolean; last_seen?: string }
type AirSensor = { temp?: number; humi?: number; co2?: number; pm25_ae?: number };
const airDevices = ref<AirDevice[]>([]);
const airLatest = ref<Record<string, AirSensor>>({});
const airFilter = ref<'all' | 'online' | 'offline'>('all');
const airQuery = ref('');
const airOnline = computed(() => airDevices.value.filter((d) => d.online).length);
const shownAir = computed(() => {
  const q = airQuery.value.trim().toLowerCase();
  return airDevices.value.filter((d) =>
    (airFilter.value === 'all' || d.online === (airFilter.value === 'online'))
    && (!q || d.device_id.toLowerCase().includes(q) || (d.display_name ?? '').toLowerCase().includes(q)));
});

// Live telemetry stream, same handling as the old dashboard.
const { isConnected: wsConnected } = useWebSocket((msg) => {
  if (!msg.device_id) return;
  const target = airDevices.value.find((d) => d.device_id === msg.device_id);
  if (msg.type === 'sensor') airLatest.value[msg.device_id] = msg.sensor;
  else if (msg.type === 'online') {
    if (target) { target.online = Boolean(msg.online); target.last_seen = msg.timestamp; } else void loadAir();
  } else if (msg.type === 'status' && target) target.version = msg.version;
});
const airLoading = ref(true);
const airError = ref('');
let airTimer: ReturnType<typeof setInterval> | undefined;
async function loadAir() {
  try {
    const res = await fetch('/api/v1/devices', { cache: 'no-store' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    airDevices.value = [...data.devices].sort((a: AirDevice, b: AirDevice) => a.device_id.localeCompare(b.device_id));
    await Promise.all(airDevices.value.map(async (d) => {
      try {
        const r = await fetch(`/api/v1/devices/${d.device_id}/sensor/latest`, { cache: 'no-store' });
        const s = await r.json();
        if (s.success && s.data) airLatest.value[d.device_id] = s.data;
      } catch { /* keep the last reading */ }
    }));
    airError.value = '';
  } catch {
    airError.value = '無法讀取空氣盒子清單，請檢查後端。';
  } finally { airLoading.value = false; }
}
onMounted(() => { void loadAir(); airTimer = setInterval(loadAir, 30000); });
onUnmounted(() => clearInterval(airTimer));

const onlineCount = computed(() => clips.value.filter((c) => c.status.online).length + airDevices.value.filter((d) => d.online).length);
const totalCount = computed(() => clips.value.length + airDevices.value.length);
// Clips and air boxes each report about once a minute (clips every 10 s while being touched).
const rate = computed(() => clips.value.filter((c) => c.status.online).length + airDevices.value.filter((d) => d.online).length);
const attention = computed(() => clips.value.filter((c) => c.status.tone !== 'on').length + airDevices.value.filter((d) => !d.online).length);

// Demo connection log, relative to now.
const events = computed(() => {
  const t = mock.now.value;
  const list = [
    { ago: 61, device: '衣夾-02', text: '重量感測讀取失敗', tone: 'wa-tx' },
    { ago: 107, device: '衣夾-02', text: '上線', tone: 'ac-tx' },
    { ago: 323, device: '衣夾-01', text: '斷線 14 秒後重新連線', tone: 'muted-2' },
    { ago: 2 * 1440 + 90, device: '衣夾-08', text: '離線', tone: 'muted-2' },
  ];
  return list.map((e, i) => {
    const at = t - e.ago * MIN;
    const day = dayLabel(at, t);
    return { key: i, time: day === '今天' ? clock(at) : `${day} ${clock(at)}`, device: e.device, text: e.text, tone: e.tone };
  });
});
</script>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 480px), 1fr)); gap: 24px; }
.dev { border: 1px solid var(--bd); border-radius: 20px; background: var(--sf); padding: 28px; display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.dev.warn { border-color: var(--wa-bd); }
.dev.off { border-style: dashed; border-color: var(--bd2); background: transparent; }
.dev.off h2 { color: var(--tx2); }
.dev-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dev-head h2 { font-size: 1.375rem; }
.real { font-size: 0.75rem; font-weight: 500; margin-left: 6px; padding: 2px 8px; border-radius: 999px; background: var(--ac-soft); color: var(--ac-tx); vertical-align: middle; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 16px; }
.facts span { display: block; font-size: 0.875rem; color: var(--mu); }
.facts b { font-size: 1.125rem; }
.facts .raw { font-size: 0.9375rem; }
.issue { padding: 14px 16px; border-radius: 12px; background: var(--wa-soft); }
.muted-2 { color: var(--tx2); }
.dev-foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-top: 16px; border-top: 1px solid var(--bd); margin-top: auto; flex-wrap: wrap; }
.dev-foot code { font-size: 0.875rem; }
.foot-btns { display: flex; gap: 8px; }
.section { display: flex; flex-direction: column; gap: 16px; }
.row-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.section-title { font-size: 1.5rem; }
.stream { display: inline-flex; align-items: center; gap: 8px; font-size: 0.875rem; }
.stream i { width: 8px; height: 8px; background: var(--wa); }
.stream i.on { background: var(--ac); }
.air-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.search { flex: 0 1 320px; }
.dev .facts + p { margin: 0; }
@media (max-width: 640px) { .dev { padding: 20px; } }
</style>
