/// <reference lib="webworker" />
import { generateZone } from './generator';

self.onmessage = (e: MessageEvent<{ seed: number; zx: number; zy: number }>) => {
  const { seed, zx, zy } = e.data;
  const puzzle = generateZone(seed, zx, zy);
  (self as unknown as Worker).postMessage({ zx, zy, seed, puzzle });
};
