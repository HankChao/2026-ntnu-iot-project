// ==============================================================================
// Devices Routes
// ==============================================================================

import { Hono } from 'hono';
import { getDevice, getDeviceConfig, getDevices, setDeviceConfig, updateDeviceName } from '../db/queries';
import { mqttPublisher } from '../mqtt/publisher';

export const devicesRoute = new Hono();

// GET /api/v1/devices
devicesRoute.get('/', async (c) => {
  const devices = await getDevices();
  return c.json({ success: true, count: devices.length, devices });
});

// GET /api/v1/devices/:id
devicesRoute.get('/:id', async (c) => {
  const id = c.req.param('id');
  const device = await getDevice(id);
  if (!device) {
    return c.json({ success: false, error: 'Device not found' }, 404);
  }
  const config = await getDeviceConfig(id);
  return c.json({ success: true, device, config });
});

// PATCH /api/v1/devices/:id
devicesRoute.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  if (body.display_name !== undefined) {
    await updateDeviceName(id, body.display_name);
  }
  const device = await getDevice(id);
  return c.json({ success: true, device });
});

// GET /api/v1/devices/:id/config
devicesRoute.get('/:id/config', async (c) => {
  const id = c.req.param('id');
  const config = await getDeviceConfig(id);
  return c.json({ success: true, config });
});

// PATCH /api/v1/devices/:id/config
devicesRoute.patch('/:id/config', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const updated = await setDeviceConfig(id, body);

  // Sync to box via MQTT set_config command
  await mqttPublisher.sendCommand(id, {
    action: 'set_config',
    timestamp: new Date().toISOString(),
    params: { config: updated },
  });

  return c.json({ success: true, config: updated });
});
