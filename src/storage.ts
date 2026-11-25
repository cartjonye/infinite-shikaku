/**
 * Save persistence (through kv: localStorage on the web, native storage in the app):
 * one save per mode and option, e.g. Classic Hard and Classic Easy are separate saves.
 * Every access is guarded so the game still runs (without saving) when storage is unavailable.
 */
import { kv, KEY_PREFIX } from './kv';
import { DIFFICULTIES, FOCUSED_SIZES, zoneByKey, type Difficulty, type ModeId, type WorldLayout } from './layouts';
import { rectArea, type Rect } from './types';

/**
 * Storage schema. Every key the game writes starts with PREFIX. When the stored schema
 * differs from SCHEMA, all of them are wiped once (saves, run slots, records, prefs,
 * the controls card flag): older data uses mode names and layouts that no longer exist.
 */
export const PREFIX = KEY_PREFIX;
export const SCHEMA = 6;
const SCHEMA_KEY = `${PREFIX}schema`;
export const SAVE_VERSION = SCHEMA;

/** Mode options: the difficulty for Classic, the grid size for Focused. */
export interface ModeOptions {
  difficulty?: Difficulty;
  size?: number;
}

/** Mode plus its option, e.g. "classic-hard", "focused-12", "mosaic". */
export const modeVariant = (mode: ModeId, opts: ModeOptions = {}) =>
  mode === 'classic' ? `classic-${opts.difficulty ?? 'easy'}` : mode === 'focused' ? `focused-${opts.size ?? 8}` : mode;

/** Every option a mode offers (World modes have none). */
export function modeOptionsList(mode: ModeId): ModeOptions[] {
  if (mode === 'classic') return DIFFICULTIES.map((difficulty) => ({ difficulty }));
  if (mode === 'focused') return FOCUSED_SIZES.map((size) => ({ size }));
  return [{}];
}

/** One Infinity save per mode and option. */
const saveKey = (mode: ModeId, opts: ModeOptions = {}) => `${PREFIX}infinity:${modeVariant(mode, opts)}`;

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

/** The options a save was made with (only the field that matters for its mode). */
export const saveOptions = (d: { mode: ModeId; size?: number; difficulty?: Difficulty }): ModeOptions =>
  d.mode === 'classic' ? { difficulty: d.difficulty ?? 'easy' } : d.mode === 'focused' ? { size: d.size ?? 8 } : {};

export function loadSave(mode: ModeId, opts: ModeOptions = {}): SaveData | null {
  const d = read(saveKey(mode, opts));
  if (!isValid(d, mode) || modeVariant(mode, saveOptions(d)) !== modeVariant(mode, opts)) return null;
  return { ...freshSave(mode, opts), ...d, mode, stats: { ...emptyStats(), ...d.stats } };
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
  return kv.set(saveKey(d.mode, saveOptions(d)), json);
}

export function clearSave(mode: ModeId, opts: ModeOptions = {}) {
  remove(saveKey(mode, opts));
}

/**
 * Cells covered by rectangles on unsolved zones, right or wrong: an almost-solved zone
 * still earns most of its area. Solved zones hold no rectangles (World.markSolved clears them).
 */
export function placedArea(d: Pick<SaveData, 'rects'>): number {
  let n = 0;
  for (const list of Object.values(d.rects)) for (const q of list) n += rectArea(q);
  return n;
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

export function summarize(mode: ModeId, opts: ModeOptions = {}): SaveSummary | null {
  const d = loadSave(mode, opts);
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

/** The options of a mode that have a save, most recently played first. */
export function savedOptions(mode: ModeId): { opts: ModeOptions; summary: SaveSummary }[] {
  return modeOptionsList(mode)
    .map((opts) => ({ opts, summary: summarize(mode, opts) }))
    .filter((x): x is { opts: ModeOptions; summary: SaveSummary } => x.summary !== null)
    .sort((a, b) => b.summary.lastPlayed - a.summary.lastPlayed);
}

// ---------- seed codes ----------
// (version)(mode, 2 chars)(option, 2 chars)_(seed in base 36), e.g. 6CLHA_1K9ZQ3.
// Everything before "_" is readable at a glance; the part after it is the world seed.
const MODE_CODES: Record<ModeId, string> = { classic: 'CL', focused: 'FC', journey: 'JO', mosaic: 'MO' };
const DIFF_CODES: Record<Difficulty, string> = { easy: 'EA', medium: 'ME', hard: 'HA', expert: 'EX' };

export function seedCode(d: { mode: ModeId; seed: number; size?: number; difficulty?: Difficulty }, version = SCHEMA): string {
  const o = saveOptions(d);
  const opt = d.mode === 'classic' ? DIFF_CODES[o.difficulty!] : d.mode === 'focused' ? String(o.size).padStart(2, '0') : '00';
  return `${version}${MODE_CODES[d.mode]}${opt}_${(d.seed >>> 0).toString(36).toUpperCase()}`;
}

export interface ParsedSeed {
  version: number;
  mode: ModeId;
  opts: ModeOptions;
  seed: number;
}
export function parseSeedCode(code: string): ParsedSeed | null {
  const m = /^(\d{1,4})([A-Z]{2})([A-Z0-9]{2})_([0-9A-Z]{1,7})$/.exec(code.trim().toUpperCase());
  if (!m) return null;
  const mode = (Object.keys(MODE_CODES) as ModeId[]).find((k) => MODE_CODES[k] === m[2]);
  if (!mode) return null;
  let opts: ModeOptions = {};
  if (mode === 'classic') {
    const difficulty = (Object.keys(DIFF_CODES) as Difficulty[]).find((k) => DIFF_CODES[k] === m[3]);
    if (!difficulty) return null;
    opts = { difficulty };
  } else if (mode === 'focused') {
    const size = Number(m[3]);
    if (!FOCUSED_SIZES.includes(size)) return null;
    opts = { size };
  } else if (m[3] !== '00') return null;
  const seed = parseInt(m[4], 36);
  if (!Number.isFinite(seed) || seed > 0xffffffff) return null;
  return { version: Number(m[1]), mode, opts, seed };
}
