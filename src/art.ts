/**
 * Small looping illustrations (inline SVG, animated by CSS in style.css):
 * the controls card, the How to play demo and the mode cards.
 */
import type { ModeId } from './layouts';

const VIEW = 'viewBox="0 0 120 90" aria-hidden="true"';

/** A grid of rounded cells, optionally with one number on it. */
function cells(cols: number, rows: number, x0: number, y0: number, size: number, gap: number, num?: [number, number, string], cls = 'cc-cell') {
  let out = '';
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      out += `<rect x="${x0 + c * (size + gap)}" y="${y0 + r * (size + gap)}" width="${size}" height="${size}" rx="${Math.max(2, size / 5)}" class="${cls}"/>`;
  if (num)
    out += `<text x="${x0 + num[0] * (size + gap) + size / 2}" y="${y0 + num[1] * (size + gap) + size / 2 + size * 0.25}" class="cc-num" style="font-size:${size * 0.65}px">${num[2]}</text>`;
  return out;
}
const finger = (cls: string, x: number, y: number) => `<g class="${cls}"><circle cx="${x}" cy="${y}" r="9" class="cc-finger"/></g>`;
const cursor = (cls: string, x: number, y: number) =>
  `<g class="${cls}"><path d="M${x} ${y}l0 17 4.5-4.2 3.3 7.2 3-1.4-3.2-7 6.2-.4z" class="cc-cursor"/></g>`;

export type ControlKind = 'draw' | 'tap' | 'pan' | 'zoom';

/** The four controls: draw, undo (tap a number), move, zoom. */
export function controlArt(kind: ControlKind, touch: boolean): string {
  if (kind === 'draw') {
    const pointer = touch ? finger('cc-draw-move', 34, 21) : cursor('cc-draw-move', 32, 18);
    return `<svg ${VIEW}>${cells(3, 3, 24, 11, 20, 4, [0, 0, '4'])}<rect x="24" y="11" width="44" height="44" rx="5" class="cc-rect cc-draw-grow"/>${pointer}</svg>`;
  }
  if (kind === 'tap') {
    const x = 34;
    const y = 21;
    const pointer = touch ? finger('cc-tap-move', x, y) : cursor('cc-tap-move', x - 2, y - 3);
    return `<svg ${VIEW}>${cells(3, 3, 24, 11, 20, 4)}<rect x="24" y="11" width="44" height="44" rx="5" class="cc-rect cc-tap-rect"/><text x="34" y="26" class="cc-num">4</text><circle cx="${x}" cy="${y}" r="12" class="cc-ripple"/>${pointer}</svg>`;
  }
  if (kind === 'pan') {
    const pointers = touch ? finger('cc-pan-move', 50, 46) + finger('cc-pan-move', 72, 46) : cursor('cc-pan-move', 56, 40);
    return `<svg ${VIEW}><g class="cc-pan-move">${cells(5, 4, 4, 2, 20, 4, [2, 1, '6'])}</g>${pointers}</svg>`;
  }
  const pointers = touch
    ? finger('cc-zoom-a', 50, 50) + finger('cc-zoom-b', 70, 40)
    : `<g><rect x="50" y="30" width="20" height="32" rx="10" class="cc-mouse"/><line x1="60" y1="35" x2="60" y2="43" class="cc-wheel"/></g>`;
  return `<svg ${VIEW}><g class="cc-zoom-grow">${cells(3, 3, 24, 9, 20, 4, [0, 0, '9'])}</g>${pointers}</svg>`;
}

/** How to play: drag across the 6 to make a 3×2 rectangle, which snaps in green. */
export function guideArt(touch: boolean): string {
  const size = 16;
  const gap = 3;
  const x0 = 22;
  const y0 = 8;
  const at = (c: number, r: number) => [x0 + c * (size + gap) + size / 2, y0 + r * (size + gap) + size / 2];
  const [sx, sy] = at(0, 0);
  const pointer = touch ? finger('ga-move', sx, sy) : cursor('ga-move', sx - 2, sy - 3);
  return `<svg ${VIEW} class="guide-svg">${cells(4, 4, x0, y0, size, gap, [0, 0, '6'])}${cells(1, 1, x0 + 3 * (size + gap), y0 + 3 * (size + gap), size, gap, [0, 0, '2'], 'cc-cell ga-dim')}<rect x="${x0}" y="${y0}" width="${3 * size + 2 * gap}" height="${2 * size + gap}" rx="4" class="cc-rect ga-grow"/>${pointer}</svg>`;
}

/**
 * Mode-card timelines. Every animated element in a card runs for the card's
 * whole cycle with no animation-delay; its stagger lives in its own keyframes.
 * That keeps every piece locked to one clock, so nothing pops at first paint
 * or when the loop wraps. All cards share a 3 s beat.
 */
const BEAT = 3;
type Stop = [number, string];
class Timeline {
  private rules: string[] = [];
  private n = 0;
  constructor(
    private id: string,
    private cycle: number,
  ) {}
  /** Inline style for an element following these stops (times in seconds). */
  anim(stops: Stop[], timing = 'ease-in-out', extra = ''): string {
    const name = `mk-${this.id}-${this.n++}`;
    const C = this.cycle;
    const clamped = stops.map(([t, css]): Stop => [Math.min(C, Math.max(0, t)), css]).sort((a, b) => a[0] - b[0]);
    if (clamped[0][0] > 0) clamped.unshift([0, clamped[0][1]]);
    if (clamped[clamped.length - 1][0] < C) clamped.push([C, clamped[clamped.length - 1][1]]);
    const pct = (t: number) => +((t / C) * 100).toFixed(3);
    this.rules.push(`@keyframes ${name}{${clamped.map(([t, css]) => `${pct(t)}%{${css}}`).join('')}}`);
    return `style="animation:${name} ${C}s ${timing} infinite;${extra}"`;
  }
  /** Shown over [from, to] with a fade in; hidden the rest of the cycle. */
  show(from: number, to: number, on: string, off: string, fadeIn = 0.2, fadeOut = 0): string {
    const e = 0.001;
    const stops: Stop[] = [[0, off], [from, off], [from + fadeIn, on], [to, on], [to + (fadeOut || e), off]];
    // an interval that ends at the cycle's end must hand over to "off" right there
    if (to + (fadeOut || e) > this.cycle) stops.splice(3, 2, [this.cycle - (fadeOut || e), on], [this.cycle, off]);
    return this.anim(stops, fadeOut ? 'ease-in-out' : 'ease-out');
  }
  style(): string {
    return `<style>${this.rules.join('')}</style>`;
  }
}
const OFF = 'opacity:0;transform:scale(.7)';
const ON = 'opacity:1;transform:scale(1)';
/** A beat: the grid arrives at 0, pieces land from 0.4 s every 0.3 s, it holds, then slides over 2.5-3 s. */
const PIECE_AT = (j: number) => 0.4 + 0.3 * j;
const SLIDE_AT = 2.5;

/**
 * Grids that grow level after level (4×4, 5×5, 6×6, then back): the Classic card
 * with its (1) 2 3 steps, and without them the game's own mark, used for loading.
 */
function growArt(id: string, withSteps: boolean): string {
  const cy = withSteps ? 40 : 45;
  // grids grow level after level: 4×4, 5×5, 6×6, then back to level 1
  const tl = new Timeline(id, 3 * BEAT);
  const cell = 9;
  const gap = 2;
  const step = cell + gap;
  const parts: Record<number, [number, number, number, number][]> = {
    4: [[0, 0, 2, 2], [2, 0, 2, 2], [0, 2, 4, 2]],
    5: [[0, 0, 3, 2], [3, 0, 2, 3], [0, 2, 3, 3], [3, 3, 2, 2]],
    6: [[0, 0, 3, 3], [3, 0, 3, 2], [3, 2, 3, 4], [0, 3, 3, 3]],
  };
  const fills = ['ma-a', 'ma-b', 'ma-c', 'ma-a'];
  const level = (slot: number, n: number, filled: boolean) => {
    const span = n * step - gap;
    const x0 = 60 + slot * 100 - span / 2;
    const y0 = cy - span / 2;
    const t0 = slot * BEAT;
    const rects = filled
      ? parts[n]
          .map(
            ([c, r, w, h], j) =>
              `<rect x="${x0 + c * step}" y="${y0 + r * step}" width="${w * step - gap}" height="${h * step - gap}" rx="2.5" class="${fills[j]} ma-pop ma-anim" ${tl.show(t0 + PIECE_AT(j), t0 + BEAT, ON, OFF)}/>`,
          )
          .join('')
      : '';
    return `${cells(n, n, x0, y0, cell, gap)}${rects}`;
  };
  const x = (k: number) => `transform:translateX(${-100 * k}px)`;
  const slide = tl.anim([
    [0, x(0)], [SLIDE_AT, x(0)], [BEAT, x(1)], [BEAT + SLIDE_AT, x(1)], [2 * BEAT, x(2)], [2 * BEAT + SLIDE_AT, x(2)], [3 * BEAT, x(3)],
  ]);
  if (!withSteps) {
    const grids = `<g class="ma-anim" ${slide}>${level(0, 4, true)}${level(1, 5, true)}${level(2, 6, true)}${level(3, 4, false)}</g>`;
    return `<svg viewBox="24 ${cy - 36} 72 72" aria-hidden="true">${tl.style()}${grids}</svg>`;
  }
  // level steps under the grid: (1) 2 3, then 1 (2) 3, then 1 2 (3); the dot moves mid-slide
  const mid = (SLIDE_AT + BEAT) / 2;
  const dotStops: Stop[][] = [
    [[0, 'opacity:1'], [mid, 'opacity:1'], [mid + 0.001, 'opacity:0'], [2 * BEAT + mid, 'opacity:0'], [2 * BEAT + mid + 0.001, 'opacity:1']],
    [[0, 'opacity:0'], [mid, 'opacity:0'], [mid + 0.001, 'opacity:1'], [BEAT + mid, 'opacity:1'], [BEAT + mid + 0.001, 'opacity:0']],
    [[0, 'opacity:0'], [BEAT + mid, 'opacity:0'], [BEAT + mid + 0.001, 'opacity:1'], [2 * BEAT + mid, 'opacity:1'], [2 * BEAT + mid + 0.001, 'opacity:0']],
  ];
  const steps = [1, 2, 3]
    .map((lv) => {
      const cx = 44 + (lv - 1) * 16;
      return `<text x="${cx}" y="85" class="ma-lv">${lv}</text><g class="ma-step ma-anim" ${tl.anim(dotStops[lv - 1], 'linear', lv === 1 ? '' : 'opacity:0')}><circle cx="${cx}" cy="82" r="6" class="ma-step-dot"/><text x="${cx}" y="85" class="ma-lv ma-lv-on">${lv}</text></g>`;
    })
    .join('');
  const body = `<g class="ma-anim" ${slide}>${level(0, 4, true)}${level(1, 5, true)}${level(2, 6, true)}${level(3, 4, false)}</g>${steps}`;
  return `<svg ${VIEW}>${tl.style()}${body}</svg>`;
}

/** The game mark: growing grids, used for loading screens and the menu logo. */
export function brandArt(): string {
  return growArt('brand', false);
}

/** Mode cards: a tiny looping picture of how each mode plays. */
export function modeArt(mode: ModeId): string {
  if (mode === 'classic') return growArt('classic', true);
  if (mode === 'focused') {
    // the same size every time: one grid fills, then slides off as an identical one slides in
    const tl = new Timeline('focused', BEAT);
    const pieces: [number, number, number, number, string][] = [
      [0, 18, 35, 16, 'ma-a'], [38, 18, 16, 35, 'ma-b'], [0, 37, 35, 35, 'ma-c'], [38, 56, 16, 16, 'ma-a'],
    ];
    const grid = (x: number, filled: boolean) =>
      `<g transform="translate(${x} 0)">${cells(3, 3, 0, 18, 16, 3)}${
        filled
          ? pieces
              .map(([px, py, w, h, cls], j) => `<rect x="${px}" y="${py}" width="${w}" height="${h}" rx="3" class="${cls} ma-pop ma-anim" ${tl.show(PIECE_AT(j), BEAT, ON, OFF)}/>`)
              .join('')
          : ''
      }</g>`;
    const slide = tl.anim([[0, 'transform:translateX(0)'], [SLIDE_AT, 'transform:translateX(0)'], [BEAT, 'transform:translateX(-90px)']]);
    const body = `<g class="ma-anim" ${slide}>${grid(33, true)}${grid(123, false)}</g>`;
    return `<svg ${VIEW}>${tl.style()}${body}</svg>`;
  }
  if (mode === 'journey') {
    // a small centre, then each bigger ring fills cell by cell, clockwise from the top left
    const tl = new Timeline('journey', 2 * BEAT);
    const end = 2 * BEAT;
    /** The cells of a square ring, in clockwise order. */
    const ringCells = (half: number, size: number): [number, number][] => {
      const n = Math.round((2 * half) / size);
      const out: [number, number][] = [];
      for (let i = 0; i < n; i++) out.push([i, 0]);
      for (let j = 1; j < n; j++) out.push([n - 1, j]);
      for (let i = n - 2; i >= 0; i--) out.push([i, n - 1]);
      for (let j = n - 2; j > 0; j--) out.push([0, j]);
      return out;
    };
    const rect = (half: number, size: number, [i, j]: [number, number], cls: string, extra = '') =>
      `<rect x="${60 - half + i * size + 1}" y="${45 - half + j * size + 1}" width="${size - 2}" height="${size - 2}" rx="2" class="${cls}" ${extra}/>`;
    const rings: [number, number, string, number, number][] = [
      // half, cell, colour, first cell lights at, last cell lights at
      [8, 8, 'ma-core', 0.2, 0.2],
      [20, 10, 'ma-ring1', 0.5, 1.4],
      [36, 12, 'ma-ring2', 1.7, 3.0],
    ];
    const ON = 'opacity:1;transform:scale(1)';
    const OFF = 'opacity:0;transform:scale(.5)';
    let dim = '';
    let lit = '';
    for (const [half, size, cls, from, to] of rings) {
      const cells = half === 8 ? [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][] : ringCells(half, size);
      cells.forEach((c, k) => {
        dim += rect(half, size, c, 'ma-ring');
        const at = half === 8 ? from : from + ((to - from) * k) / (cells.length - 1);
        lit += rect(half, size, c, `${cls} ma-pop ma-anim`, tl.show(at, end - 0.6, ON, OFF, 0.12, 0.5));
      });
    }
    return `<svg ${VIEW}>${tl.style()}${dim}${lit}</svg>`;
  }
  // mosaic: a patchwork of every size lighting up tile by tile until it is whole
  const tl = new Timeline('mosaic', 3 * BEAT);
  const tiles: [number, number, number][] = [
    [22, 8, 30], [54, 8, 14], [70, 8, 28], [54, 24, 14], [22, 40, 14], [38, 40, 14], [54, 40, 44], [22, 56, 30],
  ];
  const lit = ['ma-b', 'ma-c', 'ma-a'];
  const end = 3 * BEAT;
  const body = tiles
    .map(
      ([x, y, s], i) =>
        `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="3" class="ma-tile"/><rect x="${x}" y="${y}" width="${s}" height="${s}" rx="3" class="${lit[i % 3]} ma-anim" ${tl.show(0.5 + 0.75 * i, end - 0.6, 'opacity:1', 'opacity:0', 0.25, 0.5)}/>`,
    )
    .join('');
  return `<svg ${VIEW}>${tl.style()}${body}</svg>`;
}
