// /api/v1/settings: site-wide settings (currently the demo data switch).
import { Hono } from 'hono';
import { SettingsError, getSettings, parseSettingsPatch, updateSettings } from '../settings/store';

export const settingsRoute = new Hono();

settingsRoute.get('/', async (c) => {
  try {
    return c.json({ success: true, settings: await getSettings() });
  } catch {
    return c.json({ success: false, error: '資料庫無法讀取，設定暫時不可用' }, 503);
  }
});

settingsRoute.patch('/', async (c) => {
  let patch;
  try { patch = parseSettingsPatch(await c.req.json()); } catch (error) {
    return c.json({ success: false, error: error instanceof SettingsError ? error.message : '內容必須是 JSON' }, 400);
  }
  try {
    return c.json({ success: true, settings: await updateSettings(patch) });
  } catch {
    return c.json({ success: false, error: '資料庫無法寫入，設定沒有儲存' }, 503);
  }
});
