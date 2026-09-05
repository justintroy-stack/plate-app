/* Personal health context (config/history.csv): diagnoses, imaging, therapies, and recurring
   non-lab monitoring. A twin of labtrack/history.py.

   The planner never derives clinical conclusions from these rows; it shows them next to the
   panels they affect and tracks due dates for monitoring rows that carry an interval. One line
   per fact keeps the friction low. */
import { formatDicts, formatRow, readRows } from './csv.js';
import { isDigit, lower, orEmpty, pyD, pyInt, strip } from './py.js';
import { addMonths } from './pydate.js';
import { pyDate, unpackInts3 } from './pyx.js';

export const COLUMNS = ['date', 'category', 'item', 'status', 'detail', 'affects', 'interval_months', 'last_done'];

/* HistoryItem.touches: the affects list matched case-insensitively, either way round. */
export function touches(item, name) {
  const n = lower(name);
  return item.affects.some(a => a && (a.toLowerCase() === n || n.includes(a.toLowerCase()) || a.toLowerCase().includes(n)));
}

/* [{date, category, item, status, detail, affects, interval_months, last_done}, ...] */
export function loadHistory(home) {
  const out = [];
  const text = home.read('config/history.csv');
  if (text == null) return out;
  for (const r of readRows(text)) {
    if (!strip(r.item)) continue;
    const iv = strip(r.interval_months);
    out.push({
      date: strip(r.date),
      category: lower(strip(orEmpty(r.category) || 'note')),      // diagnosis | imaging | therapy | monitoring | note
      item: r.item.trim(),
      status: lower(strip(orEmpty(r.status) || 'active')),        // active | superseded | resolved | confirm
      detail: strip(r.detail),
      affects: orEmpty(r.affects).split(',').join('|').split('|').map(a => a.trim()).filter(a => a),
      interval_months: isDigit(iv) ? pyInt(iv) : null,
      last_done: strip(r.last_done),                              // YYYY-MM-DD for monitoring rows
    });
  }
  return out;
}

/* Append one row, writing the header first when the file is new: DictWriter's '\r\n' records. */
export function appendHistory(home, row) {
  const p = 'config/history.csv';
  const isNew = !home.exists(p);
  const rec = {};
  for (const c of COLUMNS) rec[c] = row[c] === undefined ? '' : row[c];
  const text = isNew ? formatDicts(COLUMNS, [rec]) : formatRow(COLUMNS.map(c => rec[c]));
  home.write(p, (isNew ? '' : home.read(p)) + text);
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
