import { Hono } from 'hono';
import { apiKey, CWA_BASE, loadObservations, loadRainfall, num, type Observation, type RainObservation } from '../weather/cwa';
import { configuredStationIds, storedWeather, weatherState } from '../weather/store';
import { weatherPoller } from '../weather/poller';

export const weatherRoute = new Hono();

const FORECAST_DATASET = 'F-C0032-001';
const FORECAST_TTL_MS = 30 * 60 * 1000;

export type { Observation };

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

let forecastCache: { at: number; map: Map<string, ForecastPeriod[]> } | null = null;

const round1 = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const mode = (values: string[]): string | null => {
  if (!values.length) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
};

export function parseForecastLocation(location: any): ForecastPeriod[] {
  const periods = new Map<string, ForecastPeriod>();
  const fieldMap: Record<string, keyof ForecastPeriod> = {
    Wx: 'weather', PoP: 'rain_probability', PoP12h: 'rain_probability', MinT: 'min_temp', MaxT: 'max_temp', CI: 'comfort',
  };
  for (const element of location?.weatherElement ?? []) {
    const field = fieldMap[element?.elementName];
    if (!field) continue;
    for (const slot of element?.time ?? []) {
      if (!slot?.startTime) continue;
      const period = periods.get(slot.startTime) ?? {
        start: slot.startTime, end: slot.endTime ?? '', weather: null, weather_code: null,
        rain_probability: null, min_temp: null, max_temp: null, comfort: null,
      };
      const parameter = slot.parameter ?? {};
      if (field === 'weather') {
        period.weather = String(parameter.parameterName ?? '').trim() || null;
        period.weather_code = num(parameter.parameterValue);
      } else if (field === 'comfort') {
        period.comfort = String(parameter.parameterName ?? '').trim() || null;
      } else {
        const value = num(parameter.parameterName);
        if (field === 'rain_probability') period.rain_probability = value;
        if (field === 'min_temp') period.min_temp = value;
        if (field === 'max_temp') period.max_temp = value;
      }
      if (slot.endTime) period.end = slot.endTime;
      periods.set(slot.startTime, period);
    }
  }
  return [...periods.values()].sort((a, b) => a.start.localeCompare(b.start));
}

async function loadForecasts(): Promise<Map<string, ForecastPeriod[]>> {
  if (forecastCache && Date.now() - forecastCache.at < FORECAST_TTL_MS) return forecastCache.map;
  const key = apiKey();
  try {
    const params = new URLSearchParams({ Authorization: key, format: 'JSON' });
    const response = await fetch(`${CWA_BASE}/${FORECAST_DATASET}?${params}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`氣象署 ${FORECAST_DATASET} HTTP ${response.status}`);
    const json: any = await response.json();
    const map = new Map<string, ForecastPeriod[]>();
    for (const location of json?.records?.location ?? []) {
      const county = String(location?.locationName ?? '');
      if (county) map.set(county, parseForecastLocation(location));
    }
    if (!map.size) throw new Error('氣象署沒有回傳預報');
    forecastCache = { at: Date.now(), map };
    return map;
  } catch (error) {
    if (forecastCache) return forecastCache.map;
    throw error;
  }
}

function windDirection(observations: Observation[]): number | null {
  const samples = observations.filter((item) => item.wind_direction !== null);
  if (!samples.length) return null;
  let x = 0;
  let y = 0;
  for (const sample of samples) {
    const radians = sample.wind_direction! * Math.PI / 180;
    const weight = sample.wind_speed && sample.wind_speed > 0 ? sample.wind_speed : 1;
    x += Math.sin(radians) * weight;
    y += Math.cos(radians) * weight;
  }
  return Math.round((Math.atan2(x, y) * 180 / Math.PI + 360) % 360);
}

export function summarizeCounty(observations: Observation[], county: string) {
  const selected = observations.filter((item) => item.county === county);
  if (!selected.length) return null;
  const values = (field: keyof Observation) => selected.map((item) => item[field]).filter((value): value is number => typeof value === 'number');
  const observedAt = selected.map((item) => item.observed_at).filter(Boolean).sort().at(-1) ?? '';
  return {
    county,
    observed_at: observedAt,
    weather: mode(selected.map((item) => item.weather).filter((value): value is string => value !== null)),
    temp: round1(median(values('temp'))),
    hum: round1(median(values('hum'))),
    rain_mm: round1(values('rain_mm').length ? Math.max(...values('rain_mm')) : null),
    wind_speed: round1(median(values('wind_speed'))),
    wind_direction: windDirection(selected),
    gust_speed: round1(values('gust_speed').length ? Math.max(...values('gust_speed')) : null),
    pressure: round1(median(values('pressure'))),
    stations: selected.length,
  };
}

export function selectDistrictObservation(observations: Observation[], county: string, district?: string) {
  const countyObservations = observations.filter((item) => item.county === county && item.town && item.temp !== null);
  if (!countyObservations.length) return null;

  const defaultObservation = countyObservations.find((item) => item.name === defaultStation());
  const selectedDistrict = district || defaultObservation?.town
    || [...new Set(countyObservations.map((item) => item.town))].sort((a, b) => a.localeCompare(b, 'zh-Hant'))[0];
  const selected = countyObservations
    .filter((item) => item.town === selectedDistrict)
    .sort((a, b) => b.observed_at.localeCompare(a.observed_at) || a.name.localeCompare(b.name, 'zh-Hant'))[0];
  if (!selected) return null;

  return {
    county: selected.county,
    district: selected.town,
    station_id: selected.id,
    station_name: selected.name,
    observed_at: selected.observed_at,
    weather: selected.weather,
    temp: round1(selected.temp),
    hum: round1(selected.hum),
    rain_mm: round1(selected.rain_mm),
    wind_speed: round1(selected.wind_speed),
    wind_direction: selected.wind_direction === null ? null : Math.round(selected.wind_direction),
    gust_speed: round1(selected.gust_speed),
    pressure: round1(selected.pressure),
    stations: 1,
  };
}

const defaultStation = () => process.env.CWA_STATION || '臺北';
const defaultCounty = (observations: Observation[]) => observations.find((item) => item.name === defaultStation())?.county;

// rain_mm above is today's total since 00:00. Whether it is raining now comes from the rain gauges
// (O-A0002-001): the last 10 minutes and the last hour. Null when the gauge data is unavailable.
const NO_RAIN_NOW = { rain_10min_mm: null, rain_1h_mm: null } as const;
const maxOf = (values: Array<number | null>) => {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length ? round1(Math.max(...numbers)) : null;
};

export function rainForStation(gauges: RainObservation[], stationId: string) {
  const gauge = gauges.find((item) => item.id === stationId);
  return gauge ? { rain_10min_mm: round1(gauge.rain_10min_mm), rain_1h_mm: round1(gauge.rain_1h_mm) } : { ...NO_RAIN_NOW };
}

export function rainForCounty(gauges: RainObservation[], county: string) {
  const selected = gauges.filter((item) => item.county === county);
  if (!selected.length) return { ...NO_RAIN_NOW };
  return { rain_10min_mm: maxOf(selected.map((item) => item.rain_10min_mm)), rain_1h_mm: maxOf(selected.map((item) => item.rain_1h_mm)) };
}

const gaugesOrNone = () => loadRainfall().catch(() => [] as RainObservation[]);

async function countyCurrent(requested: string | undefined) {
  const [observationMap, gauges] = await Promise.all([loadObservations(), gaugesOrNone()]);
  const observations = [...observationMap.values()];
  const county = requested || defaultCounty(observations);
  if (!county) return null;
  const summary = summarizeCounty(observations, county);
  return summary && { ...summary, ...rainForCounty(gauges, county) };
}

async function districtCurrent(requestedCounty: string | undefined, requestedDistrict: string | undefined) {
  const [observationMap, gauges] = await Promise.all([loadObservations(), gaugesOrNone()]);
  const observations = [...observationMap.values()];
  const county = requestedCounty || defaultCounty(observations);
  if (!county) return null;
  const selected = selectDistrictObservation(observations, county, requestedDistrict);
  return selected && { ...selected, ...rainForStation(gauges, selected.station_id) };
}

async function countyDetail(requestedCounty: string | undefined, requestedDistrict: string | undefined) {
  const [current, forecastMap] = await Promise.all([
    districtCurrent(requestedCounty, requestedDistrict),
    loadForecasts().catch(() => new Map<string, ForecastPeriod[]>()),
  ]);
  if (!current) return null;
  return { current, forecast: forecastMap.get(current.county) ?? [], forecast_updated_at: forecastCache?.at ?? null };
}

weatherRoute.get('/counties', async (context) => {
  try {
    const all = [...(await loadObservations()).values()].filter((item) => item.temp !== null);
    const counties = [...new Set(all.map((item) => item.county))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    return context.json({ success: true, data: counties, default: defaultCounty(all) ?? counties[0] ?? null });
  } catch (error) {
    return context.json({ success: false, error: (error as Error).message }, 502);
  }
});

weatherRoute.get('/districts', async (context) => {
  try {
    const observations = [...(await loadObservations()).values()];
    const county = context.req.query('county') || defaultCounty(observations);
    if (!county) return context.json({ success: false, error: '找不到這個縣市' }, 404);
    const matching = observations.filter((item) => item.county === county && item.town && item.temp !== null);
    const districts = [...new Set(matching.map((item) => item.town))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    if (!districts.length) return context.json({ success: false, error: '找不到這個縣市' }, 404);
    const preferred = matching.find((item) => item.name === defaultStation())?.town;
    return context.json({ success: true, data: districts, default: preferred && districts.includes(preferred) ? preferred : districts[0] });
  } catch (error) {
    return context.json({ success: false, error: (error as Error).message }, 502);
  }
});

weatherRoute.get('/outdoor', async (context) => {
  try {
    const current = await countyCurrent(context.req.query('county'));
    if (!current) return context.json({ success: false, error: '找不到這個縣市' }, 404);
    return context.json({ success: true, data: current });
  } catch (error) {
    return context.json({ success: false, error: (error as Error).message }, 502);
  }
});

weatherRoute.get('/detail', async (context) => {
  try {
    const detail = await countyDetail(context.req.query('county'), context.req.query('district'));
    if (!detail) return context.json({ success: false, error: '找不到這個縣市或行政區' }, 404);
    return context.json({ success: true, data: detail });
  } catch (error) {
    return context.json({ success: false, error: (error as Error).message }, 502);
  }
});

// ===== Stored observations (weather_obs) =====
export const STORED_MAX_DAYS = 7;

// What the poller has stored for the configured stations, in time order, and whether it is running.
weatherRoute.get('/stored', async (context) => {
  const now = new Date();
  const startText = context.req.query('start');
  const endText = context.req.query('end');
  const start = startText === undefined ? new Date(now.getTime() - 24 * 60 * 60000) : new Date(startText);
  const end = endText === undefined ? now : new Date(endText);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end ||
      end.getTime() - start.getTime() > STORED_MAX_DAYS * 24 * 60 * 60000) {
    return context.json({ success: false, error: `時間範圍最多 ${STORED_MAX_DAYS} 天，結束需晚於開始` }, 400);
  }
  const poller = { ...weatherPoller };
  if (!weatherState.schemaReady) return context.json({ success: false, error: '資料庫無法讀取，戶外觀測紀錄暫時不可用', poller }, 503);
  try {
    const stationIds = await configuredStationIds();
    const records = await storedWeather(stationIds, start, end);
    return context.json({ success: true, start: start.toISOString(), end: end.toISOString(), station_ids: stationIds, records, poller });
  } catch {
    return context.json({ success: false, error: '資料庫無法讀取，戶外觀測紀錄暫時不可用', poller }, 503);
  }
});
