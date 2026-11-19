/**
 * Journey (a World mode): concentric square rings of ever larger zones around the start.
 *
 * The world centre is the cell corner (0, 0), where four 6×6 zones meet.
 * A ring of s×s tiles closes seamlessly only if every boundary's full side is a
 * multiple of both sizes that meet there and each ring's width is a multiple of s:
 *
 *   size  full side  rings  depth
 *   6×6       72      6     1–6     72 = 12·6  = 9·8
 *   8×8      120      3     7–9    120 = 15·8  = 12·10
 *   10×10    180      3    10–12   180 = 18·10 = 15·12
 *   12×12    300      5    13–17   300 = 25·12 = 20·15
 *   15×15    480      6    18–23   480 = 32·15 = 30·16
 *   16×16    576      3    24–26   576 = 36·16 = 32·18
 *   18×18    720      4    27–30   720 = 40·18 = 36·20
 *   20×20    840      3    31–33   840 = 42·20 = 35·24
 *   24×24     ∞       ∞    34+
 */
import { ZonePool, mod, zoneCenter, type WorldLayout, type Zone } from './types';

export interface Ring {
  size: number;
  /** lattice offset: tiles start at x ≡ anchor (mod size) */
  anchor: number;
  /** outer half-side (Chebyshev radius, in cells) of this ring's square */
  outer: number;
  /** total rings in all inner sizes */
  ringsBefore: number;
}

const RAW: [number, number][] = [
  [6, 36],
  [8, 60],
  [10, 90],
  [12, 150],
  [15, 240],
  [16, 288],
  [18, 360],
  [20, 420],
  [24, Infinity],
];

export const JOURNEY_RINGS: Ring[] = (() => {
  const out: Ring[] = [];
  let inner = 0;
  let rings = 0;
  for (const [size, outer] of RAW) {
    out.push({ size, anchor: mod(-inner, size), outer, ringsBefore: rings });
    if (isFinite(outer)) rings += (outer - inner) / size;
    inner = outer;
  }
  return out;
})();

export const ringInner = (t: number) => (t === 0 ? 0 : JOURNEY_RINGS[t - 1].outer);

export function ringOfPoint(x: number, y: number): number {
  const rad = Math.max(Math.abs(x), Math.abs(y));
  for (let t = 0; t < JOURNEY_RINGS.length; t++) if (rad < JOURNEY_RINGS[t].outer) return t;
  return JOURNEY_RINGS.length - 1;
}

export function journeyDepth(z: { x0: number; y0: number; size: number }): number {
  const [cx, cy] = zoneCenter(z);
  const t = ringOfPoint(cx, cy);
  const cheb = Math.max(Math.abs(cx), Math.abs(cy));
  return JOURNEY_RINGS[t].ringsBefore + Math.floor((cheb - ringInner(t)) / JOURNEY_RINGS[t].size) + 1;
}

export function createJourneyLayout(): WorldLayout {
  const pool = new ZonePool();
  const zoneAtCell = (x: number, y: number): Zone => {
    const t = ringOfPoint(x + 0.5, y + 0.5);
    const { size, anchor } = JOURNEY_RINGS[t];
    return pool.get(size, x - mod(x - anchor, size), y - mod(y - anchor, size));
  };
  return {
    mode: 'journey',
    origin: zoneAtCell(0, 0),
    centre: [0, 0],
    zoneAtCell,
    zonesInRect(x0, y0, x1, y1) {
      const out: Zone[] = [];
      for (let t = 0; t < JOURNEY_RINGS.length; t++) {
        const { size, anchor, outer } = JOURNEY_RINGS[t];
        const inner = ringInner(t);
        if (x1 < -outer || x0 > outer || y1 < -outer || y0 > outer) continue;
        if (t > 0 && x0 >= -inner && x1 <= inner && y0 >= -inner && y1 <= inner) continue;
        const ax = Math.floor((Math.max(x0, -outer) - anchor) / size);
        const bx = Math.floor((Math.min(x1, outer) - anchor) / size);
        const ay = Math.floor((Math.max(y0, -outer) - anchor) / size);
        const by = Math.floor((Math.min(y1, outer) - anchor) / size);
        for (let iy = ay; iy <= by; iy++)
          for (let ix = ax; ix <= bx; ix++) {
            const zx = anchor + ix * size;
            const zy = anchor + iy * size;
            if (ringOfPoint(zx + size / 2, zy + size / 2) === t) out.push(pool.get(size, zx, zy));
          }
      }
      return out;
    },
    depthFor: journeyDepth,
    label: (z) => `Depth ${journeyDepth(z)}`,
    unlockRule: 'step-diagonal',
    expansionBanner: true,
  };
}
