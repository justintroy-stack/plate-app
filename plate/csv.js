/* CSV exactly as Python's csv module reads and writes it.

   Every config row and every stored result is a CSV cell, and a backup written on the device
   must read back on the Mac (and the other way) byte for byte. So this is the default dialect
   of Python's csv module and nothing else: a comma, a double quote doubled inside a quoted
   field, a field quoted only when it holds a comma, a quote or a line break, a record made of
   one empty field written as "", and '\r\n' between records unless a writer asks for '\n'. */

/* csv.reader: rows as arrays. A blank line is an empty row, which DictReader skips. */
export function parseRows(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQuotes = false, started = false;
  const n = text.length;
  const endField = () => { row.push(field); field = ''; started = false; };
  const endRow = () => { rows.push(row); row = []; };
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') {
      if (field === '' && !started) { inQuotes = true; started = true; i++; continue; }
      field += c; i++; continue;                       // strict=False: a quote mid-field is a character
    }
    if (c === ',') { endField(); i++; continue; }
    if (c === '\r' || c === '\n') {
      if (row.length === 0 && field === '' && !started) rows.push([]);
      else { endField(); endRow(); }
      if (c === '\r' && text[i + 1] === '\n') i++;
      i++; continue;
    }
    field += c; started = true; i++;
  }
  if (field !== '' || started || row.length) { endField(); endRow(); }
  return rows;
}

/* list(csv.DictReader(f)): the first row names the columns; a short row is filled with null,
   a long row loses its extras. */
export function readDicts(text) {
  const rows = parseRows(text);
  if (!rows.length) return { fieldnames: [], rows: [] };
  let k = 0;
  const fieldnames = rows[k++];
  const out = [];
  for (; k < rows.length; k++) {
    const r = rows[k];
    if (r.length === 0) continue;
    const d = {};
    fieldnames.forEach((f, j) => { d[f] = j < r.length ? r[j] : null; });
    out.push(d);
  }
  return { fieldnames, rows: out };
}
export function readRows(text) { return readDicts(text).rows; }
/* DictReader.fieldnames, or null for an empty file */
export function fieldnamesOf(text) { const rows = parseRows(text); return rows.length ? rows[0] : null; }

function cell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return String(v);
}
function quoteField(s, lineterminator) {
  let needs = false;
  for (const ch of s) {
    if (ch === ',' || ch === '"' || lineterminator.indexOf(ch) >= 0) { needs = true; break; }
  }
  if (!needs) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}
/* csv.writer(f).writerow(list) */
export function formatRow(values, opts = {}) {
  const lt = opts.lineterminator == null ? '\r\n' : opts.lineterminator;
  const cells = values.map(v => quoteField(cell(v), lt));
  let rec = cells.join(',');
  if (values.length === 1 && rec === '') rec = '""';
  return rec + lt;
}
/* csv.writer(f).writerows(list of lists) */
export function formatRows(rows, opts = {}) { return rows.map(r => formatRow(r, opts)).join(''); }
/* DictWriter(f, fieldnames).writeheader() + writerows(dicts). A key outside fieldnames is a
   ValueError in Python; here it is ignored, because every caller builds its dict from
   fieldnames first. A missing key is ''. */
export function formatDicts(fieldnames, rows, opts = {}) {
  let out = formatRow(fieldnames, opts);
  for (const r of rows) out += formatRow(fieldnames.map(f => (r && r[f] !== undefined ? r[f] : '')), opts);
  return out;
}
