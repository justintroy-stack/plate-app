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
