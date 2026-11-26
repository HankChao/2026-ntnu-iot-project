-- Applied automatically by app/src/clothes/weight.ts (ensureWeightSchema) at startup.
-- The HX711 calibration of a clip, from `since` on, used to show the weight in grams:
--   grams = (hx711_raw - tare_count) / counts_per_gram
-- Readings stay raw counts in clothes_raw.
CREATE TABLE IF NOT EXISTS clip_scales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id UUID NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  since TIMESTAMPTZ NOT NULL,
  tare_count INTEGER NOT NULL CHECK (tare_count BETWEEN -8388608 AND 8388607),
  counts_per_gram DOUBLE PRECISION NOT NULL CHECK (abs(counts_per_gram) BETWEEN 1 AND 100000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clip_id, since)
);
