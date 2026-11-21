import { Hono } from 'hono';
import {
  AIR_MAX_AGE_MS, CSV_HEADER, type CsvRow, airReadings, clothesAirboxId, listAirboxes, clothesCsvLine, clothesExportRows,
  clothesHistory, clothesState, latestAir, latestClothesRaw, CLIP_STALE_MS, isUuid,
} from '../clothes/store';
import { mqttSubscriber } from '../mqtt/subscriber';
import { dryingRoute } from './drying';

export { CLIP_STALE_MS };
export const clothesRoute = new Hono();
clothesRoute.route('/', dryingRoute);

// Air box data is a bonus next to the clip: if it is missing or unreadable, clip data still works.
async function optional<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); } catch { return null; }
}

// ?airbox=<device_id> picks the air box; without it, the clip's own setting (?clip=<uuid>, default
// the real clip), then CLOTHES_AIRBOX_ID, then the most recent one.
const AIRBOX_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const BAD_AIRBOX = { success: false, error: 'airbox 或 clip 參數格式錯誤' } as const;
async function chosenAirbox(requested: string | undefined, clip: string | undefined) {
  if (requested !== undefined) return AIRBOX_ID.test(requested) ? requested : undefined;
  if (clip !== undefined && !isUuid(clip)) return undefined;
  return optional(() => clothesAirboxId(clip));
}

// Air boxes for the dashboard picker; "connected" = online and reported within the last 5 minutes.
clothesRoute.get('/airboxes', async (c) => {
  const boxes = await optional(listAirboxes);
  if (!boxes) return c.json({ success: false, error: '資料庫無法讀取，空氣盒子清單暫時不可用' }, 503);
  const now = Date.now();
  const clip = c.req.query('clip');
  if (clip !== undefined && !isUuid(clip)) return c.json(BAD_AIRBOX, 400);
  // default_id: the box this clip actually uses.
  return c.json({ success: true, default_id: await optional(() => clothesAirboxId(clip)), airboxes: boxes.map((box) => ({
    device_id: box.device_id, display_name: box.display_name, last_reading: box.last_reading,
    connected: box.online && box.last_reading !== null && now - new Date(box.last_reading).getTime() <= AIR_MAX_AGE_MS,
  })) });
});

clothesRoute.get('/latest', async (c) => {
  try {
    const airboxId = await chosenAirbox(c.req.query('airbox'), c.req.query('clip'));
    if (airboxId === undefined) return c.json(BAD_AIRBOX, 400);
    const data = await latestClothesRaw();
    const now = new Date();
    const ageMs = data ? Math.max(0, now.getTime() - new Date(data.timestamp).getTime()) : null;
    const reading = airboxId ? await optional(() => latestAir(airboxId)) : null;
    const airAgeMs = reading ? Math.max(0, now.getTime() - new Date(reading.timestamp).getTime()) : null;
    return c.json({
      success: true, data, server_time: now.toISOString(), age_ms: ageMs,
      air: airboxId ? { device_id: airboxId, ...reading, age_ms: airAgeMs, stale: airAgeMs === null || airAgeMs > AIR_MAX_AGE_MS } : null,
      stale: ageMs === null || ageMs > CLIP_STALE_MS, stale_after_ms: CLIP_STALE_MS,
      mqtt_connected: mqttSubscriber.isConnected(),
      ingestion_error: clothesState.lastError,
    });
  } catch {
    return c.json({ success: false, error: '資料庫無法讀取，請檢查後端與 PostgreSQL' }, 503);
  }
});

export const EXPORT_MAX_DAYS = 7;
const fileStamp = (date: Date) => new Date(date.getTime() + 8 * 60 * 60000).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

// Raw CSV download for a closed time range (both ends required so the file is reproducible).
clothesRoute.get('/export', async (c) => {
  const startText = c.req.query('start');
  const endText = c.req.query('end');
  const start = new Date(startText ?? NaN);
  const end = new Date(endText ?? NaN);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end ||
      end.getTime() - start.getTime() > EXPORT_MAX_DAYS * 24 * 60 * 60000) {
    return c.json({ success: false, error: `請提供 start 與 end，結束需晚於開始，最長 ${EXPORT_MAX_DAYS} 天` }, 400);
  }
  const airboxId = await chosenAirbox(c.req.query('airbox'), c.req.query('clip'));
  if (airboxId === undefined) return c.json(BAD_AIRBOX, 400);
  const pages = clothesExportRows(start, end, 5000, airboxId);
  let first: IteratorResult<CsvRow[], void>;
  try { first = await pages.next(); } catch {
    return c.json({ success: false, error: '資料庫無法讀取，暫時無法匯出' }, 503);
  }
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      // BOM so Excel opens the UTF-8 file correctly.
      controller.enqueue(encoder.encode('\uFEFF' + CSV_HEADER));
      if (first.value) controller.enqueue(encoder.encode(first.value.map(clothesCsvLine).join('')));
    },
    async pull(controller) {
      try {
        const page = await pages.next();
        if (page.done) return controller.close();
        if (page.value.length) controller.enqueue(encoder.encode(page.value.map(clothesCsvLine).join('')));
      } catch (err) { controller.error(err); }
    },
    async cancel() { await pages.return(undefined); },
  });
  const name = `clothes_raw_${fileStamp(start)}_${fileStamp(end)}.csv`;
  return new Response(body, { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'no-store',
  } });
});

clothesRoute.get('/history', async (c) => {
  const now = new Date();
  const startText = c.req.query('start');
  const endText = c.req.query('end');
  const start = startText === undefined ? new Date(now.getTime() - 15 * 60000) : new Date(startText);
  const end = endText === undefined ? now : new Date(endText);
  const limitText = c.req.query('limit') ?? '5000';
  const limit = Number(limitText);
  if (!/^\d+$/.test(limitText) || !Number.isInteger(limit) || limit < 1 || limit > 5000 ||
      !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end ||
      end.getTime() - start.getTime() > 24 * 60 * 60000) {
    return c.json({ success: false, error: '時間範圍最多24小時，limit 必須為1～5000' }, 400);
  }
  try {
    const airboxId = await chosenAirbox(c.req.query('airbox'), c.req.query('clip'));
    if (airboxId === undefined) return c.json(BAD_AIRBOX, 400);
    const result = await clothesHistory(start, end, limit);
    const air = airboxId ? await optional(() => airReadings(airboxId, start, end)) : null;
    return c.json({ success: true, start: start.toISOString(), end: end.toISOString(), ...result,
      air: airboxId ? { device_id: airboxId, records: air ?? [] } : null });
  } catch {
    return c.json({ success: false, error: '資料庫無法讀取，歷史資料暫時不可用' }, 503);
  }
});
