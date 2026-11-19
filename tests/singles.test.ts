import { describe, expect, it } from 'vitest';
import { generateZone } from '../src/generator';
import {
  CLASSIC_PATTERNS,
  DIFFICULTIES,
  FOCUSED_SIZES,
  classicLevelSize,
  createClassicLayout,
  createFocusedLayout,
  zoneByKey,
} from '../src/layouts';
import { solve } from '../src/solver';
import { freshSave } from '../src/storage';
import { World } from '../src/world';

describe('Singles: Classic', () => {
  it('follows each 10-level pattern and repeats it', () => {
    expect(CLASSIC_PATTERNS.easy).toEqual([6, 6, 8, 6, 6, 8, 6, 6, 8, 10]);
    expect(CLASSIC_PATTERNS.medium).toEqual([8, 8, 10, 8, 12, 8, 8, 10, 10, 12]);
    expect(CLASSIC_PATTERNS.hard).toEqual([10, 10, 12, 12, 15, 16, 12, 15, 16, 18]);
    expect(CLASSIC_PATTERNS.expert).toEqual([15, 15, 16, 18, 20, 15, 16, 18, 20, 24]);
    for (const d of DIFFICULTIES) {
      const L = createClassicLayout(d);
      expect(L.mode).toBe('classic');
      for (let n = 1; n <= 30; n++) {
        expect(L.levelZone(n).size).toBe(classicLevelSize(d, n));
        expect(L.levelZone(n).size).toBe(CLASSIC_PATTERNS[d][(n - 1) % 10]);
        expect(L.levelOf(L.levelZone(n))).toBe(n);
      }
    }
  });

  it('places levels apart, centred on one line, and maps their cells back', () => {
    const L = createClassicLayout('expert');
    for (let n = 1; n <= 25; n++) {
      const z = L.levelZone(n);
      if (n > 1) {
        const p = L.levelZone(n - 1);
        expect(z.x0).toBeGreaterThan(p.x0 + p.size);
      }
      for (const [x, y] of [[z.x0, z.y0], [z.x0 + z.size - 1, z.y0 + z.size - 1], [z.x0 + 3, z.y0 + 2]]) expect(L.zoneAtCell(x, y)).toBe(z);
      expect(L.levelOf(L.zoneAtCell(z.x0 + z.size, 0))).toBe(0);
      expect(L.levelOf(L.zoneAtCell(z.x0, z.y0 - 1))).toBe(0);
      expect(Math.abs(z.y0 + z.size / 2)).toBeLessThanOrEqual(0.5);
    }
  });

  it('opens one level at a time and draws only the current one', () => {
    const L = createClassicLayout('easy');
    const w = new World(L, freshSave('classic', { difficulty: 'easy' }));
    expect(w.openZones()).toEqual([L.levelZone(1)]);
    for (let n = 1; n <= 12; n++) {
      expect(w.markSolved(L.levelZone(n))).toEqual([L.levelZone(n + 1)]);
      expect(w.openZones()).toEqual([L.levelZone(n + 1)]);
    }
    L.setCurrent(5);
    expect(L.zonesInRect(-1e6, -1e6, 1e6, 1e6)).toEqual([L.levelZone(5)]);
  });

  it('every level is uniquely solvable and gets harder each cycle', () => {
    for (const d of DIFFICULTIES) {
      const L = createClassicLayout(d);
      expect(L.depthFor(L.levelZone(11))).toBeGreaterThan(L.depthFor(L.levelZone(1)));
      for (const n of [1, 5, 10, 11]) {
        const z = L.levelZone(n);
        const p = generateZone(77, { x0: z.x0, y0: z.y0, size: z.size, depth: L.depthFor(z), seedId: z.seedId });
        expect(solve(p.clues, z.size, z.size, 2).count).toBe(1);
      }
    }
  }, 60000);
});

describe('Singles: Focused', () => {
  it('every level is the chosen size and each is a little harder', () => {
    for (const size of FOCUSED_SIZES) {
      const L = createFocusedLayout(size);
      expect(L.mode).toBe('focused');
      for (let n = 1; n <= 15; n++) {
        expect(L.levelZone(n).size).toBe(size);
        if (n > 1) expect(L.depthFor(L.levelZone(n))).toBeGreaterThan(L.depthFor(L.levelZone(n - 1)));
      }
    }
  });

  it('opens levels in sequence like Classic', () => {
    const L = createFocusedLayout(10);
    const w = new World(L, freshSave('focused', { size: 10 }));
    expect(w.markSolved(L.levelZone(1))).toEqual([L.levelZone(2)]);
  });
});

describe('Singles: keys, seeds and the level slide', () => {
  it('uses level keys and resolves them', () => {
    const L = createClassicLayout('hard');
    expect(L.levelZone(7).key).toBe('L7');
    expect(zoneByKey(L, 'L7')).toBe(L.levelZone(7));
    expect(zoneByKey(L, '12@0,0')).toBeNull();
  });

  it('seeds each level by its number, so its board position never changes its puzzle', () => {
    const L = createFocusedLayout(8);
    const z = L.levelZone(5);
    const spec = { size: z.size, depth: L.depthFor(z), seedId: z.seedId };
    expect(generateZone(9, { ...spec, x0: z.x0, y0: z.y0 })).toEqual(generateZone(9, { ...spec, x0: 999, y0: -42 }));
  });

  it('fades the finished level out and the next one in while sliding', () => {
    const L = createClassicLayout('medium');
    L.setCurrent(3);
    expect(L.alphaFor!(L.levelZone(3), 0)).toBe(1);
    L.slideTo(4, 1000, 800);
    expect(L.zonesInRect(-1e6, -1e6, 1e6, 1e6)).toEqual([L.levelZone(3), L.levelZone(4)]);
    expect(L.animating!()).toBe(true);
    const a = (n: number, t: number) => L.alphaFor!(L.levelZone(n), t);
    // old level: full for the first half, then down to 0
    expect(a(3, 1000)).toBe(1);
    expect(a(3, 1400)).toBe(1);
    expect(a(3, 1600)).toBeCloseTo(0.5);
    expect(a(3, 1800)).toBe(0);
    // new level: up to full over the first half
    expect(a(4, 1000)).toBe(0);
    expect(a(4, 1200)).toBeCloseTo(0.5);
    expect(a(4, 1400)).toBe(1);
    L.endSlide();
    expect(L.zonesInRect(-1e6, -1e6, 1e6, 1e6)).toEqual([L.levelZone(4)]);
    expect(a(4, 1000)).toBe(1);
    expect(L.animating!()).toBe(false);
  });
});
