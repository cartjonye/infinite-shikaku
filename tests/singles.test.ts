import { describe, expect, it } from 'vitest';
import { generateZone } from '../src/generator';
import { DIFFICULTIES, SINGLES_PATTERNS, createSinglesLayout, singlesSize } from '../src/layouts';
import { solve } from '../src/solver';
import { freshSave } from '../src/storage';
import { World } from '../src/world';

describe('Singles', () => {
  it('follows each 10-level pattern and repeats it', () => {
    expect(SINGLES_PATTERNS.easy).toEqual([6, 6, 8, 6, 6, 8, 6, 6, 8, 10]);
    expect(SINGLES_PATTERNS.medium).toEqual([8, 8, 10, 8, 12, 8, 8, 10, 10, 12]);
    expect(SINGLES_PATTERNS.hard).toEqual([10, 10, 12, 12, 15, 16, 12, 15, 16, 18]);
    expect(SINGLES_PATTERNS.expert).toEqual([15, 15, 16, 18, 20, 15, 16, 18, 20, 24]);
    for (const d of DIFFICULTIES) {
      const L = createSinglesLayout(d);
      for (let n = 1; n <= 30; n++) {
        expect(L.levelZone(n).size).toBe(singlesSize(d, n));
        expect(L.levelZone(n).size).toBe(SINGLES_PATTERNS[d][(n - 1) % 10]);
        expect(L.levelOf(L.levelZone(n))).toBe(n);
      }
    }
  });

  it('places levels apart and maps every cell of a level back to it', () => {
    const L = createSinglesLayout('expert');
    for (let n = 1; n <= 25; n++) {
      const z = L.levelZone(n);
      if (n > 1) {
        const p = L.levelZone(n - 1);
        expect(z.x0).toBeGreaterThan(p.x0 + p.size);
      }
      for (const [x, y] of [[z.x0, 0], [z.x0 + z.size - 1, z.size - 1], [z.x0 + 3, 2]]) expect(L.zoneAtCell(x, y)).toBe(z);
      expect(L.zoneAtCell(z.x0 + z.size, 0)).not.toBe(z);
      expect(L.levelOf(L.zoneAtCell(z.x0 + z.size, 0))).toBe(0);
    }
  });

  it('opens one level at a time and draws only the current one', () => {
    const L = createSinglesLayout('easy');
    const w = new World(L, freshSave('singles', undefined, 'easy'));
    expect(w.openZones()).toEqual([L.levelZone(1)]);
    for (let n = 1; n <= 12; n++) {
      const opened = w.markSolved(L.levelZone(n));
      expect(opened).toEqual([L.levelZone(n + 1)]);
      expect(w.openZones()).toEqual([L.levelZone(n + 1)]);
    }
    L.setCurrent(5);
    expect(L.zonesInRect(-1e6, -1e6, 1e6, 1e6)).toEqual([L.levelZone(5)]);
  });

  it('every level is uniquely solvable and gets harder each cycle', () => {
    for (const d of DIFFICULTIES) {
      const L = createSinglesLayout(d);
      expect(L.depthFor(L.levelZone(11))).toBeGreaterThan(L.depthFor(L.levelZone(1)));
      for (const n of [1, 5, 10, 11]) {
        const z = L.levelZone(n);
        const p = generateZone(77, { x0: z.x0, y0: z.y0, size: z.size, depth: L.depthFor(z) });
        expect(solve(p.clues, z.size, z.size, 2).count).toBe(1);
      }
    }
  }, 60000);
});

describe('Singles level change', () => {
  it('can keep the solved level drawn during the slide, then drop it', () => {
    const L = createSinglesLayout('medium');
    L.setCurrent(3);
    L.setCurrent(4, true);
    expect(L.zonesInRect(-1e6, -1e6, 1e6, 1e6)).toEqual([L.levelZone(3), L.levelZone(4)]);
    L.dropPrevious();
    expect(L.zonesInRect(-1e6, -1e6, 1e6, 1e6)).toEqual([L.levelZone(4)]);
    L.setCurrent(5);
    expect(L.zonesInRect(-1e6, -1e6, 1e6, 1e6)).toEqual([L.levelZone(5)]);
  });
});
