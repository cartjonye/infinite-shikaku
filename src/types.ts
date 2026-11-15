export const ZONE = 8; // zone side length in cells

export interface Clue {
  r: number;
  c: number;
  v: number;
}

/** Rectangle in zone-local cell coordinates. */
export interface Rect {
  r: number;
  c: number;
  h: number;
  w: number;
}

export interface Puzzle {
  size: number;
  clues: Clue[];
  /** solution[i] is the rectangle belonging to clues[i] */
  solution: Rect[];
  needsSearch: boolean;
}

export const rectArea = (q: Rect) => q.w * q.h;

export const rectContains = (q: Rect, r: number, c: number) =>
  r >= q.r && r < q.r + q.h && c >= q.c && c < q.c + q.w;

export const rectsOverlap = (a: Rect, b: Rect) =>
  a.r < b.r + b.h && b.r < a.r + a.h && a.c < b.c + b.w && b.c < a.c + a.w;

export const rectEq = (a: Rect, b: Rect) =>
  a.r === b.r && a.c === b.c && a.w === b.w && a.h === b.h;
