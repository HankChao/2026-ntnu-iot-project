import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { parseClothesRaw } from '../src/clothes/validation';
import { ingestClothesRaw } from '../src/clothes/ingest';
import { clothesRoute } from '../src/routes/clothes';

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
  it('bounds and validates history queries before hitting the database', async () => {
    const app = new Hono().route('/clothes', clothesRoute);
    for (const query of ['limit=0', 'limit=5001', 'limit=2x', 'start=bad',
      'start=2026-01-03&end=2026-01-01', 'start=2026-01-01&end=2026-01-03']) {
      expect((await app.request(`/clothes/history?${query}`)).status).toBe(400);
    }
  });
});
