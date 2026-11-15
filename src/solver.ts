/**
 * Shikaku solver: candidate enumeration + constraint propagation + backtracking.
 * Cell sets are word bitsets (Uint32Array), so any grid size works.
 */
import type { Clue, Rect } from './types';

interface Cand {
  rect: Rect;
  m: Uint32Array;
}

export interface SolveResult {
  /** number of solutions found, capped at `limit` */
  count: number;
  /** true if propagation alone could not finish (guessing was required) */
  needsSearch: boolean;
  /** first solution found, indexed like the clues */
  solution: Rect[] | null;
  /** a second, different solution when count >= 2 */
  alternative: Rect[] | null;
}

export function candidatesFor(clues: Clue[], rows: number, cols: number): Rect[][] {
  const clueAt = new Int32Array(rows * cols).fill(-1);
  clues.forEach((k, i) => (clueAt[k.r * cols + k.c] = i));
  return clues.map((k, idx) => {
    const out: Rect[] = [];
    for (let h = 1; h <= k.v; h++) {
      if (k.v % h) continue;
      const w = k.v / h;
      if (h > rows || w > cols) continue;
      for (let r0 = Math.max(0, k.r - h + 1); r0 <= k.r && r0 + h <= rows; r0++) {
        for (let c0 = Math.max(0, k.c - w + 1); c0 <= k.c && c0 + w <= cols; c0++) {
          let ok = true;
          for (let r = r0; r < r0 + h && ok; r++) {
            for (let c = c0; c < c0 + w; c++) {
              const j = clueAt[r * cols + c];
              if (j >= 0 && j !== idx) {
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

export function solve(clues: Clue[], rows: number, cols: number, limit = 2): SolveResult {
  const n = rows * cols;
  const W = (n + 31) >>> 5;
  const total = clues.reduce((s, k) => s + k.v, 0);
  const none: SolveResult = { count: 0, needsSearch: false, solution: null, alternative: null };
  if (total !== n) return none;

  const cands: Cand[][] = candidatesFor(clues, rows, cols).map((list) =>
    list.map((rect) => {
      const m = new Uint32Array(W);
      for (let r = rect.r; r < rect.r + rect.h; r++)
        for (let c = rect.c; c < rect.c + rect.w; c++) {
          const i = r * cols + c;
          m[i >>> 5] |= 1 << (i & 31);
        }
      return { rect, m };
    }),
  );
  const K = clues.length;

  let count = 0;
  const found: Rect[][] = [];
  let searched = false;

  const overlaps = (a: Uint32Array, b: Uint32Array) => {
    for (let w = 0; w < W; w++) if (a[w] & b[w]) return true;
    return false;
  };
  const once = new Uint32Array(W);
  const twice = new Uint32Array(W);
  const uni = new Uint32Array(W);

  function propagate(lists: Cand[][], assigned: (Cand | null)[], cov: Uint32Array): boolean {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < K; i++) {
        if (assigned[i]) continue;
        const filtered = lists[i].filter((c) => !overlaps(c.m, cov));
        if (filtered.length !== lists[i].length) {
          lists[i] = filtered;
          changed = true;
        }
        if (filtered.length === 0) return false;
        if (filtered.length === 1) {
          assigned[i] = filtered[0];
          for (let w = 0; w < W; w++) cov[w] |= filtered[0].m[w];
          changed = true;
        }
      }
      if (changed) continue;
      // which uncovered cells can be claimed by exactly one / no clue?
      once.fill(0);
      twice.fill(0);
      const unions: Uint32Array[] = [];
      for (let i = 0; i < K; i++) {
        if (assigned[i]) {
          unions.push(uni);
          continue;
        }
        const u = new Uint32Array(W);
        for (const c of lists[i]) for (let w = 0; w < W; w++) u[w] |= c.m[w];
        unions.push(u);
        for (let w = 0; w < W; w++) {
          twice[w] |= once[w] & u[w];
          once[w] |= u[w];
        }
      }
      for (let w = 0; w < W; w++) {
        const bitsInGrid = w === W - 1 && n & 31 ? (1 << (n & 31)) - 1 : 0xffffffff;
        const free = ~cov[w] & bitsInGrid;
        if (free & ~once[w]) return false;
        let single = (free & once[w] & ~twice[w]) >>> 0;
        while (single) {
          const b = single & -single;
          single = (single ^ b) >>> 0;
          for (let i = 0; i < K; i++) {
            if (assigned[i] || !(unions[i][w] & b)) continue;
            const filtered = lists[i].filter((c) => c.m[w] & b);
            if (filtered.length !== lists[i].length) {
              lists[i] = filtered;
              changed = true;
            }
            break;
          }
        }
      }
    }
    return true;
  }

  function rec(lists: Cand[][], assigned: (Cand | null)[], cov: Uint32Array, depth: number) {
    if (count >= limit) return;
    if (!propagate(lists, assigned, cov)) return;
    let best = -1;
    for (let i = 0; i < K; i++) {
      if (assigned[i]) continue;
      if (best < 0 || lists[i].length < lists[best].length) best = i;
    }
    if (best < 0) {
      count++;
      found.push(assigned.map((a) => a!.rect));
      return;
    }
    if (depth === 0) searched = true;
    for (const choice of lists[best]) {
      if (count >= limit) return;
      const l2 = lists.slice();
      const a2 = assigned.slice();
      a2[best] = choice;
      l2[best] = [choice];
      const c2 = cov.slice();
      for (let w = 0; w < W; w++) c2[w] |= choice.m[w];
      rec(l2, a2, c2, depth + 1);
    }
  }

  rec(
    cands.map((l) => l.slice()),
    clues.map(() => null),
    new Uint32Array(W),
    0,
  );
  return { count, needsSearch: searched, solution: found[0] ?? null, alternative: found[1] ?? null };
}
