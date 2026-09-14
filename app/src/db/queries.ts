// ==============================================================================
// Database Query Operations using Native Bun SQL
// ==============================================================================

import { dbClient } from './client';
import type { Device, DeviceConfig, SensorData, SensorPayload, StatusPayload } from '../types';

// In-memory fallback stores (for unit tests / decoupled runs)
const memoryDevices = new Map<string, Device>();
const memoryConfigs = new Map<string, DeviceConfig>();
const memorySensors = new Map<string, Array<{ timestamp: string; sensor: SensorData }>>();

export async function upsertDeviceStatus(status: StatusPayload): Promise<void> {
  if (!dbClient.isConnected()) {
    const existing = memoryDevices.get(status.device_id) || {
      device_id: status.device_id,
      display_name: status.device_id,
      app: status.app || 'MAPS6',
      online: true,
    };
    memoryDevices.set(status.device_id, {
      ...existing,
      version: status.version,
      uptime_sec: status.uptime_sec,
      network: status.network,
      mcu_firmware: status.mcu_firmware,
      modules: status.modules,
      last_seen: status.timestamp,
      updated_at: new Date().toISOString(),
    });
    return;
  }

  const sql = dbClient.sql;
  const networkJson = JSON.stringify(status.network || {});
  const modulesJson = JSON.stringify(status.modules || {});
  const mcuFw = status.mcu_firmware || null;
  const uptime = status.uptime_sec || 0;

  await sql`
    INSERT INTO devices (device_id, app, version, mcu_firmware, online, last_seen, network, modules, uptime_sec, updated_at)
    VALUES (${status.device_id}, ${status.app || 'MAPS6'}, ${status.version}, ${mcuFw}, true, ${status.timestamp}, ${networkJson}::jsonb, ${modulesJson}::jsonb, ${uptime}, NOW())
    ON CONFLICT (device_id) DO UPDATE SET
      version = EXCLUDED.version,
      mcu_firmware = EXCLUDED.mcu_firmware,
      online = true,
      last_seen = EXCLUDED.last_seen,
      network = EXCLUDED.network,
      modules = EXCLUDED.modules,
      uptime_sec = EXCLUDED.uptime_sec,
      updated_at = NOW();
  `;

  // Auto ensure default device_configs
  await sql`
    INSERT INTO device_configs (device_id) VALUES (${status.device_id}) ON CONFLICT (device_id) DO NOTHING;
  `;
}

export async function setDeviceOnline(deviceId: string, online: boolean, timestamp: string): Promise<void> {
  if (!dbClient.isConnected()) {
    const dev = memoryDevices.get(deviceId);
    if (dev) {
      dev.online = online;
      dev.last_seen = timestamp;
      dev.updated_at = new Date().toISOString();
    } else {
      memoryDevices.set(deviceId, {
        device_id: deviceId,
        display_name: deviceId,
        app: 'MAPS6',
        online,
        last_seen: timestamp,
      });
    }
    return;
  }

  const sql = dbClient.sql;
  await sql`
    INSERT INTO devices (device_id, online, last_seen, updated_at)
    VALUES (${deviceId}, ${online}, ${timestamp}, NOW())
    ON CONFLICT (device_id) DO UPDATE SET
      online = EXCLUDED.online,
      last_seen = EXCLUDED.last_seen,
      updated_at = NOW();
  `;
}

export async function insertSensorData(payload: SensorPayload): Promise<void> {
  if (!dbClient.isConnected()) {
    if (!memorySensors.has(payload.device_id)) {
      memorySensors.set(payload.device_id, []);
    }
    memorySensors.get(payload.device_id)!.push({
      timestamp: payload.timestamp,
      sensor: payload.sensor,
    });
    return;
  }

  const sql = dbClient.sql;
  const s = payload.sensor || {};

  await sql`
    INSERT INTO sensor_data (
      device_id, timestamp, temp, humi, cpu_temp, co2, ave_co2, tvoc, eco2,
      s_h2, s_ethanol, baseline_tvoc, baseline_eco2, illuminance, color_temp,
      ch_r, ch_g, ch_b, ch_c, pm1_ae, pm25_ae, pm10_ae, pm1_sp, pm25_sp, pm10_sp
    ) VALUES (
      ${payload.device_id}, ${payload.timestamp},
      ${s.temp ?? null}, ${s.humi ?? null}, ${s.cpu_temp ?? null},
      ${s.co2 ?? null}, ${s.ave_co2 ?? null}, ${s.tvoc ?? null}, ${s.eco2 ?? null},
      ${s.s_h2 ?? null}, ${s.s_ethanol ?? null}, ${s.baseline_tvoc ?? null}, ${s.baseline_eco2 ?? null},
      ${s.illuminance ?? null}, ${s.color_temp ?? null}, ${s.ch_r ?? null}, ${s.ch_g ?? null},
      ${s.ch_b ?? null}, ${s.ch_c ?? null}, ${s.pm1_ae ?? null}, ${s.pm25_ae ?? null},
      ${s.pm10_ae ?? null}, ${s.pm1_sp ?? null}, ${s.pm25_sp ?? null}, ${s.pm10_sp ?? null}
    )
    ON CONFLICT (device_id, timestamp) DO NOTHING;
  `;
}

export async function batchInsertSensorData(deviceId: string, records: Array<{ timestamp: string; sensor: SensorData }>): Promise<number> {
  if (records.length === 0) return 0;

  if (!dbClient.isConnected()) {
    if (!memorySensors.has(deviceId)) {
      memorySensors.set(deviceId, []);
    }
    const store = memorySensors.get(deviceId)!;
    for (const r of records) {
      store.push(r);
    }
    return records.length;
  }

  const sql = dbClient.sql;

  // Ensure device exists
  await sql`
    INSERT INTO devices (device_id, app, online, last_seen, updated_at)
    VALUES (${deviceId}, 'MAPS6', false, ${records[records.length - 1].timestamp}, NOW())
    ON CONFLICT (device_id) DO NOTHING;
  `;

  let inserted = 0;
  for (const item of records) {
    const s = item.sensor || {};
    await sql`
      INSERT INTO sensor_data (
        device_id, timestamp, temp, humi, cpu_temp, co2, ave_co2, tvoc, eco2,
        s_h2, s_ethanol, baseline_tvoc, baseline_eco2, illuminance, color_temp,
        ch_r, ch_g, ch_b, ch_c, pm1_ae, pm25_ae, pm10_ae, pm1_sp, pm25_sp, pm10_sp
      ) VALUES (
        ${deviceId}, ${item.timestamp},
        ${s.temp ?? null}, ${s.humi ?? null}, ${s.cpu_temp ?? null},
        ${s.co2 ?? null}, ${s.ave_co2 ?? null}, ${s.tvoc ?? null}, ${s.eco2 ?? null},
        ${s.s_h2 ?? null}, ${s.s_ethanol ?? null}, ${s.baseline_tvoc ?? null}, ${s.baseline_eco2 ?? null},
        ${s.illuminance ?? null}, ${s.color_temp ?? null}, ${s.ch_r ?? null}, ${s.ch_g ?? null},
        ${s.ch_b ?? null}, ${s.ch_c ?? null}, ${s.pm1_ae ?? null}, ${s.pm25_ae ?? null},
        ${s.pm10_ae ?? null}, ${s.pm1_sp ?? null}, ${s.pm25_sp ?? null}, ${s.pm10_sp ?? null}
      )
      ON CONFLICT (device_id, timestamp) DO NOTHING;
    `;
    inserted++;
  }

  return inserted;
}

export async function getDevices(): Promise<Device[]> {
  if (!dbClient.isConnected()) {
    return Array.from(memoryDevices.values());
  }

  const sql = dbClient.sql;
  return await sql`SELECT * FROM devices ORDER BY device_id ASC`;
}

export async function getDevice(deviceId: string): Promise<Device | null> {
  if (!dbClient.isConnected()) {
    return memoryDevices.get(deviceId) || null;
  }

  const sql = dbClient.sql;
  const rows = await sql`SELECT * FROM devices WHERE device_id = ${deviceId}`;
  return rows[0] || null;
}

export async function updateDeviceName(deviceId: string, displayName: string): Promise<boolean> {
  if (!dbClient.isConnected()) {
    const dev = memoryDevices.get(deviceId);
    if (dev) {
      dev.display_name = displayName;
      return true;
    }
    return false;
  }

  const sql = dbClient.sql;
  const res = await sql`
    UPDATE devices SET display_name = ${displayName}, updated_at = NOW() WHERE device_id = ${deviceId}
  `;
  return res.length > 0 || true;
}

export async function getDeviceConfig(deviceId: string): Promise<DeviceConfig> {
  const defaultConfig: DeviceConfig = {
    device_id: deviceId,
    sensor_interval: 60,
    status_interval: 300,
    lass_upload: true,
    mqtt_upload: true,
  };

  if (!dbClient.isConnected()) {
    return memoryConfigs.get(deviceId) || defaultConfig;
  }

  const sql = dbClient.sql;
  const rows = await sql`SELECT * FROM device_configs WHERE device_id = ${deviceId}`;
  return rows[0] || defaultConfig;
}

export async function setDeviceConfig(deviceId: string, config: Partial<DeviceConfig>): Promise<DeviceConfig> {
  const current = await getDeviceConfig(deviceId);
  const updated: DeviceConfig = {
    ...current,
    ...config,
    device_id: deviceId,
    updated_at: new Date().toISOString(),
  };

  if (!dbClient.isConnected()) {
    memoryConfigs.set(deviceId, updated);
    return updated;
  }

  const sql = dbClient.sql;
  const rows = await sql`
    INSERT INTO device_configs (device_id, sensor_interval, status_interval, lass_upload, mqtt_upload, updated_at)
    VALUES (${deviceId}, ${updated.sensor_interval}, ${updated.status_interval}, ${updated.lass_upload}, ${updated.mqtt_upload}, NOW())
    ON CONFLICT (device_id) DO UPDATE SET
      sensor_interval = EXCLUDED.sensor_interval,
      status_interval = EXCLUDED.status_interval,
      lass_upload = EXCLUDED.lass_upload,
      mqtt_upload = EXCLUDED.mqtt_upload,
      updated_at = NOW()
    RETURNING *;
  `;
  return rows[0];
}

export async function getLatestSensor(deviceId: string): Promise<any | null> {
  if (!dbClient.isConnected()) {
    const list = memorySensors.get(deviceId);
    return list && list.length > 0 ? list[list.length - 1] : null;
  }

  const sql = dbClient.sql;
  const rows = await sql`
    SELECT * FROM sensor_data
    WHERE device_id = ${deviceId}
    ORDER BY timestamp DESC
    LIMIT 1;
  `;
  return rows[0] || null;
}

export async function getSensorHistory(deviceId: string, startDate?: string, endDate?: string, step: number = 1): Promise<any[]> {
  const safeStep = Math.max(1, step);

  if (!dbClient.isConnected()) {
    const list = memorySensors.get(deviceId) || [];
    return safeStep === 1 ? list : list.filter((_, idx) => idx % safeStep === 0);
  }

  const sql = dbClient.sql;
  const startTs = startDate ? (startDate.length === 10 ? `${startDate} 00:00:00` : startDate) : null;
  const endTs = endDate ? (endDate.length === 10 ? `${endDate} 23:59:59.999` : endDate) : null;

  if (safeStep === 1) {
    if (startTs && endTs) {
      return await sql`
        SELECT * FROM sensor_data
        WHERE device_id = ${deviceId}
          AND timestamp >= ${startTs}::timestamptz
          AND timestamp <= ${endTs}::timestamptz
        ORDER BY timestamp ASC;
      `;
    }
    return await sql`
      SELECT * FROM sensor_data
      WHERE device_id = ${deviceId}
      ORDER BY timestamp ASC;
    `;
  }

  // Stepped query
  if (startTs && endTs) {
    return await sql`
      WITH ranked AS (
        SELECT *, ROW_NUMBER() OVER (ORDER BY timestamp ASC) AS rnum
        FROM sensor_data
        WHERE device_id = ${deviceId}
          AND timestamp >= ${startTs}::timestamptz
          AND timestamp <= ${endTs}::timestamptz
      )
      SELECT * FROM ranked
      WHERE (rnum - 1) % ${safeStep} = 0
      ORDER BY timestamp ASC;
    `;
  }

  return await sql`
    WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (ORDER BY timestamp ASC) AS rnum
      FROM sensor_data
      WHERE device_id = ${deviceId}
    )
    SELECT * FROM ranked
    WHERE (rnum - 1) % ${safeStep} = 0
    ORDER BY timestamp ASC;
  `;
}

export async function getDeviceDates(deviceId: string): Promise<string[]> {
  if (!dbClient.isConnected()) {
    const list = memorySensors.get(deviceId) || [];
    const dates = new Set(list.map(item => item.timestamp.slice(0, 10)));
    return Array.from(dates).sort();
  }

  const sql = dbClient.sql;
  const rows = await sql`
    SELECT DISTINCT TO_CHAR(timestamp, 'YYYY-MM-DD') AS date
    FROM sensor_data
    WHERE device_id = ${deviceId}
    ORDER BY date ASC;
  `;
  return rows.map((r: any) => r.date);
}

export interface DateSummary {
  date: string;
  count: number;
  min_time: string;
  max_time: string;
}

export async function getDeviceDateSummary(deviceId: string): Promise<DateSummary[]> {
  if (!dbClient.isConnected()) {
    const list = memorySensors.get(deviceId) || [];
    const dateMap = new Map<string, { count: number; min_time: string; max_time: string }>();
    for (const item of list) {
      const d = item.timestamp.slice(0, 10);
      const curr = dateMap.get(d) || { count: 0, min_time: item.timestamp, max_time: item.timestamp };
      curr.count++;
      if (item.timestamp < curr.min_time) curr.min_time = item.timestamp;
      if (item.timestamp > curr.max_time) curr.max_time = item.timestamp;
      dateMap.set(d, curr);
    }
    return Array.from(dateMap.entries())
      .map(([date, val]) => ({ date, ...val }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  const sql = dbClient.sql;
  const rows = await sql`
    SELECT 
      TO_CHAR(timestamp AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD') AS date,
      COUNT(*)::int AS count,
      MIN(timestamp) AS min_time,
      MAX(timestamp) AS max_time
    FROM sensor_data
    WHERE device_id = ${deviceId}
    GROUP BY 1
    ORDER BY date ASC;
  `;
  return rows.map((r: any) => ({
    date: r.date,
    count: r.count,
    min_time: r.min_time,
    max_time: r.max_time,
  }));
}

export async function getSystemStats(): Promise<any> {
  if (!dbClient.isConnected()) {
    return {
      total_devices: memoryDevices.size,
      online_devices: Array.from(memoryDevices.values()).filter(d => d.online).length,
      total_records: Array.from(memorySensors.values()).reduce((sum, list) => sum + list.length, 0),
      database_connected: false,
    };
  }

  const sql = dbClient.sql;
  const [devStats] = await sql`
    SELECT 
      COUNT(*)::int AS total_devices,
      COUNT(*) FILTER (WHERE online = true)::int AS online_devices
    FROM devices;
  `;

  const [sensorStats] = await sql`
    SELECT 
      COUNT(*)::int AS total_records,
      MIN(timestamp) AS oldest_record,
      MAX(timestamp) AS newest_record
    FROM sensor_data;
  `;

  return {
    total_devices: devStats?.total_devices ?? 0,
    online_devices: devStats?.online_devices ?? 0,
    total_records: sensorStats?.total_records ?? 0,
    oldest_record: sensorStats?.oldest_record ?? null,
    newest_record: sensorStats?.newest_record ?? null,
    database_connected: true,
  };
}
