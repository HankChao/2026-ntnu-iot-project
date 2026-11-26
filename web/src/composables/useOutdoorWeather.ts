import { onMounted, onUnmounted, ref, watch } from 'vue';
import { apiFetch } from './useAuth';

export interface OutdoorWeather {
  county: string;
  district: string;
  station_id: string;
  station_name: string;
  observed_at: string;
  weather: string | null;
  temp: number | null;
  hum: number | null;
  /** 本日 0 時至今的累積雨量，不是現在的雨量 */
  rain_mm: number | null;
  /** 雨量站（O-A0002-001）最近 10 分鐘、1 小時的雨量；這個測站沒有雨量站資料時為 null */
  rain_10min_mm: number | null;
  rain_1h_mm: number | null;
  wind_speed: number | null;
  wind_direction: number | null;
  gust_speed: number | null;
  pressure: number | null;
  stations: number;
}

export interface ForecastPeriod {
  start: string;
  end: string;
  weather: string | null;
  weather_code: number | null;
  rain_probability: number | null;
  min_temp: number | null;
  max_temp: number | null;
  comfort: string | null;
}

const counties = ref<string[]>([]);
const county = ref('');
const districts = ref<string[]>([]);
const district = ref('');
const outdoor = ref<OutdoorWeather | null>(null);
const forecast = ref<ForecastPeriod[]>([]);
const forecastUpdatedAt = ref<number | null>(null);
const loading = ref(false);
const error = ref('');
let consumers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let latestRequest = 0;

async function request(path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await apiFetch(path, { cache: 'no-store', signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) throw new Error(data?.error || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadOutdoor() {
  if (!county.value || !district.value) return;
  const requestId = ++latestRequest;
  loading.value = true;
  try {
    const params = new URLSearchParams({ county: county.value, district: district.value });
    const data = await request(`/api/v1/weather/detail?${params}`);
    if (requestId !== latestRequest) return;
    outdoor.value = data.data.current;
    forecast.value = data.data.forecast;
    forecastUpdatedAt.value = data.data.forecast_updated_at;
    error.value = '';
  } catch {
    if (requestId !== latestRequest) return;
    outdoor.value = null;
    forecast.value = [];
    forecastUpdatedAt.value = null;
    error.value = '氣象署資料暫時無法取得';
  } finally {
    if (requestId === latestRequest) loading.value = false;
  }
}

async function loadDistricts() {
  if (!county.value) return;
  const requestId = ++latestRequest;
  loading.value = true;
  district.value = '';
  districts.value = [];
  outdoor.value = null;
  forecast.value = [];
  forecastUpdatedAt.value = null;
  try {
    const data = await request(`/api/v1/weather/districts?county=${encodeURIComponent(county.value)}`);
    if (requestId !== latestRequest) return;
    districts.value = data.data;
    let saved = '';
    try { saved = localStorage.getItem(`outdoorDistrict:${county.value}`) || ''; } catch { /* cache only */ }
    district.value = districts.value.includes(saved) ? saved : data.default || districts.value[0] || '';
    if (!district.value) error.value = '這個縣市沒有可用的行政區觀測資料';
  } catch {
    if (requestId !== latestRequest) return;
    error.value = '氣象署行政區資料暫時無法取得';
  } finally {
    if (requestId === latestRequest) loading.value = false;
  }
}

async function loadCounties() {
  try {
    const data = await request('/api/v1/weather/counties');
    counties.value = data.data;
    let saved = '';
    try { saved = localStorage.getItem('outdoorCounty') || ''; } catch { /* cache only */ }
    const nextCounty = counties.value.includes(saved) ? saved : data.default || counties.value[0] || '';
    const countyChanged = county.value !== nextCounty;
    county.value = nextCounty;
    if (!county.value) error.value = '氣象署沒有可用的測站資料';
    else if (!countyChanged) void loadDistricts();
  } catch {
    error.value = '氣象署資料暫時無法取得';
  }
}

watch(county, (value) => {
  if (!value) return;
  try { localStorage.setItem('outdoorCounty', value); } catch { /* cache only */ }
  void loadDistricts();
});

watch(district, (value) => {
  if (!value || !county.value) return;
  try { localStorage.setItem(`outdoorDistrict:${county.value}`, value); } catch { /* cache only */ }
  void loadOutdoor();
});

export function useOutdoorWeather() {
  onMounted(() => {
    consumers += 1;
    if (county.value && district.value) void loadOutdoor();
    else if (county.value) void loadDistricts();
    else void loadCounties();
    timer ??= setInterval(() => {
      if (county.value && district.value) void loadOutdoor();
      else void loadCounties();
    }, 10 * 60 * 1000);
  });
  onUnmounted(() => {
    consumers -= 1;
    if (consumers === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  });
  return { counties, county, districts, district, outdoor, forecast, forecastUpdatedAt, loading, error, refresh: loadOutdoor };
}
