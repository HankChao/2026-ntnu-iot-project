-- Applied automatically (idempotently) by app/src/weather/store.ts at startup.
-- Also usable manually when upgrading an existing PostgreSQL volume.
-- CWA observations of the configured stations (CWA_STATION, CWA_RAIN_STATION), stored every 5 minutes
-- by app/src/weather/poller.ts, plus hourly CODiS rows imported with app/scripts/import-codis.ts.
-- observed_at is CWA's observation time; rain_day_mm is the total since 00:00 Taipei time.
CREATE TABLE IF NOT EXISTS weather_obs (
    id BIGSERIAL PRIMARY KEY,
    dataset TEXT NOT NULL,                 -- O-A0001-001 / O-A0002-001 / O-A0003-001 / CODiS
    station_id TEXT NOT NULL,
    station_name TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    temp DOUBLE PRECISION,                 -- °C
    hum DOUBLE PRECISION,                  -- %RH
    wind_speed DOUBLE PRECISION,           -- m/s
    wind_dir DOUBLE PRECISION,             -- degrees, where the wind comes from
    gust DOUBLE PRECISION,                 -- m/s
    pressure DOUBLE PRECISION,             -- hPa (station level)
    rain_day_mm DOUBLE PRECISION,          -- since 00:00 today
    rain_10min_mm DOUBLE PRECISION,        -- O-A0002 only
    rain_1h_mm DOUBLE PRECISION,           -- O-A0002, and the hour's rain in CODiS
    sunshine_h DOUBLE PRECISION,           -- O-A0003 SunshineDuration as reported
    sunshine_1h_h DOUBLE PRECISION,        -- CODiS: sunshine within the hour
    radiation_1h_mj DOUBLE PRECISION,      -- CODiS: global radiation within the hour, MJ/m²
    uv DOUBLE PRECISION,
    weather TEXT,
    raw JSONB,                             -- the whole station object from the API (null for CODiS)
    UNIQUE (dataset, station_id, observed_at)
);
CREATE INDEX IF NOT EXISTS weather_obs_station_time_idx ON weather_obs (station_id, observed_at);
