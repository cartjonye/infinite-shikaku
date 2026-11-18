# Infinite Shikaku

An endless, seamless Shikaku world. You solve a zone by splitting it into rectangles: each rectangle holds exactly one number, and that number is its area. Solving zones unlocks more of the world.

## Play styles

The main menu offers three play styles:

- **Endless**: the three worlds below, each with its own save (Continue or New).
- **Time Attack**: clear as much area as possible in 2, 5 or 10 minutes, in a fresh world of your choice. Not saved; personal bests are kept per world and length.
- **Survival**: start with 90 seconds; every solved zone adds time. Each grid size has a weight (6×6 10, 8×8 15, 10×10 22, 12×12 28, 15×15 40, 16×16 44, 18×18 52, 20×20 61, 24×24 80, scaled to its typical number of pieces). The bonus is `round(base × weight / 10)` seconds, where `base` (the 6×6 bonus) is 30 s for the first three zones, then drops 1 s every three zones down to a floor of 6 s from the 73rd zone. Because it shrinks per zone, big grids are worth most early in a run. A run in progress is saved per world and resumes after a 3, 2, 1 countdown; personal bests rank by time survived.

Run logic lives in `src/runs.ts`.

## Worlds

Each mode has its own save, so the menu offers **Continue** or **New game** per mode.

- **Classic**: zones grow in concentric rings from 6×6 to 24×24 (see below). The HUD shows the depth.
- **Fixed**: you pick one tile size (6, 8, 10, 12, 15, 16, 18, 20 or 24), and every zone in that world uses it. Puzzles get harder with depth.
- **Mosaic**: an endless grid of random 66×66 supertiles, each a gap-free tiling by 28 squares of every size.
  - The tilings come from the bundled square-tiling-66 dataset: `public/tilings_66x66.packed.txt` and `src/vendor/tiling.js`.
  - The start is the 6×6 zone nearest the centre of the first supertile.
  - The HUD shows the straight-line distance to it, with 1 cell = 1 m.
  - A zone opens when every zone along any one of its sides is solved (no diagonal rule).
  - If that ever leaves nothing open, the frontier zone(s) closest to completing a side open, so a game can never get stuck.

**Pause** (the ⏸ button or Esc) stops the timer and shows that mode's stats, including a per-grid-size table of solved count, best and average time, plus How to play and Back to menu.

## Timer and input rules

- A zone's clock starts with the first rectangle the player drags in it. Looking at a zone or tapping never starts it.
- The clock runs only for the zone the player last acted in, while that zone is on screen, the zoom is playable, the tab is visible and nothing is paused.
- Below 9 px per cell (where clue numbers are hidden) the board is not playable: the clock pauses and every drag pans.
- Input that doesn't touch a number does nothing. A drag over exactly one number with the right area places a rectangle; a drag over a number with the wrong area (or over several numbers) shows as a short red flash that fades in a second and replaces nothing. Tapping a number removes its rectangle (with Undo) or fills a 1; taps elsewhere do nothing. Taps right after a pan, pinch or glide, and long presses, are ignored.
- Every start or resume, in every mode, plays a 3, 2, 1, Go countdown with the board locked and all clocks frozen. First-time players see a "Getting around" controls card first (replayable from How to play).
- The start zone has a gold outline and house badge; the Home button (H) glides back to it and points towards it while it is off screen.

## Puzzle guarantees

- Every puzzle has exactly one solution. The generator checks this with the solver, and the tests re-check it with an independent brute-force tiler. Solved zones are therefore not stored; they are redrawn from the seed.
- Single-cell pieces are almost eliminated: they are a last resort in the partition, merged into neighbours where possible, and capped at `floor(size² / 150)` per zone.

## Scale

`tests/scale.test.ts` plays 5,000 zones in each mode: solve bookkeeping averages well under 0.1 ms, the save stays near 65 KB, and reloading takes about 40 ms. Solved zones are generated in a Web Worker and the puzzle cache is bounded, so large worlds reload without freezing.

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
- Progress saves automatically to `localStorage` with one key per mode: `infinite-shikaku:classic:v4`, `infinite-shikaku:fixed:v2` and `infinite-shikaku:mosaic:v2`. It autosaves every 5 seconds, on every solve, and when the page is hidden.

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
