import './style.css';
import {
  DIFFICULTIES,
  DIFFICULTY_NAMES,
  FIXED_SIZES,
  SINGLES_PATTERNS,
  createClassicLayout,
  createSinglesLayout,
  createFixedLayout,
  createMosaicLayout,
  edgeNeighbours,
  formatMetres,
  loadTiler,
  zoneByKey,
  zoneCenter,
  type Difficulty,
  type ModeId,
  type SinglesLayout,
  type WorldLayout,
  type Zone,
} from './layouts';
import { MIN_PLAY_ZOOM, Renderer, type Camera, type Preview } from './render';
import { clearSave, freshSave, loadSave, sanitize, summarize, writeSave, type SaveData } from './storage';
import { rectsOverlap, type Rect } from './types';
import {
  TA_MINUTES,
  clearSurvival,
  creditSolve,
  getRecord,
  loadPrefs,
  loadSurvival,
  newRun,
  recordKey,
  savePrefs,
  submitRecord,
  survivalBonusMs,
  survivalStartMs,
  SURVIVAL_START_MS,
  writeSurvival,
  type RunState,
  type RunStyle,
} from './runs';
import { World } from './world';
import { ZoneCache } from './zones';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const canvas = $<HTMLCanvasElement>('#board');
const renderer = new Renderer(canvas);

// The menu shows over an idle Classic backdrop that is never saved.
let inGame = false;
/** the Time Attack or Survival run in progress (null in Endless) */
let run: RunState | null = null;
let runPhase: 'live' | 'over' | null = null;
/** true while "3, 2, 1, Go" plays: the board is locked and every clock is frozen */
let countdownActive = false;
let layout: WorldLayout = createClassicLayout();
let save: SaveData = { ...freshSave('classic'), seed: 20261116 };
let world = new World(layout, save);
let dirty = true;
let zones = new ZoneCache(save.seed, layout, () => (dirty = true));

const MIN_ZOOM = 3;
const MAX_ZOOM = 140;
let cam: Camera = { x: 4, y: 4, zoom: 40 };
interface CamStep {
  to: Camera;
  dur: number;
  hold?: number;
}
let camAnim: { from: Camera; to: Camera; t0: number; dur: number; hold: number } | null = null;
let camQueue: CamStep[] = [];
let preview: Preview | null = null;
let lastInteracted: Zone | null = null;

// ---------- persistence ----------
let saveTimer: number | undefined;
function saveNow() {
  window.clearTimeout(saveTimer);
  if (!inGame) return;
  save.cam = { ...cam };
  if (run) {
    // Time Attack is never saved; a Survival run keeps one slot per world until it ends
    if (run.style === 'survival' && runPhase !== 'over') writeSurvival(save, run);
    return;
  }
  writeSave(save);
}
function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 300);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveNow();
  lastTick = performance.now();
  // coming back to a live run: give the player a moment before the clock moves again
  if (!document.hidden && inGame && runPhase !== 'over' && !anyModalOpen()) startCountdown('Welcome back');
});
window.addEventListener('pagehide', saveNow);

// ---------- camera helpers ----------
/** Zoom that fits a span of `cells` on screen, leaving room for the HUD. */
function fitZoom(cells = 8) {
  const usableH = renderer.h - 150;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(renderer.w - 24, usableH) / (cells + 0.6)));
}
function camFor(z: Zone): Camera {
  const [x, y] = zoneCenter(z);
  const zoom = fitZoom(z.size);
  return { x, y: y + 18 / zoom, zoom };
}
function playCam(steps: CamStep[]) {
  camQueue = steps.slice();
  nextCamStep();
}
function nextCamStep() {
  const st = camQueue.shift();
  camAnim = st ? { from: { ...cam }, to: st.to, t0: performance.now(), dur: st.dur, hold: st.hold ?? 0 } : null;
}
/** Pan to a zone, keeping the player's zoom. */
function flyTo(z: Zone) {
  const [x, y] = zoneCenter(z);
  playCam([{ to: { x, y: y + 18 / cam.zoom, zoom: cam.zoom }, dur: 650 }]);
}
/** Zoom by a factor around the screen centre. */
function zoomBy(f: number) {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (camAnim?.to.zoom ?? cam.zoom) * f));
  playCam([{ to: { x: cam.x, y: cam.y, zoom }, dur: 220 }]);
}
function fitFocus() {
  const z = focusZone() ?? lastInteracted ?? centerZone();
  playCam([{ to: camFor(z), dur: 450 }]);
}
function stopCam() {
  camAnim = null;
  camQueue = [];
}
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function centerZone(): Zone {
  return layout.zoneAtCell(Math.floor(cam.x), Math.floor(cam.y));
}

/** The zone the player is working on: the open zone under the screen centre, else the last touched one if visible. */
function focusZone(): Zone | null {
  const cz = centerZone();
  if (world.status(cz) === 'open') return cz;
  if (lastInteracted && world.status(lastInteracted) === 'open') {
    const [x, y] = zoneCenter(lastInteracted);
    const [sx, sy] = renderer.toScreen(cam, x, y);
    if (sx > 0 && sx < renderer.w && sy > 0 && sy < renderer.h) return lastInteracted;
  }
  return null;
}

/** The zone whose timer runs: the last zone the player acted in, once they have drawn in it. */
function activeZone(): Zone | null {
  if (!save.active) return null;
  const z = zoneByKey(layout, save.active);
  return z && world.status(z) === 'open' ? z : null;
}
function onScreen(z: Zone) {
  const [x0, y0] = renderer.toScreen(cam, z.x0, z.y0);
  const w = z.size * cam.zoom;
  return x0 + w > 0 && y0 + w > 0 && x0 < renderer.w && y0 < renderer.h;
}
const playableZoom = () => cam.zoom >= MIN_PLAY_ZOOM;
/** True while the active zone's clock is counting. */
function timerRunning(): Zone | null {
  if (run || countdownActive) return null; // runs use one shared clock; nothing runs during the countdown
  if (!inGame || document.hidden || anyModalOpen() || !playableZoom()) return null;
  const z = activeZone();
  return z && z.key in save.timers && onScreen(z) ? z : null;
}

// ---------- input ----------
interface Ptr {
  x: number;
  y: number;
}
const ptrs = new Map<number, Ptr>();
type Mode =
  | { kind: 'none' }
  | { kind: 'pan'; moved: number }
  | { kind: 'draw'; zone: Zone; r0: number; c0: number; sx: number; sy: number; moved: boolean; t0: number }
  | { kind: 'pinch'; d0: number; z0: number; wx: number; wy: number };
let mode: Mode = { kind: 'none' };
/** when the last pan, pinch, wheel or camera glide ended: taps right after it are ignored */
let lastGestureAt = -1e9;
const TAP_GUARD_MS = 300;
const LONG_PRESS_MS = 500;

function cellAt(sx: number, sy: number) {
  const [wx, wy] = renderer.toWorld(cam, sx, sy);
  const gx = Math.floor(wx);
  const gy = Math.floor(wy);
  const zone = layout.zoneAtCell(gx, gy);
  return { zone, r: gy - zone.y0, c: gx - zone.x0 };
}

function localPos(e: PointerEvent): Ptr {
  const b = canvas.getBoundingClientRect();
  return { x: e.clientX - b.left, y: e.clientY - b.top };
}

function startPinch() {
  const [a, b] = [...ptrs.values()];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const [wx, wy] = renderer.toWorld(cam, mx, my);
  mode = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: cam.zoom, wx, wy };
  preview = null;
  dirty = true;
}

canvas.addEventListener('pointerdown', (e) => {
  if (!inGame || countdownActive || runPhase === 'over') return;
  canvas.setPointerCapture(e.pointerId);
  const p = localPos(e);
  ptrs.set(e.pointerId, p);
  stopCam();
  if (ptrs.size === 2) return startPinch();
  if (ptrs.size > 2) return;
  if (e.pointerType === 'mouse' && e.button !== 0) {
    mode = { kind: 'pan', moved: 0 };
    return;
  }
  const h = cellAt(p.x, p.y);
  // too far out to read the numbers: every drag pans
  if (playableZoom() && world.status(h.zone) === 'open' && zones.get(h.zone)) {
    mode = { kind: 'draw', zone: h.zone, r0: h.r, c0: h.c, sx: p.x, sy: p.y, moved: false, t0: performance.now() };
    lastInteracted = h.zone;
    preview = { zone: h.zone, rect: { r: h.r, c: h.c, w: 1, h: 1 } };
  } else {
    mode = { kind: 'pan', moved: 0 };
  }
  dirty = true;
});

canvas.addEventListener('pointermove', (e) => {
  const prev = ptrs.get(e.pointerId);
  if (!prev) return;
  const p = localPos(e);
  ptrs.set(e.pointerId, p);
  if (mode.kind === 'pan') {
    cam.x -= (p.x - prev.x) / cam.zoom;
    cam.y -= (p.y - prev.y) / cam.zoom;
    mode.moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
    dirty = true;
  } else if (mode.kind === 'pinch' && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (mode.z0 * d) / mode.d0));
    // keep the pinched world point under the fingers' midpoint
    cam.x = mode.wx - (mx - renderer.w / 2) / cam.zoom;
    cam.y = mode.wy - (my - renderer.h / 2) / cam.zoom;
    dirty = true;
  } else if (mode.kind === 'draw') {
    const [wx, wy] = renderer.toWorld(cam, p.x, p.y);
    const z = mode.zone;
    const c = Math.max(0, Math.min(z.size - 1, Math.floor(wx) - z.x0));
    const r = Math.max(0, Math.min(z.size - 1, Math.floor(wy) - z.y0));
    if (Math.hypot(p.x - mode.sx, p.y - mode.sy) > 6 || r !== mode.r0 || c !== mode.c0) mode.moved = true;
    const rect: Rect = {
      r: Math.min(r, mode.r0),
      c: Math.min(c, mode.c0),
      h: Math.abs(r - mode.r0) + 1,
      w: Math.abs(c - mode.c0) + 1,
    };
    preview = { zone: z, rect };
    dirty = true;
  }
});

function endPointer(e: PointerEvent, cancelled: boolean) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  const now = performance.now();
  if (mode.kind === 'pinch') {
    if (ptrs.size === 1) mode = { kind: 'pan', moved: 99 };
    else if (ptrs.size === 0) mode = { kind: 'none' };
    lastGestureAt = now;
    scheduleSave();
    return;
  }
  if (mode.kind === 'draw' && !cancelled && preview) {
    const z = mode.zone;
    const k = z.key;
    const p = zones.get(z)!;
    const rect = preview.rect;
    let acted = false;
    // any real action replaces the Undo offer for the previous removal
    const clearUndo = () => {
      if (toastAction) hideToast();
    };
    if (!mode.moved || rect.w * rect.h === 1) {
      // A tap (or a drag inside one cell) only does something on a number:
      // remove the rectangle covering it, or fill a 1.
      const deliberate = mode.moved || (now - lastGestureAt > TAP_GUARD_MS && now - mode.t0 < LONG_PRESS_MS);
      const clue = p.clues.find((q) => q.r === rect.r && q.c === rect.c);
      if (deliberate && clue) {
        {
          const gone = world.removeAt(k, clue.r, clue.c);
          if (gone) {
            clearUndo();
            acted = true;
            toast('Rectangle removed', {
              action: {
                label: 'Undo',
                run: () => {
                  if (world.status(z) !== 'open') return;
                  world.place(k, gone);
                  afterMove(z);
                },
              },
            });
          } else if (clue.v === 1) {
            clearUndo();
            world.place(k, { r: clue.r, c: clue.c, w: 1, h: 1 });
            acted = true;
          }
        }
      }
    } else {
      const kind = World.classify(p, rect);
      if (kind === 'ok') {
        clearUndo();
        world.place(k, rect);
        const f = world.failed;
        if (f && f.zone === z && rectsOverlap(f.rect, rect)) world.failed = null;
        acted = true;
      } else if (kind === 'fail') {
        clearUndo();
        // flash the wrong attempt red for a moment, without touching any placed rectangle
        world.failed = { zone: z, rect: { ...rect }, at: performance.now() };
        acted = true;
      }
      // a drag that touches no number does nothing at all
      if (acted && !(k in save.timers)) save.timers[k] = 0; // the clock starts with the first real attempt
    }
    if (acted) afterMove(z);
  }
  if (mode.kind === 'pan') {
    if (mode.moved > 8) lastGestureAt = now;
    scheduleSave();
  }
  preview = null;
  mode = { kind: 'none' };
  dirty = true;
}

/** Bookkeeping after any change to a zone's rectangles. */
function afterMove(z: Zone) {
  save.active = z.key;
  lastInteracted = z;
  const p = zones.get(z);
  if (p && world.isComplete(z, p)) onSolved(z);
  dirty = true;
  scheduleSave();
}
canvas.addEventListener('pointerup', (e) => endPointer(e, false));
canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (!inGame) return;
    stopCam();
    const b = canvas.getBoundingClientRect();
    const sx = e.clientX - b.left;
    const sy = e.clientY - b.top;
    // mouse wheels and trackpad pinches zoom; plain trackpad scrolling pans
    const isWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40);
    if (e.ctrlKey || isWheel) {
      const [wx, wy] = renderer.toWorld(cam, sx, sy);
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * f));
      cam.x = wx - (sx - renderer.w / 2) / cam.zoom;
      cam.y = wy - (sy - renderer.h / 2) / cam.zoom;
    } else {
      // trackpad two-finger scroll pans
      cam.x += e.deltaX / cam.zoom;
      cam.y += e.deltaY / cam.zoom;
    }
    dirty = true;
    lastGestureAt = performance.now();
    scheduleSave();
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  if (!inGame || runPhase === 'over' || countdownActive) return;
  if (e.key === 'Escape' || e.key === 'p') {
    if (anyModalOpen()) closeModals();
    else openPause();
    return;
  }
  if (anyModalOpen()) return;
  if ((e.key === 'Enter' || e.key === 'c') && !continueBtn.hidden) doContinue();
  if (e.key === '+' || e.key === '=') zoomBy(1.35);
  if (e.key === '-') zoomBy(1 / 1.35);
  if (e.key === 'f') fitFocus();
  if (e.key === 'e' && !easierBtn.hidden) doEasier();
  if (e.key === 'h') goHome();
});

// ---------- solving ----------
function onSolved(z: Zone) {
  const k = z.key;
  const p = zones.get(z)!;
  const ms = save.timers[k] ?? 0;
  const newlyOpen = world.markSolved(z, p);
  if (run) return onRunSolved(z, newlyOpen);
  const st = save.stats;
  st.zonesSolved++;
  st.totalSolveMs += ms;
  const bs = (st.bySize[z.size] ??= { solved: 0, totalMs: 0, bestMs: null });
  const isBest = bs.solved > 0 && (bs.bestMs === null || ms < bs.bestMs);
  bs.solved++;
  bs.totalMs += ms;
  bs.bestMs = bs.bestMs === null ? ms : Math.min(bs.bestMs, ms);
  for (const o of newlyOpen) zones.request(o, true);
  nextSingle(newlyOpen);
  const bigger = layout.expansionBanner ? newlyOpen.find((o) => !save.seenSizes.includes(o.size)) : undefined;
  if (bigger) {
    save.seenSizes.push(bigger.size);
    revealExpansion(bigger);
  } else {
    toast(`Solved in ${fmt(ms)}`, isBest ? { pill: `Best ${z.size}×${z.size} yet` } : undefined);
  }
  saveNow();
  if (navigator.vibrate) {
    try {
      navigator.vibrate(bigger ? [30, 60, 30] : 30);
    } catch {
      /* ignore */
    }
  }
}

/** First time a bigger zone size unlocks: banner, then pan (never zoom) to it. */
function revealExpansion(target: Zone) {
  lastInteracted = target;
  zones.request(target, true);
  const [x, y] = zoneCenter(target);
  playCam([{ to: { x, y: y + 18 / cam.zoom, zoom: cam.zoom }, dur: 1100, hold: 0 }]);
  showBanner('The world expands', `Bigger ${target.size}×${target.size} Shikaku from here on`);
}

const bannerEl = $('#banner');
let bannerTimer: number | undefined;
function showBanner(title: string, sub: string) {
  bannerEl.querySelector('.banner-title')!.textContent = title;
  bannerEl.querySelector('.banner-sub')!.textContent = sub;
  bannerEl.classList.remove('show');
  void bannerEl.offsetWidth; // restart the animation
  bannerEl.classList.add('show');
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => bannerEl.classList.remove('show'), 3200);
}

/** Jump to the nearest open zone with a smaller grid than the one you're on. */
function smallerTarget(): Zone | null {
  const from = focusZone() ?? lastInteracted ?? centerZone();
  const [cx, cy] = zoneCenter(from);
  const smaller = world.nearestOpen(cx, cy, (o) => o.size < from.size);
  if (smaller) return smaller;
  const min = world.minOpenSize();
  return world.nearestOpen(cx, cy, (o) => o.size === min && o !== from);
}
function doEasier() {
  const t = smallerTarget();
  if (!t) return toast('No easier Shikaku nearby yet');
  lastInteracted = t;
  zones.request(t, true);
  flyTo(t);
  toast(`Scale back to ${t.size}×${t.size}`);
}

function doContinue() {
  const from = focusZone() ?? lastInteracted ?? centerZone();
  const [cx, cy] = zoneCenter(from);
  const target = world.nearestOpen(cx, cy);
  if (!target) return;
  zones.request(target, true);
  lastInteracted = target;
  flyTo(target);
}

function goHome() {
  flyTo(layout.origin);
}

// ---------- HUD ----------
const zoneLabel = $('#zone-label');
const timerEl = $('#timer');
const solvedCount = $('#solved-count');
const continueBtn = $<HTMLButtonElement>('#continue');
const easierBtn = $<HTMLButtonElement>('#btn-easier');
const toastEl = $('#toast');

function fmt(ms: number) {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

let toastTimer: number | undefined;
let toastAction: (() => void) | null = null;
function toast(msg: string, extra?: { action?: { label: string; run: () => void }; pill?: string }) {
  toastEl.textContent = msg;
  toastAction = null;
  if (extra?.pill) toastEl.insertAdjacentHTML('beforeend', pills([[extra.pill, 'gold']]));
  const action = extra?.action;
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    toastEl.append(btn);
    toastAction = action.run;
  }
  toastEl.classList.toggle('has-action', !!action);
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, action ? 4000 : 2600);
}
function hideToast() {
  toastEl.classList.remove('show', 'has-action');
  toastAction = null;
}
toastEl.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('.toast-action') || !toastAction) return;
  const run = toastAction;
  hideToast();
  run();
});

/** Rounded labels used instead of dot separators. Items are text or [text, variant]. */
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function pills(items: (string | [string, string])[]) {
  return items
    .map((i) => (typeof i === 'string' ? `<span class="pill">${esc(i)}</span>` : `<span class="pill ${i[1]}">${esc(i[0])}</span>`))
    .join('');
}
function setHtml(el: HTMLElement, html: string) {
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
}
const area = (n: number) => `${n.toLocaleString('en-US')} m²`;
const zonesText = (n: number) => `${n} ${n === 1 ? 'zone' : 'zones'}`;
/** Countdown clocks round up, so 0:00 only shows when time is truly out. */
const clock = (ms: number) => fmt(Math.ceil(Math.max(0, ms) / 1000) * 1000);

const homeBtn = $<HTMLButtonElement>('#btn-home');
const runPillsEl = $('#run-pills');
function updateHud() {
  if (!inGame) return;
  const f = focusZone();
  const running = timerRunning();
  if (f) {
    setHtml(
      zoneLabel,
      playableZoom() ? pills([layout.label(f), `${f.size}×${f.size}`]) : pills([['Zoom in to play', 'gold']]),
    );
    timerEl.textContent = fmt(save.timers[f.key] ?? 0);
    timerEl.classList.toggle('idle', running !== f);
  } else {
    const cz = centerZone();
    const st = world.status(cz);
    const best = st === 'locked' ? world.bestSide(cz) : null;
    if (st === 'solved') setHtml(zoneLabel, pills([layout.label(cz), ['Solved', 'gold']]));
    else if (best)
      setHtml(
        zoneLabel,
        pills([
          ['To unlock', 'gold'],
          `Side ${best.solved}/${best.total}`,
          ...(best.needsDiag ? [`Corner ${best.diagSolved ? 1 : 0}/1`] : []),
        ]),
      );
    else setHtml(zoneLabel, pills([layout.label(cz), ['Unexplored', 'dim']]));
    timerEl.textContent = '--:--';
    timerEl.classList.add('idle');
  }
  solvedCount.textContent = String(save.stats.zonesSolved);
  if (run) {
    // one shared countdown for the whole run
    timerEl.textContent = clock(run.clockMs);
    timerEl.classList.remove('idle');
    timerEl.classList.toggle('low', runPhase === 'live' && !countdownActive && run.clockMs < 10_000);
    setHtml(runPillsEl, pills([[area(run.area), 'gold'], zonesText(run.zones)]));
    solvedCount.textContent = String(run.zones);
  } else timerEl.classList.remove('low');
  runPillsEl.hidden = !run;
  const single = isSingles(layout);
  continueBtn.hidden = single || !!f || mode.kind !== 'none' || world.openCount === 0 || runPhase === 'over';
  const cur = f ?? centerZone();
  easierBtn.hidden = single || !(cur.size > world.minOpenSize()) || runPhase === 'over';
  homeBtn.hidden = single;
  // the Home button points towards the start while it is off screen
  const home = layout.origin;
  const away = !onScreen(home);
  homeBtn.classList.toggle('away', away);
  if (away) {
    const [hx, hy] = zoneCenter(home);
    const deg = (Math.atan2(hy - cam.y, hx - cam.x) * 180) / Math.PI;
    homeBtn.style.setProperty('--dir', `${deg}deg`);
  }
}

// ---------- modals: help, pause ----------
const pauseModal = $('#pause-modal');
const helpModal = $('#help-modal');
const sizeModal = $('#size-modal');
const diffModal = $('#diff-modal');
const runPauseModal = $('#run-pause-modal');
const resultsModal = $('#results-modal');
const coachModal = $('#coach-modal');

// ---------- confirm dialog (replaces the browser's confirm box) ----------
const confirmModal = $('#confirm-modal');
let confirmResolve: ((ok: boolean) => void) | null = null;
function askConfirm(o: { title: string; body: string; ok: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  confirmResolve?.(false);
  $('#confirm-title').textContent = o.title;
  $('#confirm-body').textContent = o.body;
  const ok = $<HTMLButtonElement>('#confirm-ok');
  const cancel = $<HTMLButtonElement>('#confirm-cancel');
  ok.textContent = o.ok;
  ok.classList.toggle('danger-btn', !!o.danger);
  cancel.textContent = o.cancel ?? 'Cancel';
  confirmModal.hidden = false;
  cancel.focus(); // a stray Enter should never destroy anything
  return new Promise((resolve) => (confirmResolve = resolve));
}
function settleConfirm(ok: boolean) {
  if (confirmModal.hidden) return;
  confirmModal.hidden = true;
  const r = confirmResolve;
  confirmResolve = null;
  r?.(ok);
}
$('#confirm-ok').addEventListener('click', () => settleConfirm(true));
$('#confirm-cancel').addEventListener('click', () => settleConfirm(false));
confirmModal.addEventListener('click', (e) => {
  if (e.target === confirmModal) settleConfirm(false);
});
// handled before the game's own keys, so Esc closes only this dialog
window.addEventListener(
  'keydown',
  (e) => {
    if (confirmModal.hidden) return;
    if (e.key === 'Escape') settleConfirm(false);
    else if (e.key === 'Enter' && document.activeElement !== $('#confirm-cancel')) settleConfirm(true);
    else if (e.key === 'Enter') settleConfirm(false);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  },
  true,
);

// ---------- controls card (shown once, replayable from How to play) ----------
const COACH_KEY = 'infinite-shikaku:coach:v1';
function coachSeen() {
  try {
    return localStorage.getItem(COACH_KEY) === '1';
  } catch {
    return true;
  }
}
const touchFirst = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;
function coachArt(kind: 'draw' | 'tap' | 'pan' | 'zoom', touch: boolean): string {
  const cells = (cols: number, rows: number, x0: number, y0: number, size: number, gap: number, num?: [number, number, string]) => {
    let out = '';
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        out += `<rect x="${x0 + c * (size + gap)}" y="${y0 + r * (size + gap)}" width="${size}" height="${size}" rx="4" class="cc-cell"/>`;
    if (num) out += `<text x="${x0 + num[0] * (size + gap) + size / 2}" y="${y0 + num[1] * (size + gap) + size / 2 + 5}" class="cc-num">${num[2]}</text>`;
    return out;
  };
  const finger = (cls: string, x: number, y: number) => `<g class="${cls}"><circle cx="${x}" cy="${y}" r="9" class="cc-finger"/></g>`;
  const cursor = (cls: string, x: number, y: number) =>
    `<g class="${cls}"><path d="M${x} ${y}l0 17 4.5-4.2 3.3 7.2 3-1.4-3.2-7 6.2-.4z" class="cc-cursor"/></g>`;
  if (kind === 'draw') {
    const pointer = touch ? finger('cc-draw-move', 34, 21) : cursor('cc-draw-move', 32, 18);
    return `<svg viewBox="0 0 120 90" aria-hidden="true">${cells(3, 3, 24, 11, 20, 4, [0, 0, '4'])}<rect x="24" y="11" width="44" height="44" rx="5" class="cc-rect cc-draw-grow"/>${pointer}</svg>`;
  }
  if (kind === 'tap') {
    // a placed rectangle over the 4; tapping the number removes it
    const x = 34;
    const y = 21;
    const pointer = touch ? finger('cc-tap-move', x, y) : cursor('cc-tap-move', x - 2, y - 3);
    return `<svg viewBox="0 0 120 90" aria-hidden="true">${cells(3, 3, 24, 11, 20, 4)}<rect x="24" y="11" width="44" height="44" rx="5" class="cc-rect cc-tap-rect"/><text x="34" y="26" class="cc-num">4</text><circle cx="${x}" cy="${y}" r="12" class="cc-ripple"/>${pointer}</svg>`;
  }
  if (kind === 'pan') {
    const pointers = touch ? finger('cc-pan-move', 50, 46) + finger('cc-pan-move', 72, 46) : cursor('cc-pan-move', 56, 40);
    return `<svg viewBox="0 0 120 90" aria-hidden="true"><g class="cc-pan-move">${cells(5, 4, 4, 2, 20, 4, [2, 1, '6'])}</g>${pointers}</svg>`;
  }
  const pointers = touch
    ? finger('cc-zoom-a', 50, 50) + finger('cc-zoom-b', 70, 40)
    : `<g><rect x="50" y="30" width="20" height="32" rx="10" class="cc-mouse"/><line x1="60" y1="35" x2="60" y2="43" class="cc-wheel"/></g>`;
  return `<svg viewBox="0 0 120 90" aria-hidden="true"><g class="cc-zoom-grow">${cells(3, 3, 24, 9, 20, 4, [0, 0, '9'])}</g>${pointers}</svg>`;
}
function renderCoach() {
  const touch = touchFirst();
  const items: [string, 'draw' | 'tap' | 'pan' | 'zoom', string][] = [
    ['Draw', 'draw', 'Drag across a number to draw'],
    ['Undo', 'tap', `${touch ? 'Tap' : 'Click'} a number to remove its rectangle`],
    ['Move', 'pan', touch ? 'Two fingers to move around' : 'Drag empty ground to move around'],
    ['Zoom', 'zoom', touch ? 'Pinch to zoom' : 'Scroll to zoom'],
  ];
  $('#coach-items').innerHTML = items
    .map(([title, kind, caption]) => `<div class="coach-item">${coachArt(kind, touch)}<div class="coach-title">${title}</div><div class="coach-cap">${caption}</div></div>`)
    .join('');
}
function openCoach() {
  renderCoach();
  coachModal.hidden = false;
}
$('#btn-coach-ok').addEventListener('click', () => {
  try {
    localStorage.setItem(COACH_KEY, '1');
  } catch {
    /* ignore */
  }
  closeModals();
});
$('#btn-show-controls').addEventListener('click', () => {
  helpModal.hidden = true;
  openCoach();
});
function anyModalOpen() {
  return (
    !pauseModal.hidden ||
    !helpModal.hidden ||
    !sizeModal.hidden ||
    !diffModal.hidden ||
    !runPauseModal.hidden ||
    !resultsModal.hidden ||
    !coachModal.hidden ||
    !confirmModal.hidden
  );
}
function closeModals() {
  const wasOpen = !pauseModal.hidden || !helpModal.hidden || !runPauseModal.hidden || !coachModal.hidden;
  pauseModal.hidden = true;
  helpModal.hidden = true;
  sizeModal.hidden = true;
  diffModal.hidden = true;
  runPauseModal.hidden = true;
  coachModal.hidden = true;
  if (inGame && !save.seenHelp) {
    save.seenHelp = true;
    scheduleSave();
  }
  // back to the board: first-timers see the controls, then everyone is counted in
  if (wasOpen && inGame && runPhase !== 'over') readyUp();
}

/** Before play (re)starts: show the controls card once, then "3, 2, 1, Go". */
let nextCountdownSub = 'Get ready';
function readyUp(sub?: string) {
  if (sub) nextCountdownSub = sub;
  if (!coachSeen()) return openCoach();
  const msg = nextCountdownSub;
  nextCountdownSub = 'Get ready';
  startCountdown(msg);
}
const MODE_NAMES: Record<ModeId, string> = { classic: 'Classic', fixed: 'Fixed', mosaic: 'Mosaic', singles: 'Singles' };
const STYLE_NAMES: Record<RunStyle, string> = { timeattack: 'Time Attack', survival: 'Survival' };
function worldPills(world: ModeId, tileSize?: number, difficulty?: Difficulty): (string | [string, string])[] {
  if (world === 'fixed') return [['Fixed', 'gold'], `${tileSize}×${tileSize}`];
  if (world === 'singles') return [['Singles', 'gold'], DIFFICULTY_NAMES[difficulty ?? 'easy']];
  return [[MODE_NAMES[world], 'gold']];
}
function renderStats() {
  const st = save.stats;
  // total area of every solved zone, in square cells (1 cell = 1 m)
  let total = 0;
  for (const [n, b] of Object.entries(st.bySize)) total += Number(n) * Number(n) * b.solved;
  const rows: [string, string][] = [
    ['Zones solved', String(st.zonesSolved)],
    ['Area cleared', area(total)],
    ['Time solving', fmt(st.totalSolveMs)],
    save.mode === 'mosaic'
      ? ['Farthest from home', formatMetres(st.farthestM)]
      : save.mode === 'singles'
        ? ['Level reached', `Level ${st.zonesSolved + 1}`]
        : ['Deepest reached', st.deepest ? `Depth ${st.deepest}` : '–'],
    ['Total play time', fmt(st.totalPlayMs)],
  ];
  $('#stats-grid').innerHTML = statGrid(rows);
  const sizes = Object.keys(st.bySize)
    .map(Number)
    .sort((a, b) => a - b);
  $('#stats-sizes').innerHTML = sizes.length
    ? `<table><thead><tr><th>Grid</th><th>Solved</th><th>Best</th><th>Average</th></tr></thead><tbody>${sizes
        .map((n) => {
          const b = st.bySize[n];
          return `<tr><td>${n}×${n}</td><td>${b.solved}</td><td>${b.bestMs === null ? '–' : fmt(b.bestMs)}</td><td>${fmt(b.totalMs / b.solved)}</td></tr>`;
        })
        .join('')}</tbody></table>`
    : '<p class="muted">Solve a Shikaku to see your times for each grid size.</p>';
  $('#pause-mode').innerHTML = pills(worldPills(save.mode, save.tileSize, save.difficulty));
}
const statGrid = (rows: [string, string][]) =>
  rows.map(([k, v]) => `<div class="stat"><div class="stat-v">${esc(v)}</div><div class="stat-k">${esc(k)}</div></div>`).join('');

function openPause() {
  if (!inGame || runPhase === 'over' || countdownActive) return;
  if (run) return openRunPause();
  renderStats();
  pauseModal.hidden = false;
  saveNow();
}
$('#btn-pause').addEventListener('click', openPause);
$('#btn-help').addEventListener('click', () => (helpModal.hidden = false));
$('#btn-pause-help').addEventListener('click', () => {
  pauseModal.hidden = true;
  helpModal.hidden = false;
});
$('#btn-menu').addEventListener('click', endSession);
document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeModals));
document.querySelectorAll('.modal').forEach((m) =>
  m.addEventListener('click', (e) => {
    if (e.target === m && m !== resultsModal && m !== confirmModal) closeModals();
  }),
);
continueBtn.addEventListener('click', doContinue);
easierBtn.addEventListener('click', doEasier);
$('#btn-zoom-in').addEventListener('click', () => zoomBy(1.35));
$('#btn-zoom-out').addEventListener('click', () => zoomBy(1 / 1.35));
$('#btn-fit').addEventListener('click', fitFocus);
homeBtn.addEventListener('click', goHome);

// ---------- sessions & menu ----------
const HELP_MODE: Record<ModeId, string> = {
  singles: 'One Shikaku at a time. Solve it to level up. Every few levels the grids get bigger.',
  classic:
    'Your Shikaku grow as you travel, from 6×6 all the way to 24×24. To break into a bigger one, clear <b>one whole side</b> of it plus <b>one corner piece</b> next to that side.',
  fixed:
    'Every Shikaku is the size you chose, and they get trickier the farther you roam. Clear any neighbour to open a new one.',
  mosaic:
    'Your world mixes Shikaku of every size and is never the same twice. Clear <b>every Shikaku along one side</b> of a locked zone to open it. The top of the screen shows how far you are from home.',
};
const HELP_RUN: Record<RunStyle, string> = {
  timeattack: 'Clear as much Shikaku ground as you can before the clock hits zero. Every cell counts. ',
  survival: 'Solve Shikaku to bank time. Bigger grids pay more, and bonuses shrink as you go, so grab the big ones early. ',
};

async function makeLayout(d: SaveData): Promise<WorldLayout> {
  if (d.mode === 'fixed') return createFixedLayout(d.tileSize ?? 8);
  if (d.mode === 'singles') return createSinglesLayout(d.difficulty ?? 'easy');
  if (d.mode === 'mosaic') {
    const tiler = await loadTiler(`${import.meta.env.BASE_URL}tilings_66x66.packed.txt`);
    return createMosaicLayout(d.seed, tiler);
  }
  return createClassicLayout();
}

function setSession(L: WorldLayout, d: SaveData, persisted: boolean) {
  zones.dispose();
  stopCam();
  ptrs.clear();
  mode = { kind: 'none' };
  preview = null;
  layout = L;
  save = persisted ? sanitize(d, L) : d;
  world = new World(L, save);
  zones = new ZoneCache(save.seed, L, () => (dirty = true));
  lastInteracted = null;
  if (save.cam && isFinite(save.cam.x) && isFinite(save.cam.zoom)) {
    cam = { ...save.cam, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, save.cam.zoom)) };
  } else {
    cam = camFor(L.origin);
  }
  for (const z of world.openZones()) zones.request(z, true);
  lastInteracted = activeZone();
  if (isSingles(L)) {
    const cur = world.openZones()[0] ?? L.origin;
    L.setCurrent(L.levelOf(cur));
    cam = camFor(cur);
    lastInteracted = cur;
  }
  document.body.classList.toggle('in-singles', isSingles(L));
  dirty = true;
}

const isSingles = (L: WorldLayout): L is SinglesLayout => L.mode === 'singles';

/** Singles: after a solve, slide the next level in and fit it (each level can be a new size). */
function nextSingle(newlyOpen: Zone[]) {
  const L = layout;
  const next = newlyOpen[0];
  if (!isSingles(L) || !next) return;
  zones.request(next, true);
  const solved = L.levelZone(L.current());
  const OUT_MS = 500;
  const IN_MS = 600;
  window.setTimeout(() => {
    if (layout !== L || !inGame) return;
    // Keep the solved level on screen during the change: the camera first pulls back
    // so both puzzles are in view (the solved one sliding out, the next sliding in),
    // then settles on the next level.
    L.setCurrent(L.levelOf(next), true);
    lastInteracted = next;
    const left = solved.x0;
    const right = next.x0 + next.size;
    const span = Math.max(right - left, Math.max(solved.size, next.size));
    const target = camFor(next);
    const both: Camera = {
      x: (left + right) / 2,
      y: Math.max(solved.size, next.size) / 2 + 18 / fitZoom(span),
      zoom: Math.min(cam.zoom, target.zoom, fitZoom(span)),
    };
    playCam([
      { to: both, dur: OUT_MS },
      { to: target, dur: IN_MS },
    ]);
    dirty = true;
    window.setTimeout(() => {
      if (layout !== L) return;
      L.dropPrevious();
      dirty = true;
    }, OUT_MS + IN_MS + 50);
  }, 600);
}

async function startSession(d: SaveData) {
  menuStatus('Building your world…');
  let L: WorldLayout;
  try {
    L = await makeLayout(d);
  } catch {
    menuStatus("Couldn't build your world. Check your connection and try again.");
    return;
  }
  menuStatus('');
  setSession(L, d, true);
  run = null;
  runPhase = null;
  inGame = true;
  document.body.classList.add('in-game');
  document.body.classList.remove('in-run');
  menuEl.hidden = true;
  $('#help-mode').innerHTML = HELP_MODE[d.mode];
  saveNow();
  updateHud();
  // first visit: How to play, then the controls card, then the countdown
  if (!save.seenHelp) {
    nextCountdownSub = 'Go explore';
    helpModal.hidden = false;
  } else readyUp(d.solved.length ? 'Welcome back' : 'Go explore');
}

function endSession() {
  saveNow();
  inGame = false; // first, so closing the pause sheet doesn't start a countdown
  closeModals();
  resultsModal.hidden = true;
  stopCountdown();
  const style: MenuStyle = run ? run.style : 'endless';
  run = null;
  runPhase = null;
  inGame = false;
  document.body.classList.remove('in-game', 'in-run');
  continueBtn.hidden = true;
  easierBtn.hidden = true;
  hideToast();
  menuEl.hidden = false;
  showStyle(style);
}

async function newGame(m: ModeId, tileSize?: number, difficulty?: Difficulty) {
  if (
    summarize(m) &&
    !(await askConfirm({
      title: 'Start a fresh world?',
      body: `Your current ${MODE_NAMES[m]} world will be lost.`,
      ok: 'Start fresh',
      danger: true,
    }))
  )
    return;
  clearSave(m);
  startSession(freshSave(m, tileSize, difficulty));
}

// ---------- runs: Time Attack & Survival ----------
const countdownEl = $('#countdown');
let countdownTimer: number | undefined;
function stopCountdown() {
  window.clearTimeout(countdownTimer);
  countdownEl.hidden = true;
  countdownActive = false;
}
/** "3, 2, 1, Go" with the board visible but locked, then the run clock starts. */
function startCountdown(sub: string) {
  if (!inGame) return;
  stopCountdown();
  countdownActive = true;
  preview = null;
  mode = { kind: 'none' };
  ptrs.clear();
  dirty = true;
  countdownEl.hidden = false;
  countdownEl.querySelector('.countdown-sub')!.textContent = sub;
  const num = countdownEl.querySelector<HTMLElement>('.countdown-num')!;
  let n = 3;
  const step = () => {
    if (n < 0) {
      stopCountdown();
      lastTick = performance.now();
      return;
    }
    num.textContent = n > 0 ? String(n) : 'Go!';
    num.classList.remove('tick');
    void num.offsetWidth;
    num.classList.add('tick');
    countdownTimer = window.setTimeout(step, n > 0 ? 700 : 450);
    n--;
  };
  step();
}

async function startRun(r: RunState, resume?: SaveData) {
  const d = resume ?? { ...freshSave(r.world, r.tileSize, r.difficulty), seenHelp: true };
  menuStatus('Building your world…');
  let L: WorldLayout;
  try {
    L = await makeLayout(d);
  } catch {
    menuStatus("Couldn't build your world. Check your connection and try again.");
    return;
  }
  menuStatus('');
  resultsModal.hidden = true;
  closeModals();
  setSession(L, d, !!resume);
  run = r;
  inGame = true;
  document.body.classList.add('in-game', 'in-run');
  menuEl.hidden = true;
  $('#help-mode').innerHTML = HELP_RUN[r.style] + HELP_MODE[r.world];
  runPhase = 'live';
  saveNow();
  updateHud();
  readyUp(
    resume
      ? 'Welcome back'
      : r.style === 'timeattack'
        ? `Clear all you can in ${r.minutes} minutes`
        : `You have ${SURVIVAL_START_MS / 1000} seconds. Every Shikaku buys you more`,
  );
}

function floatText(z: Zone, text: string) {
  const [cx, cy] = zoneCenter(z);
  const b = canvas.getBoundingClientRect();
  let [x, y] = renderer.toScreen(cam, cx, cy);
  x = Math.min(Math.max(x, 60), renderer.w - 60);
  y = Math.min(Math.max(y, 120), renderer.h - 120);
  const el = document.createElement('div');
  el.className = 'float-bonus';
  el.textContent = text;
  el.style.left = `${x + b.left}px`;
  el.style.top = `${y + b.top}px`;
  document.body.append(el);
  window.setTimeout(() => el.remove(), 1400);
}

function onRunSolved(z: Zone, newlyOpen: Zone[]) {
  if (!run) return;
  const bonus = creditSolve(run, z.size);
  for (const o of newlyOpen) zones.request(o, true);
  nextSingle(newlyOpen);
  floatText(z, run.style === 'survival' ? `+${Math.round(bonus / 1000)}s` : `+${area(z.size * z.size)}`);
  const bigger = layout.expansionBanner ? newlyOpen.find((o) => !save.seenSizes.includes(o.size)) : undefined;
  if (bigger) {
    save.seenSizes.push(bigger.size);
    showBanner('The world expands', `Bigger ${bigger.size}×${bigger.size} Shikaku from here on`);
  }
  saveNow();
  updateHud();
  if (navigator.vibrate) {
    try {
      navigator.vibrate(30);
    } catch {
      /* ignore */
    }
  }
}

function runPills(r: RunState): (string | [string, string])[] {
  return [
    [STYLE_NAMES[r.style], 'gold'],
    ...worldPills(r.world, r.tileSize, r.difficulty).map((p) => (typeof p === 'string' ? p : p[0])),
    ...(r.minutes ? [`${r.minutes} min`] : []),
  ];
}

function openRunPause() {
  if (!run) return;
  saveNow();
  $('#run-pause-sub').innerHTML = pills(runPills(run));
  const rows: [string, string][] = [
    ['Time left', clock(run.clockMs)],
    ['Area cleared', area(run.area)],
    ['Zones solved', String(run.zones)],
    run.style === 'survival' ? ['Survived', fmt(run.elapsedMs)] : ['Time played', fmt(run.elapsedMs)],
    ...(run.style === 'survival'
      ? ([
          ['Next 6×6 bonus', `+${survivalBonusMs(6, run.zones + 1) / 1000}s`],
          ['Next 24×24 bonus', `+${survivalBonusMs(24, run.zones + 1) / 1000}s`],
        ] as [string, string][])
      : []),
  ];
  $('#run-pause-stats').innerHTML = statGrid(rows);
  $('#btn-run-quit').textContent = run.style === 'survival' ? 'Save and quit' : 'Quit';
  $('#btn-run-surrender').hidden = run.style !== 'survival';
  runPauseModal.hidden = false;
}

function endRun(surrendered = false) {
  if (!run) return;
  run.clockMs = 0;
  runPhase = 'over';
  stopCountdown();
  preview = null;
  mode = { kind: 'none' };
  const key = recordKey(run.style, run.world, run.tileSize, run.minutes, run.difficulty);
  const previous = getRecord(key);
  const isBest = submitRecord(run);
  if (run.style === 'survival') clearSurvival(run.world, run.tileSize, run.difficulty);
  closeModals();
  showResults(run, isBest, previous, surrendered);
  updateHud();
}

function showResults(r: RunState, isBest: boolean, previous: ReturnType<typeof getRecord>, surrendered = false) {
  $('#results-badge').hidden = !isBest;
  $('#results-kicker').innerHTML = pills([...runPills(r), ...(surrendered ? [['Surrendered', 'dim'] as [string, string]] : [])]);
  $('#results-kicker').className = 'results-kicker pill-row results-pills';
  const sizes = Object.keys(r.bySize).map(Number).sort((a, b) => a - b);
  const items: (string | [string, string])[] = [];
  if (r.style === 'timeattack') {
    $('#results-score').textContent = area(r.area);
    $('#results-caption').textContent = 'of Shikaku cleared';
    items.push(zonesText(r.zones));
  } else {
    $('#results-score').textContent = fmt(r.elapsedMs);
    $('#results-caption').textContent = 'of Shikaku survived';
    items.push(area(r.area), zonesText(r.zones));
  }
  if (sizes.length) items.push(`Biggest ${sizes[sizes.length - 1]}×${sizes[sizes.length - 1]}`);
  if (!isBest && previous)
    items.push([r.style === 'timeattack' ? `Best ${area(previous.area)}` : `Best ${fmt(previous.survivedMs ?? 0)}`, 'gold']);
  $('#results-pills').innerHTML = pills(items);
  $('#results-sizes').innerHTML = sizes.length
    ? `<table><thead><tr><th>Grid</th><th>Solved</th><th>Area</th></tr></thead><tbody>${sizes
        .map((n) => `<tr><td>${n}×${n}</td><td>${r.bySize[n]}</td><td>${area(n * n * r.bySize[n])}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted">No Shikaku cleared this time. Go again?</p>';
  resultsModal.hidden = false;
}

$('#btn-run-resume').addEventListener('click', closeModals);
$('#btn-run-restart').addEventListener('click', async () => {
  if (!run) return;
  if (!(await askConfirm({ title: 'Restart this run?', body: "You'll start again from the beginning.", ok: 'Restart', danger: true })))
    return;
  if (!run) return;
  const r = run;
  if (r.style === 'survival') clearSurvival(r.world, r.tileSize, r.difficulty);
  runPauseModal.hidden = true;
  startRun(newRun(r.style, r.world, r.tileSize, r.minutes, r.difficulty));
});
$('#btn-run-quit').addEventListener('click', async () => {
  if (!run) return;
  if (
    run.style === 'timeattack' &&
    !(await askConfirm({ title: 'Leave this run?', body: "It won't count towards your best.", ok: 'Leave', danger: true }))
  )
    return;
  endSession();
});
$('#btn-run-surrender').addEventListener('click', async () => {
  if (!run || run.style !== 'survival') return;
  if (
    !(await askConfirm({
      title: 'Surrender?',
      body: 'The run ends now. The time you survived still counts.',
      ok: 'Surrender',
      danger: true,
    }))
  )
    return;
  if (!run) return;
  runPauseModal.hidden = true;
  endRun(true);
});
$('#btn-again').addEventListener('click', () => {
  if (!run) return;
  const r = run;
  startRun(newRun(r.style, r.world, r.tileSize, r.minutes, r.difficulty));
});
$('#btn-results-menu').addEventListener('click', endSession);

// ---------- menu ----------
type MenuStyle = 'endless' | RunStyle;
const STYLE_COPY: Record<MenuStyle, { title: string; pitch: string }> = {
  endless: {
    title: 'Infinity',
    pitch: "Explore your own Shikaku world at your own pace. It's saved, so you can always pick up where you left off.",
  },
  timeattack: { title: 'Time Attack', pitch: 'Beat the clock. Clear as much Shikaku ground as you can before time runs out.' },
  survival: { title: 'Survival', pitch: 'Every Shikaku you solve buys you more time. How long can you last?' },
};
const WORLD_DESC: Record<ModeId, string> = {
  singles: 'One Shikaku at a time. Levels get bigger as you go.',
  classic: 'Starts small and grows bigger the farther you go.',
  fixed: 'One grid size, all the way. You pick it.',
  mosaic: 'Every size, all mixed up, never the same twice.',
};

const menuEl = $('#menu');
let menuStyle: MenuStyle | null = null;
function menuStatus(msg: string) {
  $('#menu-status').textContent = msg;
}
function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function showHome() {
  menuStyle = null;
  menuStatus('');
  $('#menu-home').hidden = false;
  $('#menu-style').hidden = true;
}

function showStyle(style: MenuStyle) {
  menuStyle = style;
  menuStatus('');
  $('#menu-home').hidden = true;
  $('#menu-style').hidden = false;
  $('#style-title').textContent = STYLE_COPY[style].title;
  $('#style-pitch').textContent = STYLE_COPY[style].pitch;
  $('#endless-panel').hidden = style !== 'endless';
  $('#run-panel').hidden = style === 'endless';
  if (style === 'endless') renderEndless();
  else renderRunPanel();
  menuEl.scrollTop = 0;
}

function renderEndless() {
  for (const m of ['classic', 'fixed', 'mosaic', 'singles'] as ModeId[]) {
    const card = $(`.mode-card[data-mode="${m}"]`);
    const sum = summarize(m);
    const cont = card.querySelector<HTMLButtonElement>('[data-action="continue"]')!;
    const line = card.querySelector<HTMLElement>('.mode-save')!;
    cont.hidden = !sum;
    if (sum) {
      line.innerHTML = pills([
        ...(m === 'fixed' ? [[`${sum.tileSize}×${sum.tileSize}`, 'gold'] as [string, string]] : []),
        ...(m === 'singles' ? [[DIFFICULTY_NAMES[sum.difficulty ?? 'easy'], 'gold'] as [string, string]] : []),
        m === 'singles' ? `Level ${sum.zonesSolved + 1}` : `${sum.zonesSolved} solved`,
        ...(m === 'singles' ? [] : [m === 'mosaic' ? formatMetres(sum.farthestM) : `Depth ${sum.deepest || 1}`]),
        `${fmt(sum.totalPlayMs)} played`,
        [ago(sum.lastPlayed), 'dim'],
      ]);
    } else line.innerHTML = pills([['No saved world yet', 'dim']]);
  }
}

const prefs = loadPrefs();
function runSettings() {
  const style = menuStyle as RunStyle;
  const p = style === 'timeattack' ? prefs.ta : prefs.sv;
  const world = p.world;
  return {
    style,
    world,
    size: p.size,
    tile: world === 'fixed' ? p.size : undefined,
    difficulty: world === 'singles' ? p.difficulty : undefined,
    minutes: style === 'timeattack' ? prefs.ta.minutes : undefined,
  };
}
function setChecked(container: HTMLElement, attr: string, value: string) {
  container.querySelectorAll<HTMLElement>('.seg-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset[attr] === value)));
}
function renderRunPanel() {
  const { style, world, size, tile, difficulty, minutes } = runSettings();
  setChecked($('#run-world'), 'world', world);
  $('#run-world-desc').textContent = WORLD_DESC[world];
  $('#run-size-field').hidden = world !== 'fixed';
  setChecked($('#run-sizes'), 'size', String(size));
  $('#run-diff-field').hidden = world !== 'singles';
  setChecked($('#run-diffs'), 'diff', difficulty ?? 'easy');
  $('#run-minutes-field').hidden = style !== 'timeattack';
  setChecked($('#run-minutes'), 'minutes', String(minutes));
  $('#run-start-row').hidden = style !== 'survival';
  if (style === 'survival') $('#run-start-time').innerHTML = pills([[clock(survivalStartMs(world, tile, difficulty)), 'gold']]);
  const rec = getRecord(recordKey(style, world, tile, minutes, difficulty));
  $('#run-best').innerHTML = rec
    ? pills(
        style === 'timeattack'
          ? [[area(rec.area), 'gold'], zonesText(rec.zones)]
          : [[fmt(rec.survivedMs ?? 0), 'gold'], area(rec.area), zonesText(rec.zones)],
      )
    : pills([['No record yet', 'dim']]);
  const slot = style === 'survival' ? loadSurvival(world, tile, difficulty) : null;
  $('#sv-saved').hidden = !slot;
  $('#btn-run-start').hidden = !!slot;
  if (slot)
    $('#sv-saved-pills').innerHTML = pills([
      [`${clock(slot.run.clockMs)} left`, 'gold'],
      area(slot.run.area),
      zonesText(slot.run.zones),
      `${fmt(slot.run.elapsedMs)} survived`,
    ]);
}
$('#run-sizes').innerHTML = FIXED_SIZES.map((n) => `<button class="seg-btn" data-size="${n}" role="radio">${n}×${n}</button>`).join('');
$('#run-diffs').innerHTML = DIFFICULTIES.map((d) => `<button class="seg-btn" data-diff="${d}" role="radio">${DIFFICULTY_NAMES[d]}</button>`).join('');
$('#run-minutes').innerHTML = TA_MINUTES.map((n) => `<button class="seg-btn" data-minutes="${n}" role="radio">${n} min</button>`).join('');
function updatePrefs(change: (p: { world: ModeId; size: number; minutes?: number; difficulty: Difficulty }) => void) {
  const p = menuStyle === 'timeattack' ? prefs.ta : prefs.sv;
  change(p);
  savePrefs(prefs);
  renderRunPanel();
}
const segClick = (id: string, apply: (b: HTMLElement) => void) =>
  $(id).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.seg-btn');
    if (b) apply(b);
  });
segClick('#run-world', (b) => updatePrefs((p) => (p.world = b.dataset.world as ModeId)));
segClick('#run-sizes', (b) => updatePrefs((p) => (p.size = Number(b.dataset.size))));
segClick('#run-diffs', (b) => updatePrefs((p) => (p.difficulty = b.dataset.diff as Difficulty)));
segClick('#run-minutes', (b) => updatePrefs((p) => (p.minutes = Number(b.dataset.minutes))));
$('#btn-run-start').addEventListener('click', () => {
  const { style, world, tile, difficulty, minutes } = runSettings();
  startRun(newRun(style, world, tile, minutes, difficulty));
});
$('#btn-sv-continue').addEventListener('click', () => {
  const { world, tile, difficulty } = runSettings();
  const slot = loadSurvival(world, tile, difficulty);
  if (slot) startRun(slot.run, slot.save);
});
$('#btn-sv-new').addEventListener('click', async () => {
  const { world, tile, difficulty } = runSettings();
  if (!(await askConfirm({ title: 'Start a new run?', body: 'Your run in progress will be lost.', ok: 'Start new run', danger: true })))
    return;
  clearSurvival(world, tile, difficulty);
  startRun(newRun('survival', world, tile, undefined, difficulty));
});

document.querySelectorAll<HTMLButtonElement>('.style-btn').forEach((b) =>
  b.addEventListener('click', () => showStyle(b.dataset.style as MenuStyle)),
);
$('#btn-back').addEventListener('click', showHome);
document.querySelectorAll<HTMLButtonElement>('.mode-card button').forEach((btn) =>
  btn.addEventListener('click', () => {
    const m = btn.closest<HTMLElement>('.mode-card')!.dataset.mode as ModeId;
    if (btn.dataset.action === 'continue') {
      const d = loadSave(m);
      if (d) startSession(d);
    } else if (m === 'fixed') {
      sizeModal.hidden = false;
    } else if (m === 'singles') {
      diffModal.hidden = false;
    } else newGame(m);
  }),
);
const sizesText = (d: Difficulty) => [...new Set(SINGLES_PATTERNS[d])].sort((a, b) => a - b).join(', ');
$('#diff-grid').innerHTML = DIFFICULTIES.map(
  (d) => `<button class="diff-chip" data-diff="${d}">${DIFFICULTY_NAMES[d]}<small>${sizesText(d)}</small></button>`,
).join('');
document.querySelectorAll<HTMLButtonElement>('.diff-chip').forEach((b) =>
  b.addEventListener('click', () => {
    diffModal.hidden = true;
    newGame('singles', undefined, b.dataset.diff as Difficulty);
  }),
);
$('#size-grid').innerHTML = FIXED_SIZES.map((n) => `<button class="size-chip" data-size="${n}">${n}×${n}</button>`).join('');
document.querySelectorAll<HTMLButtonElement>('.size-chip').forEach((b) =>
  b.addEventListener('click', () => {
    sizeModal.hidden = true;
    newGame('fixed', Number(b.dataset.size));
  }),
);

// ---------- main loop ----------
let lastTick = performance.now();
let hudAcc = 0;
let saveAcc = 0;
const AUTOSAVE_MS = 5000;
function frame(now: number) {
  const dt = Math.min(1000, now - lastTick);
  lastTick = now;
  if (inGame && run) {
    if (runPhase === 'live' && !countdownActive && !document.hidden && !anyModalOpen()) {
      run.clockMs -= dt;
      run.elapsedMs += dt;
      if (run.style === 'survival') {
        saveAcc += dt;
        if (saveAcc > 2000) {
          saveAcc = 0;
          saveNow();
        }
      }
      if (run.clockMs <= 0) endRun();
    }
  } else if (inGame && !countdownActive && !document.hidden && !anyModalOpen()) {
    save.stats.totalPlayMs += dt;
    const z = timerRunning();
    if (z) save.timers[z.key] += dt;
    // autosave so a reload never loses more than a few seconds of clock
    saveAcc += dt;
    if (saveAcc > AUTOSAVE_MS) {
      saveAcc = 0;
      saveNow();
    }
  }
  if (camAnim) {
    const t = Math.min(1, (now - camAnim.t0) / camAnim.dur);
    const e = ease(t);
    const { from, to } = camAnim;
    cam.x = from.x + (to.x - from.x) * e;
    cam.y = from.y + (to.y - from.y) * e;
    cam.zoom = from.zoom + (to.zoom - from.zoom) * e;
    if (now - camAnim.t0 >= camAnim.dur + camAnim.hold) {
      nextCamStep();
      if (!camAnim) {
        lastGestureAt = now;
        scheduleSave();
      }
    }
    dirty = true;
  }
  if (dirty) {
    dirty = renderer.draw(cam, world, zones, preview, inGame ? focusZone() : null);
  }
  hudAcc += dt;
  if (hudAcc > 200) {
    hudAcc = 0;
    updateHud();
  }
  requestAnimationFrame(frame);
}

function onResize() {
  renderer.resize();
  dirty = true;
}
window.addEventListener('resize', onResize);
onResize();

// start on the menu over an idle backdrop
setSession(layout, save, false);
showHome();
menuEl.hidden = false;
requestAnimationFrame(frame);

// debug / test hook
const zoneOf = (key: string) => zoneByKey(layout, key) ?? layout.origin;
(window as any).__shikaku = {
  get save() {
    return save;
  },
  get cam() {
    return { ...cam };
  },
  get inGame() {
    return inGame;
  },
  get origin() {
    return layout.origin.key;
  },
  /** Singles: the level on screen */
  get current() {
    return isSingles(layout) ? layout.levelZone(layout.current()).key : null;
  },
  zoneAt: (x: number, y: number) => layout.zoneAtCell(x, y),
  solution: (key: string) => zones.getNow(zoneOf(key)).solution,
  clues: (key: string) => zones.getNow(zoneOf(key)).clues,
  toScreen: (wx: number, wy: number) => {
    const b = canvas.getBoundingClientRect();
    const [x, y] = renderer.toScreen(cam, wx, wy);
    return [x + b.left, y + b.top];
  },
  ready: (key: string) => !!zones.get(zoneOf(key)),
  status: (key: string) => world.status(zoneOf(key)),
  openZones: () => world.openZones().map((z) => z.key),
  neighbours: (key: string) => edgeNeighbours(layout, zoneOf(key)),
  flyTo: (key: string) => flyTo(zoneOf(key)),
  idle: () => !camAnim,
  get run() {
    return run;
  },
  get runPhase() {
    return runPhase;
  },
  get countdown() {
    return countdownActive;
  },
  skipCountdown: () => stopCountdown(),
  get failed() {
    return world.failed ? { zone: world.failed.zone.key, ...world.failed.rect } : null;
  },
  dismissCoach: () => {
    try {
      localStorage.setItem('infinite-shikaku:coach:v1', '1');
    } catch {
      /* ignore */
    }
  },
  /** test helper: take time off the run clock */
  fastForward: (ms: number) => {
    if (run) run.clockMs = Math.max(1, run.clockMs - ms);
  },
  timerRunning: () => timerRunning()?.key ?? null,
  rects: (key: string) => world.rects(key).length,
  /** test helper: mark the n open zones nearest the centre solved, without playing them */
  simulate: (n: number) => {
    const t0 = performance.now();
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const z = world.nearestOpen(layout.centre[0], layout.centre[1]);
      if (!z) break;
      const t = performance.now();
      world.markSolved(z);
      save.stats.zonesSolved++;
      worst = Math.max(worst, performance.now() - t);
    }
    world.solvedAt.clear();
    for (const z of world.openZones()) zones.request(z, true);
    dirty = true;
    saveNow();
    return { ms: performance.now() - t0, worst, solved: save.solved.length, open: world.openCount };
  },
  /** test helper: time the next n drawn frames */
  frameTimes: (n: number) =>
    new Promise<number[]>((resolve) => {
      const out: number[] = [];
      const step = () => {
        const t = performance.now();
        dirty = renderer.draw(cam, world, zones, preview, focusZone());
        out.push(performance.now() - t);
        if (out.length >= n) resolve(out);
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }),
  setCam: (x: number, y: number, zoom: number) => {
    stopCam();
    cam = { x, y, zoom };
    dirty = true;
  },
};
