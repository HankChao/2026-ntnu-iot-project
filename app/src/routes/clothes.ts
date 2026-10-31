import { Hono } from 'hono';
import { clothesHistory, clothesState, latestClothesRaw } from '../clothes/store';
import { mqttSubscriber } from '../mqtt/subscriber';

export const clothesRoute = new Hono();

clothesRoute.get('/latest', async (c) => {
  try {
    const data = await latestClothesRaw();
    const now = new Date();
    const ageMs = data ? Math.max(0, now.getTime() - new Date(data.timestamp).getTime()) : null;
    return c.json({
      success: true, data, server_time: now.toISOString(), age_ms: ageMs,
      stale: ageMs === null || ageMs > 10000,
      mqtt_connected: mqttSubscriber.isConnected(),
      ingestion_error: clothesState.lastError,
    });
  } catch {
    return c.json({ success: false, error: '資料庫無法讀取，請檢查後端與 PostgreSQL' }, 503);
  }
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
    const result = await clothesHistory(start, end, limit);
    return c.json({ success: true, start: start.toISOString(), end: end.toISOString(), ...result });
  } catch {
    return c.json({ success: false, error: '資料庫無法讀取，歷史資料暫時不可用' }, 503);
  }
});
