import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createClassicLayout, createFixedLayout, createMosaicLayout, type WorldLayout } from '../src/layouts';
import { freshSave, sanitize, type SaveData } from '../src/storage';
import { createTiler } from '../src/vendor/tiling';
import { World } from '../src/world';

const tiler = createTiler(readFileSync(new URL('../public/tilings_66x66.packed.txt', import.meta.url), 'utf8'));
const N = 5000;

/** Play N zones (always the open zone nearest the centre) and time the bookkeeping of each solve. */
function simulate(L: WorldLayout, save: SaveData) {
  const w = new World(L, save);
  let total = 0;
  let worst = 0;
  for (let i = 0; i < N; i++) {
    const z = w.nearestOpen(L.centre[0], L.centre[1]);
    expect(z).not.toBeNull();
    const t = performance.now();
    w.markSolved(z!);
    w.status(z!);
    const dt = performance.now() - t;
    total += dt;
    worst = Math.max(worst, dt);
  }
  const t1 = performance.now();
  const json = JSON.stringify(save);
  const serialise = performance.now() - t1;
  const t2 = performance.now();
  const loaded = sanitize(JSON.parse(json), L);
  const w2 = new World(L, loaded);
  const reload = performance.now() - t2;
  expect(w2.openCount).toBe(w.openCount);
  return { avg: total / N, worst, bytes: json.length, serialise, reload, open: w.openCount };
}

describe(`scale: ${N} solved zones`, () => {
  const cases: [string, () => [WorldLayout, SaveData]][] = [
    ['Classic', () => [createClassicLayout(), freshSave('classic')]],
    ['Fixed 6x6', () => [createFixedLayout(6), freshSave('fixed', 6)]],
    ['Mosaic', () => [createMosaicLayout(123, tiler), freshSave('mosaic')]],
  ];
  for (const [name, make] of cases) {
    it(`${name}: solving, saving and reloading stay fast`, () => {
      const [L, save] = make();
      const r = simulate(L, save);
      console.log(
        `SCALE ${name}: solve avg ${r.avg.toFixed(3)} ms, worst ${r.worst.toFixed(1)} ms, save ${(r.bytes / 1024).toFixed(0)} KB in ${r.serialise.toFixed(1)} ms, reload ${r.reload.toFixed(0)} ms, ${r.open} open`,
      );
      expect(save.solved.length).toBe(N);
      expect(r.avg).toBeLessThan(2);
      expect(r.worst).toBeLessThan(16);
      expect(r.bytes).toBeLessThan(1024 * 1024);
      expect(r.serialise).toBeLessThan(20);
      expect(r.reload).toBeLessThan(1500);
    }, 120000);
  }
});
