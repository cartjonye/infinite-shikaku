// Vendored from the square-tiling-66 handoff package (lib/tiling.js), unchanged below.
// Seeded access to every balanced 66x66 square tiling (ES module).
// Squares are [x, y, size]: x = column from left, y = row from top.
// Seed scheme matches lib/tiling.py and viewer/index.html exactly.
//
// Usage (Node):
//   import { createTiler } from "./tiling.js";
//   import { readFileSync } from "node:fs";
//   const t = createTiler(readFileSync("../data/tilings_66x66.packed.txt", "utf8"));
//   t.layout(12345); t.layout("hello"); t.randomLayout();
// In a browser, fetch the packed file (or inline it) and pass the string.

export const N = 66, UNIQUE = 10828, TOTAL = UNIQUE * 8;
export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export const ORDER = [6,6,6,6,6,8,8,8,8,8,10,10,10,10,10,12,12,12,12,15,15,15,15,16,18,18,20,24];

export function orient(squares, k) {
  return squares.map(([x, y, s]) => {
    if (k & 4) [x, y] = [y, x];
    if (k & 1) x = N - x - s;
    if (k & 2) y = N - y - s;
    return [x, y, s];
  });
}

export function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function parseSeed(v) {
  v = String(v).trim();
  if (v === "") return 0;
  if (/^\d+$/.test(v)) { const n = Number(v); return n < TOTAL ? n : fnv1a(v) % TOTAL; }
  return fnv1a(v) % TOTAL;
}

export function validate(squares, n = N) {
  const g = new Uint8Array(n * n);
  for (const [x, y, s] of squares) {
    if (x < 0 || y < 0 || x + s > n || y + s > n) return false;
    for (let i = x; i < x + s; i++) for (let j = y; j < y + s; j++) g[i * n + j]++;
  }
  return g.every(c => c === 1);
}

export function createTiler(packed) {
  const data = packed.trim();
  if (data.length !== UNIQUE * 56) throw new Error("unexpected packed data length");
  const decode = id => ORDER.map((s, i) =>
    [ALPHABET.indexOf(data[id * 56 + 2 * i]), ALPHABET.indexOf(data[id * 56 + 2 * i + 1]), s]);
  const layout = seed => { const s = parseSeed(seed); return orient(decode(Math.floor(s / 8)), s % 8); };
  const randomLayout = (rand = Math.random) => { const s = Math.floor(rand() * TOTAL); return { seed: s, squares: layout(s) }; };
  return { decode, layout, randomLayout };
}
