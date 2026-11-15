import { describe, expect, it } from 'vitest';
import { difficultyFor, generateZone } from '../src/generator';
import { solve } from '../src/solver';
import { ZONE } from '../src/types';

const coords: [number, number][] = [
  [0, 0], [1, 0], [0, -1], [-2, 1], [3, 2], [-4, -3], [6, 0], [5, -5], [-9, 7], [20, 13],
];

describe('generator', () => {
  for (const [zx, zy] of coords) {
    it(`zone ${zx},${zy} is valid, unique and deterministic`, () => {
      const p = generateZone(1234, zx, zy);
      const p2 = generateZone(1234, zx, zy);
      expect(p2).toEqual(p);
      expect(p.clues.reduce((s, k) => s + k.v, 0)).toBe(ZONE * ZONE);
      const res = solve(p.clues, ZONE, ZONE, 2);
      expect(res.count).toBe(1);
      const d = difficultyFor(Math.abs(zx) + Math.abs(zy));
      if (!d.allowSearch) expect(res.needsSearch).toBe(false);
      for (const q of p.solution) expect(q.w * q.h).toBeLessThanOrEqual(d.maxArea);
    });
  }

  it('different seeds give different worlds', () => {
    expect(generateZone(1, 0, 0)).not.toEqual(generateZone(2, 0, 0));
  });

  it('far zones have larger rectangles on average', () => {
    const avg = (zx: number) => {
      let s = 0;
      for (let i = 0; i < 6; i++) s += 64 / generateZone(77 + i, zx, 0).clues.length;
      return s / 6;
    };
    expect(avg(14)).toBeGreaterThan(avg(0));
  });
});
