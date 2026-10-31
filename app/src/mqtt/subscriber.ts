// ==============================================================================
// MQTT Subscriber (Receives box telemetry and routes to Event Bus)
// ==============================================================================

import mqtt, { type MqttClient } from 'mqtt';
import { globalEventBus } from '../events/bus';
import type { OnlinePayload, SensorPayload, StatusPayload } from '../types';
import { insertSensorData, setDeviceOnline, upsertDeviceStatus } from '../db/queries';
import { ingestClothesRaw } from '../clothes/ingest';

const clothesTopic = process.env.CLOTHES_MQTT_TOPIC || 'clothes/raw';

export class MQTTSubscriber {
  private client: MqttClient | null = null;
  private connected = false;

  constructor(
    private brokerUrl: string = process.env.MQTT_BROKER_URL || 'mqtt://mosquitto:1883',
    private options: mqtt.IClientOptions = {
      username: process.env.MQTT_USERNAME || 'maps',
      password: process.env.MQTT_PASSWORD,
      clientId: `maps6-server-sub-${Math.random().toString(16).substring(2, 8)}`,
      clean: true,
      reconnectPeriod: 3000,
    }
  ) {}

  connect(): void {
    try {
      this.client = mqtt.connect(this.brokerUrl, this.options);

      this.client.on('connect', () => {
        this.connected = true;
        console.log(`[MQTTSubscriber] Connected to broker: ${this.brokerUrl}`);

        const topics = ['MAPS/+/sensor', 'MAPS/+/status', 'MAPS/+/online', clothesTopic];
        this.client!.subscribe(topics, { qos: 1 }, (err) => {
          if (err) {
            console.error('[MQTTSubscriber] Subscription failed:', err);
          } else {
            console.log(`[MQTTSubscriber] Subscribed to topics: ${topics.join(', ')}`);
          }
        });
      });

      this.client.on('message', (topic, payload, packet) => {
        if (topic === clothesTopic) {
          const receivedAt = new Date();
          ingestClothesRaw(payload.toString(), receivedAt, packet.retain)
            .catch((error) => console.error('[Clothes] Record not stored:', error.message));
          return;
        }
        this.handleMessage(topic, payload.toString());
      });

      this.client.on('error', (err) => {
        console.error('[MQTTSubscriber] MQTT Client error:', err.message);
      });

      this.client.on('close', () => {
        this.connected = false;
      });
    } catch (err) {
      console.warn('[MQTTSubscriber] Failed to initialize MQTT client:', (err as Error).message);
    }
  }

  handleMessage(topic: string, message: string): void {
    const parts = topic.split('/');
    if (parts.length < 3 || parts[0] !== 'MAPS') return;

    const deviceId = parts[1];
    const messageType = parts[2];

    try {
      const data = JSON.parse(message);

      if (messageType === 'sensor') {
        const payload: SensorPayload = {
          device_id: deviceId,
          app: data.app || 'MAPS6',
          version: data.version || '8.0.0',
          timestamp: data.timestamp || new Date().toISOString(),
          sensor: data.sensor || {},
        };
        globalEventBus.emit('sensor', payload);
        insertSensorData(payload).catch((e) => console.error('[MQTTSubscriber] DB sensor insert error:', e));
      } else if (messageType === 'status') {
        const payload: StatusPayload = {
          device_id: deviceId,
          app: data.app || 'MAPS6',
          version: data.version || '8.0.0',
          timestamp: data.timestamp || new Date().toISOString(),
          uptime_sec: data.uptime_sec,
          network: data.network,
          mcu_firmware: data.mcu_firmware,
          modules: data.modules,
        };
        globalEventBus.emit('status', payload);
        upsertDeviceStatus(payload).catch((e) => console.error('[MQTTSubscriber] DB status update error:', e));
      } else if (messageType === 'online') {
        const online = Boolean(data.online);
        const timestamp = data.timestamp || new Date().toISOString();
        if (online) {
          globalEventBus.emit('online', { device_id: deviceId, timestamp });
        } else {
          globalEventBus.emit('offline', { device_id: deviceId, timestamp });
        }
        setDeviceOnline(deviceId, online, timestamp).catch((e) => console.error('[MQTTSubscriber] DB online status error:', e));
      }
    } catch (err) {
      console.error(`[MQTTSubscriber] JSON parse error for topic ${topic}:`, err);
    }
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

export const mqttSubscriber = new MQTTSubscriber();
