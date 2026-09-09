/* Ingest: extract, parse, compare with the store, and only on request commit.

   A twin of labtrack/ingest.py. The one difference is where the text comes from: Python runs
   pdftotext over the PDF, the page hands pdf.js's text in (put back on the same character grid
   by pdftext.js), so `candidates` takes the text and the extractor's name instead of a path.
   Everything after that is the same code path, and the statuses are the same words:
   NEW, SAME, CONFLICT, DUP, SUPERSEDE. */
import { isoLocal, orEmpty, strip, upper, PyValueError } from './py.js';
import { PyKeyError } from './pyx.js';
import { isValidIso } from './pydate.js';
import { enrich } from './ranges.js';
import { key, keyOf } from './store.js';
import { detectLab, pickParser } from './parsers.js';
import { addAlias } from './markers.js';

// rows typed by hand, which a later report of the same draw may replace (SUPERSEDE)
export const MANUAL_LABS = ['Manual sheet', 'Manual entry'];
export const MANUAL_LAB = 'Manual entry';
const NAME_MAX = 80;

/* the preview of a report with no text layer: nothing read, and said so */
export function scannedInfo(file, date) {
  return { file, method: 'no text layer', parser: 'none', verified: false, lab: 'Unknown',
           date, specimen: '', unparsed: [], ignored: [], scanned: true };
}

/* Parse one report into candidate store rows plus an info dict. Raises ValueError when no draw
   date can be found. `file` is the path the row records (labs/raw/...), `method` names the
   extractor that produced the text; `scanned` says the text layer was empty, which gives no
   rows and an info that says so rather than an error. */
export function candidates(home, { file, text, method, registry, date, scanned }) {
  if (scanned) return [[], scannedInfo(file, date || null)];
  // a failure here names its own stage rather than handing back a bare native error with
  // nothing to go on (his report, 2026-09-09, a crash the preview could only show as
  // "undefined is not a function")
  let lab, parser, verified, report;
  try {
    lab = detectLab(text);
    [parser, verified] = pickParser(text);
    report = parser.parse(text);
  } catch (e) {
    throw new Error("Reading the report's rows failed: " + (e && e.message || e));
  }
  const drawn = date || report.date_drawn;
  if (!drawn) throw new PyValueError('Could not find a collection date in the report; supply the drawn date (YYYY-MM-DD).');
  const now = isoLocal(home.now());
  const rows = [], ignored = [];
  try {
    for (const r of report.results) {
      if (registry.ignored(r.test_name)) {
        ignored.push(r.test_name + ' = ' + r.value);
        continue;
      }
      rows.push({ date_drawn: drawn, test_name: r.test_name, marker: registry.resolve(r.test_name),
                  value: r.value, unit: r.unit, ref_range: r.ref_range, lab_flag: r.lab_flag,
                  panel: r.panel, lab, specimen_id: report.specimen_id,
                  source_file: file, ingested_at: now });
    }
  } catch (e) {
    throw new Error("Reading the report's rows failed: " + (e && e.message || e));
  }
  const info = { file, method, parser: parser.name, verified, lab,
                 date: drawn, specimen: report.specimen_id, unparsed: report.unparsed, ignored, scanned: false };
  return [rows, info];
}

/* Candidate store rows from rows a person typed, or corrected on the preview. A twin of
   ingest.row_candidates: each row has test_name and value, and optionally unit, ref_range,
   lab_flag, panel and the marker chosen for it; `base` is the report's own info when the rows
   came from a report's preview. A blank line is skipped, a half-filled one refused by number. */
export function rowCandidates(home, { rows, registry, date, lab, base }) {
  if (!isValidIso(date)) throw new PyValueError('Give the draw date as YYYY-MM-DD.');
  const now = isoLocal(home.now());
  const out = [], ignored = [];
  let n = 0;
  for (const r0 of rows || []) {
    n += 1;
    const r = r0 || {};
    const name = strip(r.test_name).replace(/\s+/g, ' ');
    const value = strip(r.value);
    if (!name && !value) continue;
    if (!name || !value) throw new PyValueError('Line ' + n + ' needs both a test name and a value.');
    if (name.length > NAME_MAX) throw new PyValueError('Line ' + n + ': the test name is too long.');
    const marker = strip(r.marker);
    if (marker && !Object.prototype.hasOwnProperty.call(registry.markers, marker)) throw new PyValueError('Line ' + n + ": no marker called '" + marker + "'.");
    if (registry.ignored(name)) {
      ignored.push(name + ' = ' + value);
      continue;
    }
    out.push({ date_drawn: date, test_name: name, marker: marker || registry.resolve(name),
               value, unit: strip(r.unit), ref_range: strip(r.ref_range), lab_flag: strip(r.lab_flag),
               panel: strip(r.panel).replace(/\s+/g, ' '), lab, specimen_id: base ? base.specimen : '',
               source_file: base ? base.file : '', ingested_at: now });
  }
  const info = base ? Object.assign({}, base)
    : { file: '', method: 'typed in the app', parser: 'typed', verified: true, specimen: '', unparsed: [], scanned: false };
  Object.assign(info, { date, lab, ignored, edited: true });
  return [out, info];
}

/* [printed name, marker] for every row whose marker was chosen by hand rather than by the alias
   file, once per printed name */
export function chosenAliases(cands, registry) {
  const out = [], seen = new Set();
  for (const row of cands) {
    const k = upper(strip(row.test_name));
    if (row.marker && registry.resolve(row.test_name) !== row.marker && !seen.has(k)) {
      seen.add(k);
      out.push([row.test_name, row.marker]);
    }
  }
  return out;
}

/* The preview both hosts show, and the commit both make. A twin of ingest.review: the
   candidates classified against the store; on commit the aliases chosen by hand are written
   first, then the rows. */
export function review(home, store, registry, cands, info, { supersede = false, replace = false, commit = false } = {}) {
  try {
    const existing = store.load();
    const statuses = classify(cands, existing, !!supersede);
    let result = null;
    if (commit) {
      const aliases = chosenAliases(cands, registry);
      for (const [name, marker] of aliases) addAlias(home, name, marker, 'app', 'chosen on the preview');
      result = apply(cands, statuses, store, existing, !!replace);
      result.aliases = aliases.length;
    }
    const rows = cands.map((r, i) => Object.assign({}, r, { status: statuses[i] }));
    return { info, rows, counts: countsOf(statuses), unmapped: unmappedNames(cands, registry), result, markers: catalog(registry) };
  } catch (e) {
    throw new Error("Comparing it to what's on file failed: " + (e && e.message || e));
  }
}

/* every marker the registry knows, for the preview's picker: [id, display name, category] */
export function catalog(registry) {
  return Object.entries(registry.markers).map(([mid, m]) => [mid, m.display_name || mid, m.category]);
}

/* Decide a status per candidate against the existing store rows (enriches the candidates). */
export function classify(cands, existing, supersede = false) {
  const byKey = new Map();
  for (const r of existing) byKey.set(keyOf(r), r);
  const byMarker = new Map();
  for (const r of existing) if (r.marker) byMarker.set(JSON.stringify([r.date_drawn, r.marker]), r);
  const statuses = [];
  for (const row of cands) {
    enrich(row);
    const old = byKey.get(keyOf(row));
    let st;
    if (old === undefined) {
      const other = row.marker ? byMarker.get(JSON.stringify([row.date_drawn, row.marker])) : undefined;
      if (other !== undefined) {
        if (supersede && MANUAL_LABS.includes(other.lab)) st = "SUPERSEDE (replaces sheet row '" + other.test_name + "' = " + other.value + ')';
        else st = "DUP (marker already stored that day as '" + other.test_name + "' = " + other.value + ')';
      } else st = 'NEW';
    } else if (old.value === row.value && old.unit === row.unit && old.ref_range === row.ref_range) {
      st = 'SAME';
    } else if (supersede && MANUAL_LABS.includes(old.lab)) {
      st = "SUPERSEDE (replaces sheet row '" + old.test_name + "' = " + old.value + ')';
    } else {
      st = 'CONFLICT (stored ' + old.value + ' ' + old.unit + ', range ' + old.ref_range + ')';
    }
    statuses.push(st);
  }
  return statuses;
}

export function countsOf(statuses) {
  const c = { NEW: 0, SAME: 0, CONFLICT: 0, DUP: 0, SUPERSEDE: 0 };
  for (const st of statuses) {
    const word = String(st).split(' ')[0];
    if (!(word in c)) throw new PyKeyError(JSON.stringify(word));
    c[word] += 1;
  }
  return c;
}

/* Write NEW rows (and SUPERSEDE rows; CONFLICT rows only with replace). Returns counts. */
export function apply(cands, statuses, store, existing, replace = false) {
  const idx = new Map();
  existing.forEach((r, i) => idx.set(keyOf(r), i));
  const midx = new Map();
  existing.forEach((r, i) => { if (r.marker) midx.set(JSON.stringify([r.date_drawn, r.marker]), i); });
  let written = 0, replaced = 0, superseded = 0;
  const drop = new Set();
  for (let n = 0; n < cands.length; n++) {
    const row = cands[n], st = statuses[n];
    if (st === undefined) break;                       // zip() stops at the shorter list
    if (st === 'NEW') {
      existing.push(row);
      written += 1;
    } else if (st.startsWith('SUPERSEDE')) {
      const k = keyOf(row), mk = JSON.stringify([row.date_drawn, row.marker]);
      if (idx.has(k)) drop.add(idx.get(k));
      else if (midx.has(mk)) drop.add(midx.get(mk));
      else throw new PyKeyError(mk);
      existing.push(row);
      superseded += 1;
    } else if (st.startsWith('CONFLICT') && replace) {
      const k = keyOf(row);
      if (!idx.has(k)) throw new PyKeyError(k);
      existing[idx.get(k)] = row;
      replaced += 1;
    }
  }
  const kept = existing.filter((r, i) => !drop.has(i));
  store.save(kept);
  return { written, replaced, superseded };
}

export function unmappedNames(cands, registry) {
  const out = {};
  for (const row of cands) {
    if (!row.marker && !(row.test_name in out)) out[row.test_name] = registry.suggest(row.test_name);
  }
  return out;
}
