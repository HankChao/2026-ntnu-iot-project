-- ==============================================================================
-- MAPS 6.0 Central Server Database Schema
-- ==============================================================================

-- 1. Devices Table
CREATE TABLE IF NOT EXISTS devices (
    device_id    TEXT PRIMARY KEY,
    display_name TEXT,
    app          TEXT NOT NULL DEFAULT 'MAPS6',
    version      TEXT,
    mcu_firmware TEXT,
    online       BOOLEAN NOT NULL DEFAULT false,
    last_seen    TIMESTAMPTZ,
    network      JSONB DEFAULT '{}',
    modules      JSONB DEFAULT '{}',
    uptime_sec   INTEGER DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Sensor Time-series Table
CREATE TABLE IF NOT EXISTS sensor_data (
    id             BIGSERIAL PRIMARY KEY,
    device_id      TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    timestamp      TIMESTAMPTZ NOT NULL,
    temp           DOUBLE PRECISION,
    humi           DOUBLE PRECISION,
    cpu_temp       DOUBLE PRECISION,
    co2            INTEGER,
    ave_co2        INTEGER,
    tvoc           INTEGER,
    eco2           INTEGER,
    s_h2           INTEGER,
    s_ethanol      INTEGER,
    baseline_tvoc  INTEGER,
    baseline_eco2  INTEGER,
    illuminance    INTEGER,
    color_temp     INTEGER,
    ch_r           INTEGER,
    ch_g           INTEGER,
    ch_b           INTEGER,
    ch_c           INTEGER,
    pm1_ae         INTEGER,
    pm25_ae        INTEGER,
    pm10_ae        INTEGER,
    pm1_sp         INTEGER,
    pm25_sp        INTEGER,
    pm10_sp        INTEGER,
    
    UNIQUE (device_id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_sensor_data_device_time 
    ON sensor_data (device_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_sensor_data_timestamp 
    ON sensor_data (timestamp);

-- 3. Users Table (Simple admin authentication)
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default admin user (username: admin, password: adminpassword)
-- Password hash generated with bcrypt or sha256. For simplicity in skeleton:
INSERT INTO users (username, password_hash)
VALUES ('admin', 'adminpassword')
ON CONFLICT (username) DO NOTHING;

-- 4. Device Configurations Table
CREATE TABLE IF NOT EXISTS device_configs (
    device_id        TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
    sensor_interval  INTEGER NOT NULL DEFAULT 60,
    status_interval  INTEGER NOT NULL DEFAULT 300,
    lass_upload      BOOLEAN NOT NULL DEFAULT true,
    mqtt_upload      BOOLEAN NOT NULL DEFAULT true,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
