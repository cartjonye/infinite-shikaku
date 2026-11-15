/// <reference lib="webworker" />
import { generateZone, type ZoneSpec } from './generator';

self.onmessage = (e: MessageEvent<{ seed: number; key: string; spec: ZoneSpec }>) => {
  const { seed, key, spec } = e.data;
  const puzzle = generateZone(seed, spec);
  (self as unknown as Worker).postMessage({ key, seed, puzzle });
};
