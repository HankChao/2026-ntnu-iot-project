import { dbClient } from '../db/client';
import type { ClothesRaw } from './validation';

export const clothesState = { schemaReady: false, lastError: null as string | null };

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
  clothesState.schemaReady = true;
}

function database() {
  if (!dbClient.isConnected() || !clothesState.schemaReady) throw new Error('Clothes database unavailable');
  return dbClient.sql;
}

export async function insertClothesRaw(raw: ClothesRaw, receivedAt: Date) {
  const sql = database();
  // Timestamp comes from the subscriber callback, never from the ESP32 or DB execution time.
  const rows = await sql`
    INSERT INTO clothes_raw (timestamp, hx711_raw, ads1115_raw, touch_raw)
    VALUES (${receivedAt}, ${raw.hx711_raw}, ${raw.ads1115_raw}, ${raw.touch_raw})
    RETURNING id::text, timestamp, hx711_raw, ads1115_raw, touch_raw`;
  return rows[0];
}

export async function latestClothesRaw() {
  const sql = database();
  const rows = await sql`
    SELECT id::text, timestamp, hx711_raw, ads1115_raw, touch_raw FROM clothes_raw
    ORDER BY timestamp DESC, id DESC LIMIT 1`;
  return rows[0] ?? null;
}

// Smallest whole-second bucket that keeps the range within `limit` points.
export function historyBucketSeconds(start: Date, end: Date, limit: number) {
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 1000 / limit));
}

export async function clothesHistory(start: Date, end: Date, limit: number) {
  const sql = database();
  const rows = await sql`
    SELECT id::text, timestamp, hx711_raw, ads1115_raw, touch_raw FROM clothes_raw
    WHERE timestamp >= ${start} AND timestamp <= ${end}
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
    WHERE timestamp >= ${start} AND timestamp <= ${end}
    GROUP BY 2 ORDER BY 2 LIMIT ${limit}`;
  return { records: buckets, truncated: false, bucket_seconds: bucket };
}
