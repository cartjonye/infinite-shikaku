/**
 * World layout: concentric square rings of ever larger zones around the start.
 *
 * Centre of the world = centre of the starting zone, cell coordinate (4, 4).
 * A ring of s×s tiles closes seamlessly only if its inner and outer square
 * sides are multiples of s, so every boundary sits on a common multiple:
 *
 *   8×8   radius   0..36   side  72 = 9·8  = 6·12
 *   12×12 radius  36..72   side 144 = 12·12 = 9·16
 *   16×16 radius  72..120  side 240 = 15·16 = 12·20
 *   20×20 radius 120..∞
 */

export const CENTER = 4;

export interface Tier {
  size: number;
  /** lattice offset: tiles start at x ≡ anchor (mod size) */
  anchor: number;
  /** outer Chebyshev radius (in cells) from the centre */
  outer: number;
}

export const TIERS: Tier[] = [
  { size: 8, anchor: 0, outer: 36 },
  { size: 12, anchor: 4, outer: 72 },
  { size: 16, anchor: 12, outer: 120 },
  { size: 20, anchor: 4, outer: Infinity },
];

export interface Zone {
  key: string;
  x0: number;
  y0: number;
  size: number;
  tier: number;
}

export type Side = 'l' | 'r' | 't' | 'b';
export const SIDES: Side[] = ['l', 'r', 't', 'b'];

const mod = (a: number, m: number) => ((a % m) + m) % m;

export function tierOfCell(x: number, y: number): number {
  const rad = Math.max(Math.abs(x + 0.5 - CENTER), Math.abs(y + 0.5 - CENTER));
  for (let t = 0; t < TIERS.length; t++) if (rad < TIERS[t].outer) return t;
  return TIERS.length - 1;
}

const zoneCache = new Map<string, Zone>();

function makeZone(tier: number, x0: number, y0: number): Zone {
  const { size } = TIERS[tier];
  const key = size === 8 ? `${x0 / 8},${y0 / 8}` : `${size}@${x0},${y0}`;
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
  const m = /^(?:(\d+)@)?(-?\d+),(-?\d+)$/.exec(key);
  if (!m) return null;
  const size = m[1] ? Number(m[1]) : 8;
  let x0 = Number(m[2]);
  let y0 = Number(m[3]);
  if (!m[1]) {
    x0 *= 8;
    y0 *= 8;
  }
  const z = zoneAtCell(x0, y0);
  return z.x0 === x0 && z.y0 === y0 && z.size === size ? z : null;
}

export const ORIGIN: Zone = zoneAtCell(0, 0);

export function zoneCenter(z: { x0: number; y0: number; size: number }): [number, number] {
  return [z.x0 + z.size / 2, z.y0 + z.size / 2];
}

/** Distance level used for difficulty: Manhattan distance of zone centre, in 8-cell units. */
export function zoneDistance(z: { x0: number; y0: number; size: number }): number {
  const [cx, cy] = zoneCenter(z);
  return Math.round((Math.abs(cx - CENTER) + Math.abs(cy - CENTER)) / 8);
}

const nbCache = new Map<string, Record<Side, Zone[]>>();

/** Distinct zones sharing each edge, ordered along the edge. */
export function edgeNeighbours(z: Zone): Record<Side, Zone[]> {
  let res = nbCache.get(z.key);
  if (res) return res;
  const collect = (pts: [number, number][]) => {
    const out: Zone[] = [];
    for (const [x, y] of pts) {
      const n = zoneAtCell(x, y);
      if (out[out.length - 1] !== n) out.push(n);
    }
    return out;
  };
  const along = (f: (i: number) => [number, number]) =>
    collect(Array.from({ length: z.size }, (_, i) => f(i)));
  res = {
    l: along((i) => [z.x0 - 1, z.y0 + i]),
    r: along((i) => [z.x0 + z.size, z.y0 + i]),
    t: along((i) => [z.x0 + i, z.y0 - 1]),
    b: along((i) => [z.x0 + i, z.y0 + z.size]),
  };
  nbCache.set(z.key, res);
  return res;
}

/** Length of the shared edge between z and its neighbour n on the given side. */
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
    const inner = t === 0 ? 0 : TIERS[t - 1].outer;
    // skip tiers entirely outside the view
    const lo = CENTER - outer;
    const hi = CENTER + outer;
    if (x1 < lo || x0 > hi || y1 < lo || y0 > hi) continue;
    const ilo = CENTER - inner;
    const ihi = CENTER + inner;
    if (t > 0 && x0 >= ilo && x1 <= ihi && y0 >= ilo && y1 <= ihi) continue;
    const ax = Math.floor((Math.max(x0, lo) - anchor) / size);
    const bx = Math.floor((Math.min(x1, hi) - anchor) / size);
    const ay = Math.floor((Math.max(y0, lo) - anchor) / size);
    const by = Math.floor((Math.min(y1, hi) - anchor) / size);
    for (let iy = ay; iy <= by; iy++)
      for (let ix = ax; ix <= bx; ix++) {
        const zx = anchor + ix * size;
        const zy = anchor + iy * size;
        if (tierOfCell(zx + size / 2, zy + size / 2) === t) out.push(makeZone(t, zx, zy));
      }
  }
  return out;
}
