/** World state: which zones are unlocked/solved and what the player has drawn. */
import { zoneDistance } from './generator';
import type { SaveData } from './storage';
import { ZONE, rectArea, rectContains, rectsOverlap, type Puzzle, type Rect } from './types';

export const zkey = (zx: number, zy: number) => `${zx},${zy}`;
export const parseKey = (k: string): [number, number] => {
  const [a, b] = k.split(',').map(Number);
  return [a, b];
};
export const NEIGHBORS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export type ZoneStatus = 'locked' | 'open' | 'solved';

export class World {
  solved: Set<string>;
  solvedAt = new Map<string, number>();
  constructor(public save: SaveData) {
    this.solved = new Set(save.solved);
  }

  status(zx: number, zy: number): ZoneStatus {
    const k = zkey(zx, zy);
    if (this.solved.has(k)) return 'solved';
    if (zx === 0 && zy === 0) return 'open';
    for (const [dx, dy] of NEIGHBORS) if (this.solved.has(zkey(zx + dx, zy + dy))) return 'open';
    return 'locked';
  }

  rects(k: string): Rect[] {
    return this.save.rects[k] ?? [];
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

  rectAt(k: string, r: number, c: number): Rect | undefined {
    return this.rects(k).find((q) => rectContains(q, r, c));
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

  isComplete(k: string, p: Puzzle): boolean {
    const list = this.rects(k);
    let area = 0;
    for (const q of list) {
      if (World.matchClue(p, q) < 0) return false;
      area += rectArea(q);
    }
    return area === ZONE * ZONE && list.length === p.clues.length;
  }

  markSolved(k: string, p: Puzzle) {
    this.solved.add(k);
    this.save.solved = [...this.solved];
    this.solvedAt.set(k, performance.now());
    // keep the player's tiling (it is the solution) for display
    this.save.rects[k] = p.solution.map((q) => ({ ...q }));
    delete this.save.timers[k];
    const [zx, zy] = parseKey(k);
    this.save.stats.farthest = Math.max(this.save.stats.farthest, zoneDistance(zx, zy));
  }

  /** All open zones: unlocked but not yet solved. */
  openZones(): [number, number][] {
    const out: [number, number][] = [];
    const seen = new Set<string>();
    const consider = (x: number, y: number) => {
      const k = zkey(x, y);
      if (seen.has(k)) return;
      seen.add(k);
      if (this.status(x, y) === 'open') out.push([x, y]);
    };
    consider(0, 0);
    for (const k of this.solved) {
      const [x, y] = parseKey(k);
      for (const [dx, dy] of NEIGHBORS) consider(x + dx, y + dy);
    }
    return out;
  }

  /** Nearest open zone to (fx, fy); ties prefer zones closer to the origin. */
  nearestOpen(fx: number, fy: number): [number, number] | null {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const [x, y] of this.openZones()) {
      const d = Math.hypot(x - fx, y - fy) + zoneDistance(x, y) * 0.001;
      if (d < bestD) {
        bestD = d;
        best = [x, y];
      }
    }
    return best;
  }
}
