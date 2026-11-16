import { describe, expect, it } from 'vitest';
import { difficultyFor, generateZone, singlesBudget } from '../src/generator';
import { TIERS, createClassicLayout } from '../src/layouts';
import { solve } from '../src/solver';

const L = createClassicLayout();
const spec = (z: { x0: number; y0: number; size: number }) => ({ ...z, depth: L.depthFor(z as any) });
const samples = [
  ...TIERS.map((_t, i) => L.zoneAtCell(i === 0 ? 0 : TIERS[i - 1].outer + 1, 3)),
  L.zoneAtCell(-1000, 777),
];

describe('generator', () => {
  for (const z of samples) {
    it(`${z.size}x${z.size} zone ${z.key} (depth ${L.depthFor(z)}) is valid, unique, deterministic`, () => {
      const t = performance.now();
      const p = generateZone(99, spec(z));
      expect(performance.now() - t).toBeLessThan(2000);
      expect(generateZone(99, spec(z))).toEqual(p);
      expect(p.size).toBe(z.size);
      expect(p.clues.reduce((s, k) => s + k.v, 0)).toBe(z.size * z.size);
      const res = solve(p.clues, z.size, z.size, 2);
      expect(res.count).toBe(1);
      const d = difficultyFor(L.depthFor(z), z.size);
      if (!d.allowSearch) expect(res.needsSearch).toBe(false);
      for (const q of p.solution) expect(q.w * q.h).toBeLessThanOrEqual(d.maxArea);
    });
  }

  it('start zone is uniquely solvable for many seeds', () => {
    for (let s = 0; s < 20; s++) expect(solve(generateZone(s, spec(L.origin)).clues, 6, 6, 2).count).toBe(1);
  });

  it('different seeds give different worlds', () => {
    expect(generateZone(1, spec(L.origin))).not.toEqual(generateZone(2, spec(L.origin)));
  });

  it('keeps single cells rare', () => {
    for (const size of [6, 8, 10, 12, 15, 16, 18, 20, 24]) {
      let ones = 0;
      const N = 40;
      for (let i = 0; i < N; i++) {
        const p = generateZone(500 + i, { x0: i * size, y0: 0, size, depth: 1 + (i % 34) });
        const n = p.clues.filter((c) => c.v === 1).length;
        expect(n).toBeLessThanOrEqual(singlesBudget(size) + 1);
        ones += n;
      }
      expect(ones / N).toBeLessThanOrEqual(Math.max(0.15, singlesBudget(size) * 0.5));
    }
  });
});

/**
 * Independent check of the uniqueness guarantee: a plain exhaustive tiler that shares
 * no code with the solver. It fills the first empty cell (reading order) with every
 * rectangle anchored there that holds exactly one clue of matching area.
 */
function bruteCount(clues: { r: number; c: number; v: number }[], n: number, limit = 2): number {
  const clueAt = new Int16Array(n * n).fill(-1);
  clues.forEach((k, i) => (clueAt[k.r * n + k.c] = i));
  const used = new Uint8Array(n * n);
  let count = 0;
  const rec = (from: number) => {
    if (count >= limit) return;
    let i = from;
    while (i < n * n && used[i]) i++;
    if (i === n * n) {
      count++;
      return;
    }
    const r0 = Math.floor(i / n);
    const c0 = i % n;
    let maxW = 0;
    while (c0 + maxW < n && !used[r0 * n + c0 + maxW]) maxW++;
    for (let w = 1; w <= maxW; w++) {
      let clue = -1;
      let bad = false;
      for (let h = 1; r0 + h <= n && !bad; h++) {
        const r = r0 + h - 1;
        for (let c = c0; c < c0 + w; c++) {
          if (used[r * n + c]) bad = true;
          const k = clueAt[r * n + c];
          if (k >= 0) {
            if (clue >= 0) bad = true;
            clue = k;
          }
        }
        if (bad) break;
        if (clue < 0) continue;
        const area = w * h;
        if (area > clues[clue].v) break;
        if (area !== clues[clue].v) continue;
        for (let rr = r0; rr < r0 + h; rr++) for (let c = c0; c < c0 + w; c++) used[rr * n + c] = 1;
        rec(i + 1);
        for (let rr = r0; rr < r0 + h; rr++) for (let c = c0; c < c0 + w; c++) used[rr * n + c] = 0;
        if (count >= limit) return;
      }
    }
  };
  rec(0);
  return count;
}

describe('uniqueness guarantee (independent brute force)', () => {
  it('counts solutions correctly on known cases', () => {
    expect(bruteCount([{ r: 0, c: 0, v: 2 }, { r: 1, c: 1, v: 2 }], 2)).toBe(2);
    expect(bruteCount([{ r: 0, c: 0, v: 4 }], 2)).toBe(1);
  });

  for (const [size, samples] of [[6, 150], [8, 100], [10, 60], [12, 40], [15, 20], [16, 15], [18, 10], [20, 8], [24, 5]]) {
    it(`every generated ${size}x${size} puzzle has exactly one solution (${samples} zones)`, () => {
      for (let i = 0; i < samples; i++) {
        const p = generateZone(9000 + i, { x0: i * size, y0: size, size, depth: 1 + ((i * 7) % 40) });
        expect(bruteCount(p.clues, size)).toBe(1);
      }
    }, 120000);
  }
});
