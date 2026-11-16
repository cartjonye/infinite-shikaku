/** Canvas renderer for the infinite board. World units are cells. */
import type { ZoneCache } from './zones';
import { World, sideScore, type SideState } from './world';
import { rectContains, type Puzzle, type Rect } from './types';
import { hashInts } from './rng';
import { SIDES, diagonalZones, edgeNeighbours, sharedSpan, type Side, type Zone } from './layouts';

export interface Camera {
  x: number; // world cell coordinate at screen centre
  y: number;
  zoom: number; // pixels per cell
}

export interface Preview {
  zone: Zone;
  rect: Rect;
}

const PALETTE = [
  '#f4b6a6', // coral
  '#f7d58b', // butter
  '#a8dcc0', // mint
  '#9fc7f0', // sky
  '#c9b3ef', // lilac
  '#f2a9c9', // rose
  '#b9e08f', // lime
  '#8fd8dc', // teal
  '#f0c29a', // apricot
];

const FADE_MS = 700;

/** Below this many pixels per cell the clue numbers are hidden and the board is not playable. */
export const MIN_PLAY_ZOOM = 9;
/** Below this, zones are drawn in a simplified style. */
const FAR_ZOOM = 7;

export class Renderer {
  ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  dpr = 1;
  colors = {
    bg: '#12141c',
    cell: '#232837',
    cellClue: '#2b3144',
    fog: '#191c27',
    fogNear: '#1e2230',
    text: '#eef0f7',
    textDim: 'rgba(238,240,247,0.35)',
    ink: '#1b1d26',
    accent: '#ffcf6e',
    invalid: '#5b6175',
    ok: '#8ee0a8',
  };

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  toScreen(cam: Camera, wx: number, wy: number): [number, number] {
    return [(wx - cam.x) * cam.zoom + this.w / 2, (wy - cam.y) * cam.zoom + this.h / 2];
  }

  toWorld(cam: Camera, sx: number, sy: number): [number, number] {
    return [(sx - this.w / 2) / cam.zoom + cam.x, (sy - this.h / 2) / cam.zoom + cam.y];
  }

  /** 0..1 progress of a side's seam disappearing (all zones on both sides solved). */
  private seam(world: World, z: Zone, side: Side, now: number): number {
    if (!world.isSolved(z)) return 0;
    const nb = edgeNeighbours(world.layout, z)[side];
    let t = world.solvedAt.get(z.key) ?? -Infinity;
    for (const n of nb) {
      if (!world.isSolved(n)) return 0;
      t = Math.max(t, world.solvedAt.get(n.key) ?? -Infinity);
    }
    return Math.min(1, Math.max(0, (now - t) / FADE_MS));
  }

  /** Screen box for a zone-local rect, with zone-edge insets applied. */
  private box(cam: Camera, z: Zone, q: Rect, inset: { l: number; r: number; t: number; b: number }) {
    const s = cam.zoom;
    const g = s * 0.07;
    const [x0, y0] = this.toScreen(cam, z.x0 + q.c, z.y0 + q.r);
    let x = x0 + g / 2;
    let y = y0 + g / 2;
    let w = q.w * s - g;
    let h = q.h * s - g;
    if (q.c === 0) { x += inset.l; w -= inset.l; }
    if (q.r === 0) { y += inset.t; h -= inset.t; }
    if (q.c + q.w === z.size) w -= inset.r;
    if (q.r + q.h === z.size) h -= inset.b;
    return { x, y, w, h };
  }

  private rr(x: number, y: number, w: number, h: number, rad: number) {
    const c = this.ctx;
    const r = Math.max(0, Math.min(rad, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  colorFor(z: Zone, clueIdx: number) {
    return PALETTE[hashInts(z.x0, z.y0, z.size, clueIdx) % PALETTE.length];
  }

  draw(cam: Camera, world: World, zones: ZoneCache, preview: Preview | null, focus: Zone | null) {
    const c = this.ctx;
    const now = performance.now();
    let animating = false;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = this.colors.bg;
    c.fillRect(0, 0, this.w, this.h);

    const s = cam.zoom;
    const far = s < FAR_ZOOM;
    const [wx0, wy0] = this.toWorld(cam, 0, 0);
    const [wx1, wy1] = this.toWorld(cam, this.w, this.h);
    const zoneGap = s * 0.22;
    const rad = s * 0.16;
    const visible = world.layout.zonesInRect(wx0, wy0, wx1, wy1);
    zones.ensureCapacity(visible.length * 2);

    for (const z of visible) {
      const st = world.status(z);
      const k = z.key;
      const fade = {} as Record<Side, number>;
      for (const side of SIDES) {
        fade[side] = this.seam(world, z, side, now);
        if (fade[side] > 0 && fade[side] < 1) animating = true;
      }
      const inset = {
        l: (zoneGap / 2) * (1 - fade.l),
        r: (zoneGap / 2) * (1 - fade.r),
        t: (zoneGap / 2) * (1 - fade.t),
        b: (zoneGap / 2) * (1 - fade.b),
      };
      const whole = this.box(cam, z, { r: 0, c: 0, w: z.size, h: z.size }, inset);

      if (st === 'locked') {
        const nb = edgeNeighbours(world.layout, z);
        const near = SIDES.some((sd) => nb[sd].some((n) => world.status(n) !== 'locked'));
        c.fillStyle = near ? this.colors.fogNear : this.colors.fog;
        if (far) c.fillRect(whole.x, whole.y, whole.w, whole.h);
        else {
          this.rr(whole.x, whole.y, whole.w, whole.h, rad * 1.5);
          c.fill();
        }
        if (s >= 14) {
          c.fillStyle = 'rgba(255,255,255,0.035)';
          for (let r = 0; r < z.size; r++)
            for (let cc = 0; cc < z.size; cc++) {
              const [px, py] = this.toScreen(cam, z.x0 + cc + 0.5, z.y0 + r + 0.5);
              c.beginPath();
              c.arc(px, py, s * 0.06, 0, Math.PI * 2);
              c.fill();
            }
        }
        if (near && whole.w >= 18) {
          const lockSize = Math.max(Math.min(s * 0.9, whole.w * 0.3), Math.min(whole.w * 0.12, 48));
          this.lock(whole.x + whole.w / 2, whole.y + whole.h / 2, lockSize);
          this.sideProgress(cam, world, z, whole, lockSize);
        }
        continue;
      }

      const p = zones.get(z);
      if (!p) {
        // generated off the main thread; the cache calls back and triggers a redraw
        zones.request(z, st === 'open');
        if (st === 'solved') {
          c.globalAlpha = 0.5;
          c.fillStyle = this.colorFor(z, 0);
        } else c.fillStyle = this.colors.fogNear;
        if (far) c.fillRect(whole.x, whole.y, whole.w, whole.h);
        else {
          this.rr(whole.x, whole.y, whole.w, whole.h, rad * 1.5);
          c.fill();
        }
        c.globalAlpha = 1;
        continue;
      }

      const solved = st === 'solved';
      if (!solved) {
        c.strokeStyle = focus === z ? 'rgba(255,207,110,0.55)' : 'rgba(255,255,255,0.08)';
        c.lineWidth = Math.max(1, s * 0.05);
        this.rr(whole.x - s * 0.06, whole.y - s * 0.06, whole.w + s * 0.12, whole.h + s * 0.12, rad * 2);
        c.stroke();
        if (far) {
          // far zoom: one tile instead of every cell
          c.fillStyle = this.colors.cell;
          this.rr(whole.x, whole.y, whole.w, whole.h, rad * 2);
          c.fill();
        } else {
          const clueSet = new Set(p.clues.map((q) => q.r * z.size + q.c));
          for (let r = 0; r < z.size; r++)
            for (let cc = 0; cc < z.size; cc++) {
              const b = this.box(cam, z, { r, c: cc, w: 1, h: 1 }, inset);
              c.fillStyle = clueSet.has(r * z.size + cc) ? this.colors.cellClue : this.colors.cell;
              this.rr(b.x, b.y, b.w, b.h, rad);
              c.fill();
            }
        }
      }

      const flash = solved ? now - (world.solvedAt.get(k) ?? -1e9) : 1e9;
      if (flash < 900) animating = true;
      const shown = world.shownRects(z, p);
      // a solved zone showing its generated solution: rectangle i belongs to clue i
      const direct = solved && shown === p.solution;
      for (let i = 0; i < shown.length; i++) {
        const q = shown[i];
        const idx = direct ? i : World.matchClue(p, q);
        const b = this.box(cam, z, q, inset);
        c.fillStyle = idx >= 0 ? this.colorFor(z, idx) : this.colors.invalid;
        if (far) {
          c.fillRect(b.x, b.y, b.w, b.h);
          continue;
        }
        this.rr(b.x, b.y, b.w, b.h, rad);
        c.fill();
        if (idx < 0) {
          c.strokeStyle = 'rgba(255,255,255,0.45)';
          c.setLineDash([s * 0.12, s * 0.1]);
          c.lineWidth = Math.max(1, s * 0.04);
          c.stroke();
          c.setLineDash([]);
        }
        if (flash < 900) {
          c.fillStyle = `rgba(255,255,255,${0.55 * (1 - flash / 900)})`;
          c.fill();
        }
      }

      if (s >= MIN_PLAY_ZOOM) {
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        for (const q of p.clues) {
          const owned = solved || shown.some((o) => rectContains(o, q.r, q.c));
          const [px, py] = this.toScreen(cam, z.x0 + q.c + 0.5, z.y0 + q.r + 0.5);
          const fs = s * (q.v >= 10 ? 0.46 : 0.55);
          c.font = `700 ${fs}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
          if (solved) c.fillStyle = 'rgba(27,29,38,0.55)';
          else c.fillStyle = owned ? this.colors.ink : this.colors.text;
          c.fillText(String(q.v), px, py + fs * 0.04);
        }
      }
    }

    this.homeBadge(cam, world, now);

    // drag preview
    if (preview) {
      const p = zones.get(preview.zone);
      const zg = zoneGap / 2;
      const b = this.box(cam, preview.zone, preview.rect, { l: zg, r: zg, t: zg, b: zg });
      const ok = p ? World.matchClue(p, preview.rect) >= 0 : false;
      c.fillStyle = ok ? 'rgba(142,224,168,0.45)' : 'rgba(255,255,255,0.22)';
      this.rr(b.x, b.y, b.w, b.h, rad);
      c.fill();
      c.strokeStyle = ok ? this.colors.ok : 'rgba(255,255,255,0.7)';
      c.lineWidth = Math.max(1.5, s * 0.06);
      c.stroke();
      const area = preview.rect.w * preview.rect.h;
      const label = `${preview.rect.w}×${preview.rect.h} = ${area}`;
      const fs = Math.max(12, Math.min(22, s * 0.42));
      c.font = `700 ${fs}px ui-rounded, system-ui, sans-serif`;
      const tw = c.measureText(label).width + fs;
      const lx = b.x + b.w / 2;
      const ly = b.y - fs * 1.1;
      c.fillStyle = 'rgba(10,12,18,0.85)';
      this.rr(lx - tw / 2, ly - fs * 0.75, tw, fs * 1.5, fs * 0.5);
      c.fill();
      c.fillStyle = ok ? this.colors.ok : this.colors.text;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(label, lx, ly);
    }
    return animating;
  }

  /**
   * On a locked zone: for every side with progress, light the parts whose neighbours
   * are solved (plus corner pips where a diagonal zone is needed), and show the count
   * of the side closest to unlocking.
   */
  private sideProgress(
    cam: Camera,
    world: World,
    z: Zone,
    whole: { x: number; y: number; w: number; h: number },
    lockSize: number,
  ) {
    const c = this.ctx;
    const lw = Math.max(2, cam.zoom * 0.12);
    const gold = 'rgba(255,207,110,0.85)';
    const dim = 'rgba(255,255,255,0.14)';
    let best: SideState | null = null;
    for (const st of world.sideStates(z)) {
      if (st.solved === 0 && !(st.needsDiag && st.diagSolved)) continue;
      if (!best || sideScore(st) > sideScore(best)) best = st;
      const side = st.side;
      const vertical = side === 'l' || side === 'r';
      const edge =
        side === 'l' ? whole.x + lw : side === 'r' ? whole.x + whole.w - lw : side === 't' ? whole.y + lw : whole.y + whole.h - lw;
      c.lineCap = 'round';
      c.lineWidth = lw;
      for (const n of edgeNeighbours(world.layout, z)[side]) {
        const [a, b] = sharedSpan(z, n, side);
        c.strokeStyle = world.isSolved(n) ? gold : dim;
        c.beginPath();
        if (vertical) {
          const [, y0] = this.toScreen(cam, 0, a);
          const [, y1] = this.toScreen(cam, 0, b);
          c.moveTo(edge, Math.max(whole.y + lw * 3, y0 + lw * 2));
          c.lineTo(edge, Math.min(whole.y + whole.h - lw * 3, y1 - lw * 2));
        } else {
          const [x0] = this.toScreen(cam, a, 0);
          const [x1] = this.toScreen(cam, b, 0);
          c.moveTo(Math.max(whole.x + lw * 3, x0 + lw * 2), edge);
          c.lineTo(Math.min(whole.x + whole.w - lw * 3, x1 - lw * 2), edge);
        }
        c.stroke();
      }
      if (st.needsDiag) this.diagPips(world, z, side, vertical, edge, whole, lw, gold, dim);
    }
    if (!best) return;
    const fs = Math.max(11, lockSize * 0.42);
    c.font = `700 ${fs}px ui-rounded, system-ui, sans-serif`;
    c.fillStyle = gold;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(
      best.needsDiag ? `${best.solved}/${best.total} + ${best.diagSolved ? '◆' : '◇'}` : `${best.solved}/${best.total}`,
      whole.x + whole.w / 2,
      whole.y + whole.h / 2 + lockSize * 0.8,
    );
  }

  /** Marks the start zone: a house badge on its corner, or a pin when it is tiny on screen. */
  private homeBadge(cam: Camera, world: World, now: number) {
    const c = this.ctx;
    const origin = world.layout.origin;
    const [x0, y0] = this.toScreen(cam, origin.x0, origin.y0);
    const w = origin.size * cam.zoom;
    if (x0 + w < -30 || y0 + w < -30 || x0 > this.w + 30 || y0 > this.h + 30) return;
    const gold = '#ffcf6e';
    if (w < 44) {
      // pin
      const cx = x0 + w / 2;
      const cy = y0 + w / 2;
      c.fillStyle = 'rgba(255,207,110,0.25)';
      c.beginPath();
      c.arc(cx, cy, 11, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = gold;
      c.strokeStyle = this.colors.bg;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(cx, cy, 5.5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      return;
    }
    // outline the home zone, with the badge straddling the middle of its top edge
    // The outline hugs the zone's tiles: it follows the same per-side inset the tiles
    // use (which shrinks to nothing where the seam to a solved neighbour has faded)
    // and runs down the middle of the gap around them.
    const half = (cam.zoom * 0.22) / 2;
    const inset = {
      l: half * (1 - this.seam(world, origin, 'l', now)),
      r: half * (1 - this.seam(world, origin, 'r', now)),
      t: half * (1 - this.seam(world, origin, 't', now)),
      b: half * (1 - this.seam(world, origin, 'b', now)),
    };
    const tiles = this.box(cam, origin, { r: 0, c: 0, w: origin.size, h: origin.size }, inset);
    const lw = Math.max(1.5, cam.zoom * 0.05);
    const pad = cam.zoom * 0.035; // half of the gap between neighbouring tiles
    c.strokeStyle = 'rgba(255,207,110,0.95)';
    c.lineWidth = lw;
    this.rr(tiles.x - pad, tiles.y - pad, tiles.w + 2 * pad, tiles.h + 2 * pad, cam.zoom * 0.16 + pad);
    c.stroke();
    const g = inset.t;
    const r = Math.max(10, Math.min(15, cam.zoom * 0.36));
    const cx = x0 + w / 2;
    const cy = y0 + g;
    c.fillStyle = gold;
    c.strokeStyle = this.colors.bg;
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    // house glyph
    const u = r * 0.52;
    c.fillStyle = this.colors.ink;
    c.beginPath();
    c.moveTo(cx - u * 1.15, cy - u * 0.05);
    c.lineTo(cx, cy - u * 1.1);
    c.lineTo(cx + u * 1.15, cy - u * 0.05);
    c.lineTo(cx + u * 0.8, cy - u * 0.05);
    c.lineTo(cx + u * 0.8, cy + u * 0.95);
    c.lineTo(cx - u * 0.8, cy + u * 0.95);
    c.lineTo(cx - u * 0.8, cy - u * 0.05);
    c.closePath();
    c.fill();
  }

  private diagPips(
    world: World,
    z: Zone,
    side: Side,
    vertical: boolean,
    edge: number,
    whole: { x: number; y: number; w: number; h: number },
    lw: number,
    gold: string,
    dim: string,
  ) {
    const c = this.ctx;
    const pip = Math.max(3, lw * 1.1);
    const ends: [number, number][] = vertical
      ? [[edge, whole.y + pip * 1.2], [edge, whole.y + whole.h - pip * 1.2]]
      : [[whole.x + pip * 1.2, edge], [whole.x + whole.w - pip * 1.2, edge]];
    const diags = diagonalZones(world.layout, z, side);
    ends.forEach(([x, y], i) => {
      c.fillStyle = world.isSolved(diags[i]) ? gold : dim;
      c.beginPath();
      c.moveTo(x, y - pip);
      c.lineTo(x + pip, y);
      c.lineTo(x, y + pip);
      c.lineTo(x - pip, y);
      c.closePath();
      c.fill();
    });
  }

  private lock(x: number, y: number, size: number) {
    const c = this.ctx;
    c.save();
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.lineWidth = size * 0.1;
    c.beginPath();
    c.arc(x, y - size * 0.12, size * 0.22, Math.PI, 0);
    c.stroke();
    this.rr(x - size * 0.34, y - size * 0.12, size * 0.68, size * 0.5, size * 0.08);
    c.fill();
    c.restore();
  }
}

export type { Puzzle };
