/** Fixed: one tile size everywhere. Depth = ring index around the start zone. */
import { ZonePool, type WorldLayout, type Zone } from './types';

export const FIXED_SIZES = [6, 8, 10, 12, 15, 16, 18, 20, 24];

export function createFixedLayout(size: number): WorldLayout {
  const pool = new ZonePool();
  const zoneAtCell = (x: number, y: number): Zone =>
    pool.get(size, Math.floor(x / size) * size, Math.floor(y / size) * size);
  const depthFor = (z: Zone) => Math.max(Math.abs(z.x0), Math.abs(z.y0)) / size + 1;
  return {
    mode: 'fixed',
    origin: zoneAtCell(0, 0),
    centre: [size / 2, size / 2],
    zoneAtCell,
    zonesInRect(x0, y0, x1, y1) {
      const out: Zone[] = [];
      for (let y = Math.floor(y0 / size); y <= Math.floor(y1 / size); y++)
        for (let x = Math.floor(x0 / size); x <= Math.floor(x1 / size); x++) out.push(pool.get(size, x * size, y * size));
      return out;
    },
    depthFor,
    label: (z) => `Depth ${depthFor(z)}`,
    unlockRule: 'step-diagonal',
    expansionBanner: false,
  };
}
