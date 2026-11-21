// Site-wide settings shared by every browser, kept as key → JSON value.
// Only keys listed in SETTING_DEFS are accepted. Per-clip settings live in `clips`, not here.
import { dbClient } from '../db/client';

type Def = { default: unknown; valid: (value: unknown) => boolean };
export const SETTING_DEFS = {
  // Matches the front end's original default: demo data shown until turned off.
  demo_data: { default: true, valid: (value: unknown) => typeof value === 'boolean' },
} satisfies Record<string, Def>;
export type SettingKey = keyof typeof SETTING_DEFS;
export type Settings = { demo_data: boolean };

const settingsState = { schemaReady: false };

export class SettingsError extends Error {}

export async function ensureSettingsSchema(): Promise<void> {
  if (!dbClient.isConnected()) throw new Error('Database unavailable');
  await dbClient.sql`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  settingsState.schemaReady = true;
}

function database() {
  if (!dbClient.isConnected() || !settingsState.schemaReady) throw new Error('Settings database unavailable');
  return dbClient.sql;
}

// Pure: checks a PATCH body against the whitelist.
export function parseSettingsPatch(body: unknown): Partial<Settings> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new SettingsError('內容必須是 JSON 物件');
  const entries = Object.entries(body);
  if (!entries.length) throw new SettingsError('沒有要更新的設定');
  for (const [key, value] of entries) {
    const def = (SETTING_DEFS as Record<string, Def>)[key];
    if (!def) throw new SettingsError(`不支援的設定：${key}`);
    if (!def.valid(value)) throw new SettingsError(`設定 ${key} 格式錯誤`);
  }
  return body as Partial<Settings>;
}

export async function getSettings(): Promise<Settings> {
  const rows = await database()`SELECT key, value::text AS value FROM app_settings`;
  const settings: Record<string, unknown> = Object.fromEntries(Object.entries(SETTING_DEFS).map(([key, def]) => [key, def.default]));
  for (const row of rows) {
    const def = (SETTING_DEFS as Record<string, Def>)[row.key];
    if (!def) continue;  // a key removed from the whitelist
    const value = JSON.parse(row.value);
    if (def.valid(value)) settings[row.key] = value;
  }
  return settings as Settings;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const sql = database();
  await sql.begin(async (tx: any) => {
    for (const [key, value] of Object.entries(patch)) {
      // Bound as text and cast in SQL: a parameter typed jsonb would be encoded again as a JSON string.
      await tx`
        INSERT INTO app_settings (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}::text::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    }
  });
  return getSettings();
}
