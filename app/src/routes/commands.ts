// ==============================================================================
// Commands Routes (Remote box instruction delivery)
// ==============================================================================

import { Hono } from 'hono';
import { mqttPublisher } from '../mqtt/publisher';
import type { CommandPayload } from '../types';

export const commandsRoute = new Hono();

// POST /api/v1/devices/:id/command
commandsRoute.post('/:id/command', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<CommandPayload>().catch(() => null);

  if (!body || !body.action) {
    return c.json({ success: false, error: 'Invalid command payload: missing action' }, 400);
  }

  const command: CommandPayload = {
    action: body.action,
    timestamp: body.timestamp || new Date().toISOString(),
    params: body.params || {},
  };

  const published = await mqttPublisher.sendCommand(id, command);

  return c.json({
    success: true,
    device_id: id,
    action: command.action,
    published,
    timestamp: command.timestamp,
  });
});
