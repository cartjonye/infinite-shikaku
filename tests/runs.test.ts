import { beforeEach, describe, expect, it } from 'vitest';
import {
  SURVIVAL_BONUS_S,
  clearSurvival,
  creditSolve,
  getRecord,
  isBetter,
  loadSurvival,
  newRun,
  recordKey,
  submitRecord,
  survivalBase6,
  survivalBonusMs,
  writeSurvival,
} from '../src/runs';
import { freshSave } from '../src/storage';

// minimal localStorage for node
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
};

describe('runs', () => {
  beforeEach(() => mem.clear());

  it('survival bonus starts at 3x the table and shrinks 1 s (6x6) every 3 zones, down to 6 s', () => {
    expect(SURVIVAL_BONUS_S).toEqual({ 6: 10, 8: 15, 10: 22, 12: 28, 15: 40, 16: 44, 18: 52, 20: 61, 24: 80 });
    // zones 1-3: 3x the table
    for (const n of [1, 2, 3]) {
      expect(survivalBase6(n)).toBe(30);
      expect(survivalBonusMs(6, n)).toBe(30_000);
      expect(survivalBonusMs(24, n)).toBe(240_000);
    }
    // from the 4th zone, 1 s less every 3 zones
    expect(survivalBase6(4)).toBe(29);
    expect(survivalBase6(6)).toBe(29);
    expect(survivalBase6(7)).toBe(28);
    expect(survivalBonusMs(12, 7)).toBe(Math.round((28 * 28) / 10) * 1000);
    // floor of 6 s for 6x6 (0.6x the table) from zone 73 on
    expect(survivalBase6(72)).toBe(7);
    expect(survivalBase6(73)).toBe(6);
    expect(survivalBase6(500)).toBe(6);
    expect(survivalBonusMs(6, 500)).toBe(6_000);
    expect(survivalBonusMs(24, 500)).toBe(48_000);
  });

  it('starts runs with the right clocks and credits solves', () => {
    const ta = newRun('timeattack', 'mosaic', undefined, 2);
    expect(ta.clockMs).toBe(120_000);
    expect(creditSolve(ta, 8)).toBe(0);
    expect(ta.area).toBe(64);
    const sv = newRun('survival', 'fixed', 10);
    expect(sv.clockMs).toBe(30_000);
    expect(creditSolve(sv, 10)).toBe(66_000);
    expect(sv.clockMs).toBe(96_000);
    expect(sv.bySize).toEqual({ 10: 1 });
  });

  it('builds stable record keys', () => {
    expect(recordKey('timeattack', 'mosaic', undefined, 5)).toBe('ta:mosaic:5');
    expect(recordKey('timeattack', 'fixed', 12, 2)).toBe('ta:fixed-12:2');
    expect(recordKey('survival', 'classic')).toBe('sv:classic');
  });

  it('ranks Time Attack by area then zones, Survival by time then area', () => {
    const r = (area: number, zones: number, survivedMs?: number) => ({ area, zones, survivedMs, date: 0 });
    expect(isBetter('timeattack', r(100, 2), r(90, 5))).toBe(true);
    expect(isBetter('timeattack', r(100, 2), r(100, 3))).toBe(false);
    expect(isBetter('survival', r(10, 1, 60_000), r(999, 9, 59_000))).toBe(true);
    expect(isBetter('survival', r(10, 1, 60_000), r(11, 1, 60_000))).toBe(false);
  });

  it('keeps only better runs as personal bests', () => {
    const a = newRun('timeattack', 'mosaic', undefined, 5);
    creditSolve(a, 12);
    expect(submitRecord(a)).toBe(true);
    const worse = newRun('timeattack', 'mosaic', undefined, 5);
    creditSolve(worse, 6);
    expect(submitRecord(worse)).toBe(false);
    expect(getRecord('ta:mosaic:5')!.area).toBe(144);
    // other lengths are separate
    expect(submitRecord(worse)).toBe(false);
    const other = newRun('timeattack', 'mosaic', undefined, 2);
    creditSolve(other, 6);
    expect(submitRecord(other)).toBe(true);
  });

  it('saves and clears a Survival run per world', () => {
    const run = newRun('survival', 'fixed', 8);
    const save = freshSave('fixed', 8);
    writeSurvival(save, run);
    expect(loadSurvival('fixed', 8)!.run.clockMs).toBe(30_000);
    expect(loadSurvival('fixed', 10)).toBeNull();
    clearSurvival('fixed', 8);
    expect(loadSurvival('fixed', 8)).toBeNull();
  });
});
