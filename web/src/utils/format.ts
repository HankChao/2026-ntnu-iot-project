// Shared time / number formatting. The UI always shows Taipei time.
export const TAIPEI_MS = 8 * 60 * 60000;
export const DAY_MS = 24 * 60 * 60000;

export const formatRaw = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('en-US');
export const formatAir = (value: number | null | undefined, digits = 1) => value == null ? '—' : value.toFixed(digits);
export const formatTime = (value: string | number | Date) =>
  new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });

// HH:MM in Taipei time.
export const clock = (value: number | Date) =>
  new Date(value).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit' });

// MM/DD in Taipei time.
export const monthDay = (value: number | Date) => {
  const d = new Date(new Date(value).getTime() + TAIPEI_MS);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
};

// Day number in Taipei time, used to say 今天 / 昨天.
const taipeiDay = (value: number) => Math.floor((value + TAIPEI_MS) / DAY_MS);
export const dayLabel = (value: number, now = Date.now()) => {
  const diff = taipeiDay(now) - taipeiDay(value);
  return diff === 0 ? '今天' : diff === 1 ? '昨天' : monthDay(value);
};

// "3 小時 25 分" / "40 分"
export function formatDuration(hours: number) {
  const min = Math.max(0, Math.round(hours * 60)), h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} 小時 ${String(m).padStart(2, '0')} 分` : `${m} 分`;
}
export const minutesText = (minutes: number) => formatDuration(minutes / 60);

// Compact form used in tables: "4 時 40 分"
export function shortDuration(minutes: number) {
  const min = Math.max(0, Math.round(minutes)), h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} 時 ${String(m).padStart(2, '0')} 分` : `${m} 分`;
}

// "1 秒前" / "5 分鐘前" / "3 小時前" / "2 天前"
export function agoText(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒前`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} 小時前`;
  return `${Math.round(h / 24)} 天前`;
}

// <input type="datetime-local"> has no zone; the page shows Taipei time, so read/write it as UTC+8.
export const toTaipeiInput = (date: Date, seconds = false) =>
  new Date(date.getTime() + TAIPEI_MS).toISOString().slice(0, seconds ? 19 : 16);
// Browsers give "YYYY-MM-DDTHH:mm" or, with step="1", "YYYY-MM-DDTHH:mm:ss".
export const fromTaipeiInput = (value: string) => new Date(`${value.length === 16 ? `${value}:00` : value}+08:00`);
