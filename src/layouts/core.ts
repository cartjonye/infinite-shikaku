/** Layout-independent zone geometry: neighbours, diagonals, key lookup. */
import { SIDES, type Side, type WorldLayout, type Zone } from './types';

type Caches = {
  nb: Map<string, Record<Side, Zone[]>>;
  diag: Map<string, Zone[]>;
};
const caches = new WeakMap<WorldLayout, Caches>();
function cacheFor(L: WorldLayout): Caches {
  let c = caches.get(L);
  if (!c) {
    c = { nb: new Map(), diag: new Map() };
    caches.set(L, c);
  }
  return c;
}

export function zoneByKey(L: WorldLayout, key: string): Zone | null {
  const m = /^(\d+)@(-?\d+),(-?\d+)$/.exec(key);
  if (!m) return null;
  const size = Number(m[1]);
  const x0 = Number(m[2]);
  const y0 = Number(m[3]);
  const z = L.zoneAtCell(x0, y0);
  return z.x0 === x0 && z.y0 === y0 && z.size === size ? z : null;
}

/** Distinct zones sharing each edge, ordered along the edge. */
export function edgeNeighbours(L: WorldLayout, z: Zone): Record<Side, Zone[]> {
  const c = cacheFor(L).nb;
  let res = c.get(z.key);
  if (res) return res;
  const along = (f: (i: number) => [number, number]) => {
    const out: Zone[] = [];
    for (let i = 0; i < z.size; i++) {
      const n = L.zoneAtCell(...f(i));
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
  c.set(z.key, res);
  return res;
}

/** Does this side border any zone smaller than z (a size-step side)? */
export function isStepSide(L: WorldLayout, z: Zone, side: Side): boolean {
  return edgeNeighbours(L, z)[side].some((n) => n.size < z.size);
}

/**
 * The two "diagonal" zones of a side: the first zone past each end of the side,
 * walking along the same boundary line and skipping zones already on the side.
 */
export function diagonalZones(L: WorldLayout, z: Zone, side: Side): Zone[] {
  const c = cacheFor(L).diag;
  const ck = z.key + side;
  let res = c.get(ck);
  if (res) return res;
  const list = new Set(edgeNeighbours(L, z)[side]);
  const vertical = side === 'l' || side === 'r';
  const line = side === 'l' ? z.x0 - 1 : side === 'r' ? z.x0 + z.size : side === 't' ? z.y0 - 1 : z.y0 + z.size;
  const at = (p: number) => (vertical ? L.zoneAtCell(line, p) : L.zoneAtCell(p, line));
  const start = vertical ? z.y0 : z.x0;
  let n = at(start - 1);
  while (list.has(n)) n = at((vertical ? n.y0 : n.x0) - 1);
  const before = n;
  n = at(start + z.size);
  while (list.has(n)) n = at((vertical ? n.y0 : n.x0) + n.size);
  res = [before, n];
  c.set(ck, res);
  return res;
}

/** Shared span [a, b) along the edge between z and its neighbour n on the given side. */
export function sharedSpan(z: Zone, n: Zone, side: Side): [number, number] {
  if (side === 'l' || side === 'r') return [Math.max(z.y0, n.y0), Math.min(z.y0 + z.size, n.y0 + n.size)];
  return [Math.max(z.x0, n.x0), Math.min(z.x0 + z.size, n.x0 + n.size)];
}

export function allNeighbours(L: WorldLayout, z: Zone): Zone[] {
  const nb = edgeNeighbours(L, z);
  return SIDES.flatMap((s) => nb[s]);
}
