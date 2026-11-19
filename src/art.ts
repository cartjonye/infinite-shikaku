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

/** Mode cards: a tiny looping picture of how each mode plays. */
export function modeArt(mode: ModeId): string {
  if (mode === 'classic') {
    // grids grow level after level: 4×4, 5×5, 6×6, then back to level 1
    const cell = 9;
    const gap = 2;
    const step = cell + gap;
    const parts: Record<number, [number, number, number, number][]> = {
      4: [[0, 0, 2, 2], [2, 0, 2, 2], [0, 2, 4, 2]],
      5: [[0, 0, 3, 2], [3, 0, 2, 3], [0, 2, 3, 3], [3, 3, 2, 2]],
      6: [[0, 0, 3, 3], [3, 0, 3, 2], [3, 2, 3, 4], [0, 3, 3, 3]],
    };
    const fills = ['ma-a', 'ma-b', 'ma-c', 'ma-a'];
    const level = (slot: number, n: number, lv: number, filled: boolean) => {
      const span = n * step - gap;
      const x0 = 60 + slot * 100 - span / 2;
      const y0 = 40 - span / 2;
      const rects = filled
        ? `<g class="ma-pf ma-pf${lv}">${parts[n]
            .map(([c, r, w, h], i) => `<rect x="${x0 + c * step}" y="${y0 + r * step}" width="${w * step - gap}" height="${h * step - gap}" rx="2.5" class="${fills[i]}"/>`)
            .join('')}</g>`
        : '';
      return `${cells(n, n, x0, y0, cell, gap)}${rects}`;
    };
    // level steps under the grid: (1) 2 3, then 1 (2) 3, then 1 2 (3)
    const steps = [1, 2, 3]
      .map((lv) => {
        const x = 44 + (lv - 1) * 16;
        return `<text x="${x}" y="85" class="ma-lv">${lv}</text><g class="ma-step ma-step${lv}"><circle cx="${x}" cy="82" r="6" class="ma-step-dot"/><text x="${x}" y="85" class="ma-lv ma-lv-on">${lv}</text></g>`;
      })
      .join('');
    return `<svg ${VIEW}><g class="ma-prog">${level(0, 4, 1, true)}${level(1, 5, 2, true)}${level(2, 6, 3, true)}${level(3, 4, 1, false)}</g>${steps}</svg>`;
  }
  if (mode === 'focused') {
    // the same size every time: one grid fills, then slides off as an identical one slides in
    const grid = (x: number, filled: boolean) =>
      `<g transform="translate(${x} 0)">${cells(3, 3, 0, 18, 16, 3)}${
        filled
          ? `<rect x="0" y="18" width="35" height="16" rx="3" class="ma-a ma-fill1"/><rect x="38" y="18" width="16" height="35" rx="3" class="ma-b ma-fill2"/><rect x="0" y="37" width="35" height="35" rx="3" class="ma-c ma-fill3"/><rect x="38" y="56" width="16" height="16" rx="3" class="ma-a ma-fill3"/>`
          : ''
      }</g>`;
    return `<svg ${VIEW}><g class="ma-slide">${grid(33, true)}${grid(123, false)}</g></svg>`;
  }
  if (mode === 'journey') {
    // a small centre with ever bigger rings growing outward
    const ring = (n: number, half: number, size: number, cls: string) => {
      let out = '';
      const steps = Math.round((2 * half) / size);
      for (let i = 0; i < steps; i++)
        for (let j = 0; j < steps; j++) {
          if (i > 0 && i < steps - 1 && j > 0 && j < steps - 1) continue;
          out += `<rect x="${60 - half + i * size + 1}" y="${45 - half + j * size + 1}" width="${size - 2}" height="${size - 2}" rx="2" class="ma-ring ${cls}"/>`;
        }
      return n ? `<g class="ma-ring${n}">${out}</g>` : out;
    };
    return `<svg ${VIEW}>${ring(0, 8, 8, 'ma-core')}${ring(1, 20, 10, '')}${ring(2, 36, 12, '')}</svg>`;
  }
  // mosaic: a patchwork of every size, lighting up piece by piece
  const tiles: [number, number, number][] = [
    [22, 8, 30], [54, 8, 14], [70, 8, 28], [54, 24, 14], [22, 40, 14], [38, 40, 14], [54, 40, 44], [22, 56, 30], [70, 38, 0],
  ];
  return `<svg ${VIEW}>${tiles
    .filter((t) => t[2] > 0)
    .map(([x, y, s], i) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="3" class="ma-tile ma-t${(i % 3) + 1}" style="animation-delay:${i * 0.25}s"/>`)
    .join('')}</svg>`;
}
