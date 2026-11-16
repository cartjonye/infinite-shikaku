/**
 * Mosaic: an endless grid of 66×66 supertiles, each a random gap-free tiling by
 * squares 6, 8, 10, 12, 15, 16, 18, 20, 24 from the square-tiling-66 dataset.
 * The start is the 6×6 square nearest the centre of supertile (0, 0); positions
 * are labelled by straight-line distance to it (1 cell = 1 m).
 */
import { hashInts } from '../rng';
import { TOTAL, type Tiler } from '../vendor/tiling';
import { ZonePool, zoneCenter, type WorldLayout, type Zone } from './types';

export const SUPER = 66;
const CACHE_LIMIT = 256;

export function supertileSeed(worldSeed: number, I: number, J: number) {
  return hashInts(worldSeed, I, J, 0x6d6f73) % TOTAL;
}

export function formatMetres(m: number) {
  return `${Math.round(m).toLocaleString('en-US')} m`;
}

export function createMosaicLayout(worldSeed: number, tiler: Tiler): WorldLayout & { metres(z: Zone): number } {
  const pool = new ZonePool();
  // per supertile: owner grid (cell -> zone)
  const grids = new Map<string, Zone[]>();
  const supertile = (I: number, J: number): Zone[] => {
    const k = `${I},${J}`;
    let g = grids.get(k);
    if (g) {
      grids.delete(k);
      grids.set(k, g); // LRU bump
      return g;
    }
    g = new Array<Zone>(SUPER * SUPER);
    for (const [x, y, s] of tiler.layout(supertileSeed(worldSeed, I, J))) {
      const z = pool.get(s, I * SUPER + x, J * SUPER + y);
      for (let r = y; r < y + s; r++) for (let c = x; c < x + s; c++) g[r * SUPER + c] = z;
    }
    grids.set(k, g);
    if (grids.size > CACHE_LIMIT) grids.delete(grids.keys().next().value!);
    return g;
  };
  const zoneAtCell = (x: number, y: number): Zone => {
    const I = Math.floor(x / SUPER);
    const J = Math.floor(y / SUPER);
    return supertile(I, J)[(y - J * SUPER) * SUPER + (x - I * SUPER)];
  };

  // the 6×6 zone nearest the middle of the first supertile
  const first = tiler.layout(supertileSeed(worldSeed, 0, 0));
  let best: [number, number, number] | null = null;
  let bestD = Infinity;
  for (const q of first) {
    if (q[2] !== 6) continue;
    const d = Math.hypot(q[0] + 3 - SUPER / 2, q[1] + 3 - SUPER / 2);
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) < 1e-9 && best && (q[1] < best[1] || (q[1] === best[1] && q[0] < best[0])))) {
      bestD = d;
      best = q;
    }
  }
  const origin = zoneAtCell(best![0], best![1]);
  const centre = zoneCenter(origin);
  const metres = (z: Zone) => {
    const [cx, cy] = zoneCenter(z);
    return Math.hypot(cx - centre[0], cy - centre[1]);
  };

  return {
    mode: 'mosaic',
    origin,
    centre,
    zoneAtCell,
    zonesInRect(x0, y0, x1, y1) {
      const seen = new Set<Zone>();
      for (let J = Math.floor(y0 / SUPER); J <= Math.floor(y1 / SUPER); J++)
        for (let I = Math.floor(x0 / SUPER); I <= Math.floor(x1 / SUPER); I++) {
          const g = supertile(I, J);
          for (const z of g) {
            if (seen.has(z)) continue;
            if (z.x0 + z.size < x0 || z.x0 > x1 || z.y0 + z.size < y0 || z.y0 > y1) continue;
            seen.add(z);
          }
        }
      return [...seen];
    },
    depthFor: (z) => 1 + metres(z) / 12.5,
    label: (z) => formatMetres(metres(z)),
    unlockRule: 'full-side',
    expansionBanner: false,
    metres,
  };
}

let tilerPromise: Promise<Tiler> | null = null;
/** Fetch the packed tiling table (≈600 KB) once, on first use of Mosaic. */
export function loadTiler(url: string): Promise<Tiler> {
  if (!tilerPromise) {
    tilerPromise = import('../vendor/tiling').then(async ({ createTiler }) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`tiles: HTTP ${res.status}`);
      return createTiler(await res.text());
    });
    tilerPromise.catch(() => (tilerPromise = null));
  }
  return tilerPromise;
}
