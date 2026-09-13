import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { apiRouter } from '../src/routes/api';

describe('REST API Routes', () => {
  const app = new Hono();
  app.route('/api/v1', apiRouter);

  it('GET /api/v1/system/health should return ok status', async () => {
    const res = await app.request('/api/v1/system/health');
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.services).toBeDefined();
  });

  it('POST /api/v1/auth/login with valid credentials should succeed', async () => {
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'adminpassword' }),
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.token).toBeDefined();
  });

  it('POST /api/v1/auth/login with invalid credentials should fail', async () => {
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrongpassword' }),
    });
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it('Device configuration get and update', async () => {
    // 1. Get default config
    const getRes = await app.request('/api/v1/devices/TEST_DEV_01/config');
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.config.sensor_interval).toBe(60);

    // 2. Patch config
    const patchRes = await app.request('/api/v1/devices/TEST_DEV_01/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sensor_interval: 30, status_interval: 120 }),
    });
    expect(patchRes.status).toBe(200);
    const patchData = await patchRes.json();
    expect(patchData.config.sensor_interval).toBe(30);
    expect(patchData.config.status_interval).toBe(120);
  });

  it('POST /api/v1/devices/:id/command should accept commands', async () => {
    const res = await app.request('/api/v1/devices/TEST_DEV_01/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'trigger_co2_cal',
        params: {},
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.action).toBe('trigger_co2_cal');
  });

  it('POST /api/v1/devices/:id/backfill batch ingestion', async () => {
    const res = await app.request('/api/v1/devices/TEST_DEV_01/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: '2026-09-10',
        records: [
          {
            timestamp: '2026-09-10T08:00:00Z',
            sensor: { temp: 25.1, humi: 60, co2: 430 },
          },
          {
            timestamp: '2026-09-10T08:01:00Z',
            sensor: { temp: 25.2, humi: 59, co2: 435 },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.inserted).toBe(2);
  });
});
