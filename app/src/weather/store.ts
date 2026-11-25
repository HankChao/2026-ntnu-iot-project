import { dbClient } from '../db/client';
import { configuredStations } from './cwa';

// ==============================================================================
// weather_obs：存下來的氣象署觀測，給訓練（CSV）和之後的圖表用。
// 時間 observed_at 是氣象署給的觀測時間；fetched_at 是後端抓到的時間。
// dataset：O-A0001-001／O-A0002-001／O-A0003-001（poller 抓的），CODiS（scripts/import-codis.ts 匯入的歷史逐時資料）
// ==============================================================================

export const weatherState = { schemaReady: false };

export async function ensureWeatherSchema(): Promise<void> {
  if (!dbClient.isConnected()) throw new Error('Database unavailable');
  const sql = dbClient.sql;
  await sql`
    CREATE TABLE IF NOT EXISTS weather_obs (
      id BIGSERIAL PRIMARY KEY,
      dataset TEXT NOT NULL,
      station_id TEXT NOT NULL,
      station_name TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      temp DOUBLE PRECISION,
      hum DOUBLE PRECISION,
      wind_speed DOUBLE PRECISION,
      wind_dir DOUBLE PRECISION,
      gust DOUBLE PRECISION,
      pressure DOUBLE PRECISION,
      rain_day_mm DOUBLE PRECISION,
      rain_10min_mm DOUBLE PRECISION,
      rain_1h_mm DOUBLE PRECISION,
      sunshine_h DOUBLE PRECISION,
      sunshine_1h_h DOUBLE PRECISION,
      radiation_1h_mj DOUBLE PRECISION,
      uv DOUBLE PRECISION,
      weather TEXT,
      raw JSONB,
      UNIQUE (dataset, station_id, observed_at)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS weather_obs_station_time_idx ON weather_obs (station_id, observed_at)`;
  weatherState.schemaReady = true;
}

function database() {
  if (!dbClient.isConnected() || !weatherState.schemaReady) throw new Error('Weather database unavailable');
  return dbClient.sql;
}

// Measured values, in the order of the table and of the CSV columns.
export const WEATHER_FIELDS = [
  'temp', 'hum', 'wind_speed', 'wind_dir', 'gust', 'pressure',
  'rain_10min_mm', 'rain_1h_mm', 'rain_day_mm', 'sunshine_h', 'sunshine_1h_h', 'radiation_1h_mj', 'uv',
] as const;
export type WeatherField = typeof WEATHER_FIELDS[number];

export type WeatherRow = {
  dataset: string;
  station_id: string;
  station_name: string;
  observed_at: Date | string;
  weather?: string | null;
  raw?: unknown;
} & Partial<Record<WeatherField, number | null>>;

/** Inserts what is new; an observation already stored (same dataset, station, time) is skipped. Returns how many were new. */
export async function insertWeatherRows(rows: WeatherRow[]): Promise<number> {
  const sql = database();
  let inserted = 0;
  for (const row of rows) {
    const at = new Date(row.observed_at);
    if (!Number.isFinite(at.getTime())) continue;
    const value = (field: WeatherField) => row[field] ?? null;
    // JSONB: pass text and cast twice, otherwise Bun encodes the JSON again as a string (see CLAUDE.md).
    const raw = row.raw === undefined ? null : JSON.stringify(row.raw);
    const result = await sql`
      INSERT INTO weather_obs (dataset, station_id, station_name, observed_at, temp, hum, wind_speed, wind_dir, gust, pressure,
        rain_day_mm, rain_10min_mm, rain_1h_mm, sunshine_h, sunshine_1h_h, radiation_1h_mj, uv, weather, raw)
      VALUES (${row.dataset}, ${row.station_id}, ${row.station_name}, ${at}, ${value('temp')}, ${value('hum')},
        ${value('wind_speed')}, ${value('wind_dir')}, ${value('gust')}, ${value('pressure')},
        ${value('rain_day_mm')}, ${value('rain_10min_mm')}, ${value('rain_1h_mm')}, ${value('sunshine_h')},
        ${value('sunshine_1h_h')}, ${value('radiation_1h_mj')}, ${value('uv')}, ${row.weather ?? null}, ${raw}::text::jsonb)
      ON CONFLICT (dataset, station_id, observed_at) DO NOTHING
      RETURNING id`;
    inserted += result.length;
  }
  return inserted;
}

/** Station ids stored for a setting that may be an id or a name (CODiS rows carry the name given at import). */
export async function storedStationIds(wanted: string): Promise<string[]> {
  const rows = await database()`
    SELECT DISTINCT station_id FROM weather_obs WHERE station_id = ${wanted} OR station_name = ${wanted}`;
  return rows.map((row: { station_id: string }) => row.station_id);
}

/** Ids of the configured weather and rain stations that have stored rows. */
export async function configuredStationIds(): Promise<string[]> {
  const { weather, rain } = configuredStations();
  const ids = new Set([...await storedStationIds(weather), ...await storedStationIds(rain)]);
  return [...ids];
}

export type StoredWeather = { dataset: string; station_id: string; station_name: string; observed_at: Date | string; weather: string | null }
  & Record<WeatherField, number | null>;

export async function storedWeather(stationIds: string[], start: Date, end: Date, limit = 20000): Promise<StoredWeather[]> {
  if (!stationIds.length) return [];
  const sql = database();
  return sql`
    SELECT dataset, station_id, station_name, observed_at, temp, hum, wind_speed, wind_dir, gust, pressure,
      rain_day_mm, rain_10min_mm, rain_1h_mm, sunshine_h, sunshine_1h_h, radiation_1h_mj, uv, weather
    FROM weather_obs
    WHERE station_id IN ${sql(stationIds)} AND observed_at >= ${start} AND observed_at <= ${end}
    ORDER BY observed_at, dataset LIMIT ${limit}`;
}

// ===== Pairing clip readings with the outdoor observations (CSV) =====
// Each value is taken from the latest row at or before the clip reading that has that value,
// as long as it is not older than its dataset's interval allows (otherwise the cell stays blank).
export const OUTDOOR_MAX_AGE_MS: Record<string, number> = {
  'O-A0003-001': 20 * 60000,
  'O-A0002-001': 20 * 60000,
  'O-A0001-001': 70 * 60000,
  CODiS: 70 * 60000,
};
const DEFAULT_MAX_AGE_MS = 70 * 60000;
export const OUTDOOR_LOOKBACK_MS = Math.max(...Object.values(OUTDOOR_MAX_AGE_MS), DEFAULT_MAX_AGE_MS);
export type OutdoorValues = Partial<Record<WeatherField, number | null>>;

/** rows and observations must both be in time order. Writes row.outdoor. */
export function attachOutdoor<T extends { timestamp: Date | string; outdoor?: OutdoorValues }>(
  rows: T[], observations: Array<Pick<StoredWeather, 'dataset' | 'observed_at'> & Partial<Record<WeatherField, number | null>>>,
): T[] {
  const latest = new Map<WeatherField, { value: number; at: number; maxAge: number }>();
  let next = 0;
  for (const row of rows) {
    const time = new Date(row.timestamp).getTime();
    while (next < observations.length && new Date(observations[next]!.observed_at).getTime() <= time) {
      const observation = observations[next++]!;
      const at = new Date(observation.observed_at).getTime();
      const maxAge = OUTDOOR_MAX_AGE_MS[observation.dataset] ?? DEFAULT_MAX_AGE_MS;
      for (const field of WEATHER_FIELDS) {
        const value = observation[field];
        if (value != null && Number.isFinite(Number(value))) latest.set(field, { value: Number(value), at, maxAge });
      }
    }
    const outdoor: OutdoorValues = {};
    for (const field of WEATHER_FIELDS) {
      const entry = latest.get(field);
      outdoor[field] = entry && time - entry.at <= entry.maxAge ? Math.round(entry.value * 100) / 100 : null;
    }
    row.outdoor = outdoor;
  }
  return rows;
}
