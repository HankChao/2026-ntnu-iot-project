-- Applied automatically (idempotently) by app/src/clothes/drying.ts at startup.
-- Also usable manually when upgrading an existing PostgreSQL volume.
CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
    airbox_id TEXT REFERENCES devices(device_id) ON DELETE SET NULL,
    predict_method TEXT NOT NULL DEFAULT 'hx711_raw' CHECK (predict_method IN ('hx711_raw', 'ads1115_raw', 'touch_raw')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Only one physical clip for now.
INSERT INTO clips (id, name) VALUES ('c1', '衣夾-01') ON CONFLICT (id) DO NOTHING;
