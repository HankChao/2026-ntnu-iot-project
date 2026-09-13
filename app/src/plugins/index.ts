// ==============================================================================
// Plugin Management & Dynamic Extensibility System
// ==============================================================================

import { EventBus } from '../events/bus';

export interface Plugin {
  name: string;
  init(bus: EventBus, config?: Record<string, any>): Promise<void> | void;
  destroy?(): Promise<void> | void;
}

export class PluginManager {
  private plugins = new Map<string, Plugin>();

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      console.warn(`[PluginManager] Plugin ${plugin.name} is already registered.`);
      return;
    }
    this.plugins.set(plugin.name, plugin);
    console.log(`[PluginManager] Registered plugin: ${plugin.name}`);
  }

  async initAll(bus: EventBus): Promise<void> {
    for (const [name, plugin] of this.plugins.entries()) {
      try {
        await plugin.init(bus);
        console.log(`[PluginManager] Initialized plugin: ${name}`);
      } catch (err) {
        console.error(`[PluginManager] Failed to initialize plugin ${name}:`, err);
      }
    }
  }

  async destroyAll(): Promise<void> {
    for (const [name, plugin] of this.plugins.entries()) {
      if (plugin.destroy) {
        try {
          await plugin.destroy();
        } catch (err) {
          console.error(`[PluginManager] Error destroying plugin ${name}:`, err);
        }
      }
    }
    this.plugins.clear();
  }
}

export const pluginManager = new PluginManager();
