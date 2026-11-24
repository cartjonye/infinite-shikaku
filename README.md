# Infinite Shikaku

An endless, seamless Shikaku world. You solve a zone by splitting it into rectangles: each rectangle holds exactly one number, and that number is its area. Solving zones unlocks more of the world.

## Modes

Every mode belongs to one of two families:

| Family | Mode | What it is | Layout |
|---|---|---|---|
| **Singles**: one Shikaku at a time | **Classic** | Levels follow a 10-level size pattern per difficulty (Easy, Medium, Hard, Expert), repeating and getting harder | `src/layouts/singles.ts` |
| | **Focused** | Every level is the grid size you pick (6 to 24), each a little harder | `src/layouts/singles.ts` |
| **World**: a map you explore | **Journey** | Zones grow in concentric rings from 6×6 to 24×24 | `src/layouts/journey.ts` |
| | **Mosaic** | Random 66×66 patchworks of every size | `src/layouts/mosaic.ts` |

Classic's level patterns:

| Difficulty | Levels 1 to 10 |
|---|---|
| Easy | 6, 6, 8, 6, 6, 8, 6, 6, 8, 10 |
| Medium | 8, 8, 10, 8, 12, 8, 8, 10, 10, 12 |
| Hard | 10, 10, 12, 12, 15, 16, 12, 15, 16, 18 |
| Expert | 15, 15, 16, 18, 20, 15, 16, 18, 20, 24 |

Singles levels are keyed and seeded by level number, so their position on the board is purely visual. Moving to the next level is a straight slide in which the finished Shikaku fades out and the next fades in.

Mosaic details:
- The tilings come from the bundled square-tiling-66 dataset: `public/tilings_66x66.packed.txt` and `src/vendor/tiling.js`.
- The start is the 6×6 zone nearest the centre of the first supertile; the HUD shows the straight-line distance to it (1 cell = 1 m).
- A zone opens when every zone along any one of its sides is solved. If that ever leaves nothing open, the frontier zone(s) closest to completing a side open, so a game can never get stuck.

## Play styles

The main menu offers three play styles. Each shows the four modes as animated cards, Singles on top and World below.

- **Infinity**: tap a card for its sheet with **Continue** or **New** (Classic asks for a difficulty, Focused for a size). One save per mode.
- **Time Attack**: clear as much area as possible in 2, 5 or 10 minutes, in a fresh game of the chosen mode. Not saved; personal bests are kept per mode, option and length.
- **Survival**: every solved zone adds time, read from the fixed matrix `SURVIVAL_BONUS_S` in `src/runs.ts` (grid size × run step; a step is three zones, and the last column applies from zone 73). 6×6 goes from 30 s to 6 s, 24×24 from 240 s to 120 s. A run starts with 3× the first grid's first bonus (`SURVIVAL_START_S`): 90 s on a 6×6 start, up to 12:00 on Focused 24×24. A run in progress is saved per mode and option. Surrender ends the run with the time survived counted.

Run logic lives in `src/runs.ts`.

## Saves

Saves stay on the device (localStorage on the web, native storage in the phone apps; see Platforms). Every key starts with `infinite-shikaku:` (`infinity:<mode-option>`, `survival:<mode-option>`, `records`, `prefs`, `controls-seen`). Each Classic difficulty and each Focused grid size has its own save, marked with a gold dot in the mode sheet; the bin button next to Continue deletes a save without starting a new one.

**Seed.** The bottom of the pause sheet shows the world's seed, and tapping it copies it. The format is `(version)(mode)(option)_(seed)`, e.g. `6CLHA_1K9ZQ3`: version, mode `CL`/`FC`/`JO`/`MO`, option `EA`/`ME`/`HA`/`EX` for Classic, the grid size for Focused (`06` to `24`) and `00` for World modes, then the seed in base 36. A `schema` marker guards the format: when it changes, all older keys are wiped once.

**Pause** (the ⏸ button or Esc) stops the timer and shows that mode's stats, including a per-grid-size table of solved count, best and average time, plus How to play and Back to menu.

## Timer and input rules

- A zone's clock starts with the first rectangle the player drags in it. Looking at a zone or tapping never starts it.
- The clock runs only for the zone the player last acted in, while that zone is on screen, the zoom is playable, the tab is visible and nothing is paused.
- Below 9 px per cell (where clue numbers are hidden) the board is not playable: the clock pauses and every drag pans.
- Input that doesn't touch a number does nothing. A drag over exactly one number with the right area places a rectangle; a drag over a number with the wrong area (or over several numbers) shows as a short red flash that fades in a second and replaces nothing. Tapping a number removes its rectangle (with Undo) or fills a 1; taps elsewhere do nothing. Taps right after a pan, pinch or glide, and long presses, are ignored.
- Resuming plays a 3, 2, 1, Go countdown with the board locked, but only when a clock is actually running: always in Time Attack and Survival, and in Infinity only once the player has started the current zone.
- First-time players see a short How to play (animated) and then the Controls dialog (draw, undo by tapping a number, move, zoom). Each links to the other and both are replayable. Confirmations use an in-game dialog, never the browser's.
- In World modes the start zone has a gold outline and house badge; the Home button (H) glides back to it and points towards it while it is off screen.

## Puzzle guarantees

- Every puzzle has exactly one solution. The generator checks this with the solver, and the tests re-check it with an independent brute-force tiler. Solved zones are therefore not stored; they are redrawn from the seed.
- Single-cell pieces are almost eliminated: they are a last resort in the partition, merged into neighbours where possible, and capped at `floor(size² / 150)` per zone.

## Scale

`tests/scale.test.ts` plays 5,000 zones in each mode: solve bookkeeping averages well under 0.1 ms, the save stays near 65 KB, and reloading takes about 40 ms. Solved zones are generated in a Web Worker and the puzzle cache is bounded, so large worlds reload without freezing.

## Platforms

One codebase in `src/` runs as the website, the Android app, and the iOS app later. The apps use [Capacitor](https://capacitorjs.com): the same Vite build runs inside the phone's system WebView, so the renderer, input and puzzle generator are shared line for line.

The few phone-only pieces sit behind a platform check and do nothing on the web:

- `src/kv.ts`: storage. The web uses localStorage. The apps use native storage (Capacitor Preferences), because iOS may clear a WebView's localStorage. Native keys are loaded into memory once at startup (`src/boot.ts`), so the game still reads synchronously.
- `src/native.ts`: the Android back button (close a dialog, otherwise pause, otherwise step back in the menu, otherwise leave the app) and a save when the app goes to the background.
- `capacitor.config.ts`: app id `com.infiniteshikaku.app` (permanent once published), edge-to-edge layout with dark system bars. The CSS already pads with `env(safe-area-inset-*)`.

### Android

- **Download a test build:** every push runs the `Android app` workflow. Open it in the repository's Actions tab, download the `infinite-shikaku-debug-apk` artifact, unzip it and install `app-debug.apk` on the phone (allow installs from that source when asked).
- **Build locally:** install Android Studio (with JDK 21), then `npm ci`, `npm run cap:sync` and `npm run android:open`, and press Run. Or in `android/`, run `./gradlew assembleDebug`.
- **After changing the game:** run `npm run cap:sync` to copy the new web build into the Android project.
- **Play Store (later):** a signed release bundle (`./gradlew bundleRelease`) needs an upload keystore kept as a repository secret.

### iOS (later)

`npx cap add ios` creates the Xcode project next to `android/`; no game code changes. Building and signing need a Mac with Xcode (or a macOS CI runner) and an Apple Developer account.
