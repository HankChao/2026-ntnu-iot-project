<template>
  <div class="weather-page" :class="[`condition-${condition}`, { windy }]">
    <section class="sky-panel" aria-labelledby="weather-title">
      <div class="sky-effects" aria-hidden="true">
        <div class="sun-orb"></div>
        <div class="cloud cloud-a"></div>
        <div class="cloud cloud-b"></div>
        <div class="rain-field">
          <i v-for="drop in 28" :key="drop" class="rain-drop" :style="dropStyle(drop)"></i>
        </div>
        <div class="wind-field">
          <i v-for="line in 9" :key="line" class="wind-line" :style="windStyle(line)"></i>
        </div>
        <div class="lightning"></div>
      </div>

      <div class="sky-content">
        <header class="weather-head">
          <div>
            <p class="eyebrow">中央氣象署 · 行政區觀測與 36 小時預報</p>
            <h1 id="weather-title">戶外天氣</h1>
          </div>
          <div class="weather-controls">
            <div class="weather-field">
              <label for="weather-county">縣市</label>
              <select id="weather-county" v-model="county">
                <option v-for="name in counties" :key="name" :value="name">{{ name }}</option>
              </select>
            </div>
            <div class="weather-field">
              <label for="weather-district">行政區</label>
              <select id="weather-district" v-model="district" :disabled="!districts.length">
                <option v-for="name in districts" :key="name" :value="name">{{ name }}</option>
              </select>
            </div>
            <button class="refresh-btn" type="button" :disabled="loading" @click="refresh">
              <span :class="{ spinning: loading }" aria-hidden="true">↻</span>{{ loading ? '更新中' : '更新' }}
            </button>
          </div>
        </header>

        <p v-if="error" class="weather-error" role="alert">{{ error }}</p>

        <div class="current-layout">
          <div class="current-main">
            <p class="condition-label">{{ conditionLabel }}</p>
            <div class="temperature">
              <strong>{{ display(outdoor?.temp) }}</strong><span>°C</span>
            </div>
            <p class="comfort">{{ outdoor?.station_name ? `${outdoor.district} · ${outdoor.station_name}觀測站` : '正在選擇行政區觀測站' }}</p>
            <p class="observed">{{ observedText }}</p>
          </div>

          <div class="rain-dial" :style="{ '--rain': `${rainProbability * 3.6}deg` }">
            <div class="dial-center">
              <span>降雨機率</span>
              <strong>{{ rainProbability }}<small>%</small></strong>
              <em>{{ rainLabel }}</em>
            </div>
          </div>

          <div class="metrics" aria-label="目前天氣細節">
            <article>
              <span>相對濕度</span><strong>{{ display(outdoor?.hum, 0) }}<small>%RH</small></strong>
            </article>
            <article>
              <span>平均風速</span><strong>{{ display(outdoor?.wind_speed) }}<small>m/s</small></strong>
            </article>
            <article>
              <span>陣風</span><strong>{{ display(outdoor?.gust_speed) }}<small>m/s</small></strong>
            </article>
            <article>
              <span>風向</span>
              <strong class="wind-value"><i :style="{ transform: `rotate(${outdoor?.wind_direction ?? 0}deg)` }">↑</i>{{ windDirectionText }}</strong>
            </article>
            <article :title="rainDayText">
              <span>近 1 小時雨量</span><strong>{{ display(outdoor?.rain_1h_mm) }}<small>mm</small></strong>
            </article>
            <article>
              <span>氣壓</span><strong>{{ display(outdoor?.pressure) }}<small>hPa</small></strong>
            </article>
          </div>
        </div>
      </div>
    </section>

    <section class="laundry-advice" aria-labelledby="advice-title">
      <div class="advice-mark" aria-hidden="true">{{ advice.icon }}</div>
      <div>
        <p class="eyebrow">晾衣判斷</p>
        <h2 id="advice-title">{{ advice.title }}</h2>
        <p>{{ advice.detail }}</p>
      </div>
      <router-link to="/start" class="ui-btn ui-btn--primary">開始晾衣</router-link>
    </section>

    <section class="forecast-section" aria-labelledby="forecast-title">
      <div class="section-head">
        <div>
          <p class="eyebrow">未來 36 小時</p>
          <h2 id="forecast-title">三個預報時段</h2>
        </div>
        <span>{{ forecastUpdatedText }}</span>
      </div>
      <div class="forecast-grid">
        <article v-for="(period, index) in forecast" :key="period.start" class="forecast-card" :class="forecastTone(period)">
          <div class="period-top">
            <span>{{ index === 0 ? '接下來' : `時段 ${index + 1}` }}</span>
            <strong>{{ periodLabel(period) }}</strong>
          </div>
          <div class="forecast-icon" aria-hidden="true">{{ weatherGlyph(period.weather) }}</div>
          <h3>{{ period.weather || '資料整理中' }}</h3>
          <p>{{ period.comfort || '舒適度尚無資料' }}</p>
          <div class="forecast-values">
            <span><b>{{ period.min_temp ?? '—' }}</b>–<b>{{ period.max_temp ?? '—' }}</b>°C</span>
            <span class="pop"><i></i>{{ period.rain_probability ?? '—' }}%</span>
          </div>
        </article>
      </div>
    </section>

    <footer class="weather-source">
      <span>資料來源：交通部中央氣象署 Open Data</span>
      <span>單一觀測站原始值 · 雨量取自同站雨量計 · 觀測每 10 分鐘快取 · 縣市預報每 30 分鐘快取</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useOutdoorWeather, type ForecastPeriod } from '../composables/useOutdoorWeather';

const { counties, county, districts, district, outdoor, forecast, forecastUpdatedAt, loading, error, refresh } = useOutdoorWeather();

const activePeriod = computed(() => forecast.value[0] ?? null);
const rainProbability = computed(() => activePeriod.value?.rain_probability ?? 0);
const weatherText = computed(() => `${outdoor.value?.weather ?? ''} ${activePeriod.value?.weather ?? ''}`);
// rain_mm is today's total since 00:00, so rain early this morning does not mean it is raining now;
// the rain gauge's last 10 minutes / hour does.
const rainingNow = computed(() => (outdoor.value?.rain_10min_mm ?? 0) > 0 || (outdoor.value?.rain_1h_mm ?? 0) > 0);
const rainy = computed(() => rainingNow.value || rainProbability.value >= 45 || weatherText.value.includes('雨'));
const rainDayText = computed(() => `今日累積雨量 ${display(outdoor.value?.rain_mm)} mm`);
const stormy = computed(() => weatherText.value.includes('雷'));
const windy = computed(() => (outdoor.value?.wind_speed ?? 0) >= 7 || (outdoor.value?.gust_speed ?? 0) >= 11);
const condition = computed(() => {
  if (stormy.value) return 'storm';
  if (rainy.value) return 'rain';
  if (weatherText.value.includes('晴')) return 'sun';
  return 'cloud';
});
const conditionLabel = computed(() => outdoor.value?.weather || activePeriod.value?.weather || '等待氣象資料');
const rainLabel = computed(() => rainProbability.value >= 70 ? '很可能降雨' : rainProbability.value >= 40 ? '記得留意' : '降雨機率低');
const observedText = computed(() => outdoor.value?.observed_at
  ? `最近觀測 ${new Date(outdoor.value.observed_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}`
  : '正在等待觀測時間');
const forecastUpdatedText = computed(() => forecastUpdatedAt.value
  ? `伺服器更新 ${new Date(forecastUpdatedAt.value).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })}`
  : '等待預報資料');

const advice = computed(() => {
  const humidity = outdoor.value?.hum ?? 0;
  if (stormy.value || rainProbability.value >= 70) return { icon: '!', title: '不建議戶外晾衣', detail: '降雨機率高，建議改在室內並搭配除濕或送風。' };
  if (windy.value) return { icon: '↗', title: '風勢明顯，請固定衣物', detail: '通風有助乾燥，但強陣風可能讓衣物或衣架掉落。' };
  if (humidity >= 80) return { icon: '≈', title: '乾燥速度可能偏慢', detail: '戶外濕度偏高，建議增加通風並延長預估晾衣時間。' };
  if (rainProbability.value >= 40) return { icon: '⌁', title: '可以晾，但要留意天氣', detail: '降雨機率中等，建議使用可快速收衣的位置。' };
  return { icon: '✓', title: '適合晾衣', detail: '降雨機率低，風與濕度條件目前沒有明顯警訊。' };
});

function display(value: number | null | undefined, digits = 1) {
  return value == null ? '—' : value.toFixed(digits).replace(/\.0$/, '');
}
function cwaDate(value: string) {
  const normalized = value.replace(' ', 'T');
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}+08:00`);
}
function periodLabel(period: ForecastPeriod) {
  const start = cwaDate(period.start);
  const end = cwaDate(period.end);
  const day = start.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'short' });
  const hour = (date: Date) => date.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${hour(start)}–${hour(end)}`;
}
function weatherGlyph(value: string | null) {
  if (!value) return '◌';
  if (value.includes('雷')) return 'ϟ';
  if (value.includes('雨')) return '☂';
  if (value.includes('晴')) return '☀';
  return '☁';
}
function forecastTone(period: ForecastPeriod) {
  const text = period.weather ?? '';
  if (text.includes('雷')) return 'tone-storm';
  if (text.includes('雨') || (period.rain_probability ?? 0) >= 50) return 'tone-rain';
  if (text.includes('晴')) return 'tone-sun';
  return 'tone-cloud';
}
const compass = ['北', '北北東', '東北', '東北東', '東', '東南東', '東南', '南南東', '南', '南南西', '西南', '西南西', '西', '西北西', '西北', '北北西'];
const windDirectionText = computed(() => outdoor.value?.wind_direction == null ? '—' : compass[Math.round(outdoor.value.wind_direction / 22.5) % 16]);
function dropStyle(index: number) {
  return { left: `${(index * 37) % 100}%`, animationDelay: `${-(index % 9) * 0.22}s`, animationDuration: `${0.7 + (index % 5) * 0.09}s` };
}
function windStyle(index: number) {
  return { top: `${12 + index * 9}%`, width: `${18 + (index % 4) * 8}%`, animationDelay: `${-(index % 5) * 0.45}s`, animationDuration: `${1.4 + (index % 3) * 0.35}s` };
}
</script>

<style scoped>
.weather-page { --sky: #15202a; --sky-accent: #5ce1e6; --sky-muted: #9db0bd; max-width: 1320px; width: 100%; margin: 0 auto; padding: 36px 24px 56px; }
.sky-panel { position: relative; min-height: 560px; overflow: hidden; border: 1px solid var(--bd2); background: var(--sky); color: #eefaff; box-shadow: 0 30px 80px rgb(0 0 0 / 0.24); }
.condition-sun { --sky: #15313a; --sky-accent: #ffcc66; --sky-muted: #bdd9d9; }
.condition-rain { --sky: #111b28; --sky-accent: #72bff0; --sky-muted: #a8b9ca; }
.condition-storm { --sky: #171624; --sky-accent: #d7c5ff; --sky-muted: #b8b2c9; }
.condition-cloud { --sky: #1a242c; --sky-accent: #a8c7d2; --sky-muted: #aebbc3; }
.sky-effects { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.sky-effects::before { content: ''; position: absolute; inset: 0; background-image: linear-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px); background-size: 48px 48px; mask-image: linear-gradient(to bottom, black, transparent 80%); }
.sun-orb { position: absolute; width: 180px; height: 180px; right: 8%; top: 8%; border-radius: 50%; border: 2px solid var(--sky-accent); box-shadow: 0 0 0 28px color-mix(in srgb, var(--sky-accent) 12%, transparent), 0 0 90px color-mix(in srgb, var(--sky-accent) 42%, transparent); opacity: 0; transform: scale(0.8); }
.condition-sun .sun-orb { opacity: 0.9; animation: sun-breathe 5s ease-in-out infinite; }
.cloud { position: absolute; width: 260px; height: 72px; border: 1px solid rgb(255 255 255 / 0.16); border-radius: 50%; background: rgb(255 255 255 / 0.06); filter: blur(2px); opacity: 0.75; }
.cloud::before, .cloud::after { content: ''; position: absolute; border-radius: 50%; background: inherit; border: inherit; }
.cloud::before { width: 110px; height: 110px; left: 32px; bottom: 8px; }
.cloud::after { width: 145px; height: 145px; right: 24px; bottom: 2px; }
.cloud-a { left: -50px; top: 16%; animation: cloud-drift 18s ease-in-out infinite alternate; }
.cloud-b { right: 14%; top: 34%; transform: scale(0.65); opacity: 0.4; animation: cloud-drift 24s ease-in-out infinite alternate-reverse; }
.condition-sun .cloud { opacity: 0.2; }
.rain-field, .wind-field { position: absolute; inset: 0; opacity: 0; }
.condition-rain .rain-field, .condition-storm .rain-field { opacity: 1; }
.rain-drop { position: absolute; top: -12%; width: 1px; height: 58px; background: color-mix(in srgb, var(--sky-accent) 72%, transparent); transform: rotate(12deg); animation: rain-fall linear infinite; }
.windy .wind-field { opacity: 1; }
.wind-line { position: absolute; right: -30%; height: 1px; background: color-mix(in srgb, var(--sky-accent) 70%, transparent); box-shadow: 0 8px 0 color-mix(in srgb, var(--sky-accent) 30%, transparent); animation: wind-sweep ease-in-out infinite; }
.lightning { position: absolute; inset: 0; opacity: 0; background: rgb(226 217 255 / 0.22); }
.condition-storm .lightning { animation: lightning 7s steps(1) infinite; }
.sky-content { position: relative; z-index: 2; padding: clamp(28px, 5vw, 68px); }
.weather-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.eyebrow { margin: 0 0 8px; color: var(--sky-accent); font-size: 0.75rem; font-weight: 800; letter-spacing: 0.15em; text-transform: uppercase; }
.weather-head h1 { margin: 0; font-size: clamp(2.2rem, 5vw, 5rem); line-height: 0.95; letter-spacing: -0.05em; }
.weather-controls { display: flex; align-items: end; gap: 10px; padding: 10px; border: 1px solid rgb(255 255 255 / 0.16); background: rgb(5 10 15 / 0.45); backdrop-filter: blur(12px); }
.weather-field { display: grid; gap: 4px; }
.weather-controls label { color: var(--sky-muted); font-size: 0.8rem; }
.weather-controls select, .refresh-btn { min-height: 40px; border: 1px solid rgb(255 255 255 / 0.18); background: rgb(255 255 255 / 0.06); color: #fff; padding: 0 12px; font: inherit; }
.weather-controls select:disabled { opacity: 0.55; }
.weather-controls option { color: #111; }
.refresh-btn { cursor: pointer; display: flex; align-items: center; gap: 7px; }
.refresh-btn:disabled { cursor: wait; opacity: 0.65; }
.spinning { animation: spin 0.8s linear infinite; }
.weather-error { border: 1px solid #8d4450; background: rgb(92 26 38 / 0.5); padding: 12px 16px; }
.current-layout { display: grid; grid-template-columns: 1.2fr 240px minmax(320px, 0.9fr); gap: clamp(28px, 5vw, 72px); align-items: end; margin-top: clamp(70px, 10vw, 140px); }
.condition-label { color: var(--sky-accent); font-size: 1.1rem; font-weight: 800; letter-spacing: 0.08em; }
.temperature { display: flex; align-items: flex-start; line-height: 0.8; }
.temperature strong { font: 700 clamp(6rem, 14vw, 11rem)/0.8 var(--font-num); letter-spacing: -0.09em; }
.temperature span { margin: 8px 0 0 12px; font: 600 1.7rem var(--font-num); color: var(--sky-muted); }
.comfort { margin: 28px 0 5px; font-size: 1.05rem; }
.observed { margin: 0; color: var(--sky-muted); font-size: 0.85rem; }
.rain-dial { position: relative; width: 220px; aspect-ratio: 1; border-radius: 50%; display: grid; place-items: center; background: conic-gradient(var(--sky-accent) var(--rain), rgb(255 255 255 / 0.12) 0); box-shadow: inset 0 0 30px rgb(0 0 0 / 0.25); }
.rain-dial::before { content: ''; position: absolute; width: 178px; aspect-ratio: 1; border-radius: 50%; background: var(--sky); }
.dial-center { position: relative; z-index: 1; display: grid; justify-items: center; gap: 3px; }
.dial-center span, .dial-center em { color: var(--sky-muted); font-size: 0.75rem; font-style: normal; }
.dial-center strong { font: 700 3rem var(--font-num); }
.dial-center small { font-size: 1rem; }
.metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid rgb(255 255 255 / 0.16); border-left: 1px solid rgb(255 255 255 / 0.16); }
.metrics article { min-height: 96px; padding: 16px; border-right: 1px solid rgb(255 255 255 / 0.16); border-bottom: 1px solid rgb(255 255 255 / 0.16); background: rgb(5 10 15 / 0.22); }
.metrics span { display: block; color: var(--sky-muted); font-size: 0.75rem; }
.metrics strong { display: flex; align-items: baseline; gap: 5px; margin-top: 10px; font: 600 1.45rem var(--font-num); }
.metrics small { font-size: 0.7rem; color: var(--sky-muted); }
.wind-value i { display: inline-block; margin-right: 7px; color: var(--sky-accent); font-style: normal; transform-origin: center; }
.laundry-advice { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 24px; margin: 28px 0; padding: 28px 32px; border: 1px solid var(--bd); background: var(--sf); }
.advice-mark { width: 64px; height: 64px; display: grid; place-items: center; border: 1px solid var(--wa-bd); background: var(--wa-soft); color: var(--wa-tx); font: 700 2rem var(--font-num); }
.laundry-advice h2 { margin: 0 0 5px; }
.laundry-advice p:last-child { margin: 0; color: var(--tx2); }
.forecast-section { padding: 36px 0; }
.section-head { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
.section-head h2 { margin: 0; font-size: clamp(1.8rem, 3vw, 2.8rem); }
.section-head > span { color: var(--mu); font-size: 0.8rem; }
.forecast-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.forecast-card { position: relative; min-height: 290px; overflow: hidden; padding: 24px; border: 1px solid var(--bd); background: var(--sf); }
.forecast-card::after { content: ''; position: absolute; width: 130px; height: 130px; right: -45px; bottom: -50px; border-radius: 50%; border: 24px solid var(--forecast-accent, var(--bd)); opacity: 0.16; }
.tone-rain { --forecast-accent: #72bff0; }
.tone-storm { --forecast-accent: #b9a6ff; }
.tone-sun { --forecast-accent: #ffb347; }
.tone-cloud { --forecast-accent: #9db0bd; }
.period-top { display: flex; justify-content: space-between; gap: 10px; color: var(--mu); font-size: 0.75rem; }
.period-top strong { color: var(--tx2); }
.forecast-icon { margin: 28px 0 12px; color: var(--forecast-accent); font-size: 3.2rem; line-height: 1; }
.forecast-card h3 { margin: 0; font-size: 1.35rem; }
.forecast-card p { min-height: 44px; color: var(--tx2); }
.forecast-values { display: flex; justify-content: space-between; align-items: center; margin-top: 24px; font-family: var(--font-num); }
.pop { color: var(--forecast-accent); }
.pop i { display: inline-block; width: 7px; height: 10px; margin-right: 6px; border-radius: 50% 50% 50% 0; background: currentColor; transform: rotate(-45deg); }
.weather-source { display: flex; justify-content: space-between; gap: 20px; padding-top: 20px; border-top: 1px solid var(--bd); color: var(--mu); font-size: 0.75rem; }
@keyframes rain-fall { to { transform: translate(120px, 760px) rotate(12deg); } }
@keyframes wind-sweep { 0% { transform: translateX(0); opacity: 0; } 20% { opacity: 0.8; } 100% { transform: translateX(-1500px); opacity: 0; } }
@keyframes cloud-drift { to { transform: translateX(120px) scale(1.08); } }
@keyframes sun-breathe { 50% { transform: scale(1.06); box-shadow: 0 0 0 38px color-mix(in srgb, var(--sky-accent) 10%, transparent), 0 0 120px color-mix(in srgb, var(--sky-accent) 50%, transparent); } }
@keyframes lightning { 0%, 91%, 94%, 100% { opacity: 0; } 92%, 95% { opacity: 1; } }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1050px) {
  .current-layout { grid-template-columns: 1fr 200px; }
  .metrics { grid-column: 1 / -1; grid-template-columns: repeat(3, 1fr); }
  .rain-dial { width: 190px; }
}
@media (max-width: 760px) {
  .weather-page { padding: 20px 14px 40px; }
  .sky-panel { min-height: 0; }
  .sky-content { padding: 24px 18px 30px; }
  .weather-head, .section-head { align-items: stretch; flex-direction: column; }
  .weather-controls { display: grid; grid-template-columns: auto 1fr auto; }
  .current-layout { grid-template-columns: 1fr; margin-top: 72px; }
  .temperature strong { font-size: clamp(5.5rem, 29vw, 8rem); }
  .rain-dial { width: 180px; }
  .metrics { grid-column: auto; grid-template-columns: repeat(2, 1fr); }
  .laundry-advice { grid-template-columns: auto 1fr; padding: 22px 18px; }
  .laundry-advice .ui-btn { grid-column: 1 / -1; text-align: center; }
  .forecast-grid { grid-template-columns: 1fr; }
  .forecast-card { min-height: 250px; }
  .weather-source { flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) {
  .sun-orb, .cloud, .rain-drop, .wind-line, .lightning, .spinning { animation: none !important; }
  .rain-drop, .wind-line { opacity: 0.28; }
}
</style>
