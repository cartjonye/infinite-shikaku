/**
 * Save persistence (through kv: localStorage on the web, native storage in the app), one save per game mode.
 * Every access is guarded so the game still runs (without saving) when storage is unavailable.
 */
import { kv, KEY_PREFIX } from './kv';
import { zoneByKey, type Difficulty, type ModeId, type WorldLayout } from './layouts';
import type { Rect } from './types';

/**
 * Storage schema. Every key the game writes starts with PREFIX. When the stored schema
 * differs from SCHEMA, all of them are wiped once (saves, run slots, records, prefs,
 * the controls card flag): older data uses mode names and layouts that no longer exist.
 */
export const PREFIX = KEY_PREFIX;
export const SCHEMA = 5;
const SCHEMA_KEY = `${PREFIX}schema`;
export const SAVE_VERSION = SCHEMA;

/** One Infinity save per mode. */
const saveKey = (mode: ModeId) => `${PREFIX}infinity:${mode}`;
const LAST_MODE_KEY = `${PREFIX}last-mode`;

export interface SizeStats {
  solved: number;
  totalMs: number;
  bestMs: number | null;
}

export interface Stats {
  zonesSolved: number;
  /** sum of the solve timers of all solved zones */
  totalSolveMs: number;
  /** per grid size (key = side length) */
  bySize: Record<string, SizeStats>;
  /** deepest depth reached (Journey) */
  deepest: number;
  /** farthest straight-line distance from the centre, in cells / metres (Mosaic) */
  farthestM: number;
  totalPlayMs: number;
}

export interface SaveData {
  v: number;
  mode: ModeId;
  /** Focused only: the chosen grid size */
  size?: number;
  /** Classic only: the chosen difficulty */
  difficulty?: Difficulty;
  seed: number;
  solved: string[];
  /** in-progress rectangles per zone key */
  rects: Record<string, Rect[]>;
  /** elapsed ms per started, unsolved zone key (a key exists once the first rectangle is drawn) */
  timers: Record<string, number>;
  /** the zone the player last acted in: its timer is the one that runs */
  active: string | null;
  /** zones opened by the anti-stuck rule; they stay open */
  opened: string[];
  /** player tilings that differ from the generated solution (should never happen) */
  custom: Record<string, Rect[]>;
  cam: { x: number; y: number; zoom: number } | null;
  stats: Stats;
  seenHelp: boolean;
  /** zone sizes the player has already seen unlock (for the expansion reveal) */
  seenSizes: number[];
  lastPlayed: number;
}

export const emptyStats = (): Stats => ({
  zonesSolved: 0,
  totalSolveMs: 0,
  bySize: {},
  deepest: 0,
  farthestM: 0,
  totalPlayMs: 0,
});

/** Mode options: the difficulty for Classic, the grid size for Focused. */
export interface ModeOptions {
  difficulty?: Difficulty;
  size?: number;
}

export function freshSave(mode: ModeId, opts: ModeOptions = {}): SaveData {
  return {
    v: SAVE_VERSION,
    mode,
    size: mode === 'focused' ? (opts.size ?? 8) : undefined,
    difficulty: mode === 'classic' ? (opts.difficulty ?? 'easy') : undefined,
    seed: (Math.random() * 2 ** 32) >>> 0,
    solved: [],
    rects: {},
    timers: {},
    active: null,
    opened: [],
    custom: {},
    cam: null,
    stats: emptyStats(),
    seenHelp: false,
    seenSizes: [6],
    lastPlayed: Date.now(),
  };
}

function read(key: string): any {
  try {
    const raw = kv.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function remove(key: string) {
  kv.remove(key);
}

function isValid(d: any, mode: ModeId): boolean {
  return (
    d &&
    d.v === SAVE_VERSION &&
    d.mode === mode &&
    typeof d.seed === 'number' &&
    Array.isArray(d.solved) &&
    typeof d.rects === 'object' &&
    typeof d.timers === 'object' &&
    typeof d.stats === 'object' &&
    (mode !== 'focused' || typeof d.size === 'number') &&
    (mode !== 'classic' || typeof d.difficulty === 'string')
  );
}

/** Wipe every key from an older schema, once. Returns true if anything was wiped. */
export function ensureSchema(): boolean {
  if (kv.get(SCHEMA_KEY) === String(SCHEMA)) return false;
  const old = kv.keys().filter((k) => k.startsWith(PREFIX));
  old.forEach(remove);
  kv.set(SCHEMA_KEY, String(SCHEMA));
  return old.length > 0;
}
ensureSchema();

export function loadSave(mode: ModeId): SaveData | null {
  const d = read(saveKey(mode));
  if (!isValid(d, mode)) return null;
  return { ...freshSave(mode), ...d, mode, stats: { ...emptyStats(), ...d.stats } };
}

/** Drop zone keys that do not exist in this layout (corrupt or foreign data). */
export function sanitize(d: SaveData, L: WorldLayout): SaveData {
  const ok = (k: string) => zoneByKey(L, k) !== null;
  d.solved = d.solved.filter(ok);
  const solved = new Set(d.solved);
  for (const k of Object.keys(d.rects)) if (!ok(k) || solved.has(k)) delete d.rects[k];
  for (const k of Object.keys(d.timers)) if (!ok(k) || solved.has(k)) delete d.timers[k];
  for (const k of Object.keys(d.custom)) if (!solved.has(k)) delete d.custom[k];
  d.opened = d.opened.filter((k) => ok(k) && !solved.has(k));
  if (d.active && (!ok(d.active) || solved.has(d.active))) d.active = null;
  return d;
}

export function writeSave(d: SaveData): boolean {
  d.lastPlayed = Date.now();
  let json: string;
  try {
    json = JSON.stringify(d);
  } catch {
    return false;
  }
  return kv.set(saveKey(d.mode), json) && kv.set(LAST_MODE_KEY, d.mode);
}

export function clearSave(mode: ModeId) {
  remove(saveKey(mode));
}

export function lastMode(): ModeId | null {
  const m = kv.get(LAST_MODE_KEY);
  return m === 'classic' || m === 'focused' || m === 'journey' || m === 'mosaic' ? m : null;
}

export interface SaveSummary {
  zonesSolved: number;
  deepest: number;
  farthestM: number;
  totalPlayMs: number;
  lastPlayed: number;
  size?: number;
  difficulty?: Difficulty;
}

export function summarize(mode: ModeId): SaveSummary | null {
  const d = loadSave(mode);
  if (!d) return null;
  return {
    zonesSolved: d.stats.zonesSolved,
    deepest: d.stats.deepest,
    farthestM: d.stats.farthestM,
    totalPlayMs: d.stats.totalPlayMs,
    lastPlayed: d.lastPlayed,
    size: d.size,
    difficulty: d.difficulty,
  };
}
