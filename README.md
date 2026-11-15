# Infinite Shikaku

An endless, seamless Shikaku world. The board is an infinite lattice of 8×8 puzzle zones. You solve a zone by splitting it into rectangles: each rectangle holds exactly one number, and that number is its area. Solving a zone unlocks its four neighbours. Zones get harder the further you travel from the origin: rectangles get larger, there are fewer tiny pieces, and far zones may need real search.

## Expanding world

Zones grow in concentric square rings around the start. Every boundary sits on a common multiple of the two tile sizes that meet there, so the board stays seamless:

| Zones | Distance from centre (cells) | Ring side | Zones in ring |
|---|---|---|---|
| 8×8 | 0–36 | 72 = 9·8 = 6·12 | 81 |
| 12×12 | 36–72 | 144 = 12·12 = 9·16 | 108 |
| 16×16 | 72–120 | 240 = 15·16 = 12·20 | 144 |
| 20×20 | 120–∞ | | ∞ |

8×8 zones unlock when any neighbour is solved. Bigger ("super") zones unlock only when **every** zone along one whole side is solved. For example, a 12×12 zone bordering two 8×8 zones needs both of them solved. Locked super zones show the progress on each side. The first time a bigger size unlocks, the camera zooms out to reveal the new ring.

## Play

- Drag across cells to draw a rectangle. Tap a rectangle to remove it. Tap a `1` to fill it.
- Drag on fog or solved areas to pan. Pinch or scroll to zoom.
- **Continue** glides the camera to the nearest unlocked zone.
- The game tracks the timer per zone, best, average and last solve times, farthest level and total play time.
- Progress saves automatically to `localStorage` under the key `infinite-shikaku:v2`. Older v1 saves are migrated automatically.

## Develop

```sh
npm install
npm run dev     # local dev server
npm test        # solver + generator tests
npm run build   # production build in dist/
```

## How it works

- `src/layout.ts`: the tier rings, mapping cells to zones, and edge neighbours.
- `src/generator.ts`: each zone is generated deterministically from `(worldSeed, zx, zy)`. The generator makes a random rectangle partition, places clues, then checks that the solution is unique.
- `src/solver.ts`: candidate enumeration, constraint propagation and backtracking. It counts solutions up to 2 and reports whether guessing was needed.
- `src/gen.worker.ts` / `src/zones.ts`: zones are generated off the main thread and cached.
- `src/render.ts`: a canvas renderer with a pan/zoom camera. Seams between solved zones fade out.
- `src/world.ts`, `src/storage.ts`, `src/main.ts`: game state, persistence, input and the HUD.
