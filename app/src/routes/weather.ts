import { Hono } from 'hono';

export const weatherRoute = new Hono();

const CWA_URL = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001';
const TTL_MS = 10 * 60 * 1000; // 氣象署每 10 分鐘更新一次

interface Outdoor {
  station: string;
  observed_at: string;
  temp: number | null;
  hum: number | null;
}
let cache: { at: number; data: Outdoor } | null = null;

const num = (x: unknown): number | null => {
  const v = Number(x);
  return x == null || x === '' || !Number.isFinite(v) || v <= -99 ? null : v; // -99 = 無資料
};

async function fetchOutdoor(): Promise<Outdoor> {
  const key = process.env.CWA_API_KEY;
  if (!key) throw new Error('後端未設定 CWA_API_KEY');
  const params = new URLSearchParams({
    Authorization: key,
    StationName: process.env.CWA_STATION || '臺北',
    format: 'JSON',
  });
  const res = await fetch(`${CWA_URL}?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`氣象署 HTTP ${res.status}`);
  const json: any = await res.json();
  const st = json?.records?.Station?.[0];
  if (!st) throw new Error('找不到測站，請檢查 CWA_STATION');
  const w = st.WeatherElement ?? {};
  let hum = num(w.RelativeHumidity);
  if (hum !== null && hum <= 1) hum *= 100; // 若是 0~1 就換成 %
  return {
    station: st.StationName,
    observed_at: st.ObsTime?.DateTime ?? '',
    temp: num(w.AirTemperature),
    hum,
  };
}

weatherRoute.get('/outdoor', async (c) => {
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      cache = { at: Date.now(), data: await fetchOutdoor() };
    }
    return c.json({ success: true, data: cache.data });
  } catch (e) {
    if (cache) return c.json({ success: true, data: cache.data, stale: true });
    return c.json({ success: false, error: (e as Error).message }, 502);
  }
});