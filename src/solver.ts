/**
 * Shikaku solver: candidate enumeration + constraint propagation + backtracking.
 * Grids up to 64 cells; cell sets are stored as two 32-bit masks.
 */
import type { Clue, Rect } from './types';

interface Cand {
  rect: Rect;
  lo: number;
  hi: number;
}

export interface SolveResult {
  /** number of solutions found, capped at `limit` */
  count: number;
  /** true if propagation alone could not finish (guessing was required) */
  needsSearch: boolean;
  /** first solution found, indexed like the clues */
  solution: Rect[] | null;
}

function bit(i: number): [number, number] {
  return i < 32 ? [(1 << i) >>> 0, 0] : [0, (1 << (i - 32)) >>> 0];
}

function maskOf(rect: Rect, cols: number): [number, number] {
  let lo = 0;
  let hi = 0;
  for (let r = rect.r; r < rect.r + rect.h; r++) {
    for (let c = rect.c; c < rect.c + rect.w; c++) {
      const [l, h] = bit(r * cols + c);
      lo |= l;
      hi |= h;
    }
  }
  return [lo >>> 0, hi >>> 0];
}

export function candidatesFor(clues: Clue[], rows: number, cols: number): Rect[][] {
  const clueAt = new Map<number, number>();
  clues.forEach((k, i) => clueAt.set(k.r * cols + k.c, i));
  return clues.map((k, idx) => {
    const out: Rect[] = [];
    for (let h = 1; h <= k.v; h++) {
      if (k.v % h) continue;
      const w = k.v / h;
      if (h > rows || w > cols) continue;
      for (let r0 = k.r - h + 1; r0 <= k.r; r0++) {
        if (r0 < 0 || r0 + h > rows) continue;
        for (let c0 = k.c - w + 1; c0 <= k.c; c0++) {
          if (c0 < 0 || c0 + w > cols) continue;
          let ok = true;
          for (let r = r0; r < r0 + h && ok; r++) {
            for (let c = c0; c < c0 + w; c++) {
              const j = clueAt.get(r * cols + c);
              if (j !== undefined && j !== idx) {
                ok = false;
                break;
              }
            }
          }
          if (ok) out.push({ r: r0, c: c0, h, w });
        }
      }
    }
    return out;
  });
}

export function solve(
  clues: Clue[],
  rows: number,
  cols: number,
  limit = 2,
): SolveResult {
  const n = rows * cols;
  const total = clues.reduce((s, k) => s + k.v, 0);
  if (total !== n || n > 64) return { count: 0, needsSearch: false, solution: null };

  const cands: Cand[][] = candidatesFor(clues, rows, cols).map((list) =>
    list.map((rect) => {
      const [lo, hi] = maskOf(rect, cols);
      return { rect, lo, hi };
    }),
  );
  const cellBits: [number, number][] = [];
  for (let i = 0; i < n; i++) cellBits.push(bit(i));

  let count = 0;
  let solution: Rect[] | null = null;
  let searched = false;

  // returns false on contradiction
  function propagate(
    lists: Cand[][],
    assigned: (Cand | null)[],
    cov: [number, number],
  ): boolean {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < lists.length; i++) {
        if (assigned[i]) continue;
        const filtered = lists[i].filter((c) => !((c.lo & cov[0]) | (c.hi & cov[1])));
        if (filtered.length !== lists[i].length) {
          lists[i] = filtered;
          changed = true;
        }
        if (filtered.length === 0) return false;
        if (filtered.length === 1) {
          assigned[i] = filtered[0];
          cov[0] = (cov[0] | filtered[0].lo) >>> 0;
          cov[1] = (cov[1] | filtered[0].hi) >>> 0;
          changed = true;
        }
      }
      // each uncovered cell must be claimable by some unassigned clue
      for (let cell = 0; cell < n; cell++) {
        const [bl, bh] = cellBits[cell];
        if ((cov[0] & bl) | (cov[1] & bh)) continue;
        let owner = -1;
        let owners = 0;
        for (let i = 0; i < lists.length && owners < 2; i++) {
          if (assigned[i]) continue;
          if (lists[i].some((c) => (c.lo & bl) | (c.hi & bh))) {
            owner = i;
            owners++;
          }
        }
        if (owners === 0) return false;
        if (owners === 1) {
          const filtered = lists[owner].filter((c) => (c.lo & bl) | (c.hi & bh));
          if (filtered.length !== lists[owner].length) {
            lists[owner] = filtered;
            changed = true;
          }
        }
      }
    }
    return true;
  }

  function rec(lists: Cand[][], assigned: (Cand | null)[], cov: [number, number], depth: number) {
    if (count >= limit) return;
    if (!propagate(lists, assigned, cov)) return;
    let best = -1;
    for (let i = 0; i < lists.length; i++) {
      if (assigned[i]) continue;
      if (best < 0 || lists[i].length < lists[best].length) best = i;
    }
    if (best < 0) {
      count++;
      if (!solution) solution = assigned.map((a) => a!.rect);
      return;
    }
    if (depth === 0) searched = true;
    for (const choice of lists[best]) {
      if (count >= limit) return;
      const l2 = lists.slice();
      const a2 = assigned.slice();
      a2[best] = choice;
      l2[best] = [choice];
      rec(l2, a2, [(cov[0] | choice.lo) >>> 0, (cov[1] | choice.hi) >>> 0], depth + 1);
    }
  }

  rec(
    cands.map((l) => l.slice()),
    clues.map(() => null),
    [0, 0],
    0,
  );
  return { count, needsSearch: searched, solution };
}
