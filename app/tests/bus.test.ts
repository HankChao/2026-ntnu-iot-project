import { describe, expect, it } from 'bun:test';
import { EventBus } from '../src/events/bus';
import type { SensorPayload } from '../src/types';

describe('EventBus', () => {
  it('should emit and receive sensor events', async () => {
    const bus = new EventBus();
    let receivedPayload: SensorPayload | null = null;

    const unbind = bus.on('sensor', (data) => {
      receivedPayload = data;
    });

    const testPayload: SensorPayload = {
      device_id: 'TEST_BOX_01',
      app: 'MAPS6',
      version: '8.0.0',
      timestamp: '2026-09-13T12:00:00Z',
      sensor: {
        temp: 26.5,
        humi: 55.0,
        co2: 450,
        pm25_ae: 12,
      },
    };

    bus.emit('sensor', testPayload);

    expect(receivedPayload).not.toBeNull();
    expect(receivedPayload?.device_id).toBe('TEST_BOX_01');
    expect(receivedPayload?.sensor.temp).toBe(26.5);

    // Test unbind
    unbind();
    receivedPayload = null;
    bus.emit('sensor', testPayload);
    expect(receivedPayload).toBeNull();
  });

  it('should handle online and offline events', () => {
    const bus = new EventBus();
    const onlineEvents: string[] = [];

    bus.on('online', ({ device_id }) => onlineEvents.push(`online:${device_id}`));
    bus.on('offline', ({ device_id }) => onlineEvents.push(`offline:${device_id}`));

    bus.emit('online', { device_id: 'BOX_A', timestamp: '2026-09-13T12:00:00Z' });
    bus.emit('offline', { device_id: 'BOX_A', timestamp: '2026-09-13T12:05:00Z' });

    expect(onlineEvents).toEqual(['online:BOX_A', 'offline:BOX_A']);
  });
});
