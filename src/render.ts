/** Canvas renderer for the infinite board. World units are cells. */
import type { ZoneCache } from './zones';
import { World, zkey } from './world';
import { ZONE, rectContains, type Puzzle, type Rect } from './types';
import { hashInts } from './rng';

export interface Camera {
  x: number; // world cell coordinate at screen centre
  y: number;
  zoom: number; // pixels per cell
}

export interface Preview {
  zx: number;
  zy: number;
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

  /** 0..1 progress of the seam between two solved zones disappearing. */
  private seam(world: World, ax: number, ay: number, bx: number, by: number, now: number): number {
    const ka = zkey(ax, ay);
    const kb = zkey(bx, by);
    if (!world.solved.has(ka) || !world.solved.has(kb)) return 0;
    const ta = world.solvedAt.get(ka) ?? -Infinity;
    const tb = world.solvedAt.get(kb) ?? -Infinity;
    const t = Math.max(ta, tb);
    return Math.min(1, Math.max(0, (now - t) / FADE_MS));
  }

  /** Screen box for a zone-local rect, with zone-edge insets applied. */
  private box(
    cam: Camera,
    zx: number,
    zy: number,
    q: Rect,
    inset: { l: number; r: number; t: number; b: number },
  ) {
    const s = cam.zoom;
    const g = s * 0.07;
    const [x0, y0] = this.toScreen(cam, zx * ZONE + q.c, zy * ZONE + q.r);
    let x = x0 + g / 2;
    let y = y0 + g / 2;
    let w = q.w * s - g;
    let h = q.h * s - g;
    if (q.c === 0) { x += inset.l; w -= inset.l; }
    if (q.r === 0) { y += inset.t; h -= inset.t; }
    if (q.c + q.w === ZONE) w -= inset.r;
    if (q.r + q.h === ZONE) h -= inset.b;
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

  colorFor(zx: number, zy: number, clueIdx: number) {
    return PALETTE[hashInts(zx, zy, clueIdx) % PALETTE.length];
  }

  draw(cam: Camera, world: World, zones: ZoneCache, preview: Preview | null, focus: [number, number] | null) {
    const c = this.ctx;
    const now = performance.now();
    let animating = false;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = this.colors.bg;
    c.fillRect(0, 0, this.w, this.h);

    const s = cam.zoom;
    const [wx0, wy0] = this.toWorld(cam, 0, 0);
    const [wx1, wy1] = this.toWorld(cam, this.w, this.h);
    const zx0 = Math.floor(wx0 / ZONE);
    const zx1 = Math.floor(wx1 / ZONE);
    const zy0 = Math.floor(wy0 / ZONE);
    const zy1 = Math.floor(wy1 / ZONE);
    const zoneGap = s * 0.22;
    const rad = s * 0.16;

    for (let zy = zy0; zy <= zy1; zy++) {
      for (let zx = zx0; zx <= zx1; zx++) {
        const st = world.status(zx, zy);
        const k = zkey(zx, zy);
        const sides = {
          l: this.seam(world, zx, zy, zx - 1, zy, now),
          r: this.seam(world, zx, zy, zx + 1, zy, now),
          t: this.seam(world, zx, zy, zx, zy - 1, now),
          b: this.seam(world, zx, zy, zx, zy + 1, now),
        };
        for (const v of Object.values(sides)) if (v > 0 && v < 1) animating = true;
        const inset = {
          l: (zoneGap / 2) * (1 - sides.l),
          r: (zoneGap / 2) * (1 - sides.r),
          t: (zoneGap / 2) * (1 - sides.t),
          b: (zoneGap / 2) * (1 - sides.b),
        };
        const whole = this.box(cam, zx, zy, { r: 0, c: 0, w: ZONE, h: ZONE }, inset);

        if (st === 'locked') {
          const near =
            world.status(zx + 1, zy) === 'open' ||
            world.status(zx - 1, zy) === 'open' ||
            world.status(zx, zy + 1) === 'open' ||
            world.status(zx, zy - 1) === 'open';
          c.fillStyle = near ? this.colors.fogNear : this.colors.fog;
          this.rr(whole.x, whole.y, whole.w, whole.h, rad * 1.5);
          c.fill();
          if (s >= 14) {
            c.fillStyle = 'rgba(255,255,255,0.035)';
            for (let r = 0; r < ZONE; r++)
              for (let cc = 0; cc < ZONE; cc++) {
                const [px, py] = this.toScreen(cam, zx * ZONE + cc + 0.5, zy * ZONE + r + 0.5);
                c.beginPath();
                c.arc(px, py, s * 0.06, 0, Math.PI * 2);
                c.fill();
              }
          }
          if (near && s >= 10) this.lock(whole.x + whole.w / 2, whole.y + whole.h / 2, s * 0.9);
          continue;
        }

        const p = st === 'solved' ? zones.getNow(zx, zy) : zones.get(zx, zy);
        if (!p) {
          zones.request(zx, zy);
          c.fillStyle = this.colors.fogNear;
          this.rr(whole.x, whole.y, whole.w, whole.h, rad * 1.5);
          c.fill();
          animating = true;
          continue;
        }

        const isFocus = focus && focus[0] === zx && focus[1] === zy && st === 'open';
        if (st === 'open') {
          // zone halo
          c.strokeStyle = isFocus ? 'rgba(255,207,110,0.55)' : 'rgba(255,255,255,0.08)';
          c.lineWidth = Math.max(1, s * 0.05);
          this.rr(whole.x - s * 0.06, whole.y - s * 0.06, whole.w + s * 0.12, whole.h + s * 0.12, rad * 2);
          c.stroke();
          // empty cells
          const clueSet = new Set(p.clues.map((q) => q.r * ZONE + q.c));
          for (let r = 0; r < ZONE; r++)
            for (let cc = 0; cc < ZONE; cc++) {
              const b = this.box(cam, zx, zy, { r, c: cc, w: 1, h: 1 }, inset);
              c.fillStyle = clueSet.has(r * ZONE + cc) ? this.colors.cellClue : this.colors.cell;
              this.rr(b.x, b.y, b.w, b.h, rad);
              c.fill();
            }
        }

        // placed rectangles
        const flash = st === 'solved' ? now - (world.solvedAt.get(k) ?? -1e9) : 1e9;
        if (flash < 900) animating = true;
        for (const q of world.rects(k)) {
          const idx = World.matchClue(p, q);
          const b = this.box(cam, zx, zy, q, inset);
          c.fillStyle = idx >= 0 ? this.colorFor(zx, zy, idx) : this.colors.invalid;
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
            const a = 0.55 * (1 - flash / 900);
            c.fillStyle = `rgba(255,255,255,${a})`;
            c.fill();
          }
        }

        // clues
        if (s >= 9) {
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          for (const q of p.clues) {
            const owned = world.rects(k).find((o) => rectContains(o, q.r, q.c));
            const [px, py] = this.toScreen(cam, zx * ZONE + q.c + 0.5, zy * ZONE + q.r + 0.5);
            const fs = s * (q.v >= 10 ? 0.46 : 0.55);
            c.font = `700 ${fs}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
            if (st === 'solved') c.fillStyle = 'rgba(27,29,38,0.55)';
            else c.fillStyle = owned ? this.colors.ink : this.colors.text;
            c.fillText(String(q.v), px, py + fs * 0.04);
          }
        }
      }
    }

    // drag preview
    if (preview) {
      const p = zones.get(preview.zx, preview.zy);
      const zg = zoneGap / 2;
      const b = this.box(cam, preview.zx, preview.zy, preview.rect, { l: zg, r: zg, t: zg, b: zg });
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
