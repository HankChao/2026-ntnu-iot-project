import { Hono } from 'hono';

export const weatherRoute = new Hono();

const BASE = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore';
const DATASETS = ['O-A0001-001', 'O-A0003-001']; // 自動氣象站 + 局屬氣象站
const TTL_MS = 10 * 60 * 1000;

interface Obs {
  id: string;
  name: string;
  county: string;
  town: string;
  observed_at: string;
  temp: number | null;
  hum: number | null;
}
let cache: { at: number; map: Map<string, Obs> } | null = null;

const num = (x: unknown): number | null => {
  const v = Number(x);
  return x == null || x === '' || !Number.isFinite(v) || v <= -99 ? null : v;
};

async function fetchDataset(dataset: string, key: string): Promise<Obs[]> {
  const params = new URLSearchParams({ Authorization: key, format: 'JSON' });
  const res = await fetch(`${BASE}/${dataset}?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`氣象署 ${dataset} HTTP ${res.status}`);
  const json: any = await res.json();
  const list: any[] = json?.records?.Station ?? [];
  return list
    .map((st) => {
      const w = st.WeatherElement ?? {};
      let hum = num(w.RelativeHumidity);
      if (hum !== null && hum <= 1) hum *= 100;
      return {
        id: String(st.StationId ?? ''),
        name: String(st.StationName ?? ''),
        county: st.GeoInfo?.CountyName ?? st.CountyName ?? '其他',
        town: st.GeoInfo?.TownName ?? st.TownName ?? '',
        observed_at: st.ObsTime?.DateTime ?? '',
        temp: num(w.AirTemperature),
        hum,
      };
    })
    .filter((o) => o.id && o.name);
}

// 一次抓全部測站並快取 10 分鐘，之後所有人選站都不用再問氣象署
async function loadAll(): Promise<Map<string, Obs>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  const key = process.env.CWA_API_KEY;
  if (!key) throw new Error('後端未設定 CWA_API_KEY');
  const results = await Promise.allSettled(DATASETS.map((d) => fetchDataset(d, key)));
  const map = new Map<string, Obs>();
  for (const r of results) {
    if (r.status === 'fulfilled') for (const o of r.value) map.set(o.id, o);
  }
  if (map.size === 0) {
    if (cache) return cache.map; // 全部失敗就沿用舊資料
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    throw new Error(failed ? String(failed.reason?.message ?? failed.reason) : '氣象署沒有回傳測站');
  }
  cache = { at: Date.now(), map };
  return map;
}
const defaultName = () => process.env.CWA_STATION || '臺北';

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

// 預設縣市 = .env 的 CWA_STATION 那個測站所在的縣市（臺北 → 臺北市）
const defaultCounty = (all: Obs[]) => all.find((o) => o.name === defaultName())?.county;

weatherRoute.get('/counties', async (c) => {
  try {
    const all = [...(await loadAll()).values()].filter((o) => o.temp !== null);
    const counties = [...new Set(all.map((o) => o.county))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    return c.json({ success: true, data: counties, default: defaultCounty(all) ?? counties[0] ?? null });
  } catch (e) {
    return c.json({ success: false, error: (e as Error).message }, 502);
  }
});

weatherRoute.get('/outdoor', async (c) => {
  try {
    const all = [...(await loadAll()).values()];
    const county = c.req.query('county') || defaultCounty(all);
    const inCounty = all.filter((o) => o.county === county);
    if (!county || !inCounty.length) return c.json({ success: false, error: '找不到這個縣市' }, 404);
    const temps = inCounty.map((o) => o.temp).filter((v): v is number => v !== null);
    const hums = inCounty.map((o) => o.hum).filter((v): v is number => v !== null);
    const observedAt = inCounty.map((o) => o.observed_at).sort().at(-1) ?? '';
    return c.json({
      success: true,
      data: { county, temp: round1(median(temps)), hum: median(hums), stations: temps.length, observed_at: observedAt },
    });
  } catch (e) {
    return c.json({ success: false, error: (e as Error).message }, 502);
  }
});