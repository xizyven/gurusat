// Tiny IndexedDB wrapper. Everything you upload stays in this browser.
import type { Attempt, Test } from './types';

const DB_NAME = 'gurusat';
const DB_VERSION = 1;
type StoreName = 'tests' | 'attempts';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tests')) db.createObjectStore('tests', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('attempts')) db.createObjectStore('attempts', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

// ── change notifications so every hook can refresh ──
export const bus = new EventTarget();
function emit(store: StoreName) {
  bus.dispatchEvent(new CustomEvent('change', { detail: store }));
}

export const db = {
  async allTests(): Promise<Test[]> {
    return tx<Test[]>('tests', 'readonly', (s) => s.getAll() as IDBRequest<Test[]>);
  },
  async getTest(id: string): Promise<Test | undefined> {
    return tx<Test | undefined>('tests', 'readonly', (s) => s.get(id) as IDBRequest<Test | undefined>);
  },
  async putTest(t: Test): Promise<void> {
    await tx('tests', 'readwrite', (s) => s.put(t));
    emit('tests');
  },
  async deleteTest(id: string): Promise<void> {
    await tx('tests', 'readwrite', (s) => s.delete(id));
    emit('tests');
  },
  async allAttempts(): Promise<Attempt[]> {
    return tx<Attempt[]>('attempts', 'readonly', (s) => s.getAll() as IDBRequest<Attempt[]>);
  },
  async getAttempt(id: string): Promise<Attempt | undefined> {
    return tx<Attempt | undefined>('attempts', 'readonly', (s) => s.get(id) as IDBRequest<Attempt | undefined>);
  },
  async putAttempt(a: Attempt, silent = false): Promise<void> {
    await tx('attempts', 'readwrite', (s) => s.put(a));
    if (!silent) emit('attempts');
  },
  async deleteAttempt(id: string): Promise<void> {
    await tx('attempts', 'readwrite', (s) => s.delete(id));
    emit('attempts');
  },
  async clearAll(): Promise<void> {
    await tx('tests', 'readwrite', (s) => s.clear());
    await tx('attempts', 'readwrite', (s) => s.clear());
    emit('tests');
    emit('attempts');
  },
};

// ── Backup / restore (move data between devices) ──
export interface Backup {
  app: 'gurusat';
  version: 1;
  exportedAt: number;
  tests: Test[];
  attempts: Attempt[];
  settings?: unknown;
}

export async function makeBackup(settings: unknown): Promise<Backup> {
  const [tests, attempts] = await Promise.all([db.allTests(), db.allAttempts()]);
  return { app: 'gurusat', version: 1, exportedAt: Date.now(), tests, attempts, settings };
}

export async function restoreBackup(b: Backup): Promise<{ tests: number; attempts: number }> {
  if (b?.app !== 'gurusat' || !Array.isArray(b.tests)) throw new Error('This file is not a GuruSat backup.');
  for (const t of b.tests) await tx('tests', 'readwrite', (s) => s.put(t));
  for (const a of b.attempts ?? []) await tx('attempts', 'readwrite', (s) => s.put(a));
  emit('tests');
  emit('attempts');
  return { tests: b.tests.length, attempts: (b.attempts ?? []).length };
}
