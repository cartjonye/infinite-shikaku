import { describe, expect, it } from 'vitest';
import { difficultyFor, generateZone } from '../src/generator';
import { TIERS, zoneAtCell, zoneDepth } from '../src/layout';
import { solve } from '../src/solver';

// one sample zone from the inner ring of every tier, plus a far 24x24 zone
const samples = [
  ...TIERS.map((_t, i) => zoneAtCell(i === 0 ? 0 : TIERS[i - 1].outer + 1, 3)),
  zoneAtCell(-1000, 777),
];

describe('generator', () => {
  for (const z of samples) {
    it(`${z.size}x${z.size} zone ${z.key} (depth ${zoneDepth(z)}) is valid, unique, deterministic`, () => {
      const t = performance.now();
      const p = generateZone(99, z);
      expect(performance.now() - t).toBeLessThan(2000);
      expect(generateZone(99, z)).toEqual(p);
      expect(p.size).toBe(z.size);
      expect(p.clues.reduce((s, k) => s + k.v, 0)).toBe(z.size * z.size);
      const res = solve(p.clues, z.size, z.size, 2);
      expect(res.count).toBe(1);
      const d = difficultyFor(zoneDepth(z), z.size);
      if (!d.allowSearch) expect(res.needsSearch).toBe(false);
      for (const q of p.solution) expect(q.w * q.h).toBeLessThanOrEqual(d.maxArea);
    });
  }

  it('is deterministic across several seeds for the start zone', () => {
    const z = zoneAtCell(0, 0);
    for (let s = 0; s < 20; s++) {
      const p = generateZone(s, z);
      expect(solve(p.clues, 6, 6, 2).count).toBe(1);
    }
  });

  it('different seeds give different worlds', () => {
    const z = zoneAtCell(0, 0);
    expect(generateZone(1, z)).not.toEqual(generateZone(2, z));
  });
});
