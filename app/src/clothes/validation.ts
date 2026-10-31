export const RAW_FIELDS = ['hx711_raw', 'ads1115_raw', 'touch_raw'] as const;
export type RawField = typeof RAW_FIELDS[number];
export type ClothesRaw = Record<RawField, number | null>;

const ranges: Record<RawField, [number, number]> = {
  hx711_raw: [-8388608, 8388607],
  ads1115_raw: [-32768, 32767],
  touch_raw: [0, 4194303],
};

export function parseClothesRaw(message: string): ClothesRaw {
  if (message.length > 1024) throw new Error('Payload exceeds 1024 characters');
  const value = JSON.parse(message);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object');
  }
  if (Object.keys(value).length !== RAW_FIELDS.length) throw new Error('Expected exactly three raw fields');
  for (const field of RAW_FIELDS) {
    if (!Object.hasOwn(value, field)) throw new Error(`Missing ${field}`);
    const raw = value[field];
    const [min, max] = ranges[field];
    if (raw !== null && (!Number.isInteger(raw) || raw < min || raw > max)) {
      throw new Error(`Invalid ${field}: expected an integer in [${min}, ${max}] or null`);
    }
  }
  return Object.fromEntries(RAW_FIELDS.map((field) => [field, value[field]])) as ClothesRaw;
}
