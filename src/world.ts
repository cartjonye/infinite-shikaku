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
import { rectArea, rectContains, rectEq, rectsOverlap, type Puzzle, type Rect } from './types';

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

/** How close a side is to unlocking its zone (0..1). */
export const sideScore = (s: SideState) =>
  s.needsDiag ? (s.solved / s.total) * 0.75 + (s.diagSolved ? 0.25 : 0) : s.solved / s.total;

export class World {
  solved: Set<string>;
  solvedAt = new Map<string, number>();
  /** the last wrong attempt: a red flash that fades out; never part of a solution */
  failed: { zone: Zone; rect: Rect; at: number } | null = null;
  /** every unlocked, unsolved zone; kept up to date incrementally on each solve */
  private open = new Map<string, Zone>();

  constructor(
    public layout: WorldLayout,
    public save: SaveData,
  ) {
    this.solved = new Set(save.solved);
    this.rebuildOpen();
  }

  isSolved(z: Zone) {
    return this.solved.has(z.key);
  }

  sideState(z: Zone, side: Side): SideState {
    const nb = edgeNeighbours(this.layout, z)[side];
    let solved = 0;
    for (const n of nb) if (this.solved.has(n.key)) solved++;
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

  /** Unlock progress on all four sides. */
  sideStates(z: Zone): SideState[] {
    return SIDES.map((s) => this.sideState(z, s));
  }

  /** The side closest to unlocking the zone, if any side has progress. */
  bestSide(z: Zone): SideState | null {
    let best: SideState | null = null;
    for (const st of this.sideStates(z)) {
      if (st.solved === 0 && !(st.needsDiag && st.diagSolved)) continue;
      if (!best || sideScore(st) > sideScore(best)) best = st;
    }
    return best;
  }

  /**
   * A zone opens through any satisfied side:
   * - Classic, Fixed: any neighbour on a side; on a side bordering smaller zones,
   *   every zone on it plus one diagonal zone;
   * - Mosaic: every zone along any one side.
   */
  private ruleOpens(z: Zone): boolean {
    if (z === this.layout.origin) return true;
    for (const side of SIDES) if (this.sideState(z, side).satisfied) return true;
    return false;
  }

  status(z: Zone): ZoneStatus {
    if (this.solved.has(z.key)) return 'solved';
    return this.open.has(z.key) ? 'open' : 'locked';
  }

  /** Zones whose status could change when z is solved: everything within two neighbour steps. */
  private around(z: Zone, visit: (n: Zone) => void) {
    const nb = edgeNeighbours(this.layout, z);
    for (const s of SIDES)
      for (const n of nb[s]) {
        visit(n);
        const nn = edgeNeighbours(this.layout, n);
        for (const t of SIDES) nn[t].forEach(visit);
      }
  }

  private consider(z: Zone, added?: Zone[]) {
    if (this.solved.has(z.key) || this.open.has(z.key)) return;
    if (!this.ruleOpens(z)) return;
    this.open.set(z.key, z);
    added?.push(z);
  }

  private rebuildOpen() {
    this.open.clear();
    this.consider(this.layout.origin);
    for (const k of this.save.opened) {
      const z = zoneByKey(this.layout, k);
      if (z && !this.solved.has(k)) this.open.set(k, z);
    }
    for (const k of this.solved) {
      const z = zoneByKey(this.layout, k);
      if (z) this.around(z, (n) => this.consider(n));
    }
    this.unstick();
  }

  /**
   * Anti-soft-lock: if the rules leave nothing open (e.g. in Mosaic, a small zone
   * surrounded only by bigger ones), open the frontier zone(s) whose best side is
   * closest to complete. They are recorded in the save and stay open.
   */
  private unstick(added?: Zone[]) {
    if (this.open.size > 0 || this.solved.size === 0) return;
    const frontier = new Map<string, Zone>();
    for (const k of this.solved) {
      const z = zoneByKey(this.layout, k);
      if (!z) continue;
      const nb = edgeNeighbours(this.layout, z);
      for (const s of SIDES) for (const n of nb[s]) if (!this.solved.has(n.key)) frontier.set(n.key, n);
    }
    let best = -1;
    const scored: [Zone, number][] = [];
    for (const n of frontier.values()) {
      let f = 0;
      for (const st of this.sideStates(n)) f = Math.max(f, sideScore(st));
      best = Math.max(best, f);
      scored.push([n, f]);
    }
    for (const [n, f] of scored) {
      if (f < best - 1e-9) continue;
      this.open.set(n.key, n);
      this.save.opened.push(n.key);
      added?.push(n);
    }
  }

  rects(k: string): Rect[] {
    return this.save.rects[k] ?? [];
  }

  /** Rectangles to display: the solution for solved zones, the player's drawing otherwise. */
  shownRects(z: Zone, p: Puzzle): Rect[] {
    if (!this.solved.has(z.key)) return this.rects(z.key);
    return this.save.custom[z.key] ?? p.solution;
  }

  /** Place a rectangle, replacing any overlapping ones. Returns the rectangles it replaced. */
  place(k: string, q: Rect): Rect[] {
    const removed: Rect[] = [];
    const kept = this.rects(k).filter((o) => {
      if (!rectsOverlap(o, q)) return true;
      removed.push(o);
      return false;
    });
    kept.push(q);
    this.save.rects[k] = kept;
    return removed;
  }

  removeAt(k: string, r: number, c: number): Rect | null {
    const list = this.rects(k);
    const i = list.findIndex((q) => rectContains(q, r, c));
    if (i < 0) return null;
    const [gone] = list.splice(i, 1);
    if (list.length) this.save.rects[k] = list;
    else delete this.save.rects[k];
    return gone;
  }

  /**
   * What a drawn rectangle would do:
   * 'none' when it covers no number (ignored), 'ok' when it covers exactly one number
   * with a matching area, 'fail' otherwise (wrong area, or several numbers).
   */
  static classify(p: Puzzle, q: Rect): 'none' | 'ok' | 'fail' {
    let n = 0;
    let v = 0;
    for (const k of p.clues) {
      if (!rectContains(q, k.r, k.c)) continue;
      n++;
      v = k.v;
    }
    if (n === 0) return 'none';
    return n === 1 && v === rectArea(q) ? 'ok' : 'fail';
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

  /** Mark a zone solved. Returns the zones this newly opened. */
  markSolved(z: Zone, p?: Puzzle): Zone[] {
    // Puzzles have exactly one solution, so the player's tiling equals the generated
    // one. If that guarantee were ever broken, keep exactly what the player drew.
    const mine = this.rects(z.key);
    if (p && mine.length && !mine.every((q) => p.solution.some((o) => rectEq(o, q)))) {
      this.save.custom[z.key] = mine.map((q) => ({ ...q }));
    }
    this.solved.add(z.key);
    if (this.failed?.zone === z) this.failed = null;
    this.save.solved.push(z.key);
    this.open.delete(z.key);
    this.solvedAt.set(z.key, performance.now());
    delete this.save.rects[z.key];
    delete this.save.timers[z.key];
    const i = this.save.opened.indexOf(z.key);
    if (i >= 0) this.save.opened.splice(i, 1);
    if (this.save.active === z.key) this.save.active = null;
    const st = this.save.stats;
    st.deepest = Math.max(st.deepest, Math.floor(this.layout.depthFor(z)));
    const [cx, cy] = zoneCenter(z);
    st.farthestM = Math.max(st.farthestM, Math.hypot(cx - this.layout.centre[0], cy - this.layout.centre[1]));

    const added: Zone[] = [];
    this.around(z, (n) => this.consider(n, added));
    this.unstick(added);
    return added;
  }

  /** All open zones: unlocked but not yet solved. */
  openZones(): Zone[] {
    return [...this.open.values()];
  }

  get openCount() {
    return this.open.size;
  }

  /** Nearest open zone to a world point; ties prefer zones closer to the origin. */
  nearestOpen(wx: number, wy: number, filter?: (z: Zone) => boolean): Zone | null {
    let best: Zone | null = null;
    let bestD = Infinity;
    for (const z of this.open.values()) {
      if (filter && !filter(z)) continue;
      const [cx, cy] = zoneCenter(z);
      const d = Math.hypot(cx - wx, cy - wy) + this.layout.depthFor(z) * 0.001;
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    return best;
  }

  /** Smallest grid size among open zones (Infinity when none). */
  minOpenSize(): number {
    let m = Infinity;
    for (const z of this.open.values()) if (z.size < m) m = z.size;
    return m;
  }
}
