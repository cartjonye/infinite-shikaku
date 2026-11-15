/** Caches generated puzzles; generates them in a Web Worker when available. */
import { generateZone } from './generator';
import type { Zone } from './layout';
import type { Puzzle } from './types';

export class ZoneCache {
  private cache = new Map<string, Puzzle>();
  private pending = new Map<string, Zone>();
  private worker: Worker | null = null;
  private queue: Zone[] = [];

  constructor(
    private seed: number,
    private onReady: (key: string) => void,
  ) {
    try {
      this.worker = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const { key, seed, puzzle } = e.data;
        if (seed !== this.seed || !this.pending.has(key)) return;
        this.store(key, puzzle);
      };
      this.worker.onerror = () => {
        // fall back to main-thread generation
        this.worker = null;
        const pend = [...this.pending.values()];
        this.pending.clear();
        for (const z of pend) this.request(z);
      };
    } catch {
      this.worker = null;
    }
  }

  private store(key: string, p: Puzzle) {
    this.pending.delete(key);
    this.cache.set(key, p);
    this.onReady(key);
  }

  get(z: Zone): Puzzle | undefined {
    return this.cache.get(z.key);
  }

  /** Synchronous generation (used when a puzzle is needed immediately). */
  getNow(z: Zone): Puzzle {
    let p = this.cache.get(z.key);
    if (!p) {
      p = generateZone(this.seed, z);
      this.cache.set(z.key, p);
      this.pending.delete(z.key);
    }
    return p;
  }

  request(z: Zone) {
    if (this.cache.has(z.key) || this.pending.has(z.key)) return;
    this.pending.set(z.key, z);
    if (this.worker) {
      this.worker.postMessage({ seed: this.seed, key: z.key, spec: { x0: z.x0, y0: z.y0, size: z.size } });
    } else {
      this.queue.push(z);
      if (this.queue.length === 1) setTimeout(() => this.drain(), 0);
    }
  }

  private drain() {
    const z = this.queue.shift();
    if (!z) return;
    this.store(z.key, generateZone(this.seed, z));
    if (this.queue.length) setTimeout(() => this.drain(), 0);
  }
}
