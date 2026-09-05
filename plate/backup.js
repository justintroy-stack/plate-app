/* The backup file: one file that holds the whole home, format `plate-backup 1`.

       plate-backup 1 <index length in bytes>\n
       <index: compact JSON {"format","version","files":[{"path","size","sha256"},...]}>
       <the bytes of every file, in index order, back to back>

   spike/backup.py writes the same bytes from a folder on disk, and the spike proved the two
   identical by hash. That holds because nothing in here depends on the clock or on the
   machine: the files are sorted the way Python's sorted() sorts strings, by code point, the
   index is JSON with no spaces and non-ASCII left as it is, and every file is hashed. Reading
   checks every size and every hash before a single file is handed back, so a restore either
   lands whole or not at all. Pure: runs in the page and in node. */
import { sha256Hex } from './sha256.js';

export const FORMAT = 'plate-backup';
export const VERSION = 1;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

/* Python's sorted() on str compares code points; JavaScript's default sort compares UTF-16
   code units, which puts a character above the basic plane before some characters inside it. */
function byCodePoint(a, b) {
  const ai = a[Symbol.iterator](), bi = b[Symbol.iterator]();
  for (;;) {
    const x = ai.next(), y = bi.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0), cy = y.value.codePointAt(0);
    if (cx !== cy) return cx - cy;
  }
}

const asBytes = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));

/* files: [{path, bytes}] in any order → the container */
export function buildBackup(files) {
  const entries = files.map(f => ({ path: f.path, bytes: asBytes(f.bytes) })).sort((x, y) => byCodePoint(x.path, y.path));
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].path === entries[i - 1].path) throw new Error('buildBackup: the same path twice: ' + entries[i].path);
  }
  const index = { format: FORMAT, version: VERSION,
                  files: entries.map(e => ({ path: e.path, size: e.bytes.length, sha256: sha256Hex(e.bytes) })) };
  const indexBytes = enc.encode(JSON.stringify(index));
  const header = enc.encode(FORMAT + ' ' + VERSION + ' ' + indexBytes.length + '\n');
  const parts = [header, indexBytes, ...entries.map(e => e.bytes)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/* the container → {index, files: [{path, size, sha256, bytes}]}; throws, in plain words, on
   anything that is not a whole, undamaged backup */
export function readBackup(bytes) {
  const buf = asBytes(bytes);
  const total = buf.length;
  const nl = buf.subarray(0, 64).indexOf(10);
  const head = nl < 0 ? null : /^plate-backup (\d+) (\d+)$/.exec(String.fromCharCode(...buf.subarray(0, nl)));
  if (!head) throw new Error('This is not a Plateside backup file.');
  if (head[1] !== String(VERSION)) {
    throw new Error('This backup is in a format this version of Plateside cannot read (plate-backup ' + head[1] + ').');
  }
  const start = nl + 1, end = start + Number(head[2]);
  if (end > total) throw new Error('This backup file is incomplete: it ends inside its own index.');
  let index;
  try { index = JSON.parse(dec.decode(buf.subarray(start, end))); }
  catch (e) { throw new Error('This backup file is damaged: its index cannot be read.'); }
  if (!index || index.format !== FORMAT || index.version !== VERSION || !Array.isArray(index.files)) {
    throw new Error('This backup file is damaged: its index is not a Plateside index.');
  }
  const files = [];
  let off = end;
  for (const f of index.files) {
    if (typeof f.path !== 'string' || !Number.isInteger(f.size) || f.size < 0 || typeof f.sha256 !== 'string') {
      throw new Error('This backup file is damaged: its index lists a file badly.');
    }
    if (off + f.size > total) {
      throw new Error('This backup file is incomplete: it should hold at least ' + (off + f.size) + ' bytes and holds ' + total + '.');
    }
    const data = buf.slice(off, off + f.size);        // its own buffer, so a store keeps this file and nothing beside it
    off += f.size;
    if (sha256Hex(data) !== f.sha256) throw new Error('This backup file is damaged: ' + f.path + ' does not match its checksum.');
    files.push({ path: f.path, size: f.size, sha256: f.sha256, bytes: data });
  }
  if (off !== total) throw new Error('This backup file has ' + (total - off) + ' extra bytes after its last file.');
  return { index, files };
}

/* the whole home as one container */
export function backupFromHome(home) {
  /* the same leavings as web.backup_files: the spike's output, the golden values, a home
     nested inside this one, dotfiles, logs and earlier backups of this kind */
  const skip = p => p.startsWith('labs/spike/') || p.startsWith('labs/golden/') || /^labs\/[^/]+\/(config|labs)\//.test(p)
    || p.split('/').some(s => s.startsWith('.')) || /\.(log|plate|tmp)$/i.test(p);
  return buildBackup(home.paths().filter(p => !skip(p)).map(path => ({ path, bytes: home.readBytes(path) })));
}

/* every file of the container written into the home, bytes as Uint8Array; returns the paths
   written. The caller decides whether to empty the home first. Nothing is written unless the
   whole container checks out. */
export function restoreIntoHome(home, bytes) {
  const { files } = readBackup(bytes);
  for (const f of files) home.write(f.path, f.bytes);
  return files.map(f => f.path);
}
