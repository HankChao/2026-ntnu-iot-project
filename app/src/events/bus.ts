// ==============================================================================
// Internal Event Bus for Decoupled Message Passing
// ==============================================================================

import type { SensorPayload, StatusPayload } from '../types';

export type EventType = 'sensor' | 'status' | 'online' | 'offline' | 'command_ack';

export interface EventMap {
  sensor: SensorPayload;
  status: StatusPayload;
  online: { device_id: string; timestamp: string };
  offline: { device_id: string; timestamp: string };
  command_ack: { device_id: string; action: string; success: boolean; timestamp: string };
}

export type EventHandler<T> = (data: T) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<EventType, Set<EventHandler<any>>>();

  on<K extends EventType>(event: K, handler: EventHandler<EventMap[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    // Return unbind function
    return () => {
      this.off(event, handler);
    };
  }

  off<K extends EventType>(event: K, handler: EventHandler<EventMap[K]>): void {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler);
    }
  }

  emit<K extends EventType>(event: K, data: EventMap[K]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try {
          const res = handler(data);
          if (res instanceof Promise) {
            res.catch((err) => console.error(`[EventBus] Error in async handler for ${event}:`, err));
          }
        } catch (err) {
          console.error(`[EventBus] Error in sync handler for ${event}:`, err);
        }
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

// Global default instance
export const globalEventBus = new EventBus();
