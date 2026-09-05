/* The home folder, in memory.

   Python reads config/*.csv and labs/* from disk. The page reads the same paths from here: a
   map of relative path to text or bytes, loaded once from the device's IndexedDB at boot (or
   from a directory, in the node twin) and written through. Every module takes the home it
   reads from as its first argument, the way the Python modules take config_dir, so a module
   never knows where the bytes came from and the twin can hand it the same files the oracle
   read. Paths are 'config/meals.csv', 'labs/results.csv', 'labs/raw/report.pdf'. */

import { cmpStr } from './py.js';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

export class Home {
  constructor(files, opts = {}) {
    this.files = new Map(files || []);
    this.dirty = new Map();                 // path -> data written, or null for a delete
    this.clock = opts.clock || (() => new Date());
  }
  static fromObject(obj, opts) { return new Home(Object.entries(obj || {}), opts); }
  now() { return this.clock(); }
  exists(path) { return this.files.has(path); }
  isDir(dir) {
    const p = dir.endsWith('/') ? dir : dir + '/';
    for (const k of this.files.keys()) if (k.startsWith(p)) return true;
    return false;
  }
  /* text, or null when the file is not there (os.path.exists is the caller's question) */
  read(path) {
    if (!this.files.has(path)) return null;
    const v = this.files.get(path);
    return typeof v === 'string' ? v : dec.decode(v);
  }
  readBytes(path) {
    if (!this.files.has(path)) return null;
    const v = this.files.get(path);
    return typeof v === 'string' ? enc.encode(v) : v;
  }
  write(path, data) {
    if (data == null) throw new Error('write: nothing to write to ' + path);
    this.files.set(path, data);
    this.dirty.set(path, data);
  }
  copy(from, to) { this.write(to, this.files.get(from)); }
  remove(path) {
    this.files.delete(path);
    this.dirty.set(path, null);
  }
  /* sorted(os.listdir(dir)): the names directly under a directory */
  list(dir) {
    const p = dir.endsWith('/') ? dir : dir + '/';
    const names = new Set();
    for (const k of this.files.keys()) {
      if (!k.startsWith(p)) continue;
      const rest = k.slice(p.length);
      const cut = rest.indexOf('/');
      names.add(cut < 0 ? rest : rest.slice(0, cut));
    }
    return [...names].sort(cmpStr);          // sorted() orders by code point
  }
  /* every path, sorted, for a backup or a comparison */
  paths() { return [...this.files.keys()].sort(cmpStr); }
  /* a scratch copy: what a write would leave, loaded before it lands (plate_config.try_rows) */
  clone() { return new Home(this.files, { clock: this.clock }); }
  /* what has been written since the last flush, and forget it */
  takeDirty() { const d = this.dirty; this.dirty = new Map(); return d; }
  /* the text files as an object, for the twin */
  textFiles() {
    const out = {};
    for (const k of this.paths()) {
      const v = this.files.get(k);
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }
}
