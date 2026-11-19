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
      for (const [x, y] of [[z.x0, z.y0], [z.x0 + z.size - 1, z.y0 + z.size - 1], [z.x0 + 3, z.y0 + 2]]) expect(L.zoneAtCell(x, y)).toBe(z);
      expect(L.zoneAtCell(z.x0 + z.size, 0)).not.toBe(z);
      expect(L.levelOf(L.zoneAtCell(z.x0 + z.size, 0))).toBe(0);
      expect(L.levelOf(L.zoneAtCell(z.x0, z.y0 - 1))).toBe(0);
      // every level is centred on the same line, so the slide between sizes stays level
      expect(Math.abs(z.y0 + z.size / 2)).toBeLessThanOrEqual(0.5);
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

describe('Singles saves are keyed by level, not position', async () => {
  const { legacyLevelOf, levelKey, zoneByKey } = await import('../src/layouts');
  const { loadSave, migrateSinglesSave, freshSave: fresh } = await import('../src/storage');

  // minimal localStorage for node
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  };

  // where levels sat on the board in the two earlier versions (4-cell gap)
  const oldKey = (d: 'easy' | 'expert', n: number, version: 1 | 2) => {
    let x = 0;
    for (let i = 1; i < n; i++) x += singlesSize(d, i) + 4;
    const s = singlesSize(d, n);
    return `${s}@${x},${version === 1 ? 0 : -Math.floor(s / 2)}`;
  };

  it('uses level keys and resolves them', () => {
    const L = createSinglesLayout('hard');
    expect(L.levelZone(7).key).toBe('L7');
    expect(zoneByKey(L, 'L7')).toBe(L.levelZone(7));
    expect(zoneByKey(L, '12@0,0')).toBeNull();
  });

  it('seeds each level by its number, so moving it on the board never changes its puzzle', () => {
    const L = createSinglesLayout('medium');
    const z = L.levelZone(5);
    const spec = { size: z.size, depth: L.depthFor(z), seedId: z.seedId };
    expect(generateZone(9, { ...spec, x0: z.x0, y0: z.y0 })).toEqual(generateZone(9, { ...spec, x0: 999, y0: -42 }));
  });

  it('maps old position keys back to level numbers', () => {
    for (const v of [1, 2] as const)
      for (let n = 1; n <= 25; n++) {
        expect(legacyLevelOf('expert', oldKey('expert', n, v), v)).toBe(n);
        expect(legacyLevelOf('easy', oldKey('easy', n, v), v)).toBe(n);
      }
    expect(legacyLevelOf('easy', '6@3,0', 1)).toBe(0);
  });

  for (const version of [1, 2] as const) {
    it(`converts a version ${version} save: 7 solved levels -> continue on level 8, stats kept`, () => {
      mem.clear();
      const old = fresh('singles', undefined, 'easy');
      old.solved = Array.from({ length: 7 }, (_, i) => oldKey('easy', i + 1, version));
      old.rects = { [oldKey('easy', 8, version)]: [{ r: 0, c: 0, w: 2, h: 1 }] };
      old.timers = { [oldKey('easy', 8, version)]: 1234 };
      old.stats.zonesSolved = 7;
      old.stats.totalPlayMs = 99_000;
      mem.set(`infinite-shikaku:singles:v${version}`, JSON.stringify(old));
      const d = loadSave('singles')!;
      expect(d.solved).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']);
      expect(d.stats.zonesSolved).toBe(7);
      expect(d.stats.totalPlayMs).toBe(99_000);
      expect(d.difficulty).toBe('easy');
      expect(d.rects).toEqual({});
      expect(mem.has(`infinite-shikaku:singles:v${version}`)).toBe(false);
      expect(mem.has('infinite-shikaku:singles:v3')).toBe(true);
      const L = createSinglesLayout('easy');
      const w = new World(L, d);
      expect(w.openZones()).toEqual([L.levelZone(8)]);
      expect(levelKey(8)).toBe('L8');
    });
  }

  it('keeps other worlds seeded by position', () => {
    expect(migrateSinglesSave({ v: 1 }, 1)).toBeNull();
    const a = generateZone(3, { x0: 0, y0: 0, size: 8, depth: 1 });
    const b = generateZone(3, { x0: 8, y0: 0, size: 8, depth: 1 });
    expect(a).not.toEqual(b);
  });
});
