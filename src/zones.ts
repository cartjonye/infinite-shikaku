/**
 * Puzzle cache. Puzzles are generated in a Web Worker when available; the cache is
 * bounded (least recently used zones are dropped and regenerate on demand).
 */
import { generateZone } from './generator';
import type { WorldLayout, Zone } from './layouts';
import type { Puzzle } from './types';

const IN_FLIGHT = 4;

export class ZoneCache {
  private cache = new Map<string, Puzzle>();
  private pending = new Map<string, Zone>();
  /** waiting to be sent to the worker; the END of the array goes first */
  private queue: Zone[] = [];
  private inFlight = 0;
  private worker: Worker | null = null;
  private cap = 1500;

  constructor(
    private seed: number,
    private layout: WorldLayout,
    private onReady: (key: string) => void,
  ) {
    try {
      this.worker = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const { key, seed, puzzle } = e.data;
        this.inFlight = Math.max(0, this.inFlight - 1);
        if (seed === this.seed && this.pending.has(key)) this.store(key, puzzle);
        this.pump();
      };
      this.worker.onerror = () => {
        // fall back to main-thread generation
        this.worker = null;
        this.inFlight = 0;
        this.queue = [...this.pending.values()];
        this.pump();
      };
    } catch {
      this.worker = null;
    }
  }

  private spec(z: Zone) {
    return { x0: z.x0, y0: z.y0, size: z.size, depth: this.layout.depthFor(z), seedId: z.seedId };
  }

  /** Stop the worker (when leaving a game). */
  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.queue = [];
    this.pending.clear();
  }

  /** Keep at least this many puzzles (e.g. twice what is on screen) so drawing never thrashes. */
  ensureCapacity(n: number) {
    this.cap = Math.max(1500, n);
  }

  private store(key: string, p: Puzzle) {
    this.pending.delete(key);
    this.cache.set(key, p);
    if (this.cache.size > this.cap) {
      let drop = this.cache.size - this.cap;
      for (const k of this.cache.keys()) {
        if (drop-- <= 0) break;
        this.cache.delete(k);
      }
    }
    this.onReady(key);
  }

  get(z: Zone): Puzzle | undefined {
    const p = this.cache.get(z.key);
    if (p) {
      // bump recency
      this.cache.delete(z.key);
      this.cache.set(z.key, p);
    }
    return p;
  }

  /** Synchronous generation (tests and debugging only). */
  getNow(z: Zone): Puzzle {
    let p = this.get(z);
    if (!p) {
      p = generateZone(this.seed, this.spec(z));
      this.cache.set(z.key, p);
      this.pending.delete(z.key);
    }
    return p;
  }

  /** Ask for a puzzle. Urgent requests (zones the player can act on) jump the queue. */
  request(z: Zone, urgent = false) {
    if (this.cache.has(z.key)) return;
    if (this.pending.has(z.key)) {
      if (urgent) {
        const i = this.queue.indexOf(z);
        if (i >= 0 && i !== this.queue.length - 1) {
          this.queue.splice(i, 1);
          this.queue.push(z);
        }
      }
      return;
    }
    this.pending.set(z.key, z);
    if (urgent) this.queue.push(z);
    else this.queue.unshift(z);
    this.pump();
  }

  private pump() {
    if (this.worker) {
      while (this.inFlight < IN_FLIGHT && this.queue.length) {
        const z = this.queue.pop()!;
        if (!this.pending.has(z.key)) continue;
        this.inFlight++;
        this.worker.postMessage({ seed: this.seed, key: z.key, spec: this.spec(z) });
      }
    } else if (this.queue.length && !this.draining) {
      this.draining = true;
      setTimeout(() => this.drain(), 0);
    }
  }

  private draining = false;
  private drain() {
    this.draining = false;
    const z = this.queue.pop();
    if (!z) return;
    if (this.pending.has(z.key)) this.store(z.key, generateZone(this.seed, this.spec(z)));
    this.pump();
  }
}
