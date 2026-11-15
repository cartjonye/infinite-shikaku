import { describe, expect, it } from 'vitest';
import {
  ORIGIN,
  SIDES,
  TIERS,
  diagonalZones,
  edgeNeighbours,
  innerOf,
  isStepSide,
  zoneAtCell,
  zoneByKey,
  zoneDepth,
  zonesInRect,
} from '../src/layout';
import { freshSave } from '../src/storage';
import { World } from '../src/world';

const EXPECTED = [
  { size: 6, zones: 144, depth: [1, 6] },
  { size: 8, zones: 144, depth: [7, 9] },
  { size: 10, zones: 180, depth: [10, 12] },
  { size: 12, zones: 400, depth: [13, 17] },
  { size: 15, zones: 624, depth: [18, 23] },
  { size: 16, zones: 396, depth: [24, 26] },
  { size: 18, zones: 576, depth: [27, 30] },
  { size: 20, zones: 468, depth: [31, 33] },
];

describe('layout', () => {
  it('tiles every cell exactly once (no gaps or overlaps) out past the 24x24 boundary', () => {
    const R = 460;
    const count = new Map<string, number>();
    for (let y = -R; y < R; y++)
      for (let x = -R; x < R; x++) {
        const z = zoneAtCell(x, y);
        if (!(x >= z.x0 && x < z.x0 + z.size && y >= z.y0 && y < z.y0 + z.size)) throw new Error(`${x},${y} -> ${z.key}`);
        count.set(z.key, (count.get(z.key) ?? 0) + 1);
      }
    for (const [key, n] of count) {
      const z = zoneByKey(key)!;
      expect(z).not.toBeNull();
      if (z.x0 >= -R && z.y0 >= -R && z.x0 + z.size <= R && z.y0 + z.size <= R) expect(n).toBe(z.size * z.size);
    }
  }, 60000);

  it('has the planned ring sizes, zone counts and depths', () => {
    expect(TIERS.map((t) => t.size)).toEqual([6, 8, 10, 12, 15, 16, 18, 20, 24]);
    const all = zonesInRect(-430, -430, 430, 430);
    EXPECTED.forEach((e, i) => {
      const zs = all.filter((z) => z.tier === i);
      expect(zs.length).toBe(e.zones);
      expect(zs.every((z) => z.size === e.size)).toBe(true);
      const depths = zs.map(zoneDepth);
      expect([Math.min(...depths), Math.max(...depths)]).toEqual(e.depth);
      // the tier exactly fills its square ring
      const area = zs.reduce((s, z) => s + z.size * z.size, 0);
      expect(area).toBe((2 * TIERS[i].outer) ** 2 - (2 * innerOf(i)) ** 2);
    });
    expect(zoneDepth(zoneAtCell(425, 0))).toBe(34);
  });

  it('starts at the 6x6 zone touching the centre', () => {
    expect(ORIGIN.key).toBe('6@0,0');
    expect(zoneDepth(ORIGIN)).toBe(1);
  });

  it('edge neighbours are symmetric', () => {
    for (const z of zonesInRect(-300, -300, 300, 300)) {
      const nb = edgeNeighbours(z);
      for (const s of SIDES)
        for (const n of nb[s]) expect(SIDES.some((t) => edgeNeighbours(n)[t].includes(z))).toBe(true);
    }
  });

  it('a step side needs the whole side plus one diagonal zone', () => {
    const z = zoneAtCell(37, 3); // 8x8 just outside the 6x6 core
    expect(z.size).toBe(8);
    expect(isStepSide(z, 'l')).toBe(true);
    const side = edgeNeighbours(z).l;
    expect(side.every((n) => n.size === 6)).toBe(true);
    const diags = diagonalZones(z, 'l');
    expect(diags.some((d) => side.includes(d))).toBe(false);
    const save = freshSave();
    save.solved = side.map((n) => n.key);
    expect(new World(save).status(z)).toBe('locked');
    save.solved = [...side.map((n) => n.key), diags[0].key];
    expect(new World(save).status(z)).toBe('open');
    // only the diagonal is not enough
    save.solved = [diags[0].key, side[0].key];
    expect(new World(save).status(z)).toBe('locked');
  });

  it('same-size and smaller zones still open from any single neighbour', () => {
    const save = freshSave();
    const a = zoneAtCell(37, 3);
    const b = zoneByKey(`8@${a.x0},${a.y0 + 8}`)!;
    save.solved = [a.key];
    expect(new World(save).status(b)).toBe('open');
    const small = edgeNeighbours(a).l[0];
    expect(new World(save).status(small)).toBe('open');
  });
});
