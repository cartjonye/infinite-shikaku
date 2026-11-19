/**
 * Singles: one Shikaku at a time, level after level.
 *
 * Each difficulty has a 10-level pattern of grid sizes that repeats forever; every
 * level is a little harder than the one before. Levels sit in a row along the x axis
 * (with a gap between them) so every level keeps its own zone key, but only the
 * current level is ever returned for drawing.
 */
import { ZonePool, type WorldLayout, type Zone } from './types';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
export const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
};

/** Grid size of levels 1 to 10; the pattern repeats from level 11. */
export const SINGLES_PATTERNS: Record<Difficulty, number[]> = {
  easy: [6, 6, 8, 6, 6, 8, 6, 6, 8, 10],
  medium: [8, 8, 10, 8, 12, 8, 8, 10, 10, 12],
  hard: [10, 10, 12, 12, 15, 16, 12, 15, 16, 18],
  expert: [15, 15, 16, 18, 20, 15, 16, 18, 20, 24],
};

/** Puzzle depth of level 1; each later level is one step deeper. */
const BASE_DEPTH: Record<Difficulty, number> = { easy: 1, medium: 8, hard: 16, expert: 26 };
const GAP = 4;

export const singlesSize = (d: Difficulty, level: number) => SINGLES_PATTERNS[d][(level - 1) % 10];

export interface SinglesLayout extends WorldLayout {
  difficulty: Difficulty;
  /** 1-based level of a zone, or 0 for cells between levels */
  levelOf(z: Zone): number;
  levelZone(level: number): Zone;
  /** which level is drawn (only one is ever on screen) */
  setCurrent(level: number): void;
  current(): number;
}

export function createSinglesLayout(difficulty: Difficulty): SinglesLayout {
  const pool = new ZonePool();
  const voids = new ZonePool();
  const starts: number[] = [0]; // starts[i] = x0 of level i + 1
  const zones: Zone[] = [];
  const levelByKey = new Map<string, number>();
  const ensure = (level: number) => {
    while (zones.length < level) {
      const n = zones.length + 1;
      const size = singlesSize(difficulty, n);
      const x0 = starts[n - 1];
      const z = pool.get(size, x0, 0);
      zones.push(z);
      levelByKey.set(z.key, n);
      starts.push(x0 + size + GAP);
    }
  };
  const levelZone = (level: number) => {
    ensure(level);
    return zones[level - 1];
  };
  let current = 1;

  const zoneAtCell = (x: number, y: number): Zone => {
    if (x >= 0) {
      // levels only grow to the right; find the one whose x-range holds this cell
      while (starts[starts.length - 1] <= x) ensure(zones.length + 1);
      let lo = 0;
      let hi = zones.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (zones[mid].x0 <= x) lo = mid;
        else hi = mid - 1;
      }
      const z = zones[lo];
      if (x < z.x0 + z.size && y >= 0 && y < z.size) return z;
    }
    // between levels: an inert cell that is never drawn or opened
    return voids.get(1, x, y);
  };

  return {
    mode: 'singles',
    difficulty,
    origin: levelZone(1),
    get centre(): [number, number] {
      const z = levelZone(current);
      return [z.x0 + z.size / 2, z.size / 2];
    },
    zoneAtCell,
    zonesInRect(x0, y0, x1, y1) {
      const z = levelZone(current);
      return z.x0 + z.size < x0 || z.x0 > x1 || z.size < y0 || 0 > y1 ? [] : [z];
    },
    depthFor: (z) => BASE_DEPTH[difficulty] + Math.max(1, levelByKey.get(z.key) ?? 1) - 1,
    label: (z) => `Level ${levelByKey.get(z.key) ?? 1}`,
    expansionBanner: false,
    unlockRule: 'sequence',
    next: (z) => {
      const n = levelByKey.get(z.key);
      return n ? levelZone(n + 1) : null;
    },
    prev: (z) => {
      const n = levelByKey.get(z.key);
      return n && n > 1 ? levelZone(n - 1) : null;
    },
    levelOf: (z) => levelByKey.get(z.key) ?? 0,
    levelZone,
    setCurrent(level) {
      current = Math.max(1, level);
    },
    current: () => current,
  };
}
