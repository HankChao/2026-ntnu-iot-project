-- Applied automatically (idempotently) by app/src/clothes/drying.ts at startup.
-- Demo data lives in the same tables with is_demo = true; lists leave it out unless asked.
-- The composite keys keep a session, its clip and its garment all real or all demo.
-- The demo rows themselves are written by `make seed` (app/scripts/seed-demo.ts), not here.
ALTER TABLE clips ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE garments ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE drying_sessions ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clips_id_is_demo_key') THEN
    ALTER TABLE clips ADD CONSTRAINT clips_id_is_demo_key UNIQUE (id, is_demo);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'garments_id_is_demo_key') THEN
    ALTER TABLE garments ADD CONSTRAINT garments_id_is_demo_key UNIQUE (id, is_demo);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drying_sessions_clip_is_demo_fkey') THEN
    ALTER TABLE drying_sessions ADD CONSTRAINT drying_sessions_clip_is_demo_fkey
      FOREIGN KEY (clip_id, is_demo) REFERENCES clips (id, is_demo);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drying_sessions_garment_is_demo_fkey') THEN
    ALTER TABLE drying_sessions ADD CONSTRAINT drying_sessions_garment_is_demo_fkey
      FOREIGN KEY (garment_id, is_demo) REFERENCES garments (id, is_demo);
  END IF;
END $$;
