-- Applied automatically (idempotently) by app/src/settings/store.ts at startup.
-- Site-wide settings as key -> JSON value; the accepted keys are whitelisted in code.
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
