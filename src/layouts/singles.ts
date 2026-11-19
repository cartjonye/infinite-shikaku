/**
 * The Singles family: one Shikaku at a time, level after level.
 *
 * - Classic: a 10-level pattern of grid sizes per difficulty, repeating forever.
 * - Focused: every level is the grid size the player picked.
 *
 * Every level is a little harder than the one before. Levels sit in a row along the
 * x axis, centred on the same line with a gap between them, so moving to the next level
 * is a straight horizontal slide. Positions are purely visual: zone keys ("L7") and
 * puzzle seeds come from the level number. Only the current level is drawn, plus the
 * previous one while a slide runs (fading out as the next one fades in).
 */
import type { ModeId, WorldLayout, Zone } from './types';
import { ZonePool } from './types';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
export const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
};

/** Classic: grid size of levels 1 to 10; the pattern repeats from level 11. */
export const CLASSIC_PATTERNS: Record<Difficulty, number[]> = {
  easy: [6, 6, 8, 6, 6, 8, 6, 6, 8, 10],
  medium: [8, 8, 10, 8, 12, 8, 8, 10, 10, 12],
  hard: [10, 10, 12, 12, 15, 16, 12, 15, 16, 18],
  expert: [15, 15, 16, 18, 20, 15, 16, 18, 20, 24],
};
/** Classic: puzzle depth of level 1; each later level is one step deeper. */
const CLASSIC_BASE_DEPTH: Record<Difficulty, number> = { easy: 1, medium: 8, hard: 16, expert: 26 };

/** Focused: the grid sizes a player can pick. */
export const FOCUSED_SIZES = [6, 8, 10, 12, 15, 16, 18, 20, 24];

export const classicLevelSize = (d: Difficulty, level: number) => CLASSIC_PATTERNS[d][(level - 1) % 10];

/** cells between levels on the board; purely visual (keys and seeds don't depend on it) */
const GAP = 4;

/** Saved key of a level. */
export const levelKey = (level: number) => `L${level}`;
const parseLevelKey = (key: string) => {
  const m = /^L(\d+)$/.exec(key);
  return m ? Number(m[1]) : 0;
};

export interface SinglesLayout extends WorldLayout {
  sizeOf(level: number): number;
  /** 1-based level of a zone, or 0 for cells between levels */
  levelOf(z: Zone): number;
  levelZone(level: number): Zone;
  current(): number;
  /** show this level, without a transition */
  setCurrent(level: number): void;
  /** slide to this level: the current one fades out as the new one fades in */
  slideTo(level: number, t0: number, dur: number): void;
  /** stop drawing the previous level once the slide has finished */
  endSlide(): void;
}

interface SinglesSpec {
  mode: ModeId;
  sizeOf(level: number): number;
  depthOf(level: number): number;
}

function createSinglesLayout(spec: SinglesSpec): SinglesLayout {
  const voids = new ZonePool();
  const starts: number[] = [0]; // starts[i] = x0 of level i + 1
  const zones: Zone[] = [];
  const levelByKey = new Map<string, number>();
  const ensure = (level: number) => {
    while (zones.length < level) {
      const n = zones.length + 1;
      const size = spec.sizeOf(n);
      const x0 = starts[n - 1];
      const z: Zone = { key: levelKey(n), x0, y0: -Math.floor(size / 2), size, seedId: n };
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
  let slide: { from: number; t0: number; dur: number } | null = null;

  const zoneAtCell = (x: number, y: number): Zone => {
    if (x >= 0) {
      while (starts[starts.length - 1] <= x) ensure(zones.length + 1);
      let lo = 0;
      let hi = zones.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (zones[mid].x0 <= x) lo = mid;
        else hi = mid - 1;
      }
      const z = zones[lo];
      if (x < z.x0 + z.size && y >= z.y0 && y < z.y0 + z.size) return z;
    }
    // between levels: an inert cell that is never drawn or opened
    return voids.get(1, x, y);
  };
  const clamp = (v: number) => Math.min(1, Math.max(0, v));

  return {
    mode: spec.mode,
    sizeOf: spec.sizeOf,
    origin: levelZone(1),
    get centre(): [number, number] {
      const z = levelZone(current);
      return [z.x0 + z.size / 2, z.y0 + z.size / 2];
    },
    zoneAtCell,
    zonesInRect(x0, y0, x1, y1) {
      const shown = slide ? [levelZone(slide.from), levelZone(current)] : [levelZone(current)];
      return shown.filter((z) => !(z.x0 + z.size < x0 || z.x0 > x1 || z.y0 + z.size < y0 || z.y0 > y1));
    },
    depthFor: (z) => spec.depthOf(Math.max(1, levelByKey.get(z.key) ?? 1)),
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
    zoneByKey: (key) => {
      const n = parseLevelKey(key);
      return n > 0 ? levelZone(n) : null;
    },
    // the finished level fades out over the second half of the slide; the next one
    // fades in over the first half, so nothing pops in or out on wide screens
    alphaFor(z, now) {
      if (!slide) return 1;
      const t = (now - slide.t0) / slide.dur;
      const n = levelByKey.get(z.key);
      if (n === slide.from) return clamp(2 - 2 * t);
      if (n === current) return clamp(2 * t);
      return 1;
    },
    animating: () => !!slide,
    levelOf: (z) => levelByKey.get(z.key) ?? 0,
    levelZone,
    current: () => current,
    setCurrent(level) {
      current = Math.max(1, level);
      slide = null;
    },
    slideTo(level, t0, dur) {
      const next = Math.max(1, level);
      slide = next !== current ? { from: current, t0, dur } : null;
      current = next;
    },
    endSlide() {
      slide = null;
    },
  };
}

/** Singles Classic: grid sizes follow the difficulty's 10-level pattern. */
export function createClassicLayout(difficulty: Difficulty): SinglesLayout {
  return createSinglesLayout({
    mode: 'classic',
    sizeOf: (n) => classicLevelSize(difficulty, n),
    depthOf: (n) => CLASSIC_BASE_DEPTH[difficulty] + n - 1,
  });
}

/** Singles Focused: every level is the chosen size, each a little harder. */
export function createFocusedLayout(size: number): SinglesLayout {
  return createSinglesLayout({ mode: 'focused', sizeOf: () => size, depthOf: (n) => n });
}
