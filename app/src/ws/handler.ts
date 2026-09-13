// ==============================================================================
// WebSocket Realtime Telemetry Broadcast Handler
// ==============================================================================

import { createBunWebSocket } from 'hono/bun';
import type { ServerWebSocket } from 'bun';
import { globalEventBus } from '../events/bus';

export const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

// Keep track of active client connections
const activeClients = new Set<ServerWebSocket>();

export function initWebSocketBroadcaster(): void {
  // Listen to EventBus and broadcast to all connected WebSocket clients
  globalEventBus.on('sensor', (payload) => {
    broadcast({
      type: 'sensor',
      device_id: payload.device_id,
      timestamp: payload.timestamp,
      sensor: payload.sensor,
    });
  });

  globalEventBus.on('status', (payload) => {
    broadcast({
      type: 'status',
      device_id: payload.device_id,
      version: payload.version,
      uptime_sec: payload.uptime_sec,
      network: payload.network,
      modules: payload.modules,
    });
  });

  globalEventBus.on('online', ({ device_id, timestamp }) => {
    broadcast({
      type: 'online',
      device_id,
      online: true,
      timestamp,
    });
  });

  globalEventBus.on('offline', ({ device_id, timestamp }) => {
    broadcast({
      type: 'online',
      device_id,
      online: false,
      timestamp,
    });
  });

  globalEventBus.on('command_ack', (data) => {
    broadcast({
      type: 'command_ack',
      device_id: data.device_id,
      action: data.action,
      success: data.success,
      timestamp: data.timestamp,
    });
  });
}

export function registerClient(ws: ServerWebSocket): void {
  activeClients.add(ws);
}

export function unregisterClient(ws: ServerWebSocket): void {
  activeClients.delete(ws);
}

export function broadcast(message: Record<string, any>): void {
  const json = JSON.stringify(message);
  for (const client of activeClients) {
    try {
      client.send(json);
    } catch {
      activeClients.delete(client);
    }
  }
}
