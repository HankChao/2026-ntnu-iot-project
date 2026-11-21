// Site-wide settings kept on the server (/api/v1/settings), shared by every browser.
// The last value seen is cached in localStorage only so the first paint matches; the server
// value replaces it as soon as it arrives. Saving goes to the server first and only changes
// the local state once the server has stored it.
import { reactive, ref } from 'vue';

export interface Settings { demo_data: boolean }

const CACHE_KEY = 'clothes-settings-cache';
// The demo switch used to be stored under this key; read it once so nobody's choice flips on upgrade.
const OLD_DEMO_KEY = 'clothes-demo-enabled';

function cached(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (saved && typeof saved.demo_data === 'boolean') return saved;
    return { demo_data: localStorage.getItem(OLD_DEMO_KEY) !== 'false' };
  } catch { return { demo_data: true }; }
}

const settings = reactive<Settings>(cached());
const settingsLoaded = ref(false);  // true once the server answered
const settingsError = ref('');

function apply(value: Settings) {
  Object.assign(settings, value);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch { /* cache only */ }
}

async function call(method: 'GET' | 'PATCH', body?: Partial<Settings>): Promise<Settings> {
  const response = await fetch('/api/v1/settings', {
    method, cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) throw new Error(data?.error || `HTTP ${response.status}`);
  return data.settings;
}

let loading: Promise<Settings | null> | null = null;
export function loadSettings(): Promise<Settings | null> {
  loading ??= call('GET')
    .then((value) => { apply(value); settingsLoaded.value = true; settingsError.value = ''; return value; })
    .catch(() => { settingsError.value = '無法從伺服器讀取設定，目前顯示上次的設定。'; return null; })
    .finally(() => { loading = null; });
  return loading;
}

// Throws (with the server's message) when the setting was not stored.
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const value = await call('PATCH', patch);
  apply(value);
  settingsLoaded.value = true; settingsError.value = '';
  return value;
}

export function useSettings() {
  return { settings, settingsLoaded, settingsError, loadSettings, saveSettings };
}
