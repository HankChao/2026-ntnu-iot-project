import {
  configuredStations, loadObservationDatasets, loadRainfall, matchesStation, type Observation, type RainObservation,
} from './cwa';
import { insertWeatherRows, type WeatherRow } from './store';

// ==============================================================================
// 每 5 分鐘向氣象署抓一次，把設定的測站（CWA_STATION、CWA_RAIN_STATION）存進 weather_obs。
// O-A0003／O-A0002 每 10 分鐘更新，抓 5 分鐘一次才不會因為發布延遲漏掉一筆；重複的會被 UNIQUE 擋掉。
// 開放資料 API 只給最新一筆，沒抓到的時段之後補不回來（只能從 CODiS 下載逐時資料）。
// 抓不到就不寫，不會用舊資料或預設值冒充。
// ==============================================================================

export const POLL_INTERVAL_MS = 5 * 60 * 1000;

export const weatherPoller = {
  running: false,
  lastRunAt: null as string | null,
  lastSuccessAt: null as string | null,
  lastInserted: 0,
  lastError: null as string | null,
};

export function observationRow(station: Observation): WeatherRow {
  return {
    dataset: station.dataset ?? 'unknown', station_id: station.id, station_name: station.name, observed_at: station.observed_at,
    temp: station.temp, hum: station.hum, wind_speed: station.wind_speed, wind_dir: station.wind_direction,
    gust: station.gust_speed, pressure: station.pressure, rain_day_mm: station.rain_mm,
    sunshine_h: station.sunshine_h ?? null, uv: station.uv ?? null, weather: station.weather, raw: station.raw,
  };
}

export function rainRow(station: RainObservation): WeatherRow {
  return {
    dataset: station.dataset, station_id: station.id, station_name: station.name, observed_at: station.observed_at,
    rain_day_mm: station.rain_day_mm, rain_10min_mm: station.rain_10min_mm, rain_1h_mm: station.rain_1h_mm, raw: station.raw,
  };
}

export async function pollWeatherOnce(): Promise<number> {
  const { weather, rain } = configuredStations();
  const problems: string[] = [];
  const rows: WeatherRow[] = [];

  const [observationResult, rainResult] = await Promise.allSettled([
    loadObservationDatasets({ fresh: true }), loadRainfall({ fresh: true }),
  ]);
  if (observationResult.status === 'fulfilled') {
    for (const result of observationResult.value) {
      if ('error' in result) { problems.push(result.error); continue; }
      rows.push(...result.stations.filter((station) => matchesStation(station, weather)).map(observationRow));
    }
    if (!rows.length) problems.push(`氣象站資料裡找不到測站「${weather}」（CWA_STATION）`);
  } else {
    problems.push(String(observationResult.reason?.message ?? observationResult.reason));
  }
  if (rainResult.status === 'fulfilled') {
    const matched = rainResult.value.filter((station) => matchesStation(station, rain));
    if (!matched.length) problems.push(`雨量站資料裡找不到測站「${rain}」（CWA_RAIN_STATION）`);
    rows.push(...matched.map(rainRow));
  } else {
    problems.push(String(rainResult.reason?.message ?? rainResult.reason));
  }

  const inserted = rows.length ? await insertWeatherRows(rows) : 0;
  weatherPoller.lastInserted = inserted;
  weatherPoller.lastError = problems.length ? problems.join('；') : null;
  if (rows.length) weatherPoller.lastSuccessAt = new Date().toISOString();
  return inserted;
}

let timer: ReturnType<typeof setInterval> | undefined;

export function startWeatherPoller(intervalMs = POLL_INTERVAL_MS) {
  if (!process.env.CWA_API_KEY) {
    weatherPoller.lastError = '後端未設定 CWA_API_KEY，戶外觀測不會存進資料庫';
    console.warn(`[Weather] ${weatherPoller.lastError}`);
    return;
  }
  if (timer) return;
  const { weather, rain } = configuredStations();
  console.log(`[Weather] Storing CWA observations every ${intervalMs / 60000} min: station ${weather}, rain station ${rain}`);
  weatherPoller.running = true;
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    weatherPoller.lastRunAt = new Date().toISOString();
    try {
      const inserted = await pollWeatherOnce();
      if (weatherPoller.lastError) console.warn(`[Weather] ${weatherPoller.lastError}`);
      if (inserted) console.log(`[Weather] Stored ${inserted} new observation(s)`);
    } catch (error) {
      weatherPoller.lastError = (error as Error).message;
      console.warn(`[Weather] Poll failed: ${weatherPoller.lastError}`);
    } finally {
      busy = false;
    }
  };
  void run();
  timer = setInterval(run, intervalMs);
}
