/* The seeds: what the build wrote into this home, and what it may write again.

   A home is seeded from the packaged defaults once. Before this module the seed was never
   overwritten, so an installed copy kept the catalog it was born with through every later
   build: his phone said Costco, Fresh · weekly and MiniOven a day after the shipped words
   became kinds, and a Start over kept them. Now a shipped file the person never changed
   catches up with the build; one they changed, whatever the change, is theirs and stays.

   Two ways to know a file is still a seed. config/seeds.json records the hash of every shipped
   file as this home's seed wrote it, so a file whose hash still matches is untouched. A home
   seeded by a build older than the record has none, and reads LINEAGE from defaults.js
   instead: the hash of every version that ever shipped (tools/lineage.py), so a file whose
   hash is any of them is a seed nobody touched. Both are the same rule from a different
   witness: the record is exact, the lineage is the memory of builds that had no record.

   A restore is the exception, deliberately: what a backup brings is the person's own. A backup
   from a device carries its record; one from the Mac carries none, and ownRestored() writes an
   empty record so nothing the backup brought is ever refreshed, whatever its bytes. His Mac's
   meals and cold options are byte for byte an older shipped version, kept so on purpose (his
   bowl keeps its protein, his steps keep his oven's words), and a restore must keep them too.
   The Mac's own seeding (labtrack/paths.py) stays seed-once for the same reason. */
import { sha256Hex } from './sha256.js';
import { readDicts, formatDicts } from './csv.js';

export const RECORD = 'config/seeds.json';
const enc = new TextEncoder();
const hash = (s) => sha256Hex(typeof s === 'string' ? enc.encode(s) : s);

/* the record, {} when it is unreadable, null when this home predates it */
export function readRecord(home) {
  if (!home.exists(RECORD)) return null;
  try { const r = JSON.parse(home.read(RECORD)); return r && typeof r === 'object' && !Array.isArray(r) ? r : {}; }
  catch (e) { return {}; }
}

/* seed what is missing, refresh what is still a seed, and record what this home's seeds are.
   Returns {seeded, refreshed}: the names written for the first time, and the names caught up
   with this build. The caller flushes; home.dirty says whether anything was written. */
export function syncSeeds(home, defaults, lineage, shipped, personal) {
  const rec = readRecord(home);
  const next = Object.assign({}, rec || {});
  const seeded = [], refreshed = [];
  for (const name of [...shipped, ...personal]) {
    if (!(name in defaults)) continue;
    const path = 'config/' + name + '.csv';
    const isShipped = shipped.includes(name);
    const now = hash(defaults[name]);
    if (!home.exists(path)) {
      home.write(path, defaults[name]);
      seeded.push(name);
      if (isShipped) next[name] = now;
      continue;
    }
    if (!isShipped) continue;                                    // a personal file is only ever seeded empty
    const have = hash(home.readBytes(path));
    if (have === now) { next[name] = now; continue; }            // the current seed, whichever build wrote it
    const known = lineage && Array.isArray(lineage[name]) ? lineage[name] : [];
    const untouched = rec ? rec[name] === have : known.includes(have);
    if (untouched) {
      home.write(path, defaults[name]);
      next[name] = now;
      refreshed.push(name);
    } else {
      delete next[name];                                         // the person's own: never recorded, never refreshed
    }
  }
  const text = JSON.stringify(next);
  if (rec === null || home.read(RECORD) !== text) home.write(RECORD, text);
  return { seeded, refreshed };
}

/* after a restore: a backup with no record of its own gets an empty one, so what it brought is
   the person's from here on */
export function ownRestored(home) {
  if (!home.exists(RECORD)) home.write(RECORD, '{}');
}

const STORE_ITEM_COLUMNS = ['store', 'item', 'pack', 'buy', 'note'];
const strip = (s) => (s == null ? '' : String(s).trim());
const keysOf = (text, col) => new Set(readDicts(text || '').rows.map(r => strip(r[col])).filter(Boolean));

/* The store rows a refreshed items.csv needs in a store file the person owns. A store row is
   the item's (its pack at a kind of store), so a new item's shipped rows are added at the stores
   the person's stores.csv has; a row the person has, for any item, is never touched. Returns
   the items given rows. */
export function storeRowsForNewItems(home, defaults) {
  const items = keysOf(home.read('config/items.csv'), 'key');
  const stores = keysOf(home.read('config/stores.csv'), 'key');
  const own = readDicts(home.read('config/store_items.csv') || '');
  const have = new Set(own.rows.map(r => strip(r.item)));
  const add = readDicts(defaults.store_items).rows.filter(r => items.has(strip(r.item)) && !have.has(strip(r.item)) && stores.has(strip(r.store)));
  if (!add.length) return [];
  const fieldnames = own.fieldnames.length ? [...own.fieldnames] : [...STORE_ITEM_COLUMNS];
  for (const c of STORE_ITEM_COLUMNS) if (!fieldnames.includes(c)) fieldnames.push(c);
  const clean = (r) => { const o = {}; for (const f of fieldnames) o[f] = strip(r[f]); return o; };
  home.write('config/store_items.csv', formatDicts(fieldnames, own.rows.concat(add).map(clean), { lineterminator: '\n' }));
  return [...new Set(add.map(r => strip(r.item)))];
}

/* The seeds as one catalog. syncSeeds judges each shipped file on its own, and the files name
   each other: a meal's cooking rows, an item's store rows, a rotation's meals. A home where one
   of a pair is the person's own was left with two files that disagree, and the loader refused
   the whole home: his phone refreshed items.csv (chuck roast and six more) and kept its own
   store_items.csv, and the app opened on "no store carries chuck_roast". Two things now. A new
   item gets its shipped store rows in a store file the person owns, at the stores they have.
   And after the sync the home is checked the way the page will load it (`check`); if it does
   not load, every refreshed file goes back to its bytes, the record with it, and the reason is
   kept in `kept`, so the app opens on the catalog it had rather than on an error, and a later
   build gets to try again. */
export function syncCatalog(home, defaults, lineage, shipped, personal, check) {
  const before = new Map();
  for (const name of shipped) {
    const p = 'config/' + name + '.csv';
    if (home.exists(p)) before.set(p, home.readBytes(p));
  }
  const recBefore = home.exists(RECORD) ? home.read(RECORD) : null;
  const r = syncSeeds(home, defaults, lineage, shipped, personal);
  r.added = [];
  r.kept = null;
  const current = (name) => home.exists('config/' + name + '.csv') && hash(home.readBytes('config/' + name + '.csv')) === hash(defaults[name]);
  if (current('items') && home.exists('config/store_items.csv') && !current('store_items')) r.added = storeRowsForNewItems(home, defaults);
  if (!r.refreshed.length && !r.added.length) return r;
  try {
    check(home);
  } catch (e) {
    for (const name of r.refreshed) {
      const p = 'config/' + name + '.csv';
      if (before.has(p)) home.write(p, before.get(p));
    }
    if (r.added.length) home.write('config/store_items.csv', before.get('config/store_items.csv'));
    if (recBefore == null) home.remove(RECORD); else home.write(RECORD, recBefore);
    r.kept = String(e && e.message || e);
    r.refreshed = [];
    r.added = [];
  }
  return r;
}
