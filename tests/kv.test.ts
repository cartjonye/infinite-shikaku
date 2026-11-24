import { afterEach, describe, expect, it } from 'vitest';
import { initKv, kv, resetKvForTests, type NativeStore } from '../src/kv';

function memLocalStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    m,
  };
}

/** A fake Capacitor Preferences that records every call. */
function fakeNative(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  const calls: string[] = [];
  const store: NativeStore = {
    keys: async () => ({ keys: [...data.keys()] }),
    get: async ({ key }) => ({ value: data.get(key) ?? null }),
    set: async ({ key, value }) => {
      calls.push(`set ${key}`);
      data.set(key, value);
    },
    remove: async ({ key }) => {
      calls.push(`remove ${key}`);
      data.delete(key);
    },
  };
  return { store, data, calls };
}

afterEach(() => resetKvForTests());

describe('kv on the web', () => {
  it('passes straight through to localStorage', async () => {
    const ls = memLocalStorage();
    (globalThis as any).localStorage = ls;
    await initKv(); // not a native platform: nothing to load
    expect(kv.set('infinite-shikaku:a', '1')).toBe(true);
    expect(ls.m.get('infinite-shikaku:a')).toBe('1');
    expect(kv.get('infinite-shikaku:a')).toBe('1');
    expect(kv.keys()).toEqual(['infinite-shikaku:a']);
    kv.remove('infinite-shikaku:a');
    expect(ls.m.size).toBe(0);
  });
});

describe('kv in the native app', () => {
  it('preloads game keys, reads synchronously and writes through', async () => {
    (globalThis as any).localStorage = memLocalStorage();
    const { store, data, calls } = fakeNative({
      'infinite-shikaku:save': '{"x":1}',
      'infinite-shikaku:schema': '5',
      'other-app:key': 'nope',
    });
    await initKv(store);
    // only game keys are loaded, and reads never touch localStorage
    expect(kv.keys().sort()).toEqual(['infinite-shikaku:save', 'infinite-shikaku:schema']);
    expect(kv.get('infinite-shikaku:save')).toBe('{"x":1}');
    expect(kv.get('other-app:key')).toBeNull();

    // a write is visible at once, and reaches native storage after flush
    kv.set('infinite-shikaku:save', '{"x":2}');
    expect(kv.get('infinite-shikaku:save')).toBe('{"x":2}');
    kv.remove('infinite-shikaku:schema');
    expect(kv.get('infinite-shikaku:schema')).toBeNull();
    await kv.flush();
    expect(data.get('infinite-shikaku:save')).toBe('{"x":2}');
    expect(data.has('infinite-shikaku:schema')).toBe(false);
    expect((globalThis as any).localStorage.length).toBe(0);
    expect(calls).toEqual(['set infinite-shikaku:save', 'remove infinite-shikaku:schema']);
  });

  it('coalesces rapid writes to the newest value per key', async () => {
    (globalThis as any).localStorage = memLocalStorage();
    const { store, data, calls } = fakeNative({});
    await initKv(store);
    for (let i = 0; i < 50; i++) kv.set('infinite-shikaku:save', String(i));
    await kv.flush();
    expect(data.get('infinite-shikaku:save')).toBe('49');
    expect(calls.length).toBe(1);
  });
});
