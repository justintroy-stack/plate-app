/* Result store. A twin of labtrack/store.py, with the disk replaced by the home in memory.

   One row per (date drawn, printed name, panel). Every write keeps a timestamped copy in
   labs/backups first, because this is personal data with no undo anywhere else. */
import { readRows, formatDicts } from './csv.js';
import { pySorted, stampLocal, upper, strip, cmpStr } from './py.js';

export const STORE_PATH = 'labs/results.csv';
export const BACKUP_DIR = 'labs/backups';
export const COLUMNS = [
  'date_drawn', 'test_name', 'marker', 'value', 'value_num', 'unit', 'ref_range',
  'ref_low', 'ref_high', 'lab_flag', 'out_of_range', 'panel', 'lab',
  'specimen_id', 'source_file', 'ingested_at',
];

/* Identity of a stored row: same draw, same printed name, same panel. */
export function key(row) {
  return [row.date_drawn, upper(strip(row.test_name)), upper(strip(row.panel === undefined ? '' : row.panel))];
}
/* the same identity as one string, for a Map */
export function keyOf(row) { return JSON.stringify(key(row)); }

export class CsvStore {
  constructor(home, path = STORE_PATH) {
    this.home = home;
    this.path = path;
  }

  load() {
    const text = this.home.read(this.path);
    if (text == null) return [];
    const rows = readRows(text);
    for (const r of rows) {
      // setdefault: a column the file does not carry becomes '', one it carries stays as read
      for (const c of COLUMNS) if (!(c in r)) r[c] = '';
    }
    return rows;
  }

  /* Copy the current store aside before overwriting it, keeping the last `keep`. */
  backup(keep = 30) {
    if (!this.home.exists(this.path)) return null;
    const dest = BACKUP_DIR + '/results-' + stampLocal(this.home.now()) + '.csv';
    this.home.copy(this.path, dest);
    const old = this.home.list(BACKUP_DIR).filter(f => f.startsWith('results-') && f.endsWith('.csv')).sort(cmpStr);
    for (const f of old.slice(0, Math.max(0, old.length - keep))) this.home.remove(BACKUP_DIR + '/' + f);
    return dest;
  }

  /* Python sorts the caller's list in place and writes every column, missing ones as ''. */
  save(rows) {
    this.backup();
    const sorted = pySorted(rows, r => [r.date_drawn, r.panel, r.test_name]);
    rows.length = 0;
    for (const r of sorted) rows.push(r);
    this.home.write(this.path, formatDicts(COLUMNS, rows.map(r => {
      const o = {};
      for (const c of COLUMNS) o[c] = r[c] === undefined ? '' : r[c];
      return o;
    })));
  }
}
