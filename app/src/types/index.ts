// ==============================================================================
// MAPS 6.0 Central Server Type Definitions
// ==============================================================================

export interface SensorData {
  temp?: number;
  humi?: number;
  cpu_temp?: number;
  co2?: number;
  ave_co2?: number;
  tvoc?: number;
  eco2?: number;
  s_h2?: number;
  s_ethanol?: number;
  baseline_tvoc?: number;
  baseline_eco2?: number;
  illuminance?: number;
  color_temp?: number;
  ch_r?: number;
  ch_g?: number;
  ch_b?: number;
  ch_c?: number;
  pm1_ae?: number;
  pm25_ae?: number;
  pm10_ae?: number;
  pm1_sp?: number;
  pm25_sp?: number;
  pm10_sp?: number;
}

export interface SensorPayload {
  device_id: string;
  app: string;
  version: string;
  timestamp: string;
  sensor: SensorData;
}

export interface NetworkInfo {
  ip?: string;
  ssid?: string;
  type?: string;
}

export interface StatusPayload {
  device_id: string;
  app: string;
  version: string;
  timestamp: string;
  uptime_sec?: number;
  network?: NetworkInfo;
  mcu_firmware?: string;
  modules?: Record<string, boolean>;
}

export interface OnlinePayload {
  online: boolean;
  timestamp: string;
}

export interface CommandPayload {
  action: 'set_config' | 'reboot' | 'trigger_backfill' | 'trigger_co2_cal' | 'trigger_pms_reset' | 'set_module';
  timestamp: string;
  params?: Record<string, any>;
}

export interface DeviceConfig {
  device_id: string;
  sensor_interval: number;
  status_interval: number;
  lass_upload: boolean;
  mqtt_upload: boolean;
  updated_at?: string;
}

export interface Device {
  device_id: string;
  display_name?: string;
  app: string;
  version?: string;
  mcu_firmware?: string;
  online: boolean;
  last_seen?: string;
  network?: NetworkInfo;
  modules?: Record<string, boolean>;
  uptime_sec?: number;
  created_at?: string;
  updated_at?: string;
}
