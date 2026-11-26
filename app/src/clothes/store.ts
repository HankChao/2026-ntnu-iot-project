import { dbClient } from '../db/client';
import type { ClothesRaw } from './validation';

export const clothesState = { schemaReady: false, lastError: null as string | null };

// Every clip has its own topics, named after its device id (the ESP32's Wi-Fi MAC, 12 hex digits):
//   clothes/<id>/raw  readings        clothes/<id>/ota  update command        clothes/<id>/fw  firmware report
// The server subscribes with a wildcard, so a new clip needs no setting here: its first message
// registers it (clipIdForDevice).
export const isDeviceId = (value: unknown): value is string => typeof value === 'string' && /^[0-9A-F]{12}$/.test(value);
export const clipTopic = (deviceId: string, kind: 'raw' | 'ota' | 'fw') => `clothes/${deviceId}/${kind}`;
export const CLIP_TOPICS = ['clothes/+/raw', 'clothes/+/fw'];
export function parseClipTopic(topic: string): { deviceId: string; kind: 'raw' | 'fw' } | null {
  const match = /^clothes\/([0-9A-F]{12})\/(raw|fw)$/.exec(topic);
  return match ? { deviceId: match[1], kind: match[2] as 'raw' | 'fw' } : null;
}
// Firmware before 0.5.0 shares one topic for all clips. Set CLOTHES_MQTT_TOPIC to that topic only
// while such a clip still has to be reached (to update it); its readings go to the first real clip.
export const LEGACY_TOPIC = process.env.CLOTHES_MQTT_TOPIC?.trim() || null;
// Clips, garments and sessions use server-generated UUIDs.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
// The clip reports once a minute (every 10 s while handled) and sleeps in between,
// so data counts as interrupted only after three missed reports.
export const CLIP_STALE_MS = 3 * 60000;

// Idempotent migration runs for both new and existing database volumes.
export async function ensureClothesSchema(): Promise<void> {
  if (!dbClient.isConnected()) throw new Error('Database unavailable');
  const sql = dbClient.sql;
  await sql`
    CREATE TABLE IF NOT EXISTS clothes_raw (
      id BIGSERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ NOT NULL,
      hx711_raw INTEGER CHECK (hx711_raw BETWEEN -8388608 AND 8388607),
      ads1115_raw INTEGER CHECK (ads1115_raw BETWEEN -32768 AND 32767),
      touch_raw INTEGER CHECK (touch_raw BETWEEN 0 AND 4194303)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS clothes_raw_timestamp_idx ON clothes_raw (timestamp DESC, id DESC)`;
  await ensureAirboxNameIndex(sql);
  clothesState.schemaReady = true;
}

// Air box names must not repeat (ignoring case and surrounding spaces). If an old database already
// has a repeat the index cannot be built; renaming still checks in code, so only warn.
async function ensureAirboxNameIndex(sql: any) {
  try {
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS devices_display_name_key ON devices (lower(btrim(display_name))) WHERE display_name IS NOT NULL`;
  } catch (error) {
    console.warn('[Clothes] Air box names repeat, unique index not created:', (error as Error).message);
  }
}

function database() {
  if (!dbClient.isConnected() || !clothesState.schemaReady) throw new Error('Clothes database unavailable');
  return dbClient.sql;
}

// The clip a device id belongs to. An id seen for the first time takes over the real clip that has
// no device yet (the placeholder 衣夾-01, or the clip that owns the readings from before clips had
// ids); when there is none, a new clip is created. Names can be changed on the dashboard.
const knownDevices = new Map<string, string>();
export async function clipIdForDevice(deviceId: string): Promise<string> {
  const cached = knownDevices.get(deviceId);
  if (cached) return cached;
  const sql = database();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      let id: string | undefined = (await sql`SELECT id FROM clips WHERE device_id = ${deviceId}`)[0]?.id;
      if (!id) {
        id = (await sql`
          UPDATE clips SET device_id = ${deviceId}, updated_at = now()
          WHERE device_id IS NULL AND id = (SELECT id FROM clips WHERE NOT is_demo AND device_id IS NULL ORDER BY created_at, id LIMIT 1)
          RETURNING id`)[0]?.id;
      }
      if (!id) {
        // The lowest 衣夾-NN no clip uses, demo ones included, so two cards never share a name.
        const taken = new Set((await sql`SELECT lower(name) AS name FROM clips`).map((row: { name: string }) => row.name));
        let number = 1;
        while (taken.has(`衣夾-${String(number).padStart(2, '0')}`)) number += 1;
        const name = `衣夾-${String(number).padStart(2, '0')}`;
        id = (await sql`INSERT INTO clips (name, device_id) VALUES (${name}, ${deviceId}) RETURNING id`)[0].id as string;
        console.log(`[Clothes] New clip ${name} registered for device ${deviceId}`);
      }
      knownDevices.set(deviceId, id);
      return id;
    } catch (error: any) {
      // Unique violation: another message registered this device, or the name is taken. Look again.
      if ((error?.errno ?? error?.code) !== '23505') throw error;
    }
  }
  throw new Error(`Clip for device ${deviceId} could not be registered`);
}

export async function insertClothesRaw(raw: ClothesRaw, receivedAt: Date, clipId: string) {
  const sql = database();
  // Timestamp comes from the subscriber callback, never from the ESP32 or DB execution time.
  const rows = await sql`
    INSERT INTO clothes_raw (timestamp, clip_id, hx711_raw, ads1115_raw, touch_raw)
    VALUES (${receivedAt}, ${clipId}::uuid, ${raw.hx711_raw}, ${raw.ads1115_raw}, ${raw.touch_raw})
    RETURNING id::text, timestamp, hx711_raw, ads1115_raw, touch_raw`;
  return rows[0];
}

export async function latestClothesRaw(clipId: string | null) {
  if (!clipId) return null;
  const sql = database();
  const rows = await sql`
    SELECT id::text, timestamp, hx711_raw, ads1115_raw, touch_raw FROM clothes_raw
    WHERE clip_id = ${clipId}::uuid ORDER BY timestamp DESC, id DESC LIMIT 1`;
  return rows[0] ?? null;
}

// Smallest whole-second bucket that keeps the range within `limit` points.
export function historyBucketSeconds(start: Date, end: Date, limit: number) {
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 1000 / limit));
}

// hx711_g: weight in grams from the clip's HX711 calibration at that time (weight.ts); empty before
// the first calibration. ads1115_ohm: fabric resistance from the clip's divider setting at that time;
// empty when the clip had no setting yet or the fabric was beyond what the divider resolves (open).
export const CSV_HEADER = 'time_taipei,timestamp_utc,hx711_raw,hx711_g,ads1115_raw,ads1115_ohm,touch_raw,air_temp_c,air_humi_pct\n';
export type CsvRow = { id: string; timestamp: Date | string; hx711_raw: number | null; ads1115_raw: number | null; touch_raw: number | null;
  air_temp?: number | null; air_humi?: number | null; ads1115_ohm?: number | null; hx711_g?: number | null };
const TAIPEI_MS = 8 * 60 * 60000;
const csvValue = (value: number | null | undefined) => value == null ? '' : String(value);

// One CSV line per raw reading; time_taipei is what the dashboard shows, timestamp_utc is exact.
export function clothesCsvLine(row: CsvRow) {
  const time = new Date(row.timestamp);
  const taipei = new Date(time.getTime() + TAIPEI_MS).toISOString().replace('T', ' ').slice(0, 23);
  const grams = row.hx711_g == null || !Number.isFinite(row.hx711_g) ? '' : row.hx711_g.toFixed(1);
  return `${taipei},${time.toISOString()},${csvValue(row.hx711_raw)},${grams},${csvValue(row.ads1115_raw)},` +
    `${row.ads1115_ohm == null || !Number.isFinite(row.ads1115_ohm) ? '' : Math.round(row.ads1115_ohm)},${csvValue(row.touch_raw)},` +
    `${csvValue(row.air_temp)},${csvValue(row.air_humi)}\n`;
}

// ===== Air box (MAPS) temperature / humidity alongside the clip =====
// The air box reports about once a minute, so each clip reading takes the latest air reading
// at or before it, as long as that reading is no older than AIR_MAX_AGE_MS (otherwise blank).
export const AIR_MAX_AGE_MS = 5 * 60000;
export type AirReading = { timestamp: Date | string; temp: number | null; humi: number | null };

// The clip used when a request names none: the first real clip. Null before the drying schema has created it.
export async function defaultClipId(): Promise<string | null> {
  const rows = await database()`SELECT id FROM clips WHERE NOT is_demo ORDER BY created_at, id LIMIT 1`;
  return rows[0]?.id ?? null;
}

// Which air box to pair with a clip (default: the first real clip): the clip's own setting
// (clips.airbox_id), else CLOTHES_AIRBOX_ID, else the one that reported most recently.
export async function clothesAirboxId(clipId?: string): Promise<string | null> {
  const sql = database();
  const id = clipId ?? await defaultClipId();
  const clips = id ? await sql`SELECT airbox_id FROM clips WHERE id = ${id}::uuid` : [];
  if (clips[0]?.airbox_id) return clips[0].airbox_id;
  if (process.env.CLOTHES_AIRBOX_ID) return process.env.CLOTHES_AIRBOX_ID;
  const rows = await sql`SELECT device_id FROM sensor_data ORDER BY timestamp DESC LIMIT 1`;
  return rows[0]?.device_id ?? null;
}

// Every air box that has reported, newest reading first, for the dashboard picker.
export async function listAirboxes(): Promise<Array<{ device_id: string; display_name: string | null; online: boolean; last_reading: Date | null }>> {
  return database()`
    SELECT d.device_id, d.display_name, d.online,
      (SELECT max(s.timestamp) FROM sensor_data s WHERE s.device_id = d.device_id) AS last_reading
    FROM devices d ORDER BY last_reading DESC NULLS LAST, d.device_id`;
}

export async function airReadings(deviceId: string, start: Date, end: Date): Promise<AirReading[]> {
  return database()`
    SELECT timestamp, temp, humi FROM sensor_data
    WHERE device_id = ${deviceId} AND timestamp >= ${start} AND timestamp <= ${end}
    ORDER BY timestamp LIMIT 20000`;
}

export async function latestAir(deviceId: string): Promise<AirReading | null> {
  const rows = await database()`
    SELECT timestamp, temp, humi FROM sensor_data WHERE device_id = ${deviceId}
    ORDER BY timestamp DESC LIMIT 1`;
  return rows[0] ?? null;
}

// Both lists must be in time order. Rounded to 0.01 so the CSV stays readable.
export function attachAir<T extends CsvRow>(rows: T[], air: AirReading[], maxAgeMs = AIR_MAX_AGE_MS): T[] {
  const round = (value: number | null) => value == null ? null : Math.round(value * 100) / 100;
  let next = 0;
  let current: AirReading | null = null;
  for (const row of rows) {
    const time = new Date(row.timestamp).getTime();
    while (next < air.length && new Date(air[next].timestamp).getTime() <= time) current = air[next++];
    const fresh = current && time - new Date(current.timestamp).getTime() <= maxAgeMs ? current : null;
    row.air_temp = round(fresh?.temp ?? null); row.air_humi = round(fresh?.humi ?? null);
  }
  return rows;
}

// Raw (never averaged) rows in time order, read in pages so a week of data (1 Hz in older recordings) is not held in memory.
export async function* clothesExportRows(start: Date, end: Date, pageSize = 5000, airboxId: string | null = null, clipId: string | null = null) {
  const sql = database();
  if (!clipId) return;
  let after: { timestamp: Date | string; id: string } | null = null;
  while (true) {
    const rows: CsvRow[] = after
      ? await sql`
        SELECT id::text, timestamp, hx711_raw, ads1115_raw, touch_raw FROM clothes_raw
        WHERE clip_id = ${clipId}::uuid AND timestamp <= ${end} AND (timestamp, id) > (${new Date(after.timestamp)}, ${after.id}::bigint)
        ORDER BY timestamp, id LIMIT ${pageSize}`
      : await sql`
        SELECT id::text, timestamp, hx711_raw, ads1115_raw, touch_raw FROM clothes_raw
        WHERE clip_id = ${clipId}::uuid AND timestamp >= ${start} AND timestamp <= ${end}
        ORDER BY timestamp, id LIMIT ${pageSize}`;
    if (rows.length && airboxId) {
      const first = new Date(rows[0].timestamp), last = new Date(rows[rows.length - 1].timestamp);
      attachAir(rows, await airReadings(airboxId, new Date(first.getTime() - AIR_MAX_AGE_MS), last));
    }
    yield rows;
    if (rows.length < pageSize) return;
    after = rows[rows.length - 1];
  }
}

export async function clothesHistory(start: Date, end: Date, limit: number, clipId: string | null) {
  if (!clipId) return { records: [], truncated: false, bucket_seconds: 0 };
  const sql = database();
  const rows = await sql`
    SELECT id::text, timestamp, hx711_raw, ads1115_raw, touch_raw FROM clothes_raw
    WHERE clip_id = ${clipId}::uuid AND timestamp >= ${start} AND timestamp <= ${end}
    ORDER BY timestamp DESC, id DESC LIMIT ${limit + 1}`;
  if (rows.length <= limit) return { records: rows.reverse(), truncated: false, bucket_seconds: 0 };
  // Too many raw rows: average each sensor per time bucket so the whole range stays visible.
  // A bucket whose readings are all null stays null (read failure), it is not shown as 0.
  const bucket = historyBucketSeconds(start, end, limit);
  const buckets = await sql`
    SELECT min(id)::text AS id,
      to_timestamp(floor(extract(epoch FROM timestamp) / ${bucket}) * ${bucket}) AS timestamp,
      round(avg(hx711_raw))::integer AS hx711_raw,
      round(avg(ads1115_raw))::integer AS ads1115_raw,
      round(avg(touch_raw))::integer AS touch_raw
    FROM clothes_raw
    WHERE clip_id = ${clipId}::uuid AND timestamp >= ${start} AND timestamp <= ${end}
    GROUP BY 2 ORDER BY 2 LIMIT ${limit}`;
  return { records: buckets, truncated: false, bucket_seconds: bucket };
}
