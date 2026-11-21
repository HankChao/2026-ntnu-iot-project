// `make seed`: writes the demo data (clips 衣夾-02～08, garments, sessions, records; all is_demo = true)
// once. If demo clips already exist it does nothing; rebuild them with 重設示範資料 instead.
import { dbClient } from '../src/db/client';
import { ensureClothesSchema } from '../src/clothes/store';
import { ensureDryingSchema } from '../src/clothes/drying';
import { seedDemoData } from '../src/clothes/demo';

if (!(await dbClient.connect(3, 1000))) {
  console.error('無法連線到資料庫，示範資料沒有寫入。');
  process.exit(1);
}
try {
  await ensureClothesSchema();
  await ensureDryingSchema();
  if (await seedDemoData()) console.log('已寫入示範資料：衣夾-02～08、8 件衣物、4 筆晾衣中、14 筆紀錄（is_demo = true）。');
  else console.log('示範資料已經存在，略過。要重來請到晾衣紀錄頁按「重設示範資料」。');
} catch (error) {
  console.error('示範資料沒有寫入：', (error as Error).message);
  process.exitCode = 1;
} finally {
  await dbClient.close();
}
