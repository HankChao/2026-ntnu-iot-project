import { parseClothesRaw } from './validation';
import { clothesState, insertClothesRaw } from './store';

let pending = 0;
export async function ingestClothesRaw(message: string, receivedAt: Date, retained = false): Promise<void> {
  // A retained message may be old; arrival time must not make it appear newly measured.
  if (retained) throw new Error('Retained clothes telemetry is not accepted');
  const raw = parseClothesRaw(message);
  if (pending >= 16) throw new Error('Clothes ingestion busy; record dropped');
  pending++;
  try {
    await insertClothesRaw(raw, receivedAt);
    clothesState.lastError = null;
  } catch (error) {
    clothesState.lastError = 'Database write failed';
    throw error;
  } finally {
    pending--;
  }
}
