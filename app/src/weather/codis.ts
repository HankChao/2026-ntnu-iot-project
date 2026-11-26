import type { WeatherField, WeatherRow } from './store';

// ==============================================================================
// CODiS（氣候觀測資料查詢服務）下載的「逐時」CSV → weather_obs（dataset = 'CODiS'）。
// 開放資料 API 只給最新一筆；poller 開始之前的晾衣（例如 11/14～11/20）只能用這個補。
//
// 標題列可能是中文（觀測時間、氣溫(℃)…），也可能下一列是英文代碼（ObsTime、Temperature…），兩種都認。
// 時間欄可以是完整日期時間（2026-11-14 01:00），也可以是當天的 1～24 時（要另外給 date）。
// 逐時資料的「第 H 時」代表 H-1 到 H 時這一小時，所以存成 H 時整（24 時 = 隔天 0 時）。
// 降水量、日照時數、全天空日射量都是這一小時的量，存到 rain_1h_mm、sunshine_1h_h、radiation_1h_mj。
// ==============================================================================

type Column = WeatherField | 'time';

// Normalized header (no spaces, no unit in parentheses) → field. Chinese titles and English codes.
const HEADER_FIELDS: Record<string, Column> = {
  觀測時間: 'time', obstime: 'time', 時間: 'time',
  測站氣壓: 'pressure', stnpres: 'pressure',
  氣溫: 'temp', temperature: 'temp',
  相對溼度: 'hum', 相對濕度: 'hum', rh: 'hum',
  風速: 'wind_speed', ws: 'wind_speed',
  風向: 'wind_dir', wd: 'wind_dir',
  最大瞬間風: 'gust', 最大瞬間風速: 'gust', wsgust: 'gust',
  降水量: 'rain_1h_mm', precp: 'rain_1h_mm',
  日照時數: 'sunshine_1h_h', sunshine: 'sunshine_1h_h',
  全天空日射量: 'radiation_1h_mj', globlrad: 'radiation_1h_mj',
  紫外線指數: 'uv', uvi: 'uv',
};
// Amounts where CODiS writes "T" (trace, < 0.1) — stored as 0. Everything else non-numeric is null.
const TRACE_IS_ZERO = new Set<WeatherField>(['rain_1h_mm', 'sunshine_1h_h', 'radiation_1h_mj']);
// Values that cannot be negative; a negative one is a CODiS missing-value code.
const NON_NEGATIVE = new Set<WeatherField>(['hum', 'wind_speed', 'wind_dir', 'gust', 'pressure', 'rain_1h_mm', 'sunshine_1h_h', 'radiation_1h_mj', 'uv']);

export const normalizeHeader = (cell: string) =>
  cell.replace(/^﻿/, '').replace(/[（(].*?[)）]/g, '').replace(/\s+/g, '').toLowerCase();

/** Minimal CSV splitter (quoted cells, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
}

export function codisValue(cell: string | undefined, field: WeatherField): number | null {
  const value = (cell ?? '').trim();
  if (value.toUpperCase() === 'T') return TRACE_IS_ZERO.has(field) ? 0 : null;
  if (!/^-?\d+(\.\d+)?$/.test(value)) return null; // '', X, /, ..., &, V (variable wind) …
  const number = Number(value);
  if (number <= -90 || (NON_NEGATIVE.has(field) && number < 0)) return null;
  return number;
}

/** Taipei wall-clock time → Date. Hour 24 rolls over to the next day. */
function taipei(year: number, month: number, day: number, hour: number, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
}

export function codisTime(cell: string, date?: string): Date | null {
  const value = cell.trim();
  const full = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2})(?::(\d{2}))?/.exec(value);
  if (full) return taipei(+full[1]!, +full[2]!, +full[3]!, +full[4]!, +(full[5] ?? 0));
  if (/^\d{1,2}$/.test(value) && date) {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const hour = Number(value);
    if (day && hour >= 1 && hour <= 24) return taipei(+day[1]!, +day[2]!, +day[3]!, hour);
  }
  return null;
}

export type CodisResult = { columns: Partial<Record<Column, number>>; rows: WeatherRow[]; skipped: number };

export function parseCodisCsv(text: string, station: { id: string; name: string }, date?: string): CodisResult {
  const table = parseCsv(text);
  const headerIndex = table.findIndex((cells) => cells.some((cell) => HEADER_FIELDS[normalizeHeader(cell)] === 'time'));
  if (headerIndex < 0) throw new Error('找不到標題列（要有「觀測時間」或「ObsTime」欄）');

  // Map columns from the header row, and from an English code row right below it if there is one.
  const columns: Partial<Record<Column, number>> = {};
  let firstData = headerIndex + 1;
  const headerRows = [table[headerIndex]!];
  const below = table[headerIndex + 1];
  if (below && below.some((cell) => normalizeHeader(cell) === 'obstime')) { headerRows.push(below); firstData += 1; }
  for (const cells of headerRows) {
    cells.forEach((cell, index) => {
      const field = HEADER_FIELDS[normalizeHeader(cell)];
      if (field && columns[field] === undefined) columns[field] = index;
    });
  }
  if (columns.temp === undefined) throw new Error('找不到氣溫欄（氣溫／Temperature），請確認是逐時資料');

  const rows: WeatherRow[] = [];
  let skipped = 0;
  for (const cells of table.slice(firstData)) {
    const time = codisTime(cells[columns.time!] ?? '', date);
    if (!time) { skipped += 1; continue; }
    const row: WeatherRow = { dataset: 'CODiS', station_id: station.id, station_name: station.name, observed_at: time };
    for (const [field, index] of Object.entries(columns) as Array<[Column, number]>) {
      if (field !== 'time') row[field] = codisValue(cells[index], field);
    }
    rows.push(row);
  }
  return { columns, rows, skipped };
}
