/**
 * Deterministic zone generator. Every zone (zx, zy) of a world seed always
 * produces the same uniquely-solvable puzzle; difficulty grows with distance.
 */
import { hashInts, mulberry32, pickWeighted, randInt, type Rng } from './rng';
import { solve } from './solver';
import { ZONE, type Clue, type Puzzle, type Rect } from './types';
import { zoneDistance } from './layout';

export interface Difficulty {
  level: number;
  maxArea: number;
  /** weight multiplier for tiny (1-2 cell) rectangles */
  smallWeight: number;
  /** how strongly larger areas are preferred */
  bigBias: number;
  /** whether a solution may require guessing (still unique) */
  allowSearch: boolean;
}

export function difficultyFor(distance: number, size = ZONE): Difficulty {
  const t = Math.min(1, distance / 12);
  // bigger zones allow proportionally bigger rectangles
  const scale = 1 + (size - ZONE) / 16;
  return {
    level: distance + 1,
    maxArea: Math.round((6 + 10 * t) * scale),
    smallWeight: 0.35 - 0.3 * t,
    bigBias: 0.5 + 2.5 * t,
    allowSearch: distance >= 6,
  };
}

/** Greedy random partition of an N×N grid into rectangles. */
function partition(rng: Rng, n: number, d: Difficulty): Rect[] {
  const owner = new Int16Array(n * n).fill(-1);
  const rects: Rect[] = [];
  for (let i = 0; i < n * n; i++) {
    if (owner[i] >= 0) continue;
    const r0 = Math.floor(i / n);
    const c0 = i % n;
    // largest free width on the first row
    let maxW = 0;
    while (c0 + maxW < n && owner[r0 * n + c0 + maxW] < 0) maxW++;
    const options: Rect[] = [];
    const weights: number[] = [];
    for (let w = 1; w <= maxW; w++) {
      for (let h = 1; r0 + h <= n; h++) {
        // row r0+h-1 must be free across w
        let free = true;
        for (let c = c0; c < c0 + w; c++) if (owner[(r0 + h - 1) * n + c] >= 0) free = false;
        if (!free) break;
        const a = w * h;
        if (a > d.maxArea) break;
        // discourage very thin long strips a bit
        const thin = Math.max(w, h) / Math.min(w, h);
        let wt = a <= 2 ? d.smallWeight : 1 + d.bigBias * (a / d.maxArea);
        if (thin > 4) wt *= 0.4;
        options.push({ r: r0, c: c0, w, h });
        weights.push(wt);
      }
    }
    const pick = pickWeighted(rng, options, weights);
    for (let r = pick.r; r < pick.r + pick.h; r++)
      for (let c = pick.c; c < pick.c + pick.w; c++) owner[r * n + c] = rects.length;
    rects.push(pick);
  }
  return rects;
}

function placeClues(rng: Rng, rects: Rect[]): Clue[] {
  return rects.map((q) => ({
    r: q.r + randInt(rng, 0, q.h - 1),
    c: q.c + randInt(rng, 0, q.w - 1),
    v: q.w * q.h,
  }));
}

export interface ZoneSpec {
  x0: number;
  y0: number;
  size: number;
}

/** Seed for one generation attempt. 8×8 zones keep their original seeding so old saves stay valid. */
function attemptSeed(worldSeed: number, z: ZoneSpec, attempt: number) {
  return z.size === ZONE
    ? hashInts(worldSeed, z.x0 / ZONE, z.y0 / ZONE, attempt)
    : hashInts(worldSeed, z.x0, z.y0, z.size * 7919 + attempt);
}

export function generateZone(worldSeed: number, z: ZoneSpec): Puzzle {
  const n = z.size;
  const dist = zoneDistance(z);
  const base = difficultyFor(dist, n);
  for (let attempt = 0; attempt < 4000; attempt++) {
    // relax constraints gradually if we struggle
    const d: Difficulty =
      attempt < 1500 ? base : { ...base, maxArea: Math.max(4, base.maxArea - Math.floor(attempt / 1500)) };
    const rng = mulberry32(attemptSeed(worldSeed, z, attempt));
    const rects = partition(rng, n, d);
    if (rects.length < 3) continue;
    for (let place = 0; place < 6; place++) {
      const clues = placeClues(rng, rects);
      const res = solve(clues, n, n, 2);
      if (res.count !== 1) continue;
      if (res.needsSearch && !d.allowSearch) continue;
      return { size: n, clues, solution: res.solution!, needsSearch: res.needsSearch };
    }
  }
  // Unreachable in practice: a grid of 1x1 rectangles is always unique.
  const clues: Clue[] = [];
  const solution: Rect[] = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      clues.push({ r, c, v: 1 });
      solution.push({ r, c, w: 1, h: 1 });
    }
  return { size: n, clues, solution, needsSearch: false };
}
