/* Personal health context (config/history.csv): diagnoses, imaging, therapies, and recurring
   non-lab monitoring. A twin of labtrack/history.py.

   The planner never derives clinical conclusions from these rows; it shows them next to the
   panels they affect and tracks due dates for monitoring rows that carry an interval. One line
   per fact keeps the friction low. */
import { formatDicts, formatRow, readRows } from './csv.js';
import { isDigit, lower, orEmpty, pyD, pyInt, strip } from './py.js';
import { addMonths } from './pydate.js';
import { pyDate, unpackInts3 } from './pyx.js';

export const COLUMNS = ['date', 'category', 'item', 'status', 'detail', 'affects', 'interval_months', 'last_done', 'condition', 'protein_limit_g'];
/* what a fact can be marked as, so the food rules can read it (history.py's CONDITIONS) */
export const CONDITIONS = ['celiac', 'gout', 'hypertension', 'diabetes', 'kidney'];

/* HistoryItem.touches: the affects list matched case-insensitively, either way round. */
export function touches(item, name) {
  const n = lower(name);
  return item.affects.some(a => a && (a.toLowerCase() === n || n.includes(a.toLowerCase()) || a.toLowerCase().includes(n)));
}

function itemOf(r) {
  return {
    date: strip(r.date),
    category: lower(strip(orEmpty(r.category) || 'note')),      // diagnosis | imaging | therapy | monitoring | note
    item: r.item.trim(),
    status: lower(strip(orEmpty(r.status) || 'active')),        // active | superseded | resolved | confirm
    detail: strip(r.detail),
    affects: orEmpty(r.affects).split(',').join('|').split('|').map(a => a.trim()).filter(a => a),
    interval_months: isDigit(strip(r.interval_months)) ? pyInt(strip(r.interval_months)) : null,
    last_done: strip(r.last_done),                              // YYYY-MM-DD for monitoring rows
    condition: lower(strip(orEmpty(r.condition))),              // one of CONDITIONS, or blank
    protein_limit_g: strip(r.protein_limit_g) ? parseFloat(strip(r.protein_limit_g)) : null,   // a kidney row only, Phase 14
  };
}

/* [{date, category, item, status, detail, affects, interval_months, last_done}, ...] */
export function loadHistory(home) {
  const out = [];
  const text = home.read('config/history.csv');
  if (text == null) return out;
  for (const r of readRows(text)) {
    if (!strip(r.item)) continue;
    out.push(itemOf(r));
  }
  return out;
}

/* Every row, in file order, blank-item rows dropped -- the same filter loadHistory uses, so a
   position from the page always lands on the same row here. */
function rawRows(home) {
  const text = home.read('config/history.csv');
  if (text == null) return [];
  return readRows(text).filter(r => strip(r.item));
}

/* Every row, rewritten whole with today's columns -- how a file from before a newer column grows
   it, on the first write after that column lands, whichever kind of write it is. */
function writeRows(home, rows) {
  const kept = rows.map(r => { const o = {}; for (const c of COLUMNS) o[c] = r[c] === undefined || r[c] === null ? '' : r[c]; return o; });
  home.write('config/history.csv', formatDicts(COLUMNS, kept));
}

/* One more fact, added after every row already on file. */
export function appendHistory(home, row) {
  const rows = rawRows(home);
  const rec = {};
  for (const c of COLUMNS) rec[c] = row[c] === undefined ? '' : row[c];
  rows.push(rec);
  writeRows(home, rows);
}

/* Change one fact in place, addressed by its position among loadHistory's own rows (today a row
   is edited, never split or reordered, so a position is a stable address). */
export function updateHistory(home, index, row) {
  const rows = rawRows(home);
  if (!(index >= 0 && index < rows.length)) throw new Error('no history row at position ' + index);
  const rec = {};
  for (const c of COLUMNS) rec[c] = row[c] === undefined ? '' : row[c];
  rows[index] = rec;
  writeRows(home, rows);
}

/* Take one fact off the file, by the same position updateHistory and the page use. */
export function removeHistory(home, index) {
  const rows = rawRows(home);
  if (!(index >= 0 && index < rows.length)) throw new Error('no history row at position ' + index);
  rows.splice(index, 1);
  writeRows(home, rows);
}

/* [due ISO date or null, text] for a monitoring row with an interval. */
export function monitoringDue(item, draw) {
  if (item.interval_months == null) return [null, ''];
  const every = pyD(item.interval_months);
  if (!item.last_done) return [null, 'every ' + every + ' months; last date unknown - add last_done in config/history.csv'];
  const [y, m, d] = unpackInts3(item.last_done);
  const due = addMonths(pyDate(y, m, d), item.interval_months);
  if (due <= draw) return [due, 'every ' + every + ' months; last ' + item.last_done + '; due ' + due + ' (overdue at this draw)'];
  return [due, 'every ' + every + ' months; last ' + item.last_done + '; next ' + due];
}
