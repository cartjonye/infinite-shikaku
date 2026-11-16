import { describe, expect, it } from 'vitest';
import { difficultyFor, generateZone } from '../src/generator';
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

  it('keeps Classic puzzles identical to before the modes refactor', () => {
    // pinned so existing Classic saves keep showing the same puzzles
    const p = generateZone(4242, spec(L.origin));
    expect(p.clues.map((c) => `${c.r}${c.c}${c.v}`).join(',')).toBe('004,015,043,153,223,132,343,533,353,401,522,442,501,511');
  });

  it('start zone is uniquely solvable for many seeds', () => {
    for (let s = 0; s < 20; s++) expect(solve(generateZone(s, spec(L.origin)).clues, 6, 6, 2).count).toBe(1);
  });

  it('different seeds give different worlds', () => {
    expect(generateZone(1, spec(L.origin))).not.toEqual(generateZone(2, spec(L.origin)));
  });
});
