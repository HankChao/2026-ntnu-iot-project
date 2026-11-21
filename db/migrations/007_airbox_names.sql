-- Applied automatically by app/src/clothes/store.ts at startup.
-- Air box names must not repeat (case and surrounding spaces ignored). Air boxes keep their MAC as id.
-- If existing names already repeat this fails; rename those boxes first (renaming checks in code too).
CREATE UNIQUE INDEX IF NOT EXISTS devices_display_name_key ON devices (lower(btrim(display_name))) WHERE display_name IS NOT NULL;
