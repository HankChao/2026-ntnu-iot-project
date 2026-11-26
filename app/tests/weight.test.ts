import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { HttpError } from '../src/clothes/drying';
import { countToGram, parseScale, scaleAt } from '../src/clothes/weight';
import { clothesRoute } from '../src/routes/clothes';

const status = (fn: () => unknown) => { try { fn(); return 0; } catch (error) { return error instanceof HttpError ? error.status : -1; } };
// 衣夾-01's calibration on 2026-11-25: empty hook 105836, 162 g read 169540.
const clip01 = { since: '2026-11-25T12:38:00Z', tare_count: 105836, counts_per_gram: 393.2 };

describe('Weight in grams from the HX711 reading', () => {
  it('subtracts the empty hook and divides by counts per gram', () => {
    expect(countToGram(105836, clip01)).toBe(0);
    expect(countToGram(169540, clip01)!).toBeCloseTo(162, 0);
    expect(countToGram(129635, clip01)!).toBeCloseTo(60.5, 1);   // the 60 g check
    expect(countToGram(105816, clip01)!).toBeLessThan(0);         // noise around an empty hook stays as measured
    expect(countToGram(null, clip01)).toBeNull();
    expect(countToGram(105836 - 3932, { ...clip01, counts_per_gram: -393.2 })).toBeCloseTo(10, 5);  // reversed load cell
  });
  it('uses the setting in force at the reading time', () => {
    const older = { ...clip01, since: '2026-11-01T00:00:00Z', tare_count: 100000 };
    expect(scaleAt([older, clip01], Date.parse('2026-10-01T00:00:00Z'))).toBeNull();
    expect(scaleAt([older, clip01], Date.parse('2026-11-20T00:00:00Z'))).toBe(older);
    expect(scaleAt([older, clip01], Date.parse('2026-11-26T00:00:00Z'))).toBe(clip01);
  });
  it('checks a new setting', () => {
    const now = new Date('2026-11-25T14:00:00Z');
    expect(parseScale({ tare_count: 105836, counts_per_gram: 393.2 }, now).since).toEqual(now);
    expect(parseScale({ tare_count: -5, counts_per_gram: -2.5 }, now).counts_per_gram).toBe(-2.5);
    for (const body of [null, [], {}, { tare_count: 105836 }, { tare_count: 1.5, counts_per_gram: 393 }, { tare_count: 9_000_000, counts_per_gram: 393 },
      { tare_count: 105836, counts_per_gram: 0 }, { tare_count: 105836, counts_per_gram: 0.5 }, { tare_count: 105836, counts_per_gram: '393' },
      { tare_count: 105836, counts_per_gram: 393, since: 'today' }, { tare_count: 105836, counts_per_gram: 393, since: '2026-11-26T00:00:00Z' },
      { tare_count: 105836, counts_per_gram: 393, extra: 1 }]) {
      expect(status(() => parseScale(body, now))).toBe(400);
    }
  });
});

describe('Scale API without a database', () => {
  const app = new Hono().route('/clothes', clothesRoute);
  const ID = '11111111-1111-4111-8111-111111111111';
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  it('rejects bad input first, then answers 503', async () => {
    expect((await post(`/clothes/clips/${ID}/scales`, { tare_count: 1 })).status).toBe(400);
    expect((await post(`/clothes/clips/${ID}/scales`, { tare_count: 105836, counts_per_gram: 393.2 })).status).toBe(503);
    expect((await app.request(`/clothes/clips/${ID}/scales/${ID}`, { method: 'DELETE' })).status).toBe(503);
  });
});
