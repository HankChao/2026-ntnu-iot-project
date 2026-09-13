// ==============================================================================
// Metric Definitions & Configurations for MAPS 6.0 (23 Total Items)
// ==============================================================================

export type MetricGroup = 'weather' | 'pm' | 'gas' | 'light' | 'system';

export interface MetricDefinition {
  key: string;
  label: string;
  shortLabel: string;
  unit: string;
  color: string;
  group: MetricGroup;
  chip: string;
}

export const METRIC_GROUPS: Array<{ id: MetricGroup; label: string }> = [
  { id: 'weather', label: '氣候溫濕度 (SHT3x)' },
  { id: 'pm', label: '懸浮微粒 (PMS7003)' },
  { id: 'gas', label: '氣體與空氣品質 (S8 / SGP30)' },
  { id: 'light', label: '光學照度色彩 (TCS34725)' },
  { id: 'system', label: '主機狀態 (Raspberry Pi)' },
];

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  // 1. Weather (SHT3x)
  temp: { key: 'temp', label: '環境溫度 (°C)', shortLabel: '溫度', unit: '°C', color: '#e11d48', group: 'weather', chip: 'SHT3x' },
  humi: { key: 'humi', label: '相對濕度 (%)', shortLabel: '濕度', unit: '%', color: '#0284c7', group: 'weather', chip: 'SHT3x' },

  // 2. Particulate Matter (PMS7003)
  pm1_ae: { key: 'pm1_ae', label: 'PM1.0 大氣 (µg/m³)', shortLabel: 'PM1.0 AE', unit: 'µg/m³', color: '#64748b', group: 'pm', chip: 'PMS7003' },
  pm25_ae: { key: 'pm25_ae', label: 'PM2.5 大氣 (µg/m³)', shortLabel: 'PM2.5 AE', unit: 'µg/m³', color: '#d97706', group: 'pm', chip: 'PMS7003' },
  pm10_ae: { key: 'pm10_ae', label: 'PM10 大氣 (µg/m³)', shortLabel: 'PM10 AE', unit: 'µg/m³', color: '#ca8a04', group: 'pm', chip: 'PMS7003' },
  pm1_sp: { key: 'pm1_sp', label: 'PM1.0 標準 (µg/m³)', shortLabel: 'PM1.0 SP', unit: 'µg/m³', color: '#78716c', group: 'pm', chip: 'PMS7003' },
  pm25_sp: { key: 'pm25_sp', label: 'PM2.5 標準 (µg/m³)', shortLabel: 'PM2.5 SP', unit: 'µg/m³', color: '#b45309', group: 'pm', chip: 'PMS7003' },
  pm10_sp: { key: 'pm10_sp', label: 'PM10 標準 (µg/m³)', shortLabel: 'PM10 SP', unit: 'µg/m³', color: '#a16207', group: 'pm', chip: 'PMS7003' },

  // 3. Gases (Senseair S8 & Sensirion SGP30)
  co2: { key: 'co2', label: 'CO2 即時 (ppm)', shortLabel: 'CO2', unit: 'ppm', color: '#16a34a', group: 'gas', chip: 'Senseair S8' },
  ave_co2: { key: 'ave_co2', label: 'CO2 平均 (ppm)', shortLabel: 'Ave CO2', unit: 'ppm', color: '#059669', group: 'gas', chip: 'Senseair S8' },
  tvoc: { key: 'tvoc', label: 'TVOC 揮發有機物 (ppb)', shortLabel: 'TVOC', unit: 'ppb', color: '#9333ea', group: 'gas', chip: 'SGP30' },
  eco2: { key: 'eco2', label: 'eCO2 等效二氧化碳 (ppm)', shortLabel: 'eCO2', unit: 'ppm', color: '#7c3aed', group: 'gas', chip: 'SGP30' },
  s_h2: { key: 's_h2', label: 'H2 氫氣訊號 (Raw)', shortLabel: 'Raw H2', unit: 'Raw', color: '#8b5cf6', group: 'gas', chip: 'SGP30' },
  s_ethanol: { key: 's_ethanol', label: 'Ethanol 乙醇訊號 (Raw)', shortLabel: 'Raw Ethanol', unit: 'Raw', color: '#a855f7', group: 'gas', chip: 'SGP30' },
  baseline_tvoc: { key: 'baseline_tvoc', label: 'TVOC 基線 (Raw)', shortLabel: 'TVOC Base', unit: 'Raw', color: '#c084fc', group: 'gas', chip: 'SGP30' },
  baseline_eco2: { key: 'baseline_eco2', label: 'eCO2 基線 (Raw)', shortLabel: 'eCO2 Base', unit: 'Raw', color: '#d8b4fe', group: 'gas', chip: 'SGP30' },

  // 4. Optical (TCS34725)
  illuminance: { key: 'illuminance', label: '環境照度 (Lux)', shortLabel: '照度', unit: 'Lux', color: '#2563eb', group: 'light', chip: 'TCS34725' },
  color_temp: { key: 'color_temp', label: '相關色溫 (K)', shortLabel: '色溫', unit: 'K', color: '#0d9488', group: 'light', chip: 'TCS34725' },
  ch_r: { key: 'ch_r', label: '紅光通道 (Raw)', shortLabel: 'Red', unit: 'Raw', color: '#dc2626', group: 'light', chip: 'TCS34725' },
  ch_g: { key: 'ch_g', label: '綠光通道 (Raw)', shortLabel: 'Green', unit: 'Raw', color: '#16a34a', group: 'light', chip: 'TCS34725' },
  ch_b: { key: 'ch_b', label: '藍光通道 (Raw)', shortLabel: 'Blue', unit: 'Raw', color: '#2563eb', group: 'light', chip: 'TCS34725' },
  ch_c: { key: 'ch_c', label: '全光通道 (Raw)', shortLabel: 'Clear', unit: 'Raw', color: '#475569', group: 'light', chip: 'TCS34725' },

  // 5. System (Host Pi)
  cpu_temp: { key: 'cpu_temp', label: '主機 CPU 溫度 (°C)', shortLabel: 'CPU 溫', unit: '°C', color: '#ea580c', group: 'system', chip: 'Host Pi' },
};
