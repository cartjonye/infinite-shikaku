/**
 * World layout: concentric square rings of ever larger zones around the start.
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

export interface Tier {
  size: number;
  /** lattice offset: tiles start at x ≡ anchor (mod size) */
  anchor: number;
  /** outer half-side (Chebyshev radius, in cells) of this tier's square */
  outer: number;
  /** total rings in all inner tiers */
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

const mod = (a: number, m: number) => ((a % m) + m) % m;

export const TIERS: Tier[] = (() => {
  const out: Tier[] = [];
  let inner = 0;
  let rings = 0;
  for (const [size, outer] of RAW) {
    out.push({ size, anchor: mod(-inner, size), outer, ringsBefore: rings });
    if (isFinite(outer)) rings += (outer - inner) / size;
    inner = outer;
  }
  return out;
})();

export const innerOf = (t: number) => (t === 0 ? 0 : TIERS[t - 1].outer);

export interface Zone {
  key: string;
  x0: number;
  y0: number;
  size: number;
  tier: number;
}

export type Side = 'l' | 'r' | 't' | 'b';
export const SIDES: Side[] = ['l', 'r', 't', 'b'];

export function tierOfPoint(x: number, y: number): number {
  const rad = Math.max(Math.abs(x), Math.abs(y));
  for (let t = 0; t < TIERS.length; t++) if (rad < TIERS[t].outer) return t;
  return TIERS.length - 1;
}

export const tierOfCell = (x: number, y: number) => tierOfPoint(x + 0.5, y + 0.5);

const zoneCache = new Map<string, Zone>();

function makeZone(tier: number, x0: number, y0: number): Zone {
  const { size } = TIERS[tier];
  const key = `${size}@${x0},${y0}`;
  let z = zoneCache.get(key);
  if (!z) {
    z = { key, x0, y0, size, tier };
    zoneCache.set(key, z);
  }
  return z;
}

export function zoneAtCell(x: number, y: number): Zone {
  const t = tierOfCell(x, y);
  const { size, anchor } = TIERS[t];
  return makeZone(t, x - mod(x - anchor, size), y - mod(y - anchor, size));
}

export function zoneByKey(key: string): Zone | null {
  const m = /^(\d+)@(-?\d+),(-?\d+)$/.exec(key);
  if (!m) return null;
  const size = Number(m[1]);
  const x0 = Number(m[2]);
  const y0 = Number(m[3]);
  const z = zoneAtCell(x0, y0);
  return z.x0 === x0 && z.y0 === y0 && z.size === size ? z : null;
}

export const ORIGIN: Zone = zoneAtCell(0, 0);

type Box = { x0: number; y0: number; size: number };

export function zoneCenter(z: Box): [number, number] {
  return [z.x0 + z.size / 2, z.y0 + z.size / 2];
}

/** Depth = ring index counted outward from the centre across all tiers (starts at 1). */
export function zoneDepth(z: Box): number {
  const [cx, cy] = zoneCenter(z);
  const t = tierOfPoint(cx, cy);
  const cheb = Math.max(Math.abs(cx), Math.abs(cy));
  return TIERS[t].ringsBefore + Math.floor((cheb - innerOf(t)) / TIERS[t].size) + 1;
}

const nbCache = new Map<string, Record<Side, Zone[]>>();

/** Distinct zones sharing each edge, ordered along the edge. */
export function edgeNeighbours(z: Zone): Record<Side, Zone[]> {
  let res = nbCache.get(z.key);
  if (res) return res;
  const along = (f: (i: number) => [number, number]) => {
    const out: Zone[] = [];
    for (let i = 0; i < z.size; i++) {
      const n = zoneAtCell(...f(i));
      if (out[out.length - 1] !== n) out.push(n);
    }
    return out;
  };
  res = {
    l: along((i) => [z.x0 - 1, z.y0 + i]),
    r: along((i) => [z.x0 + z.size, z.y0 + i]),
    t: along((i) => [z.x0 + i, z.y0 - 1]),
    b: along((i) => [z.x0 + i, z.y0 + z.size]),
  };
  nbCache.set(z.key, res);
  return res;
}

/** Does this side border any zone smaller than z (a size-change side)? */
export function isStepSide(z: Zone, side: Side): boolean {
  return edgeNeighbours(z)[side].some((n) => n.size < z.size);
}

const diagCache = new Map<string, Zone[]>();

/**
 * The two "diagonal" zones of a side: the first zone past each end of the side,
 * walking along the same boundary line and skipping zones already on the side.
 */
export function diagonalZones(z: Zone, side: Side): Zone[] {
  const ck = z.key + side;
  let res = diagCache.get(ck);
  if (res) return res;
  const list = new Set(edgeNeighbours(z)[side]);
  const vertical = side === 'l' || side === 'r';
  const line = side === 'l' ? z.x0 - 1 : side === 'r' ? z.x0 + z.size : side === 't' ? z.y0 - 1 : z.y0 + z.size;
  const at = (p: number) => (vertical ? zoneAtCell(line, p) : zoneAtCell(p, line));
  const start = vertical ? z.y0 : z.x0;
  let p = start - 1;
  let n = at(p);
  while (list.has(n)) {
    p = (vertical ? n.y0 : n.x0) - 1;
    n = at(p);
  }
  const before = n;
  p = start + z.size;
  n = at(p);
  while (list.has(n)) {
    p = (vertical ? n.y0 : n.x0) + n.size;
    n = at(p);
  }
  res = [before, n];
  diagCache.set(ck, res);
  return res;
}

/** Shared span [a, b) along the edge between z and its neighbour n on the given side. */
export function sharedSpan(z: Zone, n: Zone, side: Side): [number, number] {
  if (side === 'l' || side === 'r') {
    return [Math.max(z.y0, n.y0), Math.min(z.y0 + z.size, n.y0 + n.size)];
  }
  return [Math.max(z.x0, n.x0), Math.min(z.x0 + z.size, n.x0 + n.size)];
}

/** All zones intersecting the world-space rectangle [x0,x1)×[y0,y1). */
export function zonesInRect(x0: number, y0: number, x1: number, y1: number): Zone[] {
  const out: Zone[] = [];
  for (let t = 0; t < TIERS.length; t++) {
    const { size, anchor, outer } = TIERS[t];
    const inner = innerOf(t);
    const lo = -outer;
    const hi = outer;
    if (x1 < lo || x0 > hi || y1 < lo || y0 > hi) continue;
    if (t > 0 && x0 >= -inner && x1 <= inner && y0 >= -inner && y1 <= inner) continue;
    const ax = Math.floor((Math.max(x0, lo) - anchor) / size);
    const bx = Math.floor((Math.min(x1, hi) - anchor) / size);
    const ay = Math.floor((Math.max(y0, lo) - anchor) / size);
    const by = Math.floor((Math.min(y1, hi) - anchor) / size);
    for (let iy = ay; iy <= by; iy++)
      for (let ix = ax; ix <= bx; ix++) {
        const zx = anchor + ix * size;
        const zy = anchor + iy * size;
        if (tierOfPoint(zx + size / 2, zy + size / 2) === t) out.push(makeZone(t, zx, zy));
      }
  }
  return out;
}
