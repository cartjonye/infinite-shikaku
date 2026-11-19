/**
 * localStorage persistence, one save per game mode.
 * Every access is guarded so the game still runs (without saving) when storage is unavailable.
 */
import { zoneByKey, type Difficulty, type ModeId, type WorldLayout } from './layouts';
import type { Rect } from './types';

export const SAVE_VERSION = 4;
const KEYS: Record<ModeId, string> = {
  classic: 'infinite-shikaku:classic:v4',
  fixed: 'infinite-shikaku:fixed:v2',
  mosaic: 'infinite-shikaku:mosaic:v2',
  singles: 'infinite-shikaku:singles:v1',
};
const LAST_MODE_KEY = 'infinite-shikaku:last-mode';
// Saves made before the puzzle generator changed no longer match their worlds.
const LEGACY_KEYS = [
  'infinite-shikaku:v1',
  'infinite-shikaku:v2',
  'infinite-shikaku:v3',
  'infinite-shikaku:fixed:v1',
  'infinite-shikaku:mosaic:v1',
];

export interface SizeStats {
  solved: number;
  totalMs: number;
  bestMs: number | null;
}

export interface Stats {
  zonesSolved: number;
  /** sum of the solve timers of all solved zones */
  totalSolveMs: number;
  /** per grid size (key = side length) */
  bySize: Record<string, SizeStats>;
  /** deepest depth reached (Classic, Fixed) */
  deepest: number;
  /** farthest straight-line distance from the centre, in cells / metres (Mosaic) */
  farthestM: number;
  totalPlayMs: number;
}

export interface SaveData {
  v: number;
  mode: ModeId;
  /** Fixed mode only: the chosen tile size */
  tileSize?: number;
  /** Singles only: the chosen difficulty */
  difficulty?: Difficulty;
  seed: number;
  solved: string[];
  /** in-progress rectangles per zone key */
  rects: Record<string, Rect[]>;
  /** elapsed ms per started, unsolved zone key (a key exists once the first rectangle is drawn) */
  timers: Record<string, number>;
  /** the zone the player last acted in: its timer is the one that runs */
  active: string | null;
  /** zones opened by the anti-stuck rule; they stay open */
  opened: string[];
  /** player tilings that differ from the generated solution (should never happen) */
  custom: Record<string, Rect[]>;
  cam: { x: number; y: number; zoom: number } | null;
  stats: Stats;
  seenHelp: boolean;
  /** zone sizes the player has already seen unlock (for the expansion reveal) */
  seenSizes: number[];
  lastPlayed: number;
}

export const emptyStats = (): Stats => ({
  zonesSolved: 0,
  totalSolveMs: 0,
  bySize: {},
  deepest: 0,
  farthestM: 0,
  totalPlayMs: 0,
});

export function freshSave(mode: ModeId, tileSize?: number, difficulty?: Difficulty): SaveData {
  return {
    v: SAVE_VERSION,
    mode,
    tileSize: mode === 'fixed' ? tileSize : undefined,
    difficulty: mode === 'singles' ? (difficulty ?? 'easy') : undefined,
    seed: (Math.random() * 2 ** 32) >>> 0,
    solved: [],
    rects: {},
    timers: {},
    active: null,
    opened: [],
    custom: {},
    cam: null,
    stats: emptyStats(),
    seenHelp: false,
    seenSizes: [6],
    lastPlayed: Date.now(),
  };
}

function read(key: string): any {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function isValid(d: any, mode: ModeId): boolean {
  return (
    d &&
    d.v === SAVE_VERSION &&
    (d.mode ?? 'classic') === mode &&
    typeof d.seed === 'number' &&
    Array.isArray(d.solved) &&
    typeof d.rects === 'object' &&
    typeof d.timers === 'object' &&
    typeof d.stats === 'object' &&
    (mode !== 'fixed' || typeof d.tileSize === 'number') &&
    (mode !== 'singles' || typeof d.difficulty === 'string')
  );
}

// Saves from the original 8/12/16/20 layouts are gone for good.
LEGACY_KEYS.forEach(remove);

export function loadSave(mode: ModeId): SaveData | null {
  const d = read(KEYS[mode]);
  if (!isValid(d, mode)) return null;
  return { ...freshSave(mode), ...d, mode, stats: { ...emptyStats(), ...d.stats } };
}

/** Drop zone keys that do not exist in this layout (corrupt or foreign data). */
export function sanitize(d: SaveData, L: WorldLayout): SaveData {
  const ok = (k: string) => zoneByKey(L, k) !== null;
  d.solved = d.solved.filter(ok);
  const solved = new Set(d.solved);
  for (const k of Object.keys(d.rects)) if (!ok(k) || solved.has(k)) delete d.rects[k];
  for (const k of Object.keys(d.timers)) if (!ok(k) || solved.has(k)) delete d.timers[k];
  for (const k of Object.keys(d.custom)) if (!solved.has(k)) delete d.custom[k];
  d.opened = d.opened.filter((k) => ok(k) && !solved.has(k));
  if (d.active && (!ok(d.active) || solved.has(d.active))) d.active = null;
  return d;
}

export function writeSave(d: SaveData): boolean {
  try {
    d.lastPlayed = Date.now();
    localStorage.setItem(KEYS[d.mode], JSON.stringify(d));
    localStorage.setItem(LAST_MODE_KEY, d.mode);
    return true;
  } catch {
    return false;
  }
}

export function clearSave(mode: ModeId) {
  remove(KEYS[mode]);
}

export function lastMode(): ModeId | null {
  try {
    const m = localStorage.getItem(LAST_MODE_KEY);
    return m === 'classic' || m === 'fixed' || m === 'mosaic' || m === 'singles' ? m : null;
  } catch {
    return null;
  }
}

export interface SaveSummary {
  zonesSolved: number;
  deepest: number;
  farthestM: number;
  totalPlayMs: number;
  lastPlayed: number;
  tileSize?: number;
  difficulty?: Difficulty;
}

export function summarize(mode: ModeId): SaveSummary | null {
  const d = loadSave(mode);
  if (!d) return null;
  return {
    zonesSolved: d.stats.zonesSolved,
    deepest: d.stats.deepest,
    farthestM: d.stats.farthestM,
    totalPlayMs: d.stats.totalPlayMs,
    lastPlayed: d.lastPlayed,
    tileSize: d.tileSize,
    difficulty: d.difficulty,
  };
}
