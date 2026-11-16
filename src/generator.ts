/**
 * Deterministic zone generator. Every zone (zx, zy) of a world seed always
 * produces the same uniquely-solvable puzzle; difficulty grows with distance.
 */
import { hashInts, mulberry32, pickWeighted, randInt, type Rng } from './rng';
import { solve } from './solver';
import type { Clue, Puzzle, Rect } from './types';

export interface Difficulty {
  depth: number;
  maxArea: number;
  /** weight multiplier for tiny (1-2 cell) rectangles */
  smallWeight: number;
  /** how strongly larger areas are preferred */
  bigBias: number;
  /** whether a solution may require guessing (still unique) */
  allowSearch: boolean;
}

export function difficultyFor(depth: number, size: number): Difficulty {
  const t = Math.min(1, (depth - 1) / 33);
  return {
    depth,
    maxArea: Math.max(4, Math.round(size * (0.9 + 0.6 * t))),
    smallWeight: 0.35 - 0.3 * t,
    bigBias: 0.5 + 2.5 * t,
    allowSearch: depth >= 10,
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
        // single cells are a last resort; dominoes are merely discouraged
        let wt = a === 1 ? 0.002 : a === 2 ? d.smallWeight : 1 + d.bigBias * (a / d.maxArea);
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

/**
 * Absorb single cells into a neighbour when the union is still a rectangle
 * within the area cap. Returns the new list (order: reading order of top-left).
 */
function mergeSingles(rects: Rect[], maxArea: number): Rect[] {
  const out = rects.map((q) => ({ ...q }));
  for (let i = 0; i < out.length; i++) {
    const q = out[i];
    if (q.w !== 1 || q.h !== 1) continue;
    let best = -1;
    let bestArea = Infinity;
    for (let j = 0; j < out.length; j++) {
      if (j === i) continue;
      const o = out[j];
      if (o.w * o.h + 1 > maxArea) continue;
      const vertical = o.w === 1 && o.c === q.c && (o.r + o.h === q.r || q.r + 1 === o.r);
      const horizontal = o.h === 1 && o.r === q.r && (o.c + o.w === q.c || q.c + 1 === o.c);
      // prefer the smallest neighbour so pieces stay balanced
      if ((vertical || horizontal) && o.w * o.h < bestArea) {
        best = j;
        bestArea = o.w * o.h;
      }
    }
    if (best < 0) continue;
    const o = out[best];
    if (o.w === 1 && o.c === q.c && (o.r + o.h === q.r || q.r + 1 === o.r)) {
      o.r = Math.min(o.r, q.r);
      o.h += 1;
    } else {
      o.c = Math.min(o.c, q.c);
      o.w += 1;
    }
    out.splice(i, 1);
    i = -1; // restart: merges can enable further merges
  }
  return out;
}

/** How many single cells a zone may contain before the partition is rejected. */
export const singlesBudget = (size: number) => Math.floor((size * size) / 150);

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
  /** difficulty driver from the world layout */
  depth: number;
}

function attemptSeed(worldSeed: number, z: ZoneSpec, attempt: number) {
  return hashInts(worldSeed, z.x0, z.y0, z.size * 7919 + attempt, 2);
}

export function generateZone(worldSeed: number, z: ZoneSpec): Puzzle {
  const n = z.size;
  const base = difficultyFor(z.depth, n);
  for (let attempt = 0; attempt < 4000; attempt++) {
    // relax constraints gradually if we struggle
    const d: Difficulty =
      attempt < 1500 ? base : { ...base, maxArea: Math.max(4, base.maxArea - Math.floor(attempt / 1500)) };
    const rng = mulberry32(attemptSeed(worldSeed, z, attempt));
    const rects = mergeSingles(partition(rng, n, d), d.maxArea);
    if (rects.length < 3) continue;
    let singles = 0;
    for (const q of rects) if (q.w === 1 && q.h === 1) singles++;
    if (singles > singlesBudget(n) + Math.floor(attempt / 300)) continue;
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
