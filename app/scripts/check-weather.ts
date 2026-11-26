// 用真的 CWA_API_KEY 抓一次，印出設定的測站解析後的值和原始欄位，確認解析路徑沒有落空。
// 用法：docker compose exec -T app bun scripts/check-weather.ts
// 不寫資料庫。值是 null 但原始欄位有數字 → 解析路徑要改（src/weather/cwa.ts）。
import {
  configuredStations, fetchDataset, matchesStation, OBSERVATION_DATASETS, parseObservationStations, parseRainfallStations, RAIN_DATASET,
} from '../src/weather/cwa';

const { weather, rain } = configuredStations();
let problems = 0;
for (const dataset of OBSERVATION_DATASETS) {
  const json = await fetchDataset(dataset).catch((error) => { console.error(`${dataset}: ${error.message}`); problems += 1; return null; });
  if (!json) continue;
  const station = parseObservationStations(json, dataset).find((item) => matchesStation(item, weather));
  if (!station) { console.log(`${dataset}: 沒有測站「${weather}」`); continue; }
  const { raw, ...parsed } = station;
  console.log(`\n=== ${dataset} ${station.name}（${station.id}）===`);
  console.log('解析結果：', parsed);
  console.log('原始 WeatherElement：', JSON.stringify((raw as any)?.WeatherElement, null, 1));
}
const json = await fetchDataset(RAIN_DATASET).catch((error) => { console.error(`${RAIN_DATASET}: ${error.message}`); problems += 1; return null; });
if (json) {
  const gauge = parseRainfallStations(json).find((item) => matchesStation(item, rain));
  if (!gauge) console.log(`${RAIN_DATASET}: 沒有測站「${rain}」，請設定 CWA_RAIN_STATION`);
  else {
    const { raw, ...parsed } = gauge;
    console.log(`\n=== ${RAIN_DATASET} ${gauge.name}（${gauge.id}）===`);
    console.log('解析結果：', parsed);
    console.log('原始 RainfallElement：', JSON.stringify((raw as any)?.RainfallElement, null, 1));
  }
}
process.exit(problems ? 1 : 0);
