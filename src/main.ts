import './style.css';
import { difficultyFor, zoneDistance } from './generator';
import { Renderer, type Camera, type Preview } from './render';
import { clearSave, freshSave, loadSave, writeSave, type SaveData } from './storage';
import { ZONE, type Rect } from './types';
import { NEIGHBORS, World, zkey } from './world';
import { ZoneCache } from './zones';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const canvas = $<HTMLCanvasElement>('#board');
const renderer = new Renderer(canvas);

let save: SaveData = loadSave();
let world = new World(save);
let dirty = true;
let zones = new ZoneCache(save.seed, () => (dirty = true));

const MIN_ZOOM = 6;
const MAX_ZOOM = 140;
let cam: Camera = { x: ZONE / 2, y: ZONE / 2, zoom: 40 };
let camAnim: { from: Camera; to: Camera; t0: number; dur: number } | null = null;
let preview: Preview | null = null;
let lastInteracted: [number, number] | null = null;

// ---------- persistence ----------
let saveTimer: number | undefined;
function saveNow() {
  window.clearTimeout(saveTimer);
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
function fitZoom() {
  const usableH = renderer.h - 150;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(renderer.w - 24, usableH) / (ZONE + 0.6)));
}
function zoneCenter(zx: number, zy: number): [number, number] {
  return [zx * ZONE + ZONE / 2, zy * ZONE + ZONE / 2];
}
function flyTo(zx: number, zy: number) {
  const [x, y] = zoneCenter(zx, zy);
  camAnim = { from: { ...cam }, to: { x, y: y + 18 / fitZoom(), zoom: fitZoom() }, t0: performance.now(), dur: 650 };
}
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function centerZone(): [number, number] {
  return [Math.floor(cam.x / ZONE), Math.floor(cam.y / ZONE)];
}

/** The zone the player is working on: the open zone under the screen centre, else the last touched one if visible. */
function focusZone(): [number, number] | null {
  const [cx, cy] = centerZone();
  if (world.status(cx, cy) === 'open') return [cx, cy];
  if (lastInteracted && world.status(...lastInteracted) === 'open') {
    const [x, y] = zoneCenter(...lastInteracted);
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
  | { kind: 'draw'; zx: number; zy: number; r0: number; c0: number; sx: number; sy: number; moved: boolean }
  | { kind: 'pinch'; d0: number; z0: number; wx: number; wy: number };
let mode: Mode = { kind: 'none' };

function cellAt(sx: number, sy: number) {
  const [wx, wy] = renderer.toWorld(cam, sx, sy);
  const gx = Math.floor(wx);
  const gy = Math.floor(wy);
  const zx = Math.floor(gx / ZONE);
  const zy = Math.floor(gy / ZONE);
  return { zx, zy, r: gy - zy * ZONE, c: gx - zx * ZONE, wx, wy };
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
  canvas.setPointerCapture(e.pointerId);
  const p = localPos(e);
  ptrs.set(e.pointerId, p);
  camAnim = null;
  if (ptrs.size === 2) return startPinch();
  if (ptrs.size > 2) return;
  if (e.pointerType === 'mouse' && e.button !== 0) {
    mode = { kind: 'pan', moved: 0 };
    return;
  }
  const h = cellAt(p.x, p.y);
  if (world.status(h.zx, h.zy) === 'open' && zones.get(h.zx, h.zy)) {
    mode = { kind: 'draw', zx: h.zx, zy: h.zy, r0: h.r, c0: h.c, sx: p.x, sy: p.y, moved: false };
    lastInteracted = [h.zx, h.zy];
    preview = { zx: h.zx, zy: h.zy, rect: { r: h.r, c: h.c, w: 1, h: 1 } };
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
    const c = Math.max(0, Math.min(ZONE - 1, Math.floor(wx) - mode.zx * ZONE));
    const r = Math.max(0, Math.min(ZONE - 1, Math.floor(wy) - mode.zy * ZONE));
    if (Math.hypot(p.x - mode.sx, p.y - mode.sy) > 6 || r !== mode.r0 || c !== mode.c0) mode.moved = true;
    const rect: Rect = {
      r: Math.min(r, mode.r0),
      c: Math.min(c, mode.c0),
      h: Math.abs(r - mode.r0) + 1,
      w: Math.abs(c - mode.c0) + 1,
    };
    preview = { zx: mode.zx, zy: mode.zy, rect };
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
    const k = zkey(mode.zx, mode.zy);
    const p = zones.get(mode.zx, mode.zy)!;
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
    if (world.isComplete(k, p)) onSolved(mode.zx, mode.zy);
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
    camAnim = null;
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
  if (e.key === 'Escape') closeModals();
  if ((e.key === 'Enter' || e.key === 'c') && !continueBtn.hidden && !anyModalOpen()) doContinue();
});

// ---------- solving ----------
function onSolved(zx: number, zy: number) {
  const k = zkey(zx, zy);
  const p = zones.get(zx, zy)!;
  const ms = save.timers[k] ?? 0;
  world.markSolved(k, p);
  const st = save.stats;
  st.zonesSolved++;
  st.totalSolveMs += ms;
  st.lastMs = ms;
  st.bestMs = st.bestMs === null ? ms : Math.min(st.bestMs, ms);
  for (const [dx, dy] of NEIGHBORS) if (world.status(zx + dx, zy + dy) === 'open') zones.request(zx + dx, zy + dy);
  saveNow();
  toast(`Zone solved in ${fmt(ms)}${st.bestMs === ms && st.zonesSolved > 1 ? ' · new best' : ''}`);
  if (navigator.vibrate) {
    try {
      navigator.vibrate(30);
    } catch {
      /* ignore */
    }
  }
}

function doContinue() {
  const [cx, cy] = focusZone() ?? lastInteracted ?? centerZone();
  const target = world.nearestOpen(cx, cy);
  if (!target) return;
  zones.request(...target);
  lastInteracted = target;
  flyTo(...target);
}

// ---------- HUD ----------
const zoneLabel = $('#zone-label');
const timerEl = $('#timer');
const solvedCount = $('#solved-count');
const continueBtn = $<HTMLButtonElement>('#continue');
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
  const f = focusZone();
  if (f) {
    const d = zoneDistance(...f);
    zoneLabel.textContent = `Zone ${f[0]}, ${f[1]} · Lv ${difficultyFor(d).level}`;
    timerEl.textContent = fmt(save.timers[zkey(...f)] ?? 0);
  } else {
    const [cx, cy] = centerZone();
    const st = world.status(cx, cy);
    zoneLabel.textContent = st === 'solved' ? `Zone ${cx}, ${cy} · solved` : 'Uncharted';
    timerEl.textContent = '--:--';
  }
  solvedCount.textContent = String(save.stats.zonesSolved);
  continueBtn.hidden = !!f || mode.kind !== 'none';
}

// modals
const statsModal = $('#stats-modal');
const helpModal = $('#help-modal');
function anyModalOpen() {
  return !statsModal.hidden || !helpModal.hidden;
}
function closeModals() {
  statsModal.hidden = true;
  helpModal.hidden = true;
  if (!save.seenHelp) {
    save.seenHelp = true;
    scheduleSave();
  }
}
function renderStats() {
  const st = save.stats;
  const rows: [string, string][] = [
    ['Zones solved', String(st.zonesSolved)],
    ['Best time', st.bestMs === null ? '–' : fmt(st.bestMs)],
    ['Average time', st.zonesSolved ? fmt(st.totalSolveMs / st.zonesSolved) : '–'],
    ['Last solve', st.lastMs === null ? '–' : fmt(st.lastMs)],
    ['Farthest level', String(st.farthest + 1)],
    ['Total play time', fmt(st.totalPlayMs)],
  ];
  $('#stats-grid').innerHTML = rows
    .map(([k, v]) => `<div class="stat"><div class="stat-v">${v}</div><div class="stat-k">${k}</div></div>`)
    .join('');
}
$('#btn-stats').addEventListener('click', () => {
  renderStats();
  statsModal.hidden = false;
});
$('#btn-help').addEventListener('click', () => (helpModal.hidden = false));
document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeModals));
document.querySelectorAll('.modal').forEach((m) =>
  m.addEventListener('click', (e) => {
    if (e.target === m) closeModals();
  }),
);
continueBtn.addEventListener('click', doContinue);
$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Reset all progress and start a brand-new world?')) return;
  clearSave();
  save = freshSave();
  save.seenHelp = true;
  world = new World(save);
  zones = new ZoneCache(save.seed, () => (dirty = true));
  lastInteracted = null;
  cam = { x: ZONE / 2, y: ZONE / 2, zoom: fitZoom() };
  saveNow();
  closeModals();
  dirty = true;
  toast('New world created');
});

// ---------- main loop ----------
let lastTick = performance.now();
let hudAcc = 0;
function frame(now: number) {
  const dt = Math.min(1000, now - lastTick);
  lastTick = now;
  if (!document.hidden) {
    save.stats.totalPlayMs += dt;
    const f = focusZone();
    if (f && !anyModalOpen()) {
      const k = zkey(...f);
      save.timers[k] = (save.timers[k] ?? 0) + dt;
    }
  }
  if (camAnim) {
    const t = Math.min(1, (now - camAnim.t0) / camAnim.dur);
    const e = ease(t);
    const { from, to } = camAnim;
    cam.x = from.x + (to.x - from.x) * e;
    cam.y = from.y + (to.y - from.y) * e;
    cam.zoom = from.zoom + (to.zoom - from.zoom) * e;
    if (t >= 1) {
      camAnim = null;
      scheduleSave();
    }
    dirty = true;
  }
  if (dirty) {
    dirty = renderer.draw(cam, world, zones, preview, focusZone());
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

// initial camera
if (save.cam && isFinite(save.cam.x) && isFinite(save.cam.zoom)) {
  cam = { ...save.cam, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, save.cam.zoom)) };
} else {
  const [x, y] = zoneCenter(0, 0);
  cam = { x, y: y + 18 / fitZoom(), zoom: fitZoom() };
}
for (const [x, y] of world.openZones()) zones.request(x, y);
if (!save.seenHelp) helpModal.hidden = false;
updateHud();
requestAnimationFrame(frame);

// debug / test hook
(window as any).__shikaku = {
  get save() {
    return save;
  },
  get cam() {
    return { ...cam };
  },
  solution: (zx: number, zy: number) => zones.getNow(zx, zy).solution,
  toScreen: (wx: number, wy: number) => {
    const b = canvas.getBoundingClientRect();
    const [x, y] = renderer.toScreen(cam, wx, wy);
    return [x + b.left, y + b.top];
  },
  ready: (zx: number, zy: number) => !!zones.get(zx, zy),
  status: (zx: number, zy: number) => world.status(zx, zy),
  idle: () => !camAnim,
};
