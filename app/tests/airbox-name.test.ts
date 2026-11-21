import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { devicesRoute, parseDisplayName } from '../src/routes/devices';

describe('Air box names', () => {
  it('are trimmed and 1–40 characters', () => {
    expect(parseDisplayName('  陽台 ')).toBe('陽台');
    for (const value of ['', '   ', 'x'.repeat(41), 42, null]) expect(parseDisplayName(value)).toBeUndefined();
  });
  it('rejects a bad name before touching the database', async () => {
    const app = new Hono().route('/devices', devicesRoute);
    const res = await app.request('/devices/B827EBE1580E', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: '  ' }),
    });
    expect(res.status).toBe(400);
  });
});
