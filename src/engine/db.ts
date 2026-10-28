// Thin IndexedDB wrapper: the only place the app talks to IndexedDB directly (same shape as
// webseq's persistence/db.ts). Two object stores: "saves" (named projects, keyed by id) and
// "current" (a single autosave slot, so a reload resumes where you left off). Chosen over
// localStorage: 64 patterns are ~1.7 MB of project data, and localStorage is string-only and
// capped around 5 MB for the whole origin.

const DB_NAME = "pulse8";
const DB_VERSION = 1;
export const SAVES_STORE = "saves";
export const CURRENT_STORE = "current";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SAVES_STORE)) db.createObjectStore(SAVES_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CURRENT_STORE)) db.createObjectStore(CURRENT_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  // A failed open (private window, blocked storage) must not stick: let the next call retry.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
