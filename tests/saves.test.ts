import { beforeEach, describe, expect, it } from 'vitest';
import { DIFFICULTIES, FOCUSED_SIZES, createJourneyLayout, type ModeId } from '../src/layouts';
import { World } from '../src/world';
import {
  SCHEMA,
  clearSave,
  freshSave,
  loadSave,
  parseSeedCode,
  placedArea,
  savedOptions,
  seedCode,
  summarize,
  writeSave,
} from '../src/storage';

// minimal localStorage for node (storage is read lazily, so this can follow the imports)
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

describe('one save per difficulty and grid size', () => {
  beforeEach(() => mem.clear());

  it('keeps Classic Easy and Classic Hard apart', () => {
    const easy = freshSave('classic', { difficulty: 'easy' });
    const hard = freshSave('classic', { difficulty: 'hard' });
    easy.stats.zonesSolved = 3;
    hard.stats.zonesSolved = 7;
    writeSave(easy);
    writeSave(hard);
    expect(loadSave('classic', { difficulty: 'easy' })!.stats.zonesSolved).toBe(3);
    expect(loadSave('classic', { difficulty: 'hard' })!.stats.zonesSolved).toBe(7);
    expect(loadSave('classic', { difficulty: 'medium' })).toBeNull();
    expect(mem.has('infinite-shikaku:infinity:classic-easy')).toBe(true);
    expect(mem.has('infinite-shikaku:infinity:classic-hard')).toBe(true);
  });

  it('keeps every Focused size apart and lists what is saved, newest first', async () => {
    const a = freshSave('focused', { size: 6 });
    writeSave(a);
    await new Promise((r) => setTimeout(r, 5));
    const b = freshSave('focused', { size: 12 });
    writeSave(b);
    expect(savedOptions('focused').map((x) => x.opts)).toEqual([{ size: 12 }, { size: 6 }]);
    expect(summarize('focused', { size: 12 })!.size).toBe(12);
    expect(savedOptions('classic')).toEqual([]);
  });

  it('deleting one option leaves the others', () => {
    writeSave(freshSave('classic', { difficulty: 'easy' }));
    writeSave(freshSave('classic', { difficulty: 'expert' }));
    clearSave('classic', { difficulty: 'easy' });
    expect(loadSave('classic', { difficulty: 'easy' })).toBeNull();
    expect(loadSave('classic', { difficulty: 'expert' })).not.toBeNull();
  });

  it('World modes still have a single save each', () => {
    writeSave(freshSave('journey'));
    expect(loadSave('journey')).not.toBeNull();
    expect(savedOptions('journey').map((x) => x.opts)).toEqual([{}]);
    expect(mem.has('infinite-shikaku:infinity:journey')).toBe(true);
  });
});

describe('seed codes', () => {
  const save = (mode: ModeId, o: { difficulty?: any; size?: number } = {}, seed = 123456789) => ({ ...freshSave(mode, o), seed });

  it('reads at a glance before the underscore', () => {
    expect(seedCode(save('classic', { difficulty: 'hard' }))).toBe(`${SCHEMA}CLHA_21I3V9`);
    expect(seedCode(save('classic', { difficulty: 'easy' }))).toMatch(new RegExp(`^${SCHEMA}CLEA_`));
    expect(seedCode(save('classic', { difficulty: 'medium' }))).toMatch(/^\dCLME_/);
    expect(seedCode(save('classic', { difficulty: 'expert' }))).toMatch(/^\dCLEX_/);
    expect(seedCode(save('focused', { size: 6 }))).toMatch(/^\dFC06_/);
    expect(seedCode(save('focused', { size: 24 }))).toMatch(/^\dFC24_/);
    expect(seedCode(save('journey'))).toMatch(/^\dJO00_/);
    expect(seedCode(save('mosaic'))).toMatch(/^\dMO00_/);
  });

  it('round-trips every mode and option, including extreme seeds', () => {
    const cases: [ModeId, object][] = [
      ...DIFFICULTIES.map((difficulty) => ['classic', { difficulty }] as [ModeId, object]),
      ...FOCUSED_SIZES.map((size) => ['focused', { size }] as [ModeId, object]),
      ['journey', {}],
      ['mosaic', {}],
    ];
    for (const [mode, opts] of cases)
      for (const seed of [0, 1, 123456789, 0xffffffff]) {
        const code = seedCode(save(mode, opts, seed));
        expect(parseSeedCode(code)).toEqual({ version: SCHEMA, mode, opts, seed });
        expect(parseSeedCode(code.toLowerCase())).toEqual({ version: SCHEMA, mode, opts, seed });
      }
  });

  it('rejects malformed codes', () => {
    for (const bad of ['', 'CLHA_123', '6XXHA_1', '6CLZZ_1', '6FC07_1', '6JO12_1', '6CLHA-1', '6CLHA_', '12345CLHA_1', '6CLHA_ZZZZZZZZ'])
      expect(parseSeedCode(bad)).toBeNull();
  });
});

describe('area credit for placed cells', () => {
  it('is 0 for a fresh save and sums every rectangle on unsolved zones', () => {
    const d = freshSave('journey');
    expect(placedArea(d)).toBe(0);
    d.rects = {
      a: [{ c: 0, r: 0, w: 2, h: 3 }, { c: 2, r: 0, w: 1, h: 1 }],
      b: [{ c: 0, r: 0, w: 4, h: 2 }],
    };
    expect(placedArea(d)).toBe(6 + 1 + 8);
  });

  it('a solved zone hands its area to the solved total, never counted twice', () => {
    const L = createJourneyLayout();
    const d = freshSave('journey');
    const w = new World(L, d);
    const z = L.origin;
    d.rects[z.key] = [{ c: 0, r: 0, w: 3, h: 2 }];
    expect(placedArea(d)).toBe(6);
    w.markSolved(z);
    expect(placedArea(d)).toBe(0);
  });
});
