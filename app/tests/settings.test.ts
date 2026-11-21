import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { settingsRoute } from '../src/routes/settings';
import { parseSettingsPatch } from '../src/settings/store';

describe('Site settings', () => {
  it('accepts only whitelisted keys with valid values', () => {
    expect(parseSettingsPatch({ demo_data: false })).toEqual({ demo_data: false });
    for (const body of [{}, [], null, { demo_data: 'false' }, { theme: 'dark' }]) {
      expect(() => parseSettingsPatch(body)).toThrow();
    }
  });
  it('answers 503 without a database and 400 for unknown keys', async () => {
    const app = new Hono().route('/settings', settingsRoute);
    const patch = (body: string) => app.request('/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
    expect((await app.request('/settings')).status).toBe(503);
    expect((await patch('{"demo_data":true}')).status).toBe(503);
    expect((await patch('{"theme":"dark"}')).status).toBe(400);
    expect((await patch('{broken')).status).toBe(400);
  });
});
