import { describe, expect, it } from 'vitest';
import { ORIGIN, SIDES, TIERS, edgeNeighbours, zoneAtCell, zoneByKey, zonesInRect } from '../src/layout';
import { freshSave } from '../src/storage';
import { World } from '../src/world';

describe('layout', () => {
  it('tiles every cell exactly once with no gaps or overlaps', () => {
    const R = 260;
    const seen = new Map<string, number>();
    for (let y = -R; y < R; y++)
      for (let x = -R; x < R; x++) {
        const z = zoneAtCell(x, y);
        expect(x >= z.x0 && x < z.x0 + z.size && y >= z.y0 && y < z.y0 + z.size).toBe(true);
        seen.set(z.key, (seen.get(z.key) ?? 0) + 1);
      }
    // every zone fully inside the scanned area must have all size² cells mapping back to it
    for (const [key, n] of seen) {
      const z = zoneByKey(key)!;
      expect(z).not.toBeNull();
      if (z.x0 >= -R && z.y0 >= -R && z.x0 + z.size <= R && z.y0 + z.size <= R) expect(n).toBe(z.size * z.size);
    }
  });

  it('has the expected ring sizes', () => {
    const count: Record<number, number> = {};
    for (const z of zonesInRect(-200, -200, 210, 210)) count[z.size] = (count[z.size] ?? 0) + 1;
    expect(count[8]).toBe(81);
    expect(count[12]).toBe(108);
    expect(count[16]).toBe(144);
    expect(TIERS.map((t) => t.size)).toEqual([8, 12, 16, 20]);
  });

  it('keeps legacy 8x8 keys and origin', () => {
    expect(ORIGIN.key).toBe('0,0');
    expect(zoneAtCell(-32, 39).key).toBe('-4,4');
    expect(zoneAtCell(40, 0).size).toBe(12);
    expect(zoneByKey('5,0')).toBeNull(); // now part of the 12×12 ring
  });

  it('edge neighbours are symmetric', () => {
    for (const z of zonesInRect(-140, -140, 150, 150)) {
      const nb = edgeNeighbours(z);
      for (const s of SIDES)
        for (const n of nb[s]) {
          const back = edgeNeighbours(n);
          expect(SIDES.some((t) => back[t].includes(z))).toBe(true);
        }
    }
  });

  it('a 12x12 zone needs both 8x8 zones on one side solved', () => {
    const z = zoneAtCell(40, -8); // 12@40,-8 borders 8x8 zones (4,-1) and (4,0)
    expect(z.key).toBe('12@40,-8');
    expect(edgeNeighbours(z).l.map((n) => n.key)).toEqual(['4,-1', '4,0']);
    const save = freshSave();
    save.solved = ['4,-1'];
    expect(new World(save).status(z)).toBe('locked');
    save.solved = ['4,-1', '4,0'];
    expect(new World(save).status(z)).toBe('open');
    // 8x8 zones still unlock from any single neighbour
    save.solved = ['12@40,-8'];
    expect(new World(save).status(zoneByKey('4,0')!)).toBe('open');
  });
});
