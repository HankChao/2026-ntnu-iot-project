// Weight in grams from the HX711 reading. Same formula as the server (app/src/clothes/weight.ts);
// keep the two in step.
//   grams = (count − tare_count) / counts_per_gram
// tare_count: the reading with the hook empty (空勾讀值); counts_per_gram: how much one gram adds.
export interface Scale { id?: string; since: string; tare_count: number; counts_per_gram: number }

export function countToGram(count: number | null | undefined, s: Scale): number | null {
  if (count == null) return null;
  return (count - s.tare_count) / s.counts_per_gram;
}

// The setting in force at `time`; scales come sorted oldest first. null before the first one.
export function scaleAt(scales: Scale[] | null | undefined, time: number): Scale | null {
  let found: Scale | null = null;
  for (const s of scales ?? []) {
    if (new Date(s.since).getTime() <= time) found = s; else break;
  }
  return found;
}

// One decimal below 1 kg, then kg: "62.4 g", "1.25 kg". A tiny negative around an empty hook shows as 0.
export function formatGram(gram: number): string {
  const g = Math.abs(gram) < 0.05 ? 0 : gram;
  return Math.abs(g) >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g.toFixed(1)} g`;
}

// A reading as text with the setting in force at its time, or null when there is no reading or no
// calibration yet (then show the raw count instead).
export function gramText(count: number | null | undefined, time: number, scales: Scale[] | null | undefined): string | null {
  const s = scaleAt(scales, time);
  if (!s || count == null) return null;
  return formatGram(countToGram(count, s)!);
}
