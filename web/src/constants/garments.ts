// Garment illustration data, ported from the design canvas (智慧衣夾 介面設計).
// All paths live in a 300×370 viewBox with the hanger hook at the top.

export type StyleKey = 'tee' | 'shirt' | 'tank' | 'pants' | 'towel';
export type Material = '棉' | '聚酯纖維' | '牛仔布' | '羊毛' | '麻' | '毛巾布';

export interface Shape {
  label: string;
  top: number;
  bottom: number;
  drips: [number, number];
  lift: number;  // drawn this much higher so the garment sits on the hanger (arms at y 64–97)
  clips?: [number, number];  // x of the two hanger clips holding the top edge (pants)
  d: string;
  details: string;
  folds: string;
}

export const SHAPES: Record<StyleKey, Shape> = {
  tee: {
    label: 'T 恤', top: 88, bottom: 322, drips: [128, 178], lift: 26,
    d: 'M112,90 C122,88 128,88 134,90 C140,102 160,102 166,90 C172,88 178,88 188,90 L232,112 C238,115 240,120 238,126 L222,160 C220,165 215,167 210,165 L198,158 L200,312 C200,318 196,322 190,322 L110,322 C104,322 100,318 100,312 L102,158 L90,165 C85,167 80,165 78,160 L62,126 C60,120 62,115 68,112 Z',
    details: 'M134,90 C140,106 160,106 166,90 M138,92 C143,101 157,101 162,92 M69,126 L84,158 M231,126 L216,158 M101,308 L199,308',
    folds: 'M128,190 C133,235 126,275 131,316 M174,205 C170,245 177,285 172,316',
  },
  shirt: {
    label: '襯衫', top: 88, bottom: 322, drips: [120, 184], lift: 26,
    d: 'M114,90 L136,88 L150,108 L164,88 L186,90 L236,114 C242,117 245,122 246,128 L258,250 C258,255 255,258 250,259 L232,262 C227,263 223,260 222,255 L206,160 L206,310 C206,318 202,322 196,322 L104,322 C98,322 94,318 94,310 L94,160 L78,255 C77,260 73,263 68,262 L50,259 C45,258 42,255 42,250 L54,128 C55,122 58,117 64,114 Z',
    details: 'M136,88 L143,114 L150,108 L157,114 L164,88 M150,110 V320 M147,140 a3,3 0 1 0 6,0 a3,3 0 1 0 -6,0 M147,180 a3,3 0 1 0 6,0 a3,3 0 1 0 -6,0 M147,220 a3,3 0 1 0 6,0 a3,3 0 1 0 -6,0 M147,260 a3,3 0 1 0 6,0 a3,3 0 1 0 -6,0 M45,236 L77,240 M255,236 L223,240 M95,308 L205,308',
    folds: 'M120,170 C124,220 118,270 122,316 M182,170 C178,220 184,270 180,316 M60,150 C62,190 64,220 66,250 M240,150 C238,190 236,220 234,250',
  },
  tank: {
    label: '背心', top: 88, bottom: 322, drips: [130, 172], lift: 26,
    d: 'M120,90 C126,88 130,88 134,90 C138,112 162,112 166,90 C170,88 174,88 180,90 C182,122 192,140 206,148 L206,312 C206,318 202,322 196,322 L104,322 C98,322 94,318 94,312 L94,148 C108,140 118,122 120,90 Z',
    details: 'M134,92 C138,113 162,113 166,92 M121,94 C120,124 110,140 97,147 M179,94 C180,124 190,140 203,147 M95,308 L205,308',
    folds: 'M126,170 C130,220 124,270 128,316 M174,175 C170,225 176,270 172,316',
  },
  pants: {
    label: '褲子', top: 96, bottom: 322, drips: [104, 196], lift: 2, clips: [122, 178],
    d: 'M90,96 L210,96 L212,116 L226,312 C226,318 222,322 216,322 L170,322 C165,322 162,318 161,313 L150,176 L139,313 C138,318 135,322 130,322 L84,322 C78,322 74,318 74,312 L88,116 Z',
    details: 'M89,114 L211,114 M150,116 V158 C150,164 146,167 141,165 M98,118 C105,132 113,137 123,137 M202,118 C195,132 187,137 177,137 M108,96 V114 M192,96 V114 M150,96 V114',
    folds: 'M112,190 C110,240 108,280 104,318 M188,190 C190,240 192,280 196,318 M140,140 C142,150 146,158 150,170',
  },
  towel: {
    label: '毛巾', top: 92, bottom: 310, drips: [120, 180], lift: 0,
    d: 'M80,92 L220,92 L220,296 C220,300 218,302 214,302 L86,302 C82,302 80,300 80,296 Z',
    details: 'M80,256 H220 M80,266 H220 M86,302 V310 M96,302 V310 M106,302 V310 M116,302 V310 M126,302 V310 M136,302 V310 M146,302 V310 M156,302 V310 M166,302 V310 M176,302 V310 M186,302 V310 M196,302 V310 M206,302 V310 M214,302 V310',
    folds: 'M120,110 C118,160 122,210 119,254 M180,110 C182,160 178,210 181,254',
  },
};

export const STYLE_KEYS = Object.keys(SHAPES) as StyleKey[];

export interface MaterialPattern { w: number; h: number; rot: string; d: string; sw: number; op: number; sheen: number }

export const MATS: Record<Material, MaterialPattern> = {
  '棉': { w: 4, h: 4, rot: '', d: 'M0,2 H4', sw: 0.6, op: 0.12, sheen: 0.06 },
  '聚酯纖維': { w: 8, h: 8, rot: '', d: 'M0,0', sw: 0, op: 0, sheen: 0.3 },
  '牛仔布': { w: 5, h: 5, rot: 'rotate(-35)', d: 'M0,0 V5', sw: 1.4, op: 0.24, sheen: 0.04 },
  '羊毛': { w: 8, h: 7, rot: '', d: 'M0,1 L4,6 L8,1', sw: 1.2, op: 0.18, sheen: 0.03 },
  '麻': { w: 6, h: 6, rot: '', d: 'M0,3 H6 M3,0 V6', sw: 0.7, op: 0.16, sheen: 0.05 },
  '毛巾布': { w: 6, h: 6, rot: '', d: 'M1.5,3 a1.5,1.5 0 1 0 3,0 a1.5,1.5 0 1 0 -3,0', sw: 1, op: 0.26, sheen: 0.02 },
};

export const MATERIALS = Object.keys(MATS) as Material[];

// Typical drying time per material (minutes), used for predictions before a garment has history.
export const BASE_MINUTES: Record<Material, number> = {
  '棉': 285, '聚酯纖維': 110, '牛仔布': 450, '羊毛': 360, '麻': 330, '毛巾布': 330,
};

export const COLORS = [
  { hex: '#F2F1EC', label: '白' }, { hex: '#D8CBB0', label: '米' }, { hex: '#9AA3AD', label: '灰' }, { hex: '#2A2B30', label: '黑' },
  { hex: '#2E4A7A', label: '海軍藍' }, { hex: '#4A6FA5', label: '丹寧藍' }, { hex: '#C8463D', label: '紅' },
  { hex: '#E9C46A', label: '黃' }, { hex: '#6BA37A', label: '綠' },
];

export const colorName = (hex: string) => COLORS.find((c) => c.hex === hex)?.label ?? hex;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const mix = (hex: string, to: number, k: number) =>
  '#' + rgb(hex).map((v) => Math.round(v + (to - v) * k).toString(16).padStart(2, '0')).join('');
export const lum = (hex: string) => { const a = rgb(hex); return (0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2]) / 255; };

// Repeating wave crest across the garment; the CSS animation slides it by one period (110 px).
export const crest = (y: number, x0: number) => {
  let d = `M${x0},${y} q27.5,-9 55,0`;
  for (let i = 0; i < 17; i++) d += ' t55,0';
  return d;
};
export const wave = (y: number, x0: number) => `${crest(y, x0)} V370 H${x0} Z`;

export const HANGER_HOOK = 'M140,30 a10,10 0 1 1 10,10 v14';
export const HANGER_BAR = 'M150,54 C146,58 140,61 134,64 L82,88 C76,91 78,97 85,97 L215,97 C222,97 224,91 218,88 L166,64 C160,61 154,58 150,54 Z';
export const DROP = 'M0,-5 C2.5,-1 3.5,1 3.5,2.8 A3.5,3.5 0 0 1 -3.5,2.8 C-3.5,1 -2.5,-1 0,-5 Z';
