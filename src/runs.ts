/**
 * Challenge runs: Time Attack (fixed length, no save) and Survival (a countdown that
 * every solve tops up; saved so a long run survives a closed tab). Also personal bests
 * and the player's last-picked run settings.
 */
import { singlesSize, type Difficulty, type ModeId } from './layouts';
import type { SaveData } from './storage';

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

/** The size of the first grid a run in this world starts on. */
export function firstGridSize(world: ModeId, tileSize?: number, difficulty?: Difficulty): number {
  if (world === 'fixed') return tileSize ?? 8;
  if (world === 'singles') return singlesSize(difficulty ?? 'easy', 1);
  return 6;
}
export const survivalStartMs = (world: ModeId, tileSize?: number, difficulty?: Difficulty) =>
  (SURVIVAL_START_S[firstGridSize(world, tileSize, difficulty)] ?? SURVIVAL_START_S[6]) * 1000;

export interface RunState {
  style: RunStyle;
  world: ModeId;
  tileSize?: number;
  /** Singles only */
  difficulty?: Difficulty;
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

export function newRun(
  style: RunStyle,
  world: ModeId,
  tileSize?: number,
  minutes?: number,
  difficulty?: Difficulty,
): RunState {
  return {
    style,
    world,
    tileSize: world === 'fixed' ? tileSize : undefined,
    difficulty: world === 'singles' ? (difficulty ?? 'easy') : undefined,
    minutes: style === 'timeattack' ? minutes : undefined,
    clockMs: style === 'timeattack' ? (minutes ?? 5) * 60_000 : survivalStartMs(world, tileSize, difficulty),
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

export const worldId = (world: ModeId, tileSize?: number, difficulty?: Difficulty) =>
  world === 'fixed' ? `fixed-${tileSize}` : world === 'singles' ? `singles-${difficulty ?? 'easy'}` : world;

export function recordKey(style: RunStyle, world: ModeId, tileSize?: number, minutes?: number, difficulty?: Difficulty) {
  const w = worldId(world, tileSize, difficulty);
  return style === 'timeattack' ? `ta:${w}:${minutes}` : `sv:${w}`;
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
const RECORDS_KEY = 'infinite-shikaku:records:v1';
const PREFS_KEY = 'infinite-shikaku:run-prefs:v1';
const survivalKey = (world: ModeId, tileSize?: number, difficulty?: Difficulty) =>
  `infinite-shikaku:survival:${worldId(world, tileSize, difficulty)}:v1`;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(v));
    return true;
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
  const key = recordKey(run.style, run.world, run.tileSize, run.minutes, run.difficulty);
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
  v: 1;
  save: SaveData;
  run: RunState;
}

export function loadSurvival(world: ModeId, tileSize?: number, difficulty?: Difficulty): SurvivalSlot | null {
  const d = read<SurvivalSlot>(survivalKey(world, tileSize, difficulty));
  if (!d || d.v !== 1 || !d.save || !d.run || d.run.style !== 'survival' || !(d.run.clockMs > 0)) return null;
  return d;
}
export function writeSurvival(save: SaveData, run: RunState): boolean {
  return write(survivalKey(run.world, run.tileSize, run.difficulty), { v: 1, save, run } satisfies SurvivalSlot);
}
export function clearSurvival(world: ModeId, tileSize?: number, difficulty?: Difficulty) {
  try {
    localStorage.removeItem(survivalKey(world, tileSize, difficulty));
  } catch {
    /* ignore */
  }
}

export interface RunPrefs {
  ta: { world: ModeId; size: number; minutes: number; difficulty: Difficulty };
  sv: { world: ModeId; size: number; difficulty: Difficulty };
}
export function loadPrefs(): RunPrefs {
  const d = read<Partial<RunPrefs>>(PREFS_KEY) ?? {};
  return {
    ta: { world: 'mosaic', size: 8, minutes: 5, difficulty: 'easy', ...(d.ta ?? {}) },
    sv: { world: 'mosaic', size: 8, difficulty: 'easy', ...(d.sv ?? {}) },
  };
}
export function savePrefs(p: RunPrefs) {
  write(PREFS_KEY, p);
}
