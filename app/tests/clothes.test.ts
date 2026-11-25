import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { parseClothesRaw } from '../src/clothes/validation';
import { ingestClothesRaw } from '../src/clothes/ingest';
import { clothesRoute } from '../src/routes/clothes';
import { CSV_HEADER, type CsvRow, attachAir, clothesCsvLine, historyBucketSeconds } from '../src/clothes/store';

const raw = { hx711_raw: -1500, ads1115_raw: 7799, touch_raw: 31875 };
describe('Clothes MQTT contract', () => {
  it('preserves actual integer counts, including negative HX711 and null/zero', () => {
    expect(parseClothesRaw(JSON.stringify(raw))).toEqual(raw);
    expect(parseClothesRaw('{"hx711_raw":null,"ads1115_raw":0,"touch_raw":null}'))
      .toEqual({ hx711_raw: null, ads1115_raw: 0, touch_raw: null });
  });
  it('rejects missing fields, non-numeric values, arrays, oversized and out-of-range payloads', () => {
    for (const data of [null, [], {}, { ...raw, timestamp: 'fake' }, { ...raw, hx711_raw: '42' },
      { ...raw, ads1115_raw: 32768 }, { ...raw, touch_raw: -1 }, { ...raw, hx711_raw: 1.5 }]) {
      expect(() => parseClothesRaw(JSON.stringify(data))).toThrow();
    }
    expect(() => parseClothesRaw('x'.repeat(1025))).toThrow();
    expect(() => parseClothesRaw('{broken')).toThrow();
  });
  it('rejects retained readings so old samples are not timestamped as new', async () => {
    await expect(ingestClothesRaw(JSON.stringify(raw), new Date(), true)).rejects.toThrow('Retained');
  });
  it('does not silently store clothes data in memory when PostgreSQL is absent', async () => {
    await expect(ingestClothesRaw(JSON.stringify(raw), new Date())).rejects.toThrow('unavailable');
    const app = new Hono().route('/clothes', clothesRoute);
    expect((await app.request('/clothes/latest')).status).toBe(503);
    expect((await app.request('/clothes/history')).status).toBe(503);
  });
  it('picks a history bucket that keeps long ranges within the point limit', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);
    expect(historyBucketSeconds(start, at(3600), 5000)).toBe(1);
    expect(historyBucketSeconds(start, at(6 * 3600), 5000)).toBe(5);
    expect(historyBucketSeconds(start, at(24 * 3600), 5000)).toBe(18);
    for (const seconds of [6 * 3600, 24 * 3600, 7777]) {
      expect(seconds / historyBucketSeconds(start, at(seconds), 5000)).toBeLessThanOrEqual(5000);
    }
  });
  it('writes CSV lines in Taipei and UTC time with empty cells for failed reads', () => {
    const out = ',,,,,,,,,,,,,'; // 13 outdoor columns, blank without stored observations
    expect(CSV_HEADER).toBe('time_taipei,timestamp_utc,hx711_raw,ads1115_raw,ads1115_ohm,touch_raw,air_temp_c,air_humi_pct,' +
      'out_temp_c,out_humi_pct,out_wind_ms,out_wind_dir_deg,out_gust_ms,out_pressure_hpa,out_rain_10min_mm,out_rain_1h_mm,' +
      'out_rain_day_mm,out_sunshine_h,out_sunshine_1h_h,out_radiation_1h_mj,out_uv\n');
    expect(clothesCsvLine({ id: '1', timestamp: new Date('2026-11-13T17:15:53.250Z'), hx711_raw: -1500, ads1115_raw: null, touch_raw: 0 }))
      .toBe(`2026-11-14 01:15:53.250,2026-11-13T17:15:53.250Z,-1500,,,0,,${out}\n`);
    expect(clothesCsvLine({ id: '1', timestamp: '2026-11-13T17:15:53Z', hx711_raw: 1, ads1115_raw: 2, touch_raw: 3, air_temp: 24.5, air_humi: 61.25 }))
      .toBe(`2026-11-14 01:15:53.000,2026-11-13T17:15:53.000Z,1,2,,3,24.5,61.25${out}\n`);
    expect(clothesCsvLine({ id: '1', timestamp: '2026-11-13T17:15:53Z', hx711_raw: 1, ads1115_raw: 5000, touch_raw: 3, ads1115_ohm: 245123.6 }))
      .toBe(`2026-11-14 01:15:53.000,2026-11-13T17:15:53.000Z,1,5000,245124,3,,${out}\n`);
    expect(clothesCsvLine({ id: '1', timestamp: '2026-11-13T17:15:53Z', hx711_raw: 1, ads1115_raw: 22740, touch_raw: 3, ads1115_ohm: Infinity }))
      .toBe(`2026-11-14 01:15:53.000,2026-11-13T17:15:53.000Z,1,22740,,3,,${out}\n`);
    expect(clothesCsvLine({ id: '1', timestamp: '2026-11-13T17:15:53Z', hx711_raw: 1, ads1115_raw: 2, touch_raw: 3,
      outdoor: { temp: 21.5, hum: 80, wind_speed: 2.3, rain_1h_mm: 0, uv: null } }))
      .toBe('2026-11-14 01:15:53.000,2026-11-13T17:15:53.000Z,1,2,,3,,,21.5,80,2.3,,,,,0,,,,,\n');
  });
  it('pairs each clip reading with the latest air reading no older than 5 minutes', () => {
    const t = (minutes: number) => new Date(Date.UTC(2026, 10, 14, 0, 0) + minutes * 60000).toISOString();
    const clip = (minutes: number): CsvRow => ({ id: String(minutes), timestamp: t(minutes), hx711_raw: 0, ads1115_raw: 0, touch_raw: 0 });
    const rows = attachAir([clip(-1), clip(0), clip(0.5), clip(1), clip(7)],
      [{ timestamp: t(0), temp: 24.456, humi: 60 }, { timestamp: t(1), temp: 25, humi: null }]);
    expect(rows.map((row) => [row.air_temp, row.air_humi])).toEqual(
      [[null, null], [24.46, 60], [24.46, 60], [25, null], [null, null]]);
  });
  it('rejects a malformed airbox choice and reports the air box list as unavailable without a database', async () => {
    const app = new Hono().route('/clothes', clothesRoute);
    for (const path of ['/clothes/latest?airbox=', '/clothes/latest?airbox=a%20b', `/clothes/latest?airbox=${'x'.repeat(65)}`,
      '/clothes/history?airbox=a;b', '/clothes/export?start=2026-01-01&end=2026-01-02&airbox=a/b']) {
      expect((await app.request(path)).status).toBe(400);
    }
    expect((await app.request('/clothes/latest?airbox=B827EBE1580E')).status).toBe(503);
    expect((await app.request('/clothes/airboxes')).status).toBe(503);
  });
  it('requires a closed export range of at most 7 days', async () => {
    const app = new Hono().route('/clothes', clothesRoute);
    for (const query of ['', 'start=2026-01-01', 'end=2026-01-01', 'start=bad&end=2026-01-02',
      'start=2026-01-02&end=2026-01-01', 'start=2026-01-01&end=2026-01-01', 'start=2026-01-01&end=2026-01-09']) {
      expect((await app.request(`/clothes/export?${query}`)).status).toBe(400);
    }
    expect((await app.request('/clothes/export?start=2026-01-01&end=2026-01-08')).status).toBe(503);
  });
  it('bounds and validates history queries before hitting the database', async () => {
    const app = new Hono().route('/clothes', clothesRoute);
    for (const query of ['limit=0', 'limit=5001', 'limit=2x', 'start=bad',
      'start=2026-01-03&end=2026-01-01', 'start=2026-01-01T00:00:00Z&end=2026-01-08T00:00:01Z']) {
      expect((await app.request(`/clothes/history?${query}`)).status).toBe(400);
    }
    // One week is the longest range (the clip detail page's longest view).
    expect((await app.request('/clothes/history?start=2026-01-01T00:00:00Z&end=2026-01-08T00:00:00Z')).status).toBe(503);
  });
});
