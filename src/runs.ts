/**
 * Challenge runs: Time Attack (fixed length, no save) and Survival (a countdown that
 * every solve tops up; saved so a long run survives a closed tab). Also personal bests
 * and the player's last-picked run settings.
 */
import { kv } from './kv';
import { classicLevelSize, type Difficulty, type ModeId } from './layouts';
import { PREFIX, type ModeOptions, type SaveData } from './storage';

export type RunStyle = 'timeattack' | 'survival';

export const TA_MINUTES = [2, 5, 10];
/**
 * Survival time bonus in seconds, by grid size (rows) and run step (columns).
 * Step k covers zones 3k+1 to 3k+3 of the run; from zone 73 on the last column applies.
 * Each row runs in a straight line from its first value to its floor: 6×6 goes from
 * 30 s to 6 s, 24×24 from 240 s to 120 s. Big grids keep more of their value, so they
 * pay off late in a run too, but early ones are still worth the most.
 */
// prettier-ignore
export const SURVIVAL_BONUS_S: Record<number, readonly number[]> = {
  6:  [ 30,  29,  28,  27,  26,  25,  24,  23,  22,  21,  20,  19,  18,  17,  16,  15,  14,  13,  12,  11,  10,   9,   8,   7,   6],
  8:  [ 45,  44,  42,  41,  39,  38,  36,  35,  33,  32,  30,  29,  28,  26,  25,  23,  22,  20,  19,  17,  16,  14,  13,  11,  10],
  10: [ 66,  64,  62,  60,  58,  56,  54,  52,  50,  48,  46,  44,  42,  40,  38,  36,  34,  32,  30,  28,  26,  24,  22,  20,  18],
  12: [ 84,  82,  79,  77,  74,  72,  69,  67,  64,  62,  59,  57,  55,  52,  50,  47,  45,  42,  40,  37,  35,  32,  30,  27,  25],
  15: [120, 117, 114, 110, 107, 104, 101,  97,  94,  91,  88,  84,  81,  78,  75,  71,  68,  65,  62,  58,  55,  52,  49,  45,  42],
  16: [132, 129, 125, 122, 118, 115, 111, 108, 104, 101,  97,  94,  90,  87,  83,  80,  76,  73,  69,  66,  62,  59,  55,  52,  48],
  18: [156, 152, 148, 144, 140, 136, 133, 129, 125, 121, 117, 113, 109, 105, 101,  97,  93,  89,  86,  82,  78,  74,  70,  66,  62],
  20: [183, 179, 174, 170, 166, 161, 157, 153, 148, 144, 140, 135, 131, 127, 122, 118, 114, 109, 105, 101,  96,  92,  88,  83,  79],
  24: [240, 235, 230, 225, 220, 215, 210, 205, 200, 195, 190, 185, 180, 175, 170, 165, 160, 155, 150, 145, 140, 135, 130, 125, 120],
};
export const SURVIVAL_STEPS = 25;

/** Survival starting time in seconds, by the size of the run's first grid (3× its first bonus). */
export const SURVIVAL_START_S: Record<number, number> = {
  6: 90,
  8: 135,
  10: 198,
  12: 252,
  15: 360,
  16: 396,
  18: 468,
  20: 549,
  24: 720,
};
export const SURVIVAL_START_MS = SURVIVAL_START_S[6] * 1000;

/** Which column of the matrix the n-th zone of a run (1-based) uses. */
export const survivalStep = (n: number) => Math.min(SURVIVAL_STEPS - 1, Math.floor((Math.max(1, n) - 1) / 3));

/** Time added for solving the n-th zone of a run, of the given grid size. */
export function survivalBonusMs(size: number, n: number): number {
  const row = SURVIVAL_BONUS_S[size] ?? SURVIVAL_BONUS_S[6];
  return row[survivalStep(n)] * 1000;
}

/** The size of the first grid a run in this mode starts on. */
export function firstGridSize(mode: ModeId, opts: ModeOptions = {}): number {
  if (mode === 'focused') return opts.size ?? 8;
  if (mode === 'classic') return classicLevelSize(opts.difficulty ?? 'easy', 1);
  return 6;
}
export const survivalStartMs = (mode: ModeId, opts: ModeOptions = {}) =>
  (SURVIVAL_START_S[firstGridSize(mode, opts)] ?? SURVIVAL_START_S[6]) * 1000;

export interface RunState {
  style: RunStyle;
  mode: ModeId;
  /** Classic only */
  difficulty?: Difficulty;
  /** Focused only */
  size?: number;
  /** Time Attack length */
  minutes?: number;
  /** time left on the clock */
  clockMs: number;
  /** time played so far (Survival: time survived) */
  elapsedMs: number;
  area: number;
  zones: number;
  /** zones solved per grid size */
  bySize: Record<string, number>;
}

/** A run's mode options, in the shape saves and keys use. */
export const runOptions = (r: RunState): ModeOptions => ({ difficulty: r.difficulty, size: r.size });

export function newRun(style: RunStyle, mode: ModeId, opts: ModeOptions = {}, minutes?: number): RunState {
  return {
    style,
    mode,
    difficulty: mode === 'classic' ? (opts.difficulty ?? 'easy') : undefined,
    size: mode === 'focused' ? (opts.size ?? 8) : undefined,
    minutes: style === 'timeattack' ? (minutes ?? 5) : undefined,
    clockMs: style === 'timeattack' ? (minutes ?? 5) * 60_000 : survivalStartMs(mode, opts),
    elapsedMs: 0,
    area: 0,
    zones: 0,
    bySize: {},
  };
}

/** Credit a solved zone. Returns the time bonus in ms (0 in Time Attack). */
export function creditSolve(run: RunState, size: number): number {
  run.zones++;
  run.area += size * size;
  run.bySize[size] = (run.bySize[size] ?? 0) + 1;
  if (run.style !== 'survival') return 0;
  const bonus = survivalBonusMs(size, run.zones);
  run.clockMs += bonus;
  return bonus;
}

/** Mode plus its option, e.g. "classic-hard", "focused-12", "mosaic". */
export const modeVariant = (mode: ModeId, opts: ModeOptions = {}) =>
  mode === 'classic' ? `classic-${opts.difficulty ?? 'easy'}` : mode === 'focused' ? `focused-${opts.size ?? 8}` : mode;

export function recordKey(style: RunStyle, mode: ModeId, opts: ModeOptions = {}, minutes?: number) {
  const v = modeVariant(mode, opts);
  return style === 'timeattack' ? `ta:${v}:${minutes}` : `sv:${v}`;
}

export interface RunRecord {
  area: number;
  zones: number;
  /** Survival only */
  survivedMs?: number;
  date: number;
}

/** Time Attack ranks by area, then zones; Survival by time survived, then area. */
export function isBetter(style: RunStyle, a: RunRecord, b: RunRecord | null | undefined): boolean {
  if (!b) return a.area > 0 || (a.survivedMs ?? 0) > 0;
  if (style === 'timeattack') return a.area > b.area || (a.area === b.area && a.zones > b.zones);
  const sa = a.survivedMs ?? 0;
  const sb = b.survivedMs ?? 0;
  return sa > sb || (sa === sb && a.area > b.area);
}

// ---------- storage helpers ----------
const RECORDS_KEY = `${PREFIX}records`;
const PREFS_KEY = `${PREFIX}prefs`;
const survivalKey = (mode: ModeId, opts: ModeOptions = {}) => `${PREFIX}survival:${modeVariant(mode, opts)}`;

function read<T>(key: string): T | null {
  try {
    const raw = kv.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown): boolean {
  try {
    return kv.set(key, JSON.stringify(v));
  } catch {
    return false;
  }
}

export function loadRecords(): Record<string, RunRecord> {
  return read<Record<string, RunRecord>>(RECORDS_KEY) ?? {};
}

export function getRecord(key: string): RunRecord | null {
  return loadRecords()[key] ?? null;
}

/** Store a finished run if it beats the record. Returns true for a new personal best. */
export function submitRecord(run: RunState): boolean {
  const key = recordKey(run.style, run.mode, runOptions(run), run.minutes);
  const all = loadRecords();
  const rec: RunRecord = {
    area: run.area,
    zones: run.zones,
    survivedMs: run.style === 'survival' ? Math.round(run.elapsedMs) : undefined,
    date: Date.now(),
  };
  if (!isBetter(run.style, rec, all[key])) return false;
  all[key] = rec;
  write(RECORDS_KEY, all);
  return true;
}

export interface SurvivalSlot {
  save: SaveData;
  run: RunState;
}

export function loadSurvival(mode: ModeId, opts: ModeOptions = {}): SurvivalSlot | null {
  const d = read<SurvivalSlot>(survivalKey(mode, opts));
  return d && d.save && d.run && d.run.style === 'survival' && d.run.mode === mode && d.run.clockMs > 0 ? d : null;
}
export function writeSurvival(save: SaveData, run: RunState): boolean {
  return write(survivalKey(run.mode, runOptions(run)), { save, run } satisfies SurvivalSlot);
}
export function clearSurvival(mode: ModeId, opts: ModeOptions = {}) {
  kv.remove(survivalKey(mode, opts));
}

/** The player's last run choices, per play style. */
export interface RunChoice {
  mode: ModeId;
  difficulty: Difficulty;
  size: number;
  minutes: number;
}
export interface RunPrefs {
  timeattack: RunChoice;
  survival: RunChoice;
}
export function loadPrefs(): RunPrefs {
  const d = read<Partial<RunPrefs>>(PREFS_KEY) ?? {};
  const base: RunChoice = { mode: 'classic', difficulty: 'easy', size: 8, minutes: 5 };
  return {
    timeattack: { ...base, ...(d.timeattack ?? {}) },
    survival: { ...base, ...(d.survival ?? {}) },
  };
}
export function savePrefs(p: RunPrefs) {
  write(PREFS_KEY, p);
}
