/** World state: which zones are unlocked/solved and what the player has drawn. */
import {
  ORIGIN,
  SIDES,
  edgeNeighbours,
  zoneByKey,
  zoneCenter,
  zoneDistance,
  type Side,
  type Zone,
} from './layout';
import type { SaveData } from './storage';
import { rectArea, rectContains, rectsOverlap, type Puzzle, type Rect } from './types';

export type ZoneStatus = 'locked' | 'open' | 'solved';

export class World {
  solved: Set<string>;
  solvedAt = new Map<string, number>();
  constructor(public save: SaveData) {
    this.solved = new Set(save.solved);
  }

  isSolved(z: Zone) {
    return this.solved.has(z.key);
  }

  /** For each side: how many of the zones along it are solved, out of how many. */
  sideProgress(z: Zone): Record<Side, [number, number]> {
    const nb = edgeNeighbours(z);
    const out = {} as Record<Side, [number, number]>;
    for (const s of SIDES) out[s] = [nb[s].filter((n) => this.solved.has(n.key)).length, nb[s].length];
    return out;
  }

  /**
   * 8×8 zones open when any edge neighbour is solved.
   * Bigger ("super") zones open only when every neighbour along at least one whole side is solved.
   */
  status(z: Zone): ZoneStatus {
    if (this.solved.has(z.key)) return 'solved';
    if (z === ORIGIN) return 'open';
    const nb = edgeNeighbours(z);
    if (z.tier === 0) {
      for (const s of SIDES) if (nb[s].some((n) => this.solved.has(n.key))) return 'open';
      return 'locked';
    }
    for (const s of SIDES) if (nb[s].every((n) => this.solved.has(n.key))) return 'open';
    return 'locked';
  }

  rects(k: string): Rect[] {
    return this.save.rects[k] ?? [];
  }

  /** Rectangles to display: the solution for solved zones, the player's drawing otherwise. */
  shownRects(z: Zone, p: Puzzle): Rect[] {
    return this.solved.has(z.key) ? p.solution : this.rects(z.key);
  }

  /** Place a rectangle, replacing any overlapping ones. */
  place(k: string, q: Rect) {
    const kept = this.rects(k).filter((o) => !rectsOverlap(o, q));
    kept.push(q);
    this.save.rects[k] = kept;
  }

  removeAt(k: string, r: number, c: number): boolean {
    const list = this.rects(k);
    const i = list.findIndex((q) => rectContains(q, r, c));
    if (i < 0) return false;
    list.splice(i, 1);
    if (list.length) this.save.rects[k] = list;
    else delete this.save.rects[k];
    return true;
  }

  /** Index of the single clue a rect satisfies, or -1. */
  static matchClue(p: Puzzle, q: Rect): number {
    let found = -1;
    for (let i = 0; i < p.clues.length; i++) {
      const k = p.clues[i];
      if (rectContains(q, k.r, k.c)) {
        if (found >= 0) return -1;
        found = i;
      }
    }
    if (found < 0 || p.clues[found].v !== rectArea(q)) return -1;
    return found;
  }

  isComplete(z: Zone, p: Puzzle): boolean {
    const list = this.rects(z.key);
    let area = 0;
    for (const q of list) {
      if (World.matchClue(p, q) < 0) return false;
      area += rectArea(q);
    }
    return area === z.size * z.size && list.length === p.clues.length;
  }

  markSolved(z: Zone, _p?: Puzzle) {
    this.solved.add(z.key);
    this.save.solved = [...this.solved];
    this.solvedAt.set(z.key, performance.now());
    // solved zones render from the (deterministic) solution, so no need to store their rects
    delete this.save.rects[z.key];
    delete this.save.timers[z.key];
    this.save.stats.farthest = Math.max(this.save.stats.farthest, zoneDistance(z));
  }

  /** All open zones: unlocked but not yet solved. */
  openZones(): Zone[] {
    const out: Zone[] = [];
    const seen = new Set<string>();
    const consider = (z: Zone) => {
      if (seen.has(z.key)) return;
      seen.add(z.key);
      if (this.status(z) === 'open') out.push(z);
    };
    consider(ORIGIN);
    for (const k of this.solved) {
      const z = zoneByKey(k);
      if (!z) continue;
      const nb = edgeNeighbours(z);
      for (const s of SIDES) nb[s].forEach(consider);
    }
    return out;
  }

  /** Nearest open zone to a world point; ties prefer zones closer to the origin. */
  nearestOpen(wx: number, wy: number): Zone | null {
    let best: Zone | null = null;
    let bestD = Infinity;
    for (const z of this.openZones()) {
      const [cx, cy] = zoneCenter(z);
      const d = Math.hypot(cx - wx, cy - wy) + zoneDistance(z) * 0.001;
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    return best;
  }
}
