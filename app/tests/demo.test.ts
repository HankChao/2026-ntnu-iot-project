import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { clothesRoute } from '../src/routes/clothes';
import { demoSeed } from '../src/clothes/demo';
import { HttpError, parseDemoQuery, parseNewGarment } from '../src/clothes/drying';

const now = Date.UTC(2026, 10, 21, 4, 0);  // 12:00 Taipei

describe('Demo seed', () => {
  const seed = demoSeed(now);
  it('never touches the real clip 衣夾-01', () => {
    expect(seed.clips.map((c) => c.name)).toEqual(['衣夾-02', '衣夾-03', '衣夾-04', '衣夾-05', '衣夾-06', '衣夾-07', '衣夾-08']);
    expect(seed.sessions.some((s) => s.clip === '衣夾-01')).toBe(false);
  });
  it('has unique names and only refers to its own clips and garments', () => {
    const clips = new Set(seed.clips.map((c) => c.name));
    const garments = new Set(seed.garments.map((g) => g.name));
    expect(clips.size).toBe(seed.clips.length);
    expect(garments.size).toBe(seed.garments.length);
    expect(seed.sessions.every((s) => clips.has(s.clip) && garments.has(s.garment))).toBe(true);
    // Ids come from the database, never from the seed.
    expect(JSON.stringify(seed)).not.toContain('"id"');
  });
  it('keeps one active session per clip and per garment, and valid records', () => {
    const active = seed.sessions.filter((s) => s.ended_at === null);
    expect(active.length).toBe(4);
    expect(new Set(active.map((s) => s.clip)).size).toBe(4);
    expect(new Set(active.map((s) => s.garment)).size).toBe(4);
    for (const s of seed.sessions) {
      expect(s.predicted_min).toBeGreaterThan(0);
      expect(s.started_at.getTime()).toBeLessThan(now);
      if (s.ended_at) expect(s.ended_at.getTime()).toBeGreaterThanOrEqual(s.started_at.getTime());
      expect((s.outcome === 'dry') === (s.actual_min !== null)).toBe(true);
    }
    expect(seed.sessions.filter((s) => s.outcome === 'early').length).toBe(1);
  });
});

describe('Demo filters', () => {
  it('accepts only demo=include', () => {
    expect(parseDemoQuery(undefined)).toBe(false);
    expect(parseDemoQuery('include')).toBe(true);
    expect(parseDemoQuery('true')).toBeUndefined();
  });
  it('creates real garments unless is_demo is true', () => {
    const garment = { name: '測試', style: 'tee', color: '#F2F1EC', material: '棉' };
    expect(parseNewGarment(garment).isDemo).toBe(false);
    expect(parseNewGarment({ ...garment, is_demo: true })).toEqual({ draft: garment as any, isDemo: true });
    expect(() => parseNewGarment({ ...garment, is_demo: 'yes' })).toThrow(HttpError);
  });
  it('rejects a bad demo parameter and answers 503 without a database', async () => {
    const app = new Hono().route('/clothes', clothesRoute);
    for (const path of ['/clothes/clips', '/clothes/garments', '/clothes/sessions/active', '/clothes/sessions']) {
      expect((await app.request(`${path}?demo=yes`)).status).toBe(400);
      expect((await app.request(`${path}?demo=include`)).status).toBe(503);
    }
    expect((await app.request('/clothes/clips/11111111-1111-4111-8111-111111111111', { method: 'DELETE' })).status).toBe(503);
    expect((await app.request('/clothes/demo/reset', { method: 'POST' })).status).toBe(503);
  });
});
