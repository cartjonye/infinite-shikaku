export type ModeId = 'classic' | 'fixed' | 'mosaic' | 'singles';

export interface Zone {
  key: string;
  x0: number;
  y0: number;
  size: number;
}

export type Side = 'l' | 'r' | 't' | 'b';
export const SIDES: Side[] = ['l', 'r', 't', 'b'];

/** A way of carving the infinite plane into square zones. */
export interface WorldLayout {
  mode: ModeId;
  /** the zone that starts unlocked */
  origin: Zone;
  /** world point that counts as "the centre" (distance, initial camera) */
  centre: [number, number];
  zoneAtCell(x: number, y: number): Zone;
  /** all zones intersecting [x0,x1)×[y0,y1) */
  zonesInRect(x0: number, y0: number, x1: number, y1: number): Zone[];
  /** drives puzzle difficulty (1 = easiest) */
  depthFor(z: Zone): number;
  /** short position label for the HUD, e.g. "Depth 7" or "1,250 m" */
  label(z: Zone): string;
  /** show "the world expands" when a new size first unlocks */
  expansionBanner: boolean;
  /**
   * How a locked zone opens:
   * - 'step-diagonal': any neighbour on a side; on a side bordering smaller zones,
   *   the whole side plus one diagonal zone (Classic, Fixed)
   * - 'full-side': every zone along any one side solved, no diagonal (Mosaic)
   * - 'sequence': each zone opens when the one before it is solved (Singles)
   */
  unlockRule: 'step-diagonal' | 'full-side' | 'sequence';
  /** 'sequence' only: the zone after / before this one */
  next?(z: Zone): Zone | null;
  prev?(z: Zone): Zone | null;
}

export const zoneKey = (size: number, x0: number, y0: number) => `${size}@${x0},${y0}`;

/** Canonical zone objects per layout, so zones can be compared by identity. */
export class ZonePool {
  private map = new Map<string, Zone>();
  get(size: number, x0: number, y0: number): Zone {
    const key = zoneKey(size, x0, y0);
    let z = this.map.get(key);
    if (!z) {
      z = { key, x0, y0, size };
      this.map.set(key, z);
    }
    return z;
  }
}

export const mod = (a: number, m: number) => ((a % m) + m) % m;

export function zoneCenter(z: { x0: number; y0: number; size: number }): [number, number] {
  return [z.x0 + z.size / 2, z.y0 + z.size / 2];
}
