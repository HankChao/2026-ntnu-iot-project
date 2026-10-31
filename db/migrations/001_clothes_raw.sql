-- Applied automatically (idempotently) by app/src/clothes/store.ts at startup.
-- Also usable manually when upgrading an existing PostgreSQL volume.
CREATE TABLE IF NOT EXISTS clothes_raw (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    hx711_raw INTEGER CHECK (hx711_raw BETWEEN -8388608 AND 8388607),
    ads1115_raw INTEGER CHECK (ads1115_raw BETWEEN -32768 AND 32767),
    touch_raw INTEGER CHECK (touch_raw BETWEEN 0 AND 4194303)
);
CREATE INDEX IF NOT EXISTS clothes_raw_timestamp_idx ON clothes_raw (timestamp DESC, id DESC);
