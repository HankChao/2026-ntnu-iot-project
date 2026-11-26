// Simulated sensor readings for demo clips, built from the five real drying runs (constants/dryingRuns.ts).
//
// Every demo drying session has a seed (stored on the server as drying_sessions.demo_seed). The seed
// picks one of the real runs and varies it: how heavy the garment is, how much water it holds, how
// conductive it is, the sensor offsets and the noise. Time is stretched so that the run reaches 5 %
// water left exactly at the session's predicted drying time. The same seed always gives the same
// curve, on any browser; a new session gets a new seed, so no two look the same.
//
// Readings are what the real clip would send today: HX711 counts, ADS1115 counts with the 1 MΩ
// divider, touch counts. The real runs used a 100 kΩ divider, so their resistance is carried as ohms
// and converted with the 1 MΩ formula; beyond about 3 MΩ (what 100 kΩ could still resolve) the rise
// towards a dry fabric is extrapolated.
import { DRYING_RUNS, TAU_STEP, type DryingRun } from '../constants/dryingRuns';
import { ADS_INPUT_OHM, type Divider } from './resistance';
import type { Scale } from './weight';

const MIN = 60000;
export const DEMO_DIVIDER_OHM = 1_000_000;
// Counts per gram of the simulated load cell: the real 衣夾-01 measures 393.2 (11/25 calibration).
export const DEMO_COUNTS_PER_GRAM = 393.2;
const RTH = DEMO_DIVIDER_OHM * ADS_INPUT_OHM / (DEMO_DIVIDER_OHM + ADS_INPUT_OHM);

export interface DemoSession { id: string; startedAt: number; totalMin: number; endedAt?: number | null; seed?: number | null }
export interface DemoReading { id: string; timestamp: string; hx711_raw: number | null; ads1115_raw: number | null; touch_raw: number | null }

// ---------------------------------------------------------------- deterministic randomness
function hash32(a: number, b = 0, c = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}
const unit = (a: number, b = 0, c = 0) => hash32(a, b, c) / 4294967296;            // [0, 1)
const between = (lo: number, hi: number, a: number, b: number) => lo + (hi - lo) * unit(a, b);
function gauss(a: number, b: number, c: number): number {                               // mean 0, sd 1
  const u = Math.max(unit(a, b, c), 1e-9), v = unit(a, b, c + 7919);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function stringSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 1;
}
export const randomSeed = () => Math.floor(Math.random() * 2147483647);
const seedOf = (s: DemoSession) => s.seed ?? stringSeed(s.id);

// ---------------------------------------------------------------- per-clip and per-session constants
function clipProfile(clipKey: number) {
  return {
    base: Math.round(between(112000, 124000, clipKey, 1)),      // empty clip on the load cell
    open: Math.round(between(22600, 22900, clipKey, 2)),        // ADS1115 reading with nothing clamped
    touch: Math.round(between(76000, 90000, clipKey, 3)),
  };
}
function sessionProfile(seed: number) {
  const run: DryingRun = DRYING_RUNS[hash32(seed, 11) % DRYING_RUNS.length];
  return {
    run,
    garment: between(12000, 32000, seed, 12),                    // dry garment, HX711 counts
    span: run.span * between(0.75, 1.25, seed, 13),              // water at the start
    plateau: run.plateau + between(-0.08, 0.08, seed, 14),       // log10 Ω while wet
    rise: between(0.85, 1.2, seed, 15),                          // how steeply it climbs while drying
    touchScale: between(0.5, 1.1, seed, 16),
  };
}

// ---------------------------------------------------------------- curves
function sample(values: number[], tau: number): number {
  const at = Math.max(0, tau) / TAU_STEP, i = Math.floor(at);
  if (i >= values.length - 1) return values[values.length - 1];
  return values[i] + (values[i + 1] - values[i]) * (at - i);
}
// Remaining water % of a run at tau (1 = 5 % left); past the end of the run it keeps drying out.
function waterOf(run: DryingRun, tau: number): number {
  const last = (run.water.length - 1) * TAU_STEP;
  if (tau <= last) return sample(run.water, tau);
  return run.water[run.water.length - 1] * Math.exp(-(tau - last) * 14);
}
// Fabric resistance (log10 Ω) from the water left: nearly flat while wet, rising sharply as it dries.
function logOhm(plateau: number, rise: number, water: number): number {
  if (water >= 40) return plateau + 0.02 * (100 - water) / 60;
  if (water >= 10) return plateau + 0.02 + rise * 0.25 * ((40 - water) / 30) ** 2;
  return plateau + 0.02 + rise * (0.25 + 2.3 * ((10 - water) / 10) ** 1.6);
}
const tauOf = (s: DemoSession, at: number) => (at - s.startedAt) / (s.totalMin * MIN);

// Remaining moisture % of a demo session at a time (what the overview shows).
export function demoMoisture(s: DemoSession, at: number): number {
  return Math.max(0, Math.min(100, waterOf(sessionProfile(seedOf(s)).run, tauOf(s, at))));
}
// How far into the session (0…1+) the garment is already `dryness` % dry, for a seed: used to start
// a session in the past so it is that dry now. Water only goes down, so a bisection finds it.
export function tauForDryness(seed: number, dryness: number): number {
  const run = sessionProfile(seed).run, target = 100 - Math.max(0, Math.min(99, dryness));
  if (target >= 100) return 0;
  let lo = 0, hi = 1.6;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (waterOf(run, mid) > target) lo = mid; else hi = mid; }
  return hi;
}

// One reading of a demo clip at time t (on the minute grid), with or without a garment on it.
function readingAt(clipKey: number, session: DemoSession | null, t: number): DemoReading {
  const clip = clipProfile(clipKey);
  const k = Math.floor(t / MIN);
  let weight = clip.base, ohm = Infinity, touch = clip.touch;
  if (session) {
    const seed = seedOf(session), p = sessionProfile(seed), tau = tauOf(session, t), water = waterOf(p.run, tau);
    weight += p.garment + p.span * water / 100;
    ohm = 10 ** logOhm(p.plateau, p.rise, water);
    touch += Math.round(p.touchScale * sample(p.run.touch, tau));
  }
  const count = Number.isFinite(ohm) ? clip.open * ohm / (RTH + ohm) : clip.open;
  // Noise like the clip on battery: small on the weight, growing on the resistance near the open end.
  const adsNoise = 25 + 450 * (count / clip.open) ** 12;
  const failed = unit(clipKey, k, 99) < 0.004;  // now and then a read fails (sent as null)
  return {
    id: `demo-${clipKey}-${k}`,
    timestamp: new Date(t).toISOString(),
    hx711_raw: Math.round(weight + 60 * gauss(clipKey, k, 1)),
    ads1115_raw: failed ? null : Math.max(0, Math.min(32767, Math.round(count + adsNoise * gauss(clipKey, k, 2)))),
    touch_raw: Math.round(touch + 140 * gauss(clipKey, k, 3)),
  };
}

// Readings of one demo clip over [from, to]: one a minute, or one every 5 minutes over a day (like
// the server's averaged long ranges). `sessions` are all of the clip's sessions, drying or ended.
export function demoHistory(clipId: string, sessions: DemoSession[], from: number, to: number, now = Date.now()) {
  const clipKey = stringSeed(clipId);
  const step = to - from > 24 * 60 * MIN ? 5 * MIN : MIN;
  const end = Math.min(to, now);
  const out: DemoReading[] = [];
  for (let t = Math.ceil(from / step) * step; t <= end; t += step) {
    const on = sessions.find((s) => s.startedAt <= t && t < (s.endedAt ?? Infinity)) ?? null;
    out.push(readingAt(clipKey, on, t));
  }
  return { records: out, bucketSeconds: step === MIN ? 0 : step / 1000 };
}
export function demoLatest(clipId: string, sessions: DemoSession[], now = Date.now()): DemoReading {
  const t = Math.floor(now / MIN) * MIN;
  const on = sessions.find((s) => s.startedAt <= t && t < (s.endedAt ?? Infinity)) ?? null;
  return readingAt(stringSeed(clipId), on, t);
}
// The divider setting the simulated readings assume, so demo charts show ohms like the real clip.
export function demoDividers(clipId: string): Divider[] {
  return [{ since: '2000-01-01T00:00:00Z', divider_ohm: DEMO_DIVIDER_OHM, open_count: clipProfile(stringSeed(clipId)).open }];
}
// The calibration the simulated readings assume: the empty clip's reading as tare, so demo charts show grams.
export function demoScales(clipId: string): Scale[] {
  return [{ since: '2000-01-01T00:00:00Z', tare_count: clipProfile(stringSeed(clipId)).base, counts_per_gram: DEMO_COUNTS_PER_GRAM }];
}
