/** Caches generated puzzles; generates them in a Web Worker when available. */
import { generateZone } from './generator';
import type { Puzzle } from './types';
import { zkey } from './world';

export class ZoneCache {
  private cache = new Map<string, Puzzle>();
  private pending = new Set<string>();
  private worker: Worker | null = null;
  private queue: [number, number][] = [];

  constructor(
    private seed: number,
    private onReady: (key: string) => void,
  ) {
    try {
      this.worker = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const { zx, zy, seed, puzzle } = e.data;
        if (seed !== this.seed) return;
        this.store(zx, zy, puzzle);
      };
      this.worker.onerror = () => {
        // fall back to main-thread generation
        this.worker = null;
        const pend = [...this.pending];
        this.pending.clear();
        for (const k of pend) {
          const [x, y] = k.split(',').map(Number);
          this.request(x, y);
        }
      };
    } catch {
      this.worker = null;
    }
  }

  private store(zx: number, zy: number, p: Puzzle) {
    const k = zkey(zx, zy);
    this.pending.delete(k);
    this.cache.set(k, p);
    this.onReady(k);
  }

  get(zx: number, zy: number): Puzzle | undefined {
    return this.cache.get(zkey(zx, zy));
  }

  /** Synchronous generation (used when a puzzle is needed immediately). */
  getNow(zx: number, zy: number): Puzzle {
    const k = zkey(zx, zy);
    let p = this.cache.get(k);
    if (!p) {
      p = generateZone(this.seed, zx, zy);
      this.cache.set(k, p);
      this.pending.delete(k);
    }
    return p;
  }

  request(zx: number, zy: number) {
    const k = zkey(zx, zy);
    if (this.cache.has(k) || this.pending.has(k)) return;
    this.pending.add(k);
    if (this.worker) {
      this.worker.postMessage({ seed: this.seed, zx, zy });
    } else {
      this.queue.push([zx, zy]);
      if (this.queue.length === 1) setTimeout(() => this.drain(), 0);
    }
  }

  private drain() {
    const job = this.queue.shift();
    if (!job) return;
    this.store(job[0], job[1], generateZone(this.seed, job[0], job[1]));
    if (this.queue.length) setTimeout(() => this.drain(), 0);
  }

  reset(seed: number) {
    this.seed = seed;
    this.cache.clear();
    this.pending.clear();
    this.queue = [];
  }
}
