// Weight in grams from the HX711 reading.
//
// The load cell is linear: the reading grows by a fixed number of counts per gram on top of the
// reading with nothing hung on the clip (the "tare", 空勾讀值). Both are measured per clip:
//   grams = (count − tare_count) / counts_per_gram
// tare_count: hx711_raw with the hook empty; counts_per_gram: (reading with a known weight − tare) / grams.
// The clip keeps sending raw counts; a setting applies from its `since` time on, so data recorded
// before a re-calibration keeps converting with the setting of its time (same idea as resistance.ts).
import { dbClient } from '../db/client';
import { HttpError } from './drying';
import { isUuid } from './store';

export interface Scale { id?: string; since: string | Date; tare_count: number; counts_per_gram: number }

// HX711 readings are signed 24-bit.
const HX711_MIN = -8_388_608, HX711_MAX = 8_388_607;

// Pure. null: no reading. May be slightly negative around an empty hook (noise, drift).
export function countToGram(count: number | null, s: Scale): number | null {
  if (count === null) return null;
  return (count - s.tare_count) / s.counts_per_gram;
}

// The setting in force at `time` (scales sorted by since, oldest first); null before the first one.
export function scaleAt(scales: Scale[], time: number): Scale | null {
  let found: Scale | null = null;
  for (const s of scales) {
    if (new Date(s.since).getTime() <= time) found = s; else break;
  }
  return found;
}

export function parseScale(body: unknown, now: Date): Scale {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '內容必須是 JSON 物件');
  const b = body as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    if (!['since', 'tare_count', 'counts_per_gram'].includes(key)) throw new HttpError(400, `不支援的欄位 ${key}`);
  }
  const tare = b.tare_count, perGram = b.counts_per_gram;
  if (!Number.isInteger(tare) || (tare as number) < HX711_MIN || (tare as number) > HX711_MAX) {
    throw new HttpError(400, '空勾讀值要是 HX711 範圍內的整數');
  }
  // A load cell wired the other way round gives a negative factor; zero or tiny would divide by ~0.
  if (typeof perGram !== 'number' || !Number.isFinite(perGram) || Math.abs(perGram) < 1 || Math.abs(perGram) > 100_000) {
    throw new HttpError(400, '每克讀值要是 1～100000 之間的數字（可以是負的）');
  }
  const since = b.since === undefined ? now : typeof b.since === 'string' ? new Date(b.since) : new Date(NaN);
  if (!Number.isFinite(since.getTime())) throw new HttpError(400, '生效時間格式錯誤');
  if (since > now) throw new HttpError(400, '生效時間不能晚於現在');
  return { since, tare_count: tare as number, counts_per_gram: perGram };
}

function database() {
  if (!dbClient.isConnected()) throw new Error('Database unavailable');
  return dbClient.sql;
}

// Needs the clips table (ensureDryingSchema) first.
export async function ensureWeightSchema(): Promise<void> {
  await database()`
    CREATE TABLE IF NOT EXISTS clip_scales (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      clip_id UUID NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
      since TIMESTAMPTZ NOT NULL,
      tare_count INTEGER NOT NULL CHECK (tare_count BETWEEN -8388608 AND 8388607),
      counts_per_gram DOUBLE PRECISION NOT NULL CHECK (abs(counts_per_gram) BETWEEN 1 AND 100000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (clip_id, since)
    )`;
}

const toScale = (row: any): Scale => ({ id: row.id, since: row.since, tare_count: row.tare_count, counts_per_gram: Number(row.counts_per_gram) });

export async function clipScales(clipId: string): Promise<Scale[]> {
  const rows = await database()`
    SELECT id, since, tare_count, counts_per_gram FROM clip_scales WHERE clip_id = ${clipId}::uuid ORDER BY since`;
  return rows.map(toScale);
}

// Every clip's settings, oldest first (for the clip list).
export async function allScales(): Promise<(Scale & { clip_id: string })[]> {
  const rows = await database()`SELECT id, clip_id, since, tare_count, counts_per_gram FROM clip_scales ORDER BY since`;
  return rows.map((row: any) => ({ ...toScale(row), clip_id: row.clip_id }));
}

export async function addScale(clipId: string, scale: Scale) {
  if (!isUuid(clipId)) throw new HttpError(404, '找不到這支衣夾');
  const sql = database();
  const clip = await sql`SELECT is_demo FROM clips WHERE id = ${clipId}::uuid`;
  if (!clip.length) throw new HttpError(404, '找不到這支衣夾');
  if (clip[0].is_demo) throw new HttpError(400, '示範衣夾沒有實體秤，不能設定重量校正');
  try {
    await sql`
      INSERT INTO clip_scales (clip_id, since, tare_count, counts_per_gram)
      VALUES (${clipId}::uuid, ${scale.since}, ${scale.tare_count}, ${scale.counts_per_gram})`;
  } catch (error: any) {
    if ((error?.errno ?? error?.code) === '23505') throw new HttpError(409, '這個時間已經有一筆設定');
    throw error;
  }
  return clipScales(clipId);
}

export async function deleteScale(clipId: string, scaleId: string) {
  if (!isUuid(clipId) || !isUuid(scaleId)) throw new HttpError(404, '找不到這筆設定');
  const rows = await database()`
    DELETE FROM clip_scales WHERE id = ${scaleId}::uuid AND clip_id = ${clipId}::uuid RETURNING id`;
  if (!rows.length) throw new HttpError(404, '找不到這筆設定');
  return clipScales(clipId);
}
