// ==============================================================================
// Discord Bot Plugin (Skeleton / Extensibility Example)
// ==============================================================================

import type { Plugin } from './index';
import type { EventBus } from '../events/bus';

export const discordPlugin: Plugin = {
  name: 'discord-bot',
  init(bus: EventBus) {
    const enabled = process.env.DISCORD_BOT_ENABLED === 'true';
    if (!enabled) {
      console.log('[DiscordPlugin] Bot is disabled (set DISCORD_BOT_ENABLED=true to activate)');
      return;
    }

    console.log('[DiscordPlugin] Initializing Discord Bot...');

    // Listen to offline alerts
    bus.on('offline', ({ device_id, timestamp }) => {
      console.log(`[DiscordPlugin] [ALERT] Device ${device_id} went OFFLINE at ${timestamp}`);
      // Future: send discord webhook or message via discord.js
    });

    // Listen to sensor anomalies
    bus.on('sensor', (data) => {
      const pm25 = data.sensor.pm25_ae;
      if (pm25 !== undefined && pm25 > 100) {
        console.log(`[DiscordPlugin] [ALERT] High PM2.5 on device ${data.device_id}: ${pm25} ug/m3`);
        // Future: send discord alert
      }
    });
  },
  destroy() {
    console.log('[DiscordPlugin] Destroying Discord Bot');
  },
};
