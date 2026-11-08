// React hooks over IndexedDB + localStorage settings + a tiny hash router.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { bus, db } from './db';
import type { Attempt, Settings, Test } from './types';

// ───────────── settings ─────────────
const SETTINGS_KEY = 'gurusat.settings';
const DEFAULT_SETTINGS: Settings = {
  name: '',
  testDate: '',
  targetScore: 1400,
  classicTheme: false,
  defaultTiming: 'standard',
  onboarded: false,
  apiKey: '',
  aiEffort: 'high',
};

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let settingsCache = readSettings();
const settingsListeners = new Set<() => void>();

export function getSettings() {
  return settingsCache;
}

export function saveSettings(patch: Partial<Settings>) {
  settingsCache = { ...settingsCache, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsCache));
  } catch {
    /* storage may be blocked — keep in memory */
  }
  settingsListeners.forEach((l) => l());
}

export function useSettings(): [Settings, (p: Partial<Settings>) => void] {
  const s = useSyncExternalStore(
    (cb) => {
      settingsListeners.add(cb);
      return () => settingsListeners.delete(cb);
    },
    () => settingsCache,
  );
  return [s, saveSettings];
}

// ───────────── built-in sample tests (public/tests) ─────────────
let libraryPromise: Promise<Test[]> | null = null;
export function loadLibrary(): Promise<Test[]> {
  if (!libraryPromise) {
    libraryPromise = fetch('./tests/index.json')
      .then((r) => (r.ok ? r.json() : { tests: [] }))
      .then(async (idx: { tests: string[] }) => {
        const tests = await Promise.all(
          (idx.tests || []).map((f) =>
            fetch(`./tests/${f}`)
              .then((r) => r.json())
              .then((t: Test) => ({ ...t, builtIn: true }))
              .catch(() => null),
          ),
        );
        return tests.filter(Boolean) as Test[];
      })
      .catch(() => []);
  }
  return libraryPromise;
}

function useDbList<T>(store: 'tests' | 'attempts', load: () => Promise<T[]>) {
  const [items, setItems] = useState<T[] | null>(null);
  const reload = useCallback(() => {
    load().then(setItems).catch(() => setItems([]));
  }, [load]);
  useEffect(() => {
    reload();
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === store) reload();
    };
    bus.addEventListener('change', on);
    return () => bus.removeEventListener('change', on);
  }, [reload, store]);
  return items;
}

const loadAllTests = async () => {
  const [mine, lib] = await Promise.all([db.allTests(), loadLibrary()]);
  const ids = new Set(mine.map((t) => t.id));
  return [...mine.sort((a, b) => b.updatedAt - a.updatedAt), ...lib.filter((t) => !ids.has(t.id))];
};

export function useTests() {
  return useDbList<Test>('tests', loadAllTests);
}

const loadAttempts = async () => (await db.allAttempts()).sort((a, b) => b.createdAt - a.createdAt);

export function useAttempts() {
  return useDbList<Attempt>('attempts', loadAttempts);
}

export async function findTest(id: string): Promise<Test | undefined> {
  return (await db.getTest(id)) ?? (await loadLibrary()).find((t) => t.id === id);
}

// ───────────── hash router ─────────────
function currentPath() {
  return window.location.hash.replace(/^#/, '') || '/';
}

export function useRoute(): string[] {
  const path = useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    currentPath,
  );
  return path.split('?')[0].split('/').filter(Boolean);
}

export function navigate(path: string, replace = false) {
  const url = '#' + path;
  if (replace) window.history.replaceState(null, '', url);
  else window.location.hash = path;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
  window.scrollTo(0, 0);
}
