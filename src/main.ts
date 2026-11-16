import './style.css';
import {
  FIXED_SIZES,
  createClassicLayout,
  createFixedLayout,
  createMosaicLayout,
  edgeNeighbours,
  formatMetres,
  loadTiler,
  zoneByKey,
  zoneCenter,
  type ModeId,
  type WorldLayout,
  type Zone,
} from './layouts';
import { Renderer, type Camera, type Preview } from './render';
import { clearSave, freshSave, loadSave, sanitize, summarize, writeSave, type SaveData } from './storage';
import type { Rect } from './types';
import { World } from './world';
import { ZoneCache } from './zones';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const canvas = $<HTMLCanvasElement>('#board');
const renderer = new Renderer(canvas);

// The menu shows over an idle Classic backdrop that is never saved.
let inGame = false;
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
  writeSave(save);
}
function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 300);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveNow();
  lastTick = performance.now();
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

// ---------- input ----------
interface Ptr {
  x: number;
  y: number;
}
const ptrs = new Map<number, Ptr>();
type Mode =
  | { kind: 'none' }
  | { kind: 'pan'; moved: number }
  | { kind: 'draw'; zone: Zone; r0: number; c0: number; sx: number; sy: number; moved: boolean }
  | { kind: 'pinch'; d0: number; z0: number; wx: number; wy: number };
let mode: Mode = { kind: 'none' };

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
  if (!inGame) return;
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
  if (world.status(h.zone) === 'open' && zones.get(h.zone)) {
    mode = { kind: 'draw', zone: h.zone, r0: h.r, c0: h.c, sx: p.x, sy: p.y, moved: false };
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
  if (mode.kind === 'pinch') {
    if (ptrs.size === 1) mode = { kind: 'pan', moved: 99 };
    else if (ptrs.size === 0) mode = { kind: 'none' };
    scheduleSave();
    return;
  }
  if (mode.kind === 'draw' && !cancelled && preview) {
    const z = mode.zone;
    const k = z.key;
    const p = zones.get(z)!;
    if (!mode.moved) {
      // tap: remove an existing rectangle, or place a 1-cell clue
      if (!world.removeAt(k, mode.r0, mode.c0)) {
        const { r0, c0 } = mode;
        const clue = p.clues.find((q) => q.r === r0 && q.c === c0 && q.v === 1);
        if (clue) world.place(k, { r: clue.r, c: clue.c, w: 1, h: 1 });
      }
    } else {
      world.place(k, preview.rect);
    }
    if (world.isComplete(z, p)) onSolved(z);
    scheduleSave();
  }
  if (mode.kind === 'pan') scheduleSave();
  preview = null;
  mode = { kind: 'none' };
  dirty = true;
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
    scheduleSave();
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  if (!inGame) return;
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
});

// ---------- solving ----------
function onSolved(z: Zone) {
  const k = z.key;
  const p = zones.get(z)!;
  const ms = save.timers[k] ?? 0;
  const wasOpen = new Set(world.openZones().map((o) => o.key));
  world.markSolved(z, p);
  const st = save.stats;
  st.zonesSolved++;
  st.totalSolveMs += ms;
  st.lastMs = ms;
  st.bestMs = st.bestMs === null ? ms : Math.min(st.bestMs, ms);
  const newlyOpen = world.openZones().filter((o) => !wasOpen.has(o.key));
  for (const o of newlyOpen) zones.request(o);
  const bigger = layout.expansionBanner ? newlyOpen.find((o) => !save.seenSizes.includes(o.size)) : undefined;
  if (bigger) {
    save.seenSizes.push(bigger.size);
    revealExpansion(bigger);
  } else {
    toast(`Zone solved in ${fmt(ms)}${st.bestMs === ms && st.zonesSolved > 1 ? ' · new best' : ''}`);
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
  zones.request(target);
  const [x, y] = zoneCenter(target);
  playCam([{ to: { x, y: y + 18 / cam.zoom, zoom: cam.zoom }, dur: 1100, hold: 0 }]);
  showBanner('The world expands', `${target.size}×${target.size} zones · ${layout.label(target).toLowerCase()}`);
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
  const open = world.openZones();
  if (!open.length) return null;
  const [cx, cy] = zoneCenter(from);
  const smaller = open.filter((o) => o.size < from.size);
  const pool = smaller.length ? smaller : open.filter((o) => o.size === Math.min(...open.map((q) => q.size)) && o !== from);
  let best: Zone | null = null;
  let bestD = Infinity;
  for (const o of pool) {
    const [x, y] = zoneCenter(o);
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}
function doEasier() {
  const t = smallerTarget();
  if (!t) return toast('No smaller zones open');
  lastInteracted = t;
  zones.request(t);
  flyTo(t);
  toast(`Jumping to a ${t.size}×${t.size} zone`);
}

function doContinue() {
  const from = focusZone() ?? lastInteracted ?? centerZone();
  const [cx, cy] = zoneCenter(from);
  const target = world.nearestOpen(cx, cy);
  if (!target) return;
  zones.request(target);
  lastInteracted = target;
  flyTo(target);
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
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function updateHud() {
  if (!inGame) return;
  const f = focusZone();
  if (f) {
    zoneLabel.textContent = `${layout.label(f)} · ${f.size}×${f.size}`;
    timerEl.textContent = fmt(save.timers[f.key] ?? 0);
  } else {
    const cz = centerZone();
    const st = world.status(cz);
    const best = st === 'locked' ? world.bestStepSide(cz) : null;
    if (st === 'solved') zoneLabel.textContent = `${layout.label(cz)} · solved`;
    else if (best && (best.solved > 0 || (best.needsDiag && best.diagSolved)))
      zoneLabel.textContent = best.needsDiag
        ? `Locked · side ${best.solved}/${best.total} · diagonal ${best.diagSolved ? 1 : 0}/1`
        : `Locked · side ${best.solved}/${best.total}`;
    else zoneLabel.textContent = `${layout.label(cz)} · uncharted`;
    timerEl.textContent = '--:--';
  }
  solvedCount.textContent = String(save.stats.zonesSolved);
  continueBtn.hidden = !!f || mode.kind !== 'none';
  const cur = f ?? centerZone();
  const open = world.openZones();
  const minOpen = open.length ? Math.min(...open.map((o) => o.size)) : Infinity;
  easierBtn.hidden = !(cur.size > minOpen);
}

// ---------- modals: help, pause ----------
const pauseModal = $('#pause-modal');
const helpModal = $('#help-modal');
const sizeModal = $('#size-modal');
function anyModalOpen() {
  return !pauseModal.hidden || !helpModal.hidden || !sizeModal.hidden;
}
function closeModals() {
  pauseModal.hidden = true;
  helpModal.hidden = true;
  sizeModal.hidden = true;
  if (inGame && !save.seenHelp) {
    save.seenHelp = true;
    scheduleSave();
  }
}
const MODE_NAMES: Record<ModeId, string> = { classic: 'Classic', fixed: 'Fixed', mosaic: 'Mosaic' };
function modeTitle() {
  return save.mode === 'fixed' ? `Fixed · ${save.tileSize}×${save.tileSize}` : MODE_NAMES[save.mode];
}
function renderStats() {
  const st = save.stats;
  const rows: [string, string][] = [
    ['Zones solved', String(st.zonesSolved)],
    ['Best time', st.bestMs === null ? '–' : fmt(st.bestMs)],
    ['Average time', st.zonesSolved ? fmt(st.totalSolveMs / st.zonesSolved) : '–'],
    ['Last solve', st.lastMs === null ? '–' : fmt(st.lastMs)],
    save.mode === 'mosaic'
      ? ['Farthest from centre', formatMetres(st.farthestM)]
      : ['Deepest depth', String(st.deepest || '–')],
    ['Total play time', fmt(st.totalPlayMs)],
  ];
  $('#stats-grid').innerHTML = rows
    .map(([k, v]) => `<div class="stat"><div class="stat-v">${v}</div><div class="stat-k">${k}</div></div>`)
    .join('');
  $('#pause-mode').textContent = modeTitle();
}
function openPause() {
  if (!inGame) return;
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
    if (e.target === m) closeModals();
  }),
);
continueBtn.addEventListener('click', doContinue);
easierBtn.addEventListener('click', doEasier);
$('#btn-zoom-in').addEventListener('click', () => zoomBy(1.35));
$('#btn-zoom-out').addEventListener('click', () => zoomBy(1 / 1.35));
$('#btn-fit').addEventListener('click', fitFocus);

// ---------- sessions & menu ----------
const HELP_MODE: Record<ModeId, string> = {
  classic:
    'Zones grow ring by ring: 6×6, 8×8, 10×10, 12×12, 15×15, 16×16, 18×18, 20×20, then 24×24. Where the size steps up, a zone opens only when <b>every zone along one side</b> is solved <b>plus one diagonal zone</b> past that side\'s corner.',
  fixed:
    'Every zone has the tile size you picked, forever. Puzzles get harder the deeper you go. Solve any neighbour to open a zone.',
  mosaic:
    'The world is a patchwork of random 66×66 blocks mixing every size from 6×6 to 24×24. A zone opens when <b>every zone along any one of its sides</b> is solved. The HUD shows how far you are from the centre, in metres.',
};

async function makeLayout(d: SaveData): Promise<WorldLayout> {
  if (d.mode === 'fixed') return createFixedLayout(d.tileSize ?? 8);
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
  for (const z of world.openZones()) zones.request(z);
  dirty = true;
}

async function startSession(d: SaveData) {
  menuStatus('Loading…');
  let L: WorldLayout;
  try {
    L = await makeLayout(d);
  } catch {
    menuStatus('Could not load the Mosaic tiles. Check your connection and try again.');
    return;
  }
  menuStatus('');
  setSession(L, d, true);
  inGame = true;
  document.body.classList.add('in-game');
  menuEl.hidden = true;
  $('#help-mode').innerHTML = HELP_MODE[d.mode];
  saveNow();
  if (!save.seenHelp) helpModal.hidden = false;
  updateHud();
}

function endSession() {
  saveNow();
  closeModals();
  inGame = false;
  document.body.classList.remove('in-game');
  continueBtn.hidden = true;
  easierBtn.hidden = true;
  renderMenu();
  menuEl.hidden = false;
}

function newGame(m: ModeId, tileSize?: number) {
  if (summarize(m) && !confirm(`Start a new ${MODE_NAMES[m]} game? Your current ${MODE_NAMES[m]} progress will be deleted.`)) return;
  clearSave(m);
  startSession(freshSave(m, tileSize));
}

const menuEl = $('#menu');
function menuStatus(msg: string) {
  $('#menu-status').textContent = msg;
}
function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
function renderMenu() {
  for (const m of ['classic', 'fixed', 'mosaic'] as ModeId[]) {
    const card = $(`.mode-card[data-mode="${m}"]`);
    const sum = summarize(m);
    const cont = card.querySelector<HTMLButtonElement>('[data-action="continue"]')!;
    const line = card.querySelector<HTMLElement>('.mode-save')!;
    cont.hidden = !sum;
    if (sum) {
      const where = m === 'mosaic' ? formatMetres(sum.farthestM) : `depth ${sum.deepest || 1}`;
      const size = m === 'fixed' ? `${sum.tileSize}×${sum.tileSize} · ` : '';
      line.textContent = `${size}${sum.zonesSolved} solved · ${where} · ${fmt(sum.totalPlayMs)} played · ${ago(sum.lastPlayed)}`;
    } else line.textContent = 'No saved game';
  }
}
document.querySelectorAll<HTMLButtonElement>('.mode-card button').forEach((btn) =>
  btn.addEventListener('click', () => {
    const m = btn.closest<HTMLElement>('.mode-card')!.dataset.mode as ModeId;
    if (btn.dataset.action === 'continue') {
      const d = loadSave(m);
      if (d) startSession(d);
    } else if (m === 'fixed') {
      sizeModal.hidden = false;
    } else newGame(m);
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
function frame(now: number) {
  const dt = Math.min(1000, now - lastTick);
  lastTick = now;
  if (inGame && !document.hidden && !anyModalOpen()) {
    save.stats.totalPlayMs += dt;
    const f = focusZone();
    if (f) {
      save.timers[f.key] = (save.timers[f.key] ?? 0) + dt;
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
      if (!camAnim) scheduleSave();
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
renderMenu();
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
  zoneAt: (x: number, y: number) => layout.zoneAtCell(x, y),
  solution: (key: string) => zones.getNow(zoneOf(key)).solution,
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
};
