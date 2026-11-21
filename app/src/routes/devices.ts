// ==============================================================================
// Devices Routes
// ==============================================================================

import { Hono } from 'hono';
import { deviceNameTaken, getDevice, getDeviceConfig, getDevices, setDeviceConfig, updateDeviceName } from '../db/queries';
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

// Air box names: 1–40 characters after trimming, stored trimmed. undefined = bad value.
export function parseDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name.length >= 1 && name.length <= 40 ? name : undefined;
}

// PATCH /api/v1/devices/:id — only the display name. Names must not repeat between air boxes.
devicesRoute.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  if (body.display_name !== undefined) {
    const name = parseDisplayName(body.display_name);
    if (name === undefined) return c.json({ success: false, error: '名稱必須是 1～40 個字' }, 400);
    try {
      if (!await getDevice(id)) return c.json({ success: false, error: '找不到這個空氣盒子' }, 404);
      if (await deviceNameTaken(id, name)) return c.json({ success: false, error: `已經有名為「${name}」的空氣盒子` }, 409);
      await updateDeviceName(id, name);
    } catch (error) {
      // The unique index catches a name taken at the same moment.
      if ((error as any)?.errno === '23505') return c.json({ success: false, error: `已經有名為「${name}」的空氣盒子` }, 409);
      return c.json({ success: false, error: '資料庫無法寫入，名稱沒有儲存' }, 503);
    }
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
