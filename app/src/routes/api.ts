// ==============================================================================
// REST API Aggregator
// ==============================================================================

import { Hono } from 'hono';
import { dbClient } from '../db/client';
import { mqttSubscriber } from '../mqtt/subscriber';
import { mqttPublisher } from '../mqtt/publisher';
import { devicesRoute } from './devices';
import { commandsRoute } from './commands';
import { sensorsRoute } from './sensors';
import { backfillRoute } from './backfill';
import { authRoute } from './auth';
import { clothesRoute } from './clothes';

export const apiRouter = new Hono();

// System Health Check
apiRouter.get('/system/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: dbClient.isConnected() ? 'connected' : 'disconnected',
      mqtt_subscriber: mqttSubscriber.isConnected() ? 'connected' : 'disconnected',
      mqtt_publisher: mqttPublisher.isConnected() ? 'connected' : 'disconnected',
    },
  });
});

// System Stats Summary
apiRouter.get('/system/stats', async (c) => {
  const { getSystemStats } = await import('../db/queries');
  const stats = await getSystemStats();
  return c.json({
    timestamp: new Date().toISOString(),
    stats,
  });
});

// Mount modular sub-routers
apiRouter.route('/auth', authRoute);
apiRouter.route('/clothes', clothesRoute);
apiRouter.route('/devices', devicesRoute);
apiRouter.route('/devices', commandsRoute);
apiRouter.route('/devices', sensorsRoute);
apiRouter.route('/devices', backfillRoute);
