// ==============================================================================
// 中央氣象署 Open Data：觀測資料的抓取與解析，網頁（routes/weather.ts）和定時存檔（poller.ts）共用。
//   O-A0001-001  自動氣象站，逐時
//   O-A0003-001  署屬（有人）氣象站，每 10 分鐘，多了日照時數、紫外線指數
//   O-A0002-001  自動雨量站，每 10 分鐘，有 10 分鐘、1 小時累積雨量
// 注意：O-A0001／O-A0003 的 WeatherElement.Now.Precipitation 是「本日 0 時到現在」的累積雨量，
// 不是目前的降雨強度；要看現在有沒有在下雨，用 O-A0002 的 Past10Min／Past1hr。
// ==============================================================================

export const CWA_BASE = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore';
// The merged map lets the later dataset win: O-A0003 stations carry more fields than O-A0001.
export const OBSERVATION_DATASETS = ['O-A0001-001', 'O-A0003-001'] as const;
export const RAIN_DATASET = 'O-A0002-001';
const OBSERVATION_TTL_MS = 10 * 60 * 1000;

export interface Observation {
  id: string;
  name: string;
  county: string;
  town: string;
  observed_at: string;
  weather: string | null;
  temp: number | null;
  hum: number | null;
  /** 本日 0 時至今累積雨量（mm），不是現在的雨量 */
  rain_mm: number | null;
  wind_speed: number | null;
  wind_direction: number | null;
  gust_speed: number | null;
  pressure: number | null;
  /** O-A0003 才有：SunshineDuration 原值（小時） */
  sunshine_h?: number | null;
  /** O-A0003 才有 */
  uv?: number | null;
  dataset?: string;
  raw?: unknown;
}

export interface RainObservation {
  dataset: string;
  id: string;
  name: string;
  county: string;
  town: string;
  observed_at: string;
  rain_day_mm: number | null;
  rain_10min_mm: number | null;
  rain_1h_mm: number | null;
  raw?: unknown;
}

// CWA marks missing or faulty values with -99, -990, -998, -999 … (and sometimes text such as "X").
export const num = (value: unknown): number | null => {
  const parsed = Number(value);
  return value == null || value === '' || !Number.isFinite(parsed) || parsed <= -99 ? null : parsed;
};

// First defined value among several key paths, so a renamed field does not silently become null.
function pick(object: any, ...paths: string[]): unknown {
  for (const path of paths) {
    let value = object;
    for (const key of path.split('.')) value = value?.[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

const text = (value: unknown) => (value == null ? '' : String(value).trim());

function stationBase(station: any) {
  return {
    id: text(pick(station, 'StationId', 'StationID')),
    name: text(pick(station, 'StationName')),
    county: text(pick(station, 'GeoInfo.CountyName', 'CountyName')) || '其他',
    town: text(pick(station, 'GeoInfo.TownName', 'TownName')),
    observed_at: text(pick(station, 'ObsTime.DateTime', 'DateTime')),
  };
}

export function parseObservationStations(json: any, dataset: string): Observation[] {
  const stations: any[] = json?.records?.Station ?? [];
  return stations.map((station) => {
    const element = station?.WeatherElement ?? {};
    let humidity = num(element.RelativeHumidity);
    if (humidity !== null && humidity <= 1) humidity *= 100;
    const weatherText = text(element.Weather);
    return {
      ...stationBase(station),
      weather: weatherText && weatherText !== '-99' ? weatherText : null,
      temp: num(element.AirTemperature),
      hum: humidity,
      rain_mm: num(pick(element, 'Now.Precipitation', 'Precipitation')),
      wind_speed: num(element.WindSpeed),
      wind_direction: num(element.WindDirection),
      gust_speed: num(pick(element, 'GustInfo.PeakGustSpeed', 'PeakGustSpeed')),
      pressure: num(element.AirPressure),
      sunshine_h: num(element.SunshineDuration),
      uv: num(element.UVIndex),
      dataset,
      raw: station,
    };
  }).filter((station) => station.id && station.name);
}

export function parseRainfallStations(json: any, dataset = RAIN_DATASET): RainObservation[] {
  const stations: any[] = json?.records?.Station ?? [];
  return stations.map((station) => {
    const rain = station?.RainfallElement ?? {};
    return {
      ...stationBase(station),
      dataset,
      rain_day_mm: num(pick(rain, 'Now.Precipitation')),
      rain_10min_mm: num(pick(rain, 'Past10Min.Precipitation', 'Past10min.Precipitation')),
      rain_1h_mm: num(pick(rain, 'Past1hr.Precipitation', 'Past1Hr.Precipitation')),
      raw: station,
    };
  }).filter((station) => station.id && station.name);
}

export function apiKey(): string {
  const key = process.env.CWA_API_KEY;
  if (!key) throw new Error('後端未設定 CWA_API_KEY');
  return key;
}

export async function fetchDataset(dataset: string, key = apiKey()): Promise<any> {
  const params = new URLSearchParams({ Authorization: key, format: 'JSON' });
  const response = await fetch(`${CWA_BASE}/${dataset}?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`氣象署 ${dataset} HTTP ${response.status}`);
  return response.json();
}

// ===== Caches shared by the dashboard and the poller =====
type DatasetResult = { dataset: string; stations: Observation[] } | { dataset: string; error: string };
let observationCache: { at: number; results: DatasetResult[] } | null = null;
let rainCache: { at: number; stations: RainObservation[] } | null = null;

/** Each observation dataset on its own. fresh = skip the cache (the poller), and refresh it for the dashboard. */
export async function loadObservationDatasets({ fresh = false } = {}): Promise<DatasetResult[]> {
  if (!fresh && observationCache && Date.now() - observationCache.at < OBSERVATION_TTL_MS) return observationCache.results;
  const key = apiKey();
  const settled = await Promise.allSettled(OBSERVATION_DATASETS.map((dataset) => fetchDataset(dataset, key)));
  const results: DatasetResult[] = settled.map((result, index) => {
    const dataset = OBSERVATION_DATASETS[index]!;
    return result.status === 'fulfilled'
      ? { dataset, stations: parseObservationStations(result.value, dataset) }
      : { dataset, error: String(result.reason?.message ?? result.reason) };
  });
  const usable = results.some((result) => 'stations' in result && result.stations.length > 0);
  if (!usable) {
    if (observationCache) return observationCache.results;
    const failed = results.find((result): result is { dataset: string; error: string } => 'error' in result);
    throw new Error(failed ? failed.error : '氣象署沒有回傳測站');
  }
  observationCache = { at: Date.now(), results };
  return results;
}

/** All stations merged by id (O-A0003 wins over O-A0001), for the dashboard. */
export async function loadObservations(): Promise<Map<string, Observation>> {
  const map = new Map<string, Observation>();
  for (const result of await loadObservationDatasets()) {
    if ('stations' in result) for (const station of result.stations) map.set(station.id, station);
  }
  return map;
}

export async function loadRainfall({ fresh = false } = {}): Promise<RainObservation[]> {
  if (!fresh && rainCache && Date.now() - rainCache.at < OBSERVATION_TTL_MS) return rainCache.stations;
  try {
    const stations = parseRainfallStations(await fetchDataset(RAIN_DATASET));
    if (!stations.length) throw new Error('氣象署沒有回傳雨量站');
    rainCache = { at: Date.now(), stations };
    return stations;
  } catch (error) {
    if (rainCache) return rainCache.stations;
    throw error;
  }
}

/** A station setting may be its id (466920) or its name (臺北). */
export const matchesStation = (station: { id: string; name: string }, wanted: string) =>
  station.id === wanted || station.name === wanted;

/** The stations the poller stores and the CSV pairs with the clips. */
export function configuredStations() {
  const weather = process.env.CWA_STATION?.trim() || '臺北';
  const rain = process.env.CWA_RAIN_STATION?.trim() || weather;
  return { weather, rain };
}
