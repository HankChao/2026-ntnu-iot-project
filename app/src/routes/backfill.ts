// ==============================================================================
// Historical Backfill Routes
// ==============================================================================

import { Hono } from 'hono';
import { batchInsertSensorData } from '../db/queries';
import type { SensorData } from '../types';

export const backfillRoute = new Hono();

// POST /api/v1/devices/:id/backfill (JSON batch)
backfillRoute.post('/:id/backfill', async (c) => {
  const deviceId = c.req.param('id');
  const body = await c.req.json().catch(() => null);

  if (!body || !Array.isArray(body.records)) {
    return c.json({ success: false, error: 'Expected { records: [...] }' }, 400);
  }

  const validRecords: Array<{ timestamp: string; sensor: SensorData }> = [];
  for (const item of body.records) {
    if (item && item.timestamp && item.sensor) {
      validRecords.push({
        timestamp: item.timestamp,
        sensor: item.sensor,
      });
    }
  }

  const inserted = await batchInsertSensorData(deviceId, validRecords);

  return c.json({
    success: true,
    device_id: deviceId,
    date: body.date,
    total: body.records.length,
    inserted,
  });
});

// POST /api/v1/devices/:id/backfill/csv (Multipart CSV upload)
backfillRoute.post('/:id/backfill/csv', async (c) => {
  const deviceId = c.req.param('id');
  const body = await c.req.parseBody().catch(() => ({}));
  const file = body['file'];

  if (!file || typeof file === 'string') {
    return c.json({ success: false, error: 'No CSV file uploaded' }, 400);
  }

  try {
    const text = await (file as Blob).text();
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) {
      return c.json({ success: false, error: 'CSV file is empty or missing data rows' }, 400);
    }

    const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const colIdx = new Map<string, number>();
    header.forEach((h, idx) => colIdx.set(h, idx));

    const records: Array<{ timestamp: string; sensor: SensorData }> = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      if (cols.length < header.length) continue;

      const dateStr = cols[colIdx.get('Date') ?? 1] || '';
      const timeStr = cols[colIdx.get('Time') ?? 2] || '';
      const timestamp = `${dateStr}T${timeStr}+08:00`;

      const sensor: SensorData = {};
      const getNum = (name: string) => {
        const idx = colIdx.get(name);
        if (idx !== undefined && cols[idx] !== undefined && cols[idx] !== '') {
          const val = parseFloat(cols[idx]);
          return isNaN(val) ? undefined : val;
        }
        return undefined;
      };

      sensor.temp = getNum('Temperature');
      sensor.humi = getNum('Humidity');
      sensor.pm25_ae = getNum('PM2.5_AE');
      sensor.pm1_ae = getNum('PM1.0_AE');
      sensor.pm10_ae = getNum('PM10.0_AE');
      sensor.illuminance = getNum('Illuminance');
      sensor.co2 = getNum('CO2');
      sensor.tvoc = getNum('TVOC');

      records.push({ timestamp, sensor });
    }

    const inserted = await batchInsertSensorData(deviceId, records);

    return c.json({
      success: true,
      device_id: deviceId,
      total_rows: lines.length - 1,
      inserted,
    });
  } catch (err) {
    return c.json({ success: false, error: `Failed to parse CSV: ${(err as Error).message}` }, 500);
  }
});
