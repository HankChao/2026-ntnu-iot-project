// 匯入 CODiS（氣候觀測資料查詢服務）下載的逐時 CSV 到 weather_obs，補 poller 開始之前的戶外觀測。
// 用法（在 repository 根目錄）：
//   docker compose exec -T app bun scripts/import-codis.ts --station 466920 --name 臺北 < 466920-2026-11.csv
//   檔案的時間欄只有 1～24 時（單日檔）時，加 --date 2026-11-14
//   先看解析結果、不寫入：加 --dry-run
// --name 要和 CWA_STATION 一樣（或 CWA_STATION 填站號），CSV 匯出才會配到這些資料。
// 同一站同一時間已經有的資料會略過，重複匯入沒關係。
import { dbClient } from '../src/db/client';
import { parseCodisCsv } from '../src/weather/codis';
import { ensureWeatherSchema, insertWeatherRows } from '../src/weather/store';

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const station = { id: option('station') ?? '', name: option('name') ?? '' };
const date = option('date');
const dryRun = args.includes('--dry-run');
const WITH_VALUE = new Set(['--station', '--name', '--date']);
const file = args.find((arg, index) => !arg.startsWith('--') && !WITH_VALUE.has(args[index - 1] ?? ''));

if (!/^[0-9A-Z]{4,8}$/.test(station.id) || !station.name) {
  console.error('需要 --station <站號，例如 466920> 和 --name <站名，例如 臺北>');
  process.exit(2);
}
if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error('--date 格式為 YYYY-MM-DD');
  process.exit(2);
}

const text = file ? await Bun.file(file).text() : await Bun.stdin.text();
const { columns, rows, skipped } = parseCodisCsv(text, station, date);
console.log('欄位對應：', Object.entries(columns).map(([field, index]) => `${field}←第${index! + 1}欄`).join('、'));
if (!rows.length) {
  console.error(`沒有可匯入的資料列（略過 ${skipped} 列）。時間欄若只有 1～24，請加 --date`);
  process.exit(1);
}
const at = (row: (typeof rows)[number]) => new Date(row.observed_at).toISOString();
console.log(`解析 ${rows.length} 列（略過 ${skipped} 列），${at(rows[0]!)} ～ ${at(rows[rows.length - 1]!)}（UTC）`);
console.log('第一列：', rows[0]);
if (dryRun) process.exit(0);

if (!await dbClient.connect()) process.exit(1);
await ensureWeatherSchema();
const inserted = await insertWeatherRows(rows);
console.log(`寫入 ${inserted} 筆新資料（${rows.length - inserted} 筆已經有了）`);
await dbClient.close();
