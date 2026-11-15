/** localStorage persistence. Every access is guarded so the game still runs without storage. */
import { zoneByKey } from './layout';
import type { Rect } from './types';

export const SAVE_KEY = 'infinite-shikaku:v2';
const LEGACY_KEY = 'infinite-shikaku:v1';
export const SAVE_VERSION = 2;

export interface Stats {
  zonesSolved: number;
  totalSolveMs: number;
  bestMs: number | null;
  lastMs: number | null;
  farthest: number;
  totalPlayMs: number;
}

export interface SaveData {
  v: number;
  seed: number;
  solved: string[];
  /** in-progress rectangles per zone key */
  rects: Record<string, Rect[]>;
  /** elapsed ms per unsolved zone key */
  timers: Record<string, number>;
  cam: { x: number; y: number; zoom: number } | null;
  stats: Stats;
  seenHelp: boolean;
  /** zone sizes the player has already seen unlock (for the expansion reveal) */
  seenSizes: number[];
}

export const emptyStats = (): Stats => ({
  zonesSolved: 0,
  totalSolveMs: 0,
  bestMs: null,
  lastMs: null,
  farthest: 0,
  totalPlayMs: 0,
});

export function freshSave(): SaveData {
  return {
    v: SAVE_VERSION,
    seed: (Math.random() * 2 ** 32) >>> 0,
    solved: [],
    rects: {},
    timers: {},
    cam: null,
    stats: emptyStats(),
    seenHelp: false,
    seenSizes: [8],
  };
}

function isValid(d: any, version: number): boolean {
  return (
    d &&
    d.v === version &&
    typeof d.seed === 'number' &&
    Array.isArray(d.solved) &&
    typeof d.rects === 'object' &&
    typeof d.timers === 'object' &&
    typeof d.stats === 'object'
  );
}

/** Drop any zone keys that no longer exist in the current layout. */
function sanitize(d: SaveData): SaveData {
  const ok = (k: string) => zoneByKey(k) !== null;
  d.solved = d.solved.filter(ok);
  const solved = new Set(d.solved);
  for (const k of Object.keys(d.rects)) if (!ok(k) || solved.has(k)) delete d.rects[k];
  for (const k of Object.keys(d.timers)) if (!ok(k)) delete d.timers[k];
  return d;
}

/** v1 (all zones 8×8) → v2 (concentric tiers). 8×8 keys near the centre carry over unchanged. */
function migrateV1(d: any): SaveData {
  return sanitize({ ...freshSave(), ...d, v: SAVE_VERSION, seenSizes: [8], stats: { ...emptyStats(), ...d.stats } });
}

function read(key: string): any {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadSave(): SaveData {
  const d = read(SAVE_KEY);
  if (isValid(d, SAVE_VERSION)) {
    return sanitize({ ...freshSave(), ...d, stats: { ...emptyStats(), ...d.stats } });
  }
  const old = read(LEGACY_KEY);
  if (isValid(old, 1)) {
    const migrated = migrateV1(old);
    if (writeSave(migrated)) {
      try {
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        /* ignore */
      }
    }
    return migrated;
  }
  return freshSave();
}

export function writeSave(d: SaveData): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
