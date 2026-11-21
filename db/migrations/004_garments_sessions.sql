-- Applied automatically (idempotently) by app/src/clothes/drying.ts at startup.
-- Also usable manually when upgrading an existing PostgreSQL volume.
CREATE TABLE IF NOT EXISTS garments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
    style TEXT NOT NULL CHECK (style IN ('tee', 'shirt', 'tank', 'pants', 'towel')),
    color TEXT NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    material TEXT NOT NULL CHECK (material IN ('棉', '聚酯纖維', '牛仔布', '羊毛', '麻', '毛巾布')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ended_at NULL = still drying; otherwise a record. 'cancel' deletes the row.
CREATE TABLE IF NOT EXISTS drying_sessions (
    id TEXT PRIMARY KEY,
    clip_id TEXT NOT NULL REFERENCES clips(id),
    garment_id TEXT NOT NULL REFERENCES garments(id) ON DELETE RESTRICT,
    started_at TIMESTAMPTZ NOT NULL,
    predicted_min INTEGER NOT NULL CHECK (predicted_min > 0),
    ended_at TIMESTAMPTZ,
    outcome TEXT CHECK (outcome IN ('dry', 'early')),
    actual_min INTEGER CHECK (actual_min >= 0),
    CHECK ((ended_at IS NULL) = (outcome IS NULL)),
    CHECK (CASE WHEN outcome = 'dry' THEN actual_min IS NOT NULL ELSE actual_min IS NULL END),
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS drying_sessions_active_clip_idx ON drying_sessions (clip_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS drying_sessions_active_garment_idx ON drying_sessions (garment_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS drying_sessions_garment_idx ON drying_sessions (garment_id, started_at DESC);
CREATE INDEX IF NOT EXISTS drying_sessions_started_idx ON drying_sessions (started_at DESC);
