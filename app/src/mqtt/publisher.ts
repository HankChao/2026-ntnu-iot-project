// ==============================================================================
// MQTT Command Publisher (Sends control instructions to boxes)
// ==============================================================================

import mqtt, { type MqttClient } from 'mqtt';
import type { CommandPayload } from '../types';

export class MQTTPublisher {
  private client: MqttClient | null = null;
  private connected = false;

  constructor(
    private brokerUrl: string = process.env.MQTT_BROKER_URL || 'mqtt://mosquitto:1883',
    private options: mqtt.IClientOptions = {
      username: process.env.MQTT_USERNAME || 'maps',
      password: process.env.MQTT_PASSWORD || 'iisnrl',
      clientId: `maps6-server-pub-${Math.random().toString(16).substring(2, 8)}`,
      clean: true,
      reconnectPeriod: 3000,
    }
  ) {}

  connect(): void {
    try {
      this.client = mqtt.connect(this.brokerUrl, this.options);

      this.client.on('connect', () => {
        this.connected = true;
        console.log(`[MQTTPublisher] Connected to broker: ${this.brokerUrl}`);
      });

      this.client.on('error', (err) => {
        console.error('[MQTTPublisher] MQTT Publisher error:', err.message);
      });

      this.client.on('close', () => {
        this.connected = false;
      });
    } catch (err) {
      console.warn('[MQTTPublisher] Failed to initialize MQTT publisher:', (err as Error).message);
    }
  }

  async sendCommand(deviceId: string, command: CommandPayload, retain?: boolean): Promise<boolean> {
    if (!this.client || !this.connected) {
      console.warn(`[MQTTPublisher] Not connected, mock command to ${deviceId}:`, command);
      return false;
    }

    const topic = `MAPS/${deviceId}/command`;
    const payload = JSON.stringify(command);
    // Only persistent configurations should be retained
    const shouldRetain = retain !== undefined ? retain : (command.action === 'set_config');

    return new Promise((resolve) => {
      this.client!.publish(topic, payload, { qos: 1, retain: shouldRetain }, (err) => {
        if (err) {
          console.error(`[MQTTPublisher] Error sending command to ${topic}:`, err);
          resolve(false);
        } else {
          console.log(`[MQTTPublisher] Sent command to ${topic}: ${command.action} (retain=${shouldRetain})`);
          resolve(true);
        }
      });
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.connected = false;
    }
  }
}

export const mqttPublisher = new MQTTPublisher();
