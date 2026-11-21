// Drying-time prediction, first version: the garment's own past drying times, or a per-material
// default when it has never been dried to the end. Same rule as the front-end demo.
export const STYLES = ['tee', 'shirt', 'tank', 'pants', 'towel'] as const;
export const MATERIALS = ['棉', '聚酯纖維', '牛仔布', '羊毛', '麻', '毛巾布'] as const;
export type Style = typeof STYLES[number];
export type Material = typeof MATERIALS[number];

// Keep in step with web/src/constants/garments.ts.
export const BASE_MINUTES: Record<Material, number> = {
  '棉': 285, '聚酯纖維': 110, '牛仔布': 450, '羊毛': 360, '麻': 330, '毛巾布': 330,
};

// pastMinutes: actual_min of this garment's sessions that ended as 'dry'.
export function predictMinutes(material: Material, pastMinutes: number[]): number {
  if (!pastMinutes.length) return BASE_MINUTES[material];
  // At least 1 minute: a session ended as dry right after starting would otherwise predict 0.
  return Math.max(1, Math.round(pastMinutes.reduce((sum, value) => sum + value, 0) / pastMinutes.length));
}

// Swapping the garment mid-session keeps the start time; the new prediction never ends before now.
export function swappedPrediction(elapsedMin: number, predicted: number): number {
  return Math.max(Math.round(elapsedMin) + 10, predicted);
}
