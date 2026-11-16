/** World state: which zones are unlocked/solved and what the player has drawn. */
import {
  SIDES,
  diagonalZones,
  edgeNeighbours,
  isStepSide,
  zoneByKey,
  zoneCenter,
  type Side,
  type WorldLayout,
  type Zone,
} from './layouts';
import type { SaveData } from './storage';
import { rectArea, rectContains, rectsOverlap, type Puzzle, type Rect } from './types';

export type ZoneStatus = 'locked' | 'open' | 'solved';

export interface SideState {
  side: Side;
  /** true when the side borders smaller zones (whole side + 1 diagonal needed) */
  step: boolean;
  solved: number;
  total: number;
  diagSolved: boolean;
  /** whether this side also needs a diagonal zone */
  needsDiag: boolean;
  satisfied: boolean;
}

export class World {
  solved: Set<string>;
  solvedAt = new Map<string, number>();
  constructor(
    public layout: WorldLayout,
    public save: SaveData,
  ) {
    this.solved = new Set(save.solved);
  }

  isSolved(z: Zone) {
    return this.solved.has(z.key);
  }

  sideState(z: Zone, side: Side): SideState {
    const nb = edgeNeighbours(this.layout, z)[side];
    const solved = nb.filter((n) => this.solved.has(n.key)).length;
    const total = nb.length;
    if (this.layout.unlockRule === 'full-side') {
      // Mosaic: every zone along the side, no diagonal
      return { side, step: total > 1, solved, total, diagSolved: true, needsDiag: false, satisfied: solved === total };
    }
    const step = isStepSide(this.layout, z, side);
    if (!step) return { side, step, solved, total, diagSolved: false, needsDiag: false, satisfied: solved > 0 };
    const diagSolved = diagonalZones(this.layout, z, side).some((d) => this.solved.has(d.key));
    return { side, step, solved, total, diagSolved, needsDiag: true, satisfied: solved === total && diagSolved };
  }

  /** The step side closest to being satisfied (for progress hints), or null. */
  bestStepSide(z: Zone): SideState | null {
    let best: SideState | null = null;
    const score = (s: SideState) => s.solved / s.total + (s.needsDiag && s.diagSolved ? 0.5 : 0);
    for (const side of SIDES) {
      const st = this.sideState(z, side);
      if (!st.step) continue;
      if (!best || score(st) > score(best)) best = st;
    }
    return best;
  }

  /**
   * A zone opens through any satisfied side:
   * - a side with no smaller neighbours: any neighbour on it solved;
   * - a side bordering smaller zones: every zone on it solved, plus one diagonal zone.
   */
  status(z: Zone): ZoneStatus {
    if (this.solved.has(z.key)) return 'solved';
    if (z === this.layout.origin) return 'open';
    for (const side of SIDES) if (this.sideState(z, side).satisfied) return 'open';
    if (this.fallback().has(z.key)) return 'open';
    return 'locked';
  }

  private fallbackCache: Set<string> | null = null;

  /**
   * Anti-soft-lock: if the normal rules leave no zone open (e.g. in Mosaic, a small
   * zone surrounded only by bigger zones), open the frontier zone(s) whose best side
   * is closest to complete. Derived purely from the solved set, so nothing extra is saved.
   */
  private fallback(): Set<string> {
    if (this.fallbackCache) return this.fallbackCache;
    this.fallbackCache = new Set(); // guard against re-entry while computing
    const frontier = new Map<string, Zone>();
    let anyOpen = false;
    for (const k of this.solved) {
      const z = zoneByKey(this.layout, k);
      if (!z) continue;
      const nb = edgeNeighbours(this.layout, z);
      for (const s of SIDES)
        for (const n of nb[s]) {
          if (this.solved.has(n.key) || frontier.has(n.key)) continue;
          frontier.set(n.key, n);
          if (!anyOpen && (n === this.layout.origin || SIDES.some((sd) => this.sideState(n, sd).satisfied))) anyOpen = true;
        }
    }
    const out = new Set<string>();
    if (!anyOpen && frontier.size) {
      let best = -1;
      const scored = [...frontier.values()].map((n) => {
        const f = Math.max(...SIDES.map((sd) => {
          const st = this.sideState(n, sd);
          return st.solved / st.total;
        }));
        best = Math.max(best, f);
        return [n, f] as const;
      });
      for (const [n, f] of scored) if (f >= best - 1e-9) out.add(n.key);
    }
    this.fallbackCache = out;
    return out;
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
    this.openCache = null;
    this.fallbackCache = null;
    this.save.solved = [...this.solved];
    this.solvedAt.set(z.key, performance.now());
    // solved zones render from the (deterministic) solution, so no need to store their rects
    delete this.save.rects[z.key];
    delete this.save.timers[z.key];
    const st = this.save.stats;
    st.deepest = Math.max(st.deepest, Math.floor(this.layout.depthFor(z)));
    const [cx, cy] = zoneCenter(z);
    st.farthestM = Math.max(st.farthestM, Math.hypot(cx - this.layout.centre[0], cy - this.layout.centre[1]));
  }

  private openCache: Zone[] | null = null;

  /** All open zones: unlocked but not yet solved (cached until the next solve). */
  openZones(): Zone[] {
    if (this.openCache) return this.openCache;
    const out: Zone[] = [];
    const seen = new Set<string>();
    const consider = (z: Zone) => {
      if (seen.has(z.key)) return;
      seen.add(z.key);
      if (this.status(z) === 'open') out.push(z);
    };
    consider(this.layout.origin);
    for (const k of this.solved) {
      const z = zoneByKey(this.layout, k);
      if (!z) continue;
      const nb = edgeNeighbours(this.layout, z);
      for (const s of SIDES)
        for (const n of nb[s]) {
          consider(n);
          // a solved zone can complete a bigger zone's diagonal requirement one step away
          const nn = edgeNeighbours(this.layout, n);
          for (const t of SIDES) nn[t].forEach(consider);
        }
    }
    this.openCache = out;
    return out;
  }

  /** Nearest open zone to a world point; ties prefer zones closer to the origin. */
  nearestOpen(wx: number, wy: number): Zone | null {
    let best: Zone | null = null;
    let bestD = Infinity;
    for (const z of this.openZones()) {
      const [cx, cy] = zoneCenter(z);
      const d = Math.hypot(cx - wx, cy - wy) + this.layout.depthFor(z) * 0.001;
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    return best;
  }
}
