/* The home folder on the device: IndexedDB behind a Home.

   Database `plate`, version 1, one store `files` keyed by path, one record per file:
   {path, bytes: Uint8Array}. Everything is stored as bytes, text included; Home decodes a
   Uint8Array as UTF-8 on read, so a file that came from a backup and a file that was written
   as a string are the same thing in the store. One connection is opened for the life of the
   page and shared by every call.

   A flush is one readwrite transaction holding every write since the last flush, so the store
   never shows a half-applied set of files: a meal log row and the state it changed land
   together or not at all. IndexedDB in a home-screen web app can still be evicted by the
   browser, which is why the backup file stays load-bearing and persist() is asked for. */
import { Home } from './home.js';

export const DB_NAME = 'plate';
export const DB_VERSION = 1;
export const STORE = 'files';

const enc = new TextEncoder();
let dbPromise = null;

/* the one connection; reopened only if the browser closes it under us */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'path' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };   // let another tab upgrade or delete
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

/* one transaction on the store; resolves with the last request's result once it has committed */
function transact(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let req;
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    try { req = fn(tx.objectStore(STORE)); }
    catch (e) { try { tx.abort(); } catch (_) { /* already done */ } reject(e); }
  });
}

/* every record in the store, read into a Home; opts.clock passes through to it */
export async function loadHome(opts = {}) {
  const db = await openDB();
  const records = (await transact(db, 'readonly', s => s.getAll())) || [];
  const files = records.map(r => [r.path, r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes)]);
  return new Home(files, { clock: opts.clock });
}

/* a Uint8Array that owns exactly its bytes; a view over a larger buffer would put the whole
   buffer in the record (structured clone keeps the buffer), and the backup container is one
   such buffer */
function tight(bytes) {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
}

/* home.takeDirty() applied in ONE readwrite transaction: written paths put as bytes, removed
   paths deleted. Resolves when the transaction has committed. If anything fails the entries go
   back into home.dirty (a newer write to the same path, if one landed meanwhile, wins) and the
   error is rethrown, so the next flush carries them. */
export async function flush(home) {
  const dirty = home.takeDirty();
  if (dirty.size === 0) return;
  try {
    const db = await openDB();
    await transact(db, 'readwrite', store => {
      for (const [path, data] of dirty) {
        if (data === null) store.delete(path);
        else store.put({ path, bytes: typeof data === 'string' ? enc.encode(data) : tight(data) });
      }
    });
  } catch (e) {
    for (const [path, data] of dirty) if (!home.dirty.has(path)) home.dirty.set(path, data);
    throw e;
  }
}

/* empty the store. The database itself stays: deleting it would block while this page (or
   another tab) holds the connection open, and clearing the records is all a Start over needs. */
export async function wipe() {
  const db = await openDB();
  await transact(db, 'readwrite', s => s.clear());
}

export async function count() {
  const db = await openDB();
  return transact(db, 'readonly', s => s.count());
}

/* ask the browser not to evict the store: true if granted, false if refused, null when the
   browser has no such API. A refusal changes nothing; the backup file is the guarantee. */
export async function persist() {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : null;
  if (!storage || typeof storage.persist !== 'function') return null;
  try { return await storage.persist(); } catch (e) { return null; }
}
