/**
 * Key-value storage shared by web, Android and iOS.
 *
 * On the web this is plain localStorage. In the native app, saves live in
 * native storage (Capacitor Preferences: SharedPreferences on Android,
 * UserDefaults on iOS), because iOS may clear a WebView's localStorage.
 * Preferences is asynchronous, so every game key is loaded into memory once
 * at startup (initKv); reads stay synchronous and writes go to memory first,
 * then to native storage in the background, newest value per key.
 */
import { Capacitor } from '@capacitor/core';

export const KEY_PREFIX = 'infinite-shikaku:';

/** The slice of the Preferences API that kv needs (also easy to fake in tests). */
export interface NativeStore {
  keys(): Promise<{ keys: string[] }>;
  get(o: { key: string }): Promise<{ value: string | null }>;
  set(o: { key: string; value: string }): Promise<void>;
  remove(o: { key: string }): Promise<void>;
}

let mem: Map<string, string> | null = null;
let store: NativeStore | null = null;
const dirty = new Map<string, string | null>();
let draining: Promise<void> | null = null;

async function drain() {
  while (dirty.size) {
    const batch = [...dirty];
    dirty.clear();
    for (const [key, value] of batch) {
      try {
        if (value === null) await store!.remove({ key });
        else await store!.set({ key, value });
      } catch {
        /* a failed write is retried by the next save of that key */
      }
    }
  }
  draining = null;
}
function queue(key: string, value: string | null) {
  dirty.set(key, value);
  draining ??= Promise.resolve().then(drain);
}

/** Load native storage into memory. Resolves at once on the web. */
export async function initKv(native?: NativeStore): Promise<void> {
  if (!native) {
    if (!Capacitor.isNativePlatform()) return;
    native = (await import('@capacitor/preferences')).Preferences;
  }
  const m = new Map<string, string>();
  const { keys } = await native.keys();
  await Promise.all(
    keys
      .filter((k) => k.startsWith(KEY_PREFIX))
      .map(async (key) => {
        const { value } = await native!.get({ key });
        if (value !== null) m.set(key, value);
      }),
  );
  store = native;
  mem = m;
}

export const kv = {
  get(key: string): string | null {
    if (mem) return mem.get(key) ?? null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    if (mem) {
      mem.set(key, value);
      queue(key, value);
      return true;
    }
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    if (mem) {
      mem.delete(key);
      queue(key, null);
      return;
    }
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  /** Every stored key (game keys only on native). */
  keys(): string[] {
    if (mem) return [...mem.keys()];
    try {
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) out.push(k);
      }
      return out;
    } catch {
      return [];
    }
  },
  /** Wait until every write has reached native storage. */
  flush(): Promise<void> {
    return draining ?? Promise.resolve();
  },
};

/** Test helper: go back to the web (localStorage) backend. */
export function resetKvForTests() {
  mem = null;
  store = null;
  dirty.clear();
  draining = null;
}
