import { describe, expect, it } from 'vitest';
import { difficultyFor, generateZone } from '../src/generator';
import { solve } from '../src/solver';
import { zoneAtCell, zoneDistance } from '../src/layout';

const coords: [number, number][] = [
  [0, 0], [1, 0], [0, -1], [-2, 1], [3, 2], [-4, -3], [6, 0], [5, -5], [-9, 7], [20, 13],
];

describe('generator', () => {
  for (const [zx, zy] of coords) {
    it(`8x8 zone ${zx},${zy} is valid, unique and deterministic`, () => {
      const z = { x0: zx * 8, y0: zy * 8, size: 8 };
      const p = generateZone(1234, z);
      const p2 = generateZone(1234, z);
      expect(p2).toEqual(p);
      expect(p.clues.reduce((s, k) => s + k.v, 0)).toBe(64);
      const res = solve(p.clues, 8, 8, 2);
      expect(res.count).toBe(1);
      const d = difficultyFor(Math.abs(zx) + Math.abs(zy));
      if (!d.allowSearch) expect(res.needsSearch).toBe(false);
      for (const q of p.solution) expect(q.w * q.h).toBeLessThanOrEqual(d.maxArea);
    });
  }

  for (const [x, y] of [[40, -8], [-40, 60], [80, 0], [-100, 90], [130, 5], [-500, 777]]) {
    const z = zoneAtCell(x, y);
    it(`${z.size}x${z.size} zone ${z.key} is valid, unique and deterministic`, () => {
      const t = performance.now();
      const p = generateZone(99, z);
      const ms = performance.now() - t;
      expect(ms).toBeLessThan(2000);
      expect(generateZone(99, z)).toEqual(p);
      expect(p.size).toBe(z.size);
      expect(p.clues.reduce((s, k) => s + k.v, 0)).toBe(z.size * z.size);
      expect(solve(p.clues, z.size, z.size, 2).count).toBe(1);
      const d = difficultyFor(zoneDistance(z), z.size);
      for (const q of p.solution) expect(q.w * q.h).toBeLessThanOrEqual(d.maxArea);
    });
  }

  it('different seeds give different worlds', () => {
    const z = { x0: 0, y0: 0, size: 8 };
    expect(generateZone(1, z)).not.toEqual(generateZone(2, z));
  });

  it('far zones have larger rectangles on average', () => {
    const avg = (zx: number) => {
      let s = 0;
      for (let i = 0; i < 6; i++) s += 64 / generateZone(77 + i, { x0: zx * 8, y0: 0, size: 8 }).clues.length;
      return s / 6;
    };
    expect(avg(4)).toBeGreaterThan(avg(0));
  });
});
