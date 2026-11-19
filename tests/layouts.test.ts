import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SIDES,
  SUPER,
  JOURNEY_RINGS,
  createFocusedLayout,
  createJourneyLayout,
  createMosaicLayout,
  diagonalZones,
  edgeNeighbours,
  ringInner,
  isStepSide,
  zoneByKey,
  zoneCenter,
  type WorldLayout,
} from '../src/layouts';
import { freshSave } from '../src/storage';
import { createTiler, parseSeed, validate } from '../src/vendor/tiling';
import { World } from '../src/world';

const tiler = createTiler(readFileSync(new URL('../public/tilings_66x66.packed.txt', import.meta.url), 'utf8'));

/** Every cell in the box maps to a zone containing it, and every interior zone owns exactly size² cells. */
function checkTiling(L: WorldLayout, R: number) {
  const count = new Map<string, number>();
  for (let y = -R; y < R; y++)
    for (let x = -R; x < R; x++) {
      const z = L.zoneAtCell(x, y);
      if (!(x >= z.x0 && x < z.x0 + z.size && y >= z.y0 && y < z.y0 + z.size)) throw new Error(`${x},${y} -> ${z.key}`);
      count.set(z.key, (count.get(z.key) ?? 0) + 1);
    }
  for (const [key, n] of count) {
    const z = zoneByKey(L, key)!;
    expect(z).not.toBeNull();
    if (z.x0 >= -R && z.y0 >= -R && z.x0 + z.size <= R && z.y0 + z.size <= R) expect(n).toBe(z.size * z.size);
  }
}

function checkSymmetricNeighbours(L: WorldLayout, R: number) {
  for (const z of L.zonesInRect(-R, -R, R, R)) {
    const nb = edgeNeighbours(L, z);
    for (const s of SIDES) for (const n of nb[s]) expect(SIDES.some((t) => edgeNeighbours(L, n)[t].includes(z))).toBe(true);
  }
}

describe('Journey', () => {
  const L = createJourneyLayout();
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

  it('tiles the plane exactly', () => checkTiling(L, 460), 60000);

  it('keeps the planned ring sizes, zone counts and depths', () => {
    const all = L.zonesInRect(-430, -430, 430, 430);
    EXPECTED.forEach((e, i) => {
      const zs = all.filter((z) => {
        const [cx, cy] = zoneCenter(z);
        const r = Math.max(Math.abs(cx), Math.abs(cy));
        return r >= ringInner(i) && r < JOURNEY_RINGS[i].outer;
      });
      expect(zs.length).toBe(e.zones);
      expect(zs.every((z) => z.size === e.size)).toBe(true);
      const d = zs.map(L.depthFor);
      expect([Math.min(...d), Math.max(...d)]).toEqual(e.depth);
    });
    expect(L.origin.key).toBe('6@0,0');
    expect(L.label(L.origin)).toBe('Depth 1');
  });

  it('has symmetric neighbours', () => checkSymmetricNeighbours(L, 300));

  it('needs a whole side plus one diagonal at a size step', () => {
    const z = L.zoneAtCell(37, 3);
    expect(z.size).toBe(8);
    expect(isStepSide(L, z, 'l')).toBe(true);
    const side = edgeNeighbours(L, z).l;
    const diags = diagonalZones(L, z, 'l');
    expect(diags.some((d) => side.includes(d))).toBe(false);
    const save = freshSave('journey');
    save.solved = side.map((n) => n.key);
    expect(new World(L, save).status(z)).toBe('locked');
    save.solved = [...side.map((n) => n.key), diags[0].key];
    expect(new World(L, save).status(z)).toBe('open');
  });
});

describe('Mosaic', () => {
  it('vendored tiler reproduces the handoff fingerprints', () => {
    const pyRepr = (sq: number[][]) =>
      '[' +
      sq
        .map((q) => [...q])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
        .map((q) => `(${q[0]}, ${q[1]}, ${q[2]})`)
        .join(', ') +
      ']';
    const fp = (seed: number | string) => createHash('sha1').update(pyRepr(tiler.layout(seed))).digest('hex').slice(0, 12);
    expect(fp(0)).toBe('4a9b9ac2cf01');
    expect(fp(12345)).toBe('166012158d54');
    expect(fp(86624)).toBe('22afe0e619e4');
    expect(parseSeed('hello')).toBe(3019);
    expect(fp('hello')).toBe('2d0cf52ce8a5');
    expect(fp('tile-me')).toBe('92a440da74ef');
  });

  for (const seed of [1, 42, 99999]) {
    const L = createMosaicLayout(seed, tiler);
    it(`world ${seed}: valid supertiles that tile the plane, symmetric neighbours`, () => {
      checkTiling(L, 2 * SUPER);
      checkSymmetricNeighbours(L, SUPER + 20);
      for (let J = -1; J <= 1; J++)
        for (let I = -1; I <= 1; I++) {
          const sq = L.zonesInRect(I * SUPER, J * SUPER, I * SUPER + SUPER - 1, J * SUPER + SUPER - 1)
            .filter((z) => z.x0 >= I * SUPER && z.y0 >= J * SUPER && z.x0 < (I + 1) * SUPER && z.y0 < (J + 1) * SUPER)
            .map((z) => [z.x0 - I * SUPER, z.y0 - J * SUPER, z.size] as [number, number, number]);
          expect(sq.length).toBe(28);
          expect(validate(sq)).toBe(true);
        }
    });

    it(`world ${seed}: origin is the 6x6 nearest the first supertile's centre`, () => {
      expect(L.origin.size).toBe(6);
      const d = (z: { x0: number; y0: number }) => Math.hypot(z.x0 + 3 - 33, z.y0 + 3 - 33);
      const sixes = L.zonesInRect(0, 0, 65, 65).filter((z) => z.size === 6 && z.x0 >= 0 && z.y0 >= 0 && z.x0 < 66 && z.y0 < 66);
      expect(sixes.length).toBe(5);
      expect(Math.min(...sixes.map(d))).toBe(d(L.origin));
      expect(L.label(L.origin)).toBe('0 m');
    });
  }

  it('never soft-locks: with nothing open, the closest-to-complete frontier zones open', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const L = createMosaicLayout(seed, tiler);
      const save = freshSave('mosaic');
      save.solved = [L.origin.key];
      const w = new World(L, save);
      expect(w.openZones().length).toBeGreaterThan(0);
      // keep solving the first open zone: progress must never stall
      for (let i = 0; i < 25; i++) {
        const open = w.openZones();
        expect(open.length).toBeGreaterThan(0);
        w.markSolved(open[0]);
      }
    }
  });

  it('labels distance in whole metres with a thousands comma', () => {
    const L = createMosaicLayout(7, tiler);
    const far = L.zoneAtCell(L.origin.x0 + 1500, L.origin.y0);
    expect(L.label(far)).toMatch(/^1,\d{3} m$/);
  });

  it('opens a zone when every zone along any one side is solved, no diagonal', () => {
    const L = createMosaicLayout(42, tiler);
    // find a zone with a side that has 2+ smaller neighbours
    const z = L.zonesInRect(-60, -60, 120, 120).find((q) => SIDES.some((s) => edgeNeighbours(L, q)[s].length >= 2))!;
    const side = SIDES.find((s) => edgeNeighbours(L, z)[s].length >= 2)!;
    const nb = edgeNeighbours(L, z)[side];
    const save = freshSave('mosaic');
    save.solved = nb.slice(1).map((n) => n.key);
    expect(new World(L, save).status(z)).toBe(z === L.origin ? 'open' : 'locked');
    save.solved = nb.map((n) => n.key);
    expect(new World(L, save).status(z)).toBe('open');
  });
});

describe('World bookkeeping', () => {
  it('reports unlock progress for every side, not just one', () => {
    const L = createMosaicLayout(42, tiler);
    // a zone with at least two sides that each have several neighbours
    const z = L.zonesInRect(-60, -60, 120, 120).find(
      (q) => q !== L.origin && SIDES.filter((s) => edgeNeighbours(L, q)[s].length >= 2).length >= 2,
    )!;
    const sides = SIDES.filter((s) => edgeNeighbours(L, z)[s].length >= 2).slice(0, 2);
    const save = freshSave('mosaic');
    save.solved = sides.map((s) => edgeNeighbours(L, z)[s][0].key);
    const w = new World(L, save);
    const states = w.sideStates(z);
    expect(states.length).toBe(4);
    for (const s of sides) expect(states.find((st) => st.side === s)!.solved).toBeGreaterThanOrEqual(1);
    expect(w.bestSide(z)).not.toBeNull();
  });

  it('keeps anti-stuck zones open across a reload, even after other zones open', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const L = createMosaicLayout(seed, tiler);
      const save = freshSave('mosaic');
      const w = new World(L, save);
      w.markSolved(L.origin);
      const openKeys = w.openZones().map((z) => z.key).sort();
      const again = new World(L, JSON.parse(JSON.stringify(save)));
      expect(again.openZones().map((z) => z.key).sort()).toEqual(openKeys);
    }
  });

  it('never re-locks a zone that was open', () => {
    const L = createMosaicLayout(5, tiler);
    const w = new World(L, freshSave('mosaic'));
    const everOpen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      for (const z of w.openZones()) everOpen.add(z.key);
      const z = w.nearestOpen(L.centre[0], L.centre[1])!;
      w.markSolved(z);
      for (const k of everOpen) {
        const q = zoneByKey(L, k)!;
        expect(w.status(q)).not.toBe('locked');
      }
    }
  });

  it('keeps the player\'s own tiling if it ever differs from the generated solution', () => {
    const L = createFocusedLayout(6);
    const save = freshSave('focused', { size: 6 });
    const w = new World(L, save);
    const fake = { size: 6, clues: [], solution: [{ r: 0, c: 0, w: 6, h: 6 }], needsSearch: false };
    save.rects[L.origin.key] = [
      { r: 0, c: 0, w: 6, h: 3 },
      { r: 3, c: 0, w: 6, h: 3 },
    ];
    w.markSolved(L.origin, fake);
    expect(w.shownRects(L.origin, fake).length).toBe(2);
    // and nothing is stored when it matches
    const n = L.levelZone(2);
    save.rects[n.key] = [{ r: 0, c: 0, w: 6, h: 6 }];
    w.markSolved(n, fake);
    expect(save.custom[n.key]).toBeUndefined();
    expect(w.shownRects(n, fake)).toBe(fake.solution);
  });
});

describe('drawing rules', () => {
  const p = {
    size: 4,
    clues: [
      { r: 0, c: 0, v: 4 },
      { r: 0, c: 3, v: 4 },
      { r: 3, c: 0, v: 8 },
    ],
    solution: [],
    needsSearch: false,
  };
  it('ignores rectangles that touch no number', () => {
    expect(World.classify(p, { r: 1, c: 1, w: 2, h: 2 })).toBe('none');
  });
  it('accepts exactly one number with a matching area', () => {
    expect(World.classify(p, { r: 0, c: 0, w: 2, h: 2 })).toBe('ok');
    expect(World.classify(p, { r: 2, c: 0, w: 4, h: 2 })).toBe('ok');
  });
  it('fails on a wrong area or several numbers', () => {
    expect(World.classify(p, { r: 0, c: 0, w: 3, h: 1 })).toBe('fail');
    expect(World.classify(p, { r: 0, c: 0, w: 4, h: 1 })).toBe('fail');
  });
});

