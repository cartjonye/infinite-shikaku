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
  SURVIVAL_START_S,
  survivalBonusMs,
  survivalStep,
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

  it('survival bonus matrix: 9 sizes x 25 steps, agreed endpoints, monotonic', () => {
    const sizes = [6, 8, 10, 12, 15, 16, 18, 20, 24];
    expect(Object.keys(SURVIVAL_BONUS_S).map(Number)).toEqual(sizes);
    for (const n of sizes) expect(SURVIVAL_BONUS_S[n].length).toBe(25);
    expect(SURVIVAL_BONUS_S[6][0]).toBe(30);
    expect(SURVIVAL_BONUS_S[6][24]).toBe(6);
    expect(SURVIVAL_BONUS_S[24][0]).toBe(240);
    expect(SURVIVAL_BONUS_S[24][24]).toBe(120);
    for (const n of sizes)
      for (let k = 1; k < 25; k++) expect(SURVIVAL_BONUS_S[n][k]).toBeLessThanOrEqual(SURVIVAL_BONUS_S[n][k - 1]);
    for (let k = 0; k < 25; k++)
      for (let i = 1; i < sizes.length; i++)
        expect(SURVIVAL_BONUS_S[sizes[i]][k]).toBeGreaterThan(SURVIVAL_BONUS_S[sizes[i - 1]][k]);
  });

  it('looks bonuses up by step: 3 zones per step, last column from zone 73', () => {
    expect([1, 2, 3, 4, 6, 7, 72, 73, 500].map(survivalStep)).toEqual([0, 0, 0, 1, 1, 2, 23, 24, 24]);
    expect(survivalBonusMs(6, 1)).toBe(30_000);
    expect(survivalBonusMs(6, 4)).toBe(29_000);
    expect(survivalBonusMs(24, 1)).toBe(240_000);
    expect(survivalBonusMs(24, 500)).toBe(120_000);
    expect(survivalBonusMs(12, 7)).toBe(79_000);
  });

  it('starts Survival at 3x the first grid\'s first bonus', () => {
    for (const [n, s] of Object.entries(SURVIVAL_START_S)) expect(s).toBe(3 * SURVIVAL_BONUS_S[Number(n)][0]);
    expect(newRun('survival', 'classic').clockMs).toBe(90_000);
    expect(newRun('survival', 'mosaic').clockMs).toBe(90_000);
    expect(newRun('survival', 'fixed', 24).clockMs).toBe(720_000);
    expect(newRun('survival', 'fixed', 12).clockMs).toBe(252_000);
    expect(newRun('survival', 'singles', undefined, undefined, 'medium').clockMs).toBe(135_000);
    expect(newRun('survival', 'singles', undefined, undefined, 'expert').clockMs).toBe(360_000);
    expect(recordKey('survival', 'singles', undefined, undefined, 'hard')).toBe('sv:singles-hard');
  });

  it('starts runs with the right clocks and credits solves', () => {
    const ta = newRun('timeattack', 'mosaic', undefined, 2);
    expect(ta.clockMs).toBe(120_000);
    expect(creditSolve(ta, 8)).toBe(0);
    expect(ta.area).toBe(64);
    const sv = newRun('survival', 'fixed', 10);
    expect(sv.clockMs).toBe(198_000);
    expect(creditSolve(sv, 10)).toBe(66_000);
    expect(sv.clockMs).toBe(264_000);
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
    expect(loadSurvival('fixed', 8)!.run.clockMs).toBe(135_000);
    expect(loadSurvival('fixed', 10)).toBeNull();
    clearSurvival('fixed', 8);
    expect(loadSurvival('fixed', 8)).toBeNull();
  });
});

describe('Singles Survival runs from older versions', () => {
  it('are converted to level keys with the run itself kept', () => {
    mem.clear();
    const run = newRun('survival', 'singles', undefined, undefined, 'easy');
    run.clockMs = 77_000;
    run.zones = 3;
    const save = freshSave('singles', undefined, 'easy');
    save.solved = ['6@0,-3', '6@10,-3', '8@20,-4']; // version 2 (centred) positions of levels 1-3
    mem.set('infinite-shikaku:survival:singles-easy:v2', JSON.stringify({ v: 1, save, run }));
    const slot = loadSurvival('singles', undefined, 'easy')!;
    expect(slot.save.solved).toEqual(['L1', 'L2', 'L3']);
    expect(slot.run.clockMs).toBe(77_000);
    expect(slot.run.zones).toBe(3);
    expect(mem.has('infinite-shikaku:survival:singles-easy:v2')).toBe(false);
    expect(mem.has('infinite-shikaku:survival:singles-easy:v3')).toBe(true);
  });
});
