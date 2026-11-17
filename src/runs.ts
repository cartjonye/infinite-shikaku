/**
 * Challenge runs: Time Attack (fixed length, no save) and Survival (a countdown that
 * every solve tops up; saved so a long run survives a closed tab). Also personal bests
 * and the player's last-picked run settings.
 */
import type { ModeId } from './layouts';
import type { SaveData } from './storage';

export type RunStyle = 'timeattack' | 'survival';

export const TA_MINUTES = [2, 5, 10];
export const SURVIVAL_START_MS = 30_000;

/**
 * Relative value of each grid size, scaled to its typical number of pieces
 * (6×6 = 10). The actual bonus is this times a multiplier that shrinks as the run goes on.
 */
export const SURVIVAL_BONUS_S: Record<number, number> = {
  6: 10,
  8: 15,
  10: 22,
  12: 28,
  15: 40,
  16: 44,
  18: 52,
  20: 61,
  24: 80,
};
/** 6×6 bonus for the first zones of a run (3× the table), and the floor it shrinks to. */
export const SURVIVAL_BASE_START_S = 30;
export const SURVIVAL_BASE_FLOOR_S = 6;

/**
 * The 6×6 bonus for the n-th zone solved in a run (1-based): 30 s for zones 1 to 3,
 * then 1 s less every 3 zones (29 s for zones 4 to 6, 28 s for 7 to 9, ...) down to 6 s.
 * Because it shrinks per zone, not per area, big grids solved early are worth the most.
 */
export const survivalBase6 = (n: number) =>
  Math.max(SURVIVAL_BASE_FLOOR_S, SURVIVAL_BASE_START_S - Math.floor((Math.max(1, n) - 1) / 3));

/** Time added for solving the n-th zone of a run, of the given grid size. */
export function survivalBonusMs(size: number, n: number): number {
  const weight = SURVIVAL_BONUS_S[size] ?? Math.round(10 * (size / 6) ** 1.5);
  return Math.round((survivalBase6(n) * weight) / 10) * 1000;
}

export interface RunState {
  style: RunStyle;
  world: ModeId;
  tileSize?: number;
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

export function newRun(style: RunStyle, world: ModeId, tileSize?: number, minutes?: number): RunState {
  return {
    style,
    world,
    tileSize: world === 'fixed' ? tileSize : undefined,
    minutes: style === 'timeattack' ? minutes : undefined,
    clockMs: style === 'timeattack' ? (minutes ?? 5) * 60_000 : SURVIVAL_START_MS,
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

export const worldId = (world: ModeId, tileSize?: number) => (world === 'fixed' ? `fixed-${tileSize}` : world);

export function recordKey(style: RunStyle, world: ModeId, tileSize?: number, minutes?: number) {
  return style === 'timeattack' ? `ta:${worldId(world, tileSize)}:${minutes}` : `sv:${worldId(world, tileSize)}`;
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
const survivalKey = (world: ModeId, tileSize?: number) => `infinite-shikaku:survival:${worldId(world, tileSize)}:v1`;

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
  const key = recordKey(run.style, run.world, run.tileSize, run.minutes);
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

export function loadSurvival(world: ModeId, tileSize?: number): SurvivalSlot | null {
  const d = read<SurvivalSlot>(survivalKey(world, tileSize));
  if (!d || d.v !== 1 || !d.save || !d.run || d.run.style !== 'survival' || !(d.run.clockMs > 0)) return null;
  return d;
}
export function writeSurvival(save: SaveData, run: RunState): boolean {
  return write(survivalKey(run.world, run.tileSize), { v: 1, save, run } satisfies SurvivalSlot);
}
export function clearSurvival(world: ModeId, tileSize?: number) {
  try {
    localStorage.removeItem(survivalKey(world, tileSize));
  } catch {
    /* ignore */
  }
}

export interface RunPrefs {
  ta: { world: ModeId; size: number; minutes: number };
  sv: { world: ModeId; size: number };
}
export function loadPrefs(): RunPrefs {
  const d = read<Partial<RunPrefs>>(PREFS_KEY) ?? {};
  return {
    ta: { world: 'mosaic', size: 8, minutes: 5, ...(d.ta ?? {}) },
    sv: { world: 'mosaic', size: 8, ...(d.sv ?? {}) },
  };
}
export function savePrefs(p: RunPrefs) {
  write(PREFS_KEY, p);
}
