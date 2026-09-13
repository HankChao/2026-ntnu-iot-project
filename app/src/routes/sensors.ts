// ==============================================================================
// Sensor Data Query Routes
// ==============================================================================

import { Hono } from 'hono';
import { getDeviceDates, getLatestSensor, getSensorHistory } from '../db/queries';

export const sensorsRoute = new Hono();

// GET /api/v1/devices/:id/sensor/latest
sensorsRoute.get('/:id/sensor/latest', async (c) => {
  const id = c.req.param('id');
  const latest = await getLatestSensor(id);
  if (!latest) {
    return c.json({ success: false, error: 'No sensor data found' }, 404);
  }
  return c.json({ success: true, device_id: id, data: latest });
});

// GET /api/v1/devices/:id/sensor/history
sensorsRoute.get('/:id/sensor/history', async (c) => {
  const id = c.req.param('id');
  const start = c.req.query('start');
  const end = c.req.query('end');
  const step = parseInt(c.req.query('step') || '1', 10);

  const history = await getSensorHistory(id, start, end, step);

  return c.json({
    success: true,
    device_id: id,
    start,
    end,
    step,
    count: history.length,
    records: history,
  });
});

// GET /api/v1/devices/:id/dates
sensorsRoute.get('/:id/dates', async (c) => {
  const id = c.req.param('id');
  const dates = await getDeviceDates(id);
  return c.json({ success: true, device_id: id, dates });
});
