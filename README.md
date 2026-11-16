# Infinite Shikaku

An endless, seamless Shikaku world. You solve a zone by splitting it into rectangles: each rectangle holds exactly one number, and that number is its area. Solving zones unlocks more of the world.

## Modes

Each mode has its own save, so the menu offers **Continue** or **New game** per mode.

- **Classic**: zones grow in concentric rings from 6×6 to 24×24 (see below). The HUD shows the depth.
- **Fixed**: you pick one tile size (6, 8, 10, 12, 15, 16, 18, 20 or 24), and every zone in that world uses it. Puzzles get harder with depth.
- **Mosaic**: an endless grid of random 66×66 supertiles, each a gap-free tiling by 28 squares of every size.
  - The tilings come from the bundled square-tiling-66 dataset: `public/tilings_66x66.packed.txt` and `src/vendor/tiling.js`.
  - The start is the 6×6 zone nearest the centre of the first supertile.
  - The HUD shows the straight-line distance to it, with 1 cell = 1 m.
  - A zone opens when every zone along any one of its sides is solved (no diagonal rule).
  - If that ever leaves nothing open, the frontier zone(s) closest to completing a side open, so a game can never get stuck.

**Pause** (the ⏸ button or Esc) stops the timer and shows that mode's stats, plus How to play and Back to menu.

## Classic: expanding world

Zones grow in concentric square rings around the start, where four 6×6 zones meet. Every boundary sits on a common multiple of the two tile sizes that meet there, and every ring's width is a multiple of its tile size, so the board stays seamless:

| Size | Full side | Rings | Zones | Depth |
|---|---|---|---|---|
| 6×6 | 72 | 6 | 144 | 1–6 |
| 8×8 | 120 | 3 | 144 | 7–9 |
| 10×10 | 180 | 3 | 180 | 10–12 |
| 12×12 | 300 | 5 | 400 | 13–17 |
| 15×15 | 480 | 6 | 624 | 18–23 |
| 16×16 | 576 | 3 | 396 | 24–26 |
| 18×18 | 720 | 4 | 576 | 27–30 |
| 20×20 | 840 | 3 | 468 | 31–33 |
| 24×24 | ∞ | ∞ | ∞ | 34+ |

**Unlocking.** Within a tier, a zone opens when any neighbour is solved. Where the size steps up, a zone opens only when every zone along one side is solved **plus one diagonal zone** past that side's corner. This means you can't just drill straight outward. Locked zones show their side progress and diagonal pips.

**Tools.**
- **+ / − / Fit** controls zoom. The game never zooms on its own.
- **Easier** jumps to the nearest open zone with a smaller grid.
- Keyboard: `+` `-` `f` `e` `c`.

## Play

- Drag across cells to draw a rectangle. Tap a rectangle to remove it. Tap a `1` to fill it.
- Drag on fog or solved areas to pan. Pinch or scroll to zoom.
- **Continue** glides the camera to the nearest unlocked zone.
- The game tracks the timer per zone, best, average and last solve times, farthest level and total play time.
- Progress saves automatically to `localStorage` with one key per mode: `infinite-shikaku:v3` (Classic), `infinite-shikaku:fixed:v1` and `infinite-shikaku:mosaic:v1`.

## Develop

```sh
npm install
npm run dev     # local dev server
npm test        # solver + generator tests
npm run build   # production build in dist/
```

## How it works

- `src/layouts/`: one module per mode (classic rings, fixed lattice, mosaic supertiles) behind a shared `WorldLayout` interface, plus generic neighbour and diagonal helpers.
- `src/generator.ts`: each zone is generated deterministically from `(worldSeed, zx, zy)`. The generator makes a random rectangle partition, places clues, then checks that the solution is unique.
- `src/solver.ts`: candidate enumeration, constraint propagation and backtracking. It counts solutions up to 2 and reports whether guessing was needed.
- `src/gen.worker.ts` / `src/zones.ts`: zones are generated off the main thread and cached.
- `src/render.ts`: a canvas renderer with a pan/zoom camera. Seams between solved zones fade out.
- `src/world.ts`, `src/storage.ts`, `src/main.ts`: game state, persistence, input and the HUD.
