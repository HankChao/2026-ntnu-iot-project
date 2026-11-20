import { computed, ref } from 'vue';
import { Chart } from 'chart.js';

export type ThemeMode = 'dark' | 'light';

const KEY = 'clothes_theme';

// Concrete colors for places CSS variables can't reach (SVG presentation
// attributes, Chart.js canvas). Keep in sync with styles/main.css.
export const PALETTE = {
  dark: {
    bg: '#0B0F14', sf: '#10161E', sf2: '#161D27', bd: '#1E2733', bd2: '#2A3646',
    tx: '#E6EDF3', tx2: '#C3CDD8', mu: '#8B98A8', grid: '#1C2530',
    ac: '#5CE1E6', acTx: '#A8F3F5', wa: '#FFB347', waTx: '#FFD08A',
    band: '#3A2E1A', future: '#121318', m1: '#7FD9C4', m3: '#B9A6FF',
    temp: '#FF8A73', humi: '#7FB5FF', tooltip: '#161D27',
  },
  light: {
    bg: '#F3F5F8', sf: '#FFFFFF', sf2: '#F1F4F7', bd: '#DDE3EA', bd2: '#C5CEDA',
    tx: '#0E141B', tx2: '#3A4553', mu: '#5B6675', grid: '#E6EAF0',
    ac: '#0B8F96', acTx: '#077378', wa: '#E08600', waTx: '#8F5200',
    band: '#FBE6C6', future: '#FAF8F4', m1: '#1B8A73', m3: '#6A4FD0',
    temp: '#C9573C', humi: '#3C7FC9', tooltip: '#0E141B',
  },
} as const;

export type Palette = (typeof PALETTE)[ThemeMode];

const mode = ref<ThemeMode>(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

function applyChartDefaults(p: Palette) {
  Chart.defaults.color = p.mu;
  Chart.defaults.borderColor = p.grid;
  Chart.defaults.font.family = "'Noto Sans TC', 'Space Grotesk', sans-serif";
  // The tooltip defaults only exist once the plugin is registered; set() creates the path either way.
  Chart.defaults.set('plugins.tooltip', { backgroundColor: p.tooltip });
  // Charts that don't build their options from the palette (air box pages) pick up the new defaults here.
  Object.values(Chart.instances).forEach((chart) => chart.update('none'));
}

applyChartDefaults(PALETTE[mode.value]);

function setMode(next: ThemeMode) {
  mode.value = next;
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(KEY, next); } catch { /* the choice just lasts for this visit */ }
  applyChartDefaults(PALETTE[next]);
}

export function useTheme() {
  return {
    mode,
    palette: computed<Palette>(() => PALETTE[mode.value]),
    isLight: computed(() => mode.value === 'light'),
    toggle: () => setMode(mode.value === 'dark' ? 'light' : 'dark'),
  };
}
