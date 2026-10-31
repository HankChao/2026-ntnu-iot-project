// ==============================================================================
// MAPS 6.0 Central Server Entrypoint
// ==============================================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { dbClient } from './db/client';
import { mqttSubscriber } from './mqtt/subscriber';
import { mqttPublisher } from './mqtt/publisher';
import { globalEventBus } from './events/bus';
import { pluginManager } from './plugins';
import { discordPlugin } from './plugins/discord';
import {
  initWebSocketBroadcaster,
  registerClient,
  unregisterClient,
  upgradeWebSocket,
  websocket,
} from './ws/handler';
import { apiRouter } from './routes/api';
import { ensureClothesSchema } from './clothes/store';

const app = new Hono();

// Global Middlewares
app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Basic Root & Health
app.get('/', (c) => c.text('MAPS 6.0 Central Server API is running'));
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Mount REST API v1
app.route('/api/v1', apiRouter);

// WebSocket Endpoint
app.get(
  '/ws',
  upgradeWebSocket(() => {
    return {
      onOpen(_event, ws) {
        registerClient(ws);
        ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to MAPS6 Realtime Stream' }));
      },
      onClose(_event, ws) {
        unregisterClient(ws);
      },
      onError(_event, ws) {
        unregisterClient(ws);
      },
    };
  })
);

// Initialize Services on Startup
async function bootstrap() {
  console.log('----------------------------------------------------');
  console.log('🚀 Starting MAPS 6.0 Central Server...');
  console.log('----------------------------------------------------');

  // 1. Connect to Database (with graceful fallback)
  await dbClient.connect();
  // Clothes raw must be persisted before the subscriber is started.
  await ensureClothesSchema();

  // 2. Initialize WebSocket Realtime Telemetry Broadcaster
  initWebSocketBroadcaster();

  // 3. Connect MQTT clients (telemetry subscriber & command publisher)
  mqttSubscriber.connect();
  mqttPublisher.connect();

  // 4. Register and initialize plugins (e.g. Discord Bot)
  pluginManager.register(discordPlugin);
  await pluginManager.initAll(globalEventBus);

  console.log('✅ MAPS 6.0 Central Server services initialized');
}

bootstrap().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
  websocket,
};
