/** localStorage persistence. Every access is guarded so the game still runs without storage. */
import type { Rect } from './types';

export const SAVE_KEY = 'infinite-shikaku:v1';
export const SAVE_VERSION = 1;

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
  };
}

function isValid(d: any): d is SaveData {
  return (
    d &&
    d.v === SAVE_VERSION &&
    typeof d.seed === 'number' &&
    Array.isArray(d.solved) &&
    typeof d.rects === 'object' &&
    typeof d.timers === 'object' &&
    typeof d.stats === 'object'
  );
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (isValid(d)) return { ...freshSave(), ...d, stats: { ...emptyStats(), ...d.stats } };
    }
  } catch {
    /* storage unavailable or corrupt: start fresh */
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
