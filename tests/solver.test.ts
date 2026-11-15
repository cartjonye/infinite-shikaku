import { describe, expect, it } from 'vitest';
import { solve } from '../src/solver';
import type { Clue } from '../src/types';

describe('solver', () => {
  it('solves the 7x7 puzzle from the reference screenshot uniquely', () => {
    const clues: Clue[] = [
      { r: 0, c: 0, v: 5 },
      { r: 1, c: 3, v: 12 },
      { r: 3, c: 3, v: 9 },
      { r: 3, c: 4, v: 9 },
      { r: 5, c: 3, v: 8 },
      { r: 5, c: 6, v: 3 },
      { r: 6, c: 4, v: 3 },
    ];
    const res = solve(clues, 7, 7);
    expect(res.count).toBe(1);
    expect(res.solution).toEqual([
      { r: 0, c: 0, h: 5, w: 1 },
      { r: 0, c: 1, h: 2, w: 6 },
      { r: 2, c: 1, h: 3, w: 3 },
      { r: 2, c: 4, h: 3, w: 3 },
      { r: 5, c: 0, h: 2, w: 4 },
      { r: 5, c: 4, h: 1, w: 3 },
      { r: 6, c: 4, h: 1, w: 3 },
    ]);
  });

  it('detects multiple solutions', () => {
    // 2x2 grid with two 2-clues on a diagonal: horizontal or vertical split
    const res = solve(
      [
        { r: 0, c: 0, v: 2 },
        { r: 1, c: 1, v: 2 },
      ],
      2,
      2,
    );
    expect(res.count).toBe(2);
  });

  it('rejects inconsistent area sums', () => {
    expect(solve([{ r: 0, c: 0, v: 3 }], 2, 2).count).toBe(0);
  });
});
