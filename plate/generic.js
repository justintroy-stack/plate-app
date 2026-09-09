/* Any lab's report, read by the shape of its cells rather than by a layout it knows.

   A line-for-line twin of labtrack/parsers/generic.py, and held to it by tests/test_twin_b.py
   on the invented reports and on every real one: the same text in, the same rows out. The
   Python file carries the reasoning; this one carries the same rules in the same order. Word
   lists are compared after uppercasing, regular expressions are used only for shapes, and no
   inline flag or Unicode-aware string method is relied on, because those are where the two
   languages part. */
import { matchStart, search, upper } from './py.js';
import { RANGE_TOKEN_RE, splitRangeUnit } from './ranges.js';

// a cell: words one space apart; two or more spaces end it
const CELL_RE = /\S+(?:\s\S+)*/g;
// a number as a lab prints one, with an optional < or > (and = or OR =) in front
const NUM_RE = /^(?<value>(?:[<>]\s?(?:OR\s?)?=?\s?)?\d[\d,]*(?:\.\d+)?)(?<rest>.*)$/;
// a unit: a percent sign, or something with a slash and a letter in it; the bare words are listed
const UNIT_RE = /^(?:%|(?=.*[A-Za-z%µμ])[A-Za-z0-9.^*µμ\-]+(?:\/[A-Za-z0-9.^*µμ\-]+)+)$/;
const UNIT_WORDS = ['%', 'FL', 'PG', 'RATIO', 'INDEX', 'SEC', 'SECONDS', 'MIN', 'MMHG', 'KPA', 'MM', 'G', 'MG', 'NG', 'IU', 'U',
                    'MIU', 'MEQ', 'MMOL', 'UMOL', 'NMOL', 'PMOL', 'SCORE', 'UNITS', 'TITER', 'K', 'M', 'ML', 'DL', 'L',
                    'CALC', '(CALC)', 'ANGSTROM', 'NM'];
const QUAL_WORDS = ['NEGATIVE', 'POSITIVE', 'NOT DETECTED', 'DETECTED', 'NORMAL', 'ABNORMAL', 'REACTIVE', 'NON-REACTIVE',
                    'NONREACTIVE', 'PRESENT', 'ABSENT', 'A', 'B'];
const FLAG_WORDS = ['HH', 'LL', 'H', 'L', 'HI', 'LO', 'HIGH', 'LOW', 'ABNORMAL', 'ABN', 'CRITICAL', 'CRIT', 'A', 'C', '*', '**', '!'];
const TEXT_RANGE_WORDS = ['NOT ESTAB.', 'NOT ESTAB', 'NOT ESTABLISHED', 'NOT APPLICABLE', 'N/A', 'NA', 'NONE', 'NONE DETECTED',
                          'NONE SEEN', 'SEE BELOW', 'SEE NOTE', 'SEE COMMENT', 'COMMENT', 'NOT DETECTED', 'NEGATIVE', 'NORMAL',
                          'NON-REACTIVE', 'NONREACTIVE', 'ABSENT'];
// what a column header calls each column
const HEADER_ROLES = {
  'TEST': 'name', 'TESTS': 'name', 'TEST NAME': 'name', 'TEST DESCRIPTION': 'name', 'ANALYTE': 'name',
  'COMPONENT': 'name', 'COMPONENTS': 'name', 'NAME': 'name', 'DESCRIPTION': 'name', 'EXAMINATION': 'name', 'PARAMETER': 'name',
  'RESULT': 'value', 'RESULTS': 'value', 'VALUE': 'value', 'VALUES': 'value', 'YOUR VALUE': 'value', 'YOUR RESULT': 'value',
  'CURRENT': 'value', 'CURRENT RESULT': 'value', 'OBSERVED VALUE': 'value', 'IN RANGE': 'value', 'OUT OF RANGE': 'value',
  'UNIT': 'unit', 'UNITS': 'unit',
  'REFERENCE': 'range', 'REFERENCE RANGE': 'range', 'REFERENCE RANGES': 'range', 'REFERENCE INTERVAL': 'range',
  'REFERENCE VALUES': 'range', 'REF RANGE': 'range', 'REF. RANGE': 'range', 'REF': 'range', 'NORMAL RANGE': 'range',
  'NORMAL VALUES': 'range', 'STANDARD RANGE': 'range', 'EXPECTED RANGE': 'range', 'RANGE': 'range', 'INTERVAL': 'range',
  'FLAG': 'flag', 'FLAGS': 'flag', 'ABNORMAL': 'flag', 'ABN': 'flag', 'STATUS': 'flag', 'H/L': 'flag',
  'LAB': 'other', 'PREVIOUS': 'other', 'PRIOR': 'other', 'PRIOR RESULT': 'other', 'DATE': 'other', 'NOTES': 'other',
  'NOTE': 'other', 'COMMENT': 'other', 'COMMENTS': 'other', 'SITE': 'other', 'PERFORMED AT': 'other', 'PERFORMING LAB': 'other',
};
const hasRole = (key) => Object.prototype.hasOwnProperty.call(HEADER_ROLES, key);
// a line whose name starts with one of these is a field of the report, never a result
const STOP_WORDS = ['PAGE', 'PHONE', 'FAX', 'TEL', 'DOB', 'AGE', 'PATIENT', 'MRN', 'NPI', 'ACCOUNT', 'ACCT',
                    'ACCESSION', 'SPECIMEN', 'ORDER', 'ORDERING', 'ORDERED', 'REQUISITION', 'CLIENT', 'PHYSICIAN', 'PROVIDER',
                    'DR', 'MD', 'REPORT', 'REPORTED', 'RECEIVED', 'COLLECTED', 'COLLECTION', 'PRINTED', 'ISSUED', 'DATE',
                    'TIME', 'FASTING', 'ROOM', 'BED', 'VISIT', 'ENCOUNTER', 'CPT', 'ID', 'LAB', 'LABS', 'DIRECTOR', 'DIR',
                    'ADDRESS', 'ZIP', 'CONTINUED', 'CONT', 'PERFORMING', 'RESULTED', 'FINAL', 'CORRECTED'];
// the label a lab puts in front of one of several ranges ('Optimal <1.0', 'ADULT MALE: 264-916')
const RANGE_LABELS = ['OPTIMAL', 'NEAR OPTIMAL', 'BORDERLINE', 'BORDERLINE HIGH', 'DESIRABLE', 'MODERATE', 'INTERMEDIATE',
                      'VERY HIGH', 'HIGH RISK', 'LOW RISK', 'MODERATE RISK', 'AVERAGE RISK', 'HIGHER RISK', 'LOWER RISK', 'GOAL',
                      'TARGET', 'ADULT', 'ADULT MALE', 'ADULT FEMALE', 'ADULTS', 'MALE', 'FEMALE', 'MEN', 'WOMEN', 'CHILDREN'];
// a word a title may leave in lower case
const SMALL_WORDS = ['AND', 'OF', 'WITH', 'THE', 'FOR', 'IN', 'ON', 'AT', 'BY', 'TO', 'A', 'AN', 'OR', '&', 'W/', 'PER'];
const FOOTER_RE = /\b\d+\s*\/\s*\d+\b.*\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/;
const PAGE_RE = /\bPage\s+\d+\s+(?:of|\/)\s+\d+\b/;
const DATE_IN_RE = /\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}-[A-Za-z]{3}-\d{2,4}|\b\d{1,2}:\d{2}\b/;
export const LETTER_RE = /[A-Za-z]/g;
const TITLE_START_RE = /^[A-Z(\[]/;
const UPPER_START_RE = /^[A-Z0-9(\[]/;
const CAMEL_RE = /[a-z][A-Z]/;
const DIGIT_END_RE = /\d$/;
const RANGE_LABEL_RE = /^(?:Reference\s+[Rr]anges?|Ref\.?\s+[Rr]ange|Normal\s+[Rr]ange|Range)\s*:?\s*(?<r>.*)$/;
// the dates a lab prints, and the words that announce the draw
const DATE = '(\\d{1,2}/\\d{1,2}/\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}-[A-Za-z]{3}-\\d{4}|[A-Za-z]{3,9}\\.? \\d{1,2}, \\d{4}'
  + '|\\d{1,2} [A-Za-z]{3,9} \\d{4}|\\d{1,2}/\\d{1,2}/\\d{2})';
const DATE_PATTERNS = [
  '(?:Date\\s+)?Collected(?:\\s+Date)?(?:\\s*/\\s*Time)?\\s*(?:on|:)?',
  'Collection\\s+Date(?:\\s*/\\s*Time)?\\s*:?',
  'Specimen\\s+[Cc]ollected(?:\\s+[Oo]n)?\\s*:?',
  '(?:Date\\s+)?Drawn(?:\\s+[Oo]n)?\\s*:?',
  'Date\\s+of\\s+(?:Service|Collection)\\s*:?',
  'Sample\\s+(?:[Dd]ate|[Tt]aken)\\s*:?',
].map(p => new RegExp(p + '\\s*' + DATE, 'g'));
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const SPECIMEN_RE = /(?:Specimen(?:\s+ID)?\s*[:#]|Accession(?:\s+(?:#|No\.?|Number))?\s*[:#]?|Lab\s+No\.?\s*:?|Requisition(?:\s+#)?\s*:?)\s*([A-Za-z0-9][A-Za-z0-9\-]{2,})/;

/* [[column, text]] for one line: a cell is words one space apart */
export function cellsOf(line) {
  const out = [];
  for (const m of String(line).matchAll(CELL_RE)) out.push([m.index, m[0]]);
  return out;
}

export function squash(s) { return String(s).trim().replace(/\s+/g, ' '); }

export function norm(s) { return upper(squash(s)); }

export function isUnit(s) {
  s = String(s).trim();
  return !!s && (UNIT_WORDS.includes(norm(s)) || !!matchStart(UNIT_RE, s));
}

/* a cell whose first word is a unit is a unit with a note after it: 'mg/dL (calc)' */
export function isUnitCell(s) {
  s = String(s).trim();
  return !!s && isUnit(s.split(' ')[0]);
}

/* a portal export often parenthesizes the flag, "(H)" or "(High)" -- read the word inside;
   kept as printed, parens and all, once it is recognized (his report, 2026-09-09: a row with
   one dropped silently, never even shown for a check) */
export function isFlag(s) {
  s = String(s).trim();
  if (s.slice(0, 1) === '(' && s.slice(-1) === ')') s = s.slice(1, -1);
  return FLAG_WORDS.includes(norm(s));
}

/* [value, flag, unit] when the cell starts with a value, else null. '412 H' is a value and its
   flag; '95 mg/dL' a value and its unit; '< 30' a censored value. */
export function valueOf(cell) {
  cell = String(cell).trim();
  const m = matchStart(NUM_RE, cell);
  let value, rest;
  if (m) {
    value = '<>'.includes(m.groups.value[0]) ? m.groups.value.replace(/\s+/g, '') : m.groups.value;
    rest = m.groups.rest.trim();
  } else {
    const up = norm(cell);
    let hit = '';
    for (const w of QUAL_WORDS) {
      if ((up === w || up.startsWith(w + ' ')) && w.length > hit.length) hit = w;
    }
    if (!hit) return null;
    value = cell.slice(0, hit.length);
    rest = cell.slice(hit.length).trim();
  }
  let flag = '', unit = '';
  let words = rest ? rest.split(' ') : [];
  if (words.length && isFlag(words[0])) {
    flag = words[0];
    words = words.slice(1);
  }
  if (words.length && isUnit(words[0])) {
    unit = words.join(' ');
    words = [];
  }
  if (words.length) return null;             // a value followed by words is a sentence, not a result
  return [value, flag, unit];
}

export function isRange(s) {
  s = String(s).trim();
  return !!search(RANGE_TOKEN_RE, s) || TEXT_RANGE_WORDS.includes(norm(s));
}

/* [range, unit] from a cell that is a range: '70 - 99 mg/dL' -> ['70-99', 'mg/dL']; two ranges on
   one line (by time of day) and a text range stay as printed, with no unit, so no flag is computed
   from them. */
export function rangeOf(s) {
  s = squash(String(s).replace(/≤/g, '<=').replace(/≥/g, '>='));
  const toks = [];
  for (const m of s.matchAll(new RegExp(RANGE_TOKEN_RE.source, 'gi'))) toks.push(m.index);
  if (toks.length !== 1) return [s, ''];
  const [rng, rest] = splitRangeUnit(s.slice(toks[0]));
  return [rng, isUnitCell(rest) ? rest : ''];
}

/* {role: [columns]} when the line names its columns, else null */
export function headerOf(cells) {
  if (cells.length < 2) return null;
  const roles = {};
  let unknown = 0;
  for (const [col, text] of cells) {
    const key = norm(text).replace(/:+$/, '');
    if (!hasRole(key)) unknown += 1;
    else {
      const role = HEADER_ROLES[key];
      if (!(role in roles)) roles[role] = [];
      roles[role].push(col);
    }
  }
  if (unknown > 1 || (!('name' in roles) && !('value' in roles)) || Object.keys(roles).length < 2) return null;
  return roles;
}

/* a field of the report, such as 'Patient' or 'Page', never a result */
export function looksLikeField(name) {
  const words = norm(name).split(' ');
  return STOP_WORDS.includes(words[0].replace(/[:#.]+$/, ''));
}

export function isName(s) {
  s = squash(s);
  if (!s || s.includes(':') || s.length > 64 || s.split(' ').length > 7) return false;
  if ((s.match(LETTER_RE) || []).length < 2 || s.endsWith('.')) return false;
  if (looksLikeField(s) || hasRole(norm(s)) || RANGE_LABELS.includes(norm(s))) return false;
  return !valueOf(s) && !isRange(s) && !isUnit(s) && !isFlag(s);
}

/* set as a title: starts with a capital, and every word starts with a capital, a digit or a
   bracket, except the small words a title leaves in lower case; a lone long word run together in
   camel case is the tail of a wrapped web address, and a lone word ending in a digit is a code */
export function isTitle(s) {
  if (!matchStart(TITLE_START_RE, s)) return false;
  const words = s.split(' ');
  if (words.length === 1 && (search(DIGIT_END_RE, s) || (s.length > 12 && search(CAMEL_RE, s)))) return false;
  for (const w of words) {
    if (!matchStart(UPPER_START_RE, w) && !SMALL_WORDS.includes(upper(w))) return false;
  }
  return true;
}

/* one cell, a title, no value, no field, no date: the panel the results under it belong to */
export function isHeading(cells) {
  if (cells.length !== 1) return false;
  const s = squash(cells[0][1]);
  if (s.length < 2 || s.length > 70 || search(DATE_IN_RE, s)) return false;
  return isName(s) && isTitle(s);
}

/* the index of the cell that is the result's value, or -1 */
export function pickValue(cells, header) {
  let best = -1, bestKey = null;
  for (let i = 1; i < cells.length; i++) {
    const v = valueOf(cells[i][1]);
    if (v === null) continue;
    let key;
    if (header && header.value && header.value.length) key = [Math.min(...header.value.map(c => Math.abs(cells[i][0] - c))), i];
    else key = [isRange(cells[i][1]) ? 1 : 0, i];
    if (bestKey === null || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
      best = i;
      bestKey = key;
    }
  }
  return best;
}

/* [range, unit] from 'Reference Range: 65-99 mg/dL' or 'Reference Range: A Pattern' (the text
   kept verbatim when there is no number in it), else null */
export function labelledRange(text) {
  const m = matchStart(RANGE_LABEL_RE, squash(text));
  if (!m || !m.groups.r.trim()) return null;
  const cand = m.groups.r.trim();
  return search(RANGE_TOKEN_RE, cand) ? rangeOf(cand) : [cand, ''];
}

/* one result from one line's cells, or null */
export function readLine(cells, header) {
  const vi = pickValue(cells, header);
  if (vi < 1) return null;
  let [value, flag, unit] = valueOf(cells[vi][1]);
  const names = [];
  let rng = '';
  for (let i = 0; i < vi; i++) {
    const text = cells[i][1];
    if (i === 0) names.push(text);
    else if (isRange(text) && !rng) {
      const [r, u] = rangeOf(text);
      rng = r;
      if (u && !unit) unit = u;
    } else if (isUnitCell(text) || isFlag(text) || valueOf(text) || isRange(text)) continue;
    else names.push(text);
  }
  const name = squash(names.join(' '));
  if (!isName(name)) return null;
  for (let i = vi + 1; i < cells.length; i++) {
    const text = cells[i][1];
    const lr = labelledRange(text);
    if (!flag && isFlag(text)) flag = text.trim();
    else if (!unit && isUnitCell(text)) unit = squash(text);
    else if (!rng && (lr || isRange(text))) {
      const [r, u] = lr || rangeOf(text);
      rng = r;
      if (u && !unit) unit = u;
    }
  }
  return { name, value, flag, unit, range: rng };
}

function nextNonblank(lines, j) {
  while (j < lines.length && !lines[j].trim()) j += 1;
  return j;
}

/* the range printed under a result: 'Reference Range: <100' on the next line, or 'Reference
   Range' and then the range on the line after ('Optimal <1.0', 'ADULT MALE: 264-916'), or several
   ranges on consecutive lines kept verbatim. [range, unit] */
export function rangeOnNextLine(lines, i, header) {
  let j = nextNonblank(lines, i + 1);
  if (j >= lines.length) return ['', ''];
  const cells = cellsOf(lines[j]);
  const m = matchStart(RANGE_LABEL_RE, squash(lines[j]));
  if (!m) {
    // a bare range on a line of its own ('65-99 mg/dL'), never a result of its own
    if (cells.length === 1 && isRange(cells[0][1]) && !valueOf(cells[0][1]) && header !== null) return rangeOf(cells[0][1]);
    return ['', ''];
  }
  let cand = m.groups.r.trim();
  if (!cand) {
    const k = nextNonblank(lines, j + 1);
    cand = k < lines.length ? squash(lines[k]) : '';
    if (!cand || (pickValue(cellsOf(lines[k]), header) >= 1 && !search(RANGE_TOKEN_RE, cand))) return ['', ''];
    j = k;
  }
  const parts = [cand];
  let k = nextNonblank(lines, j + 1);
  while (k < lines.length) {                 // a second 'Reference Range' line is a second range
    const m2 = matchStart(RANGE_LABEL_RE, squash(lines[k]));
    if (!m2 || !m2.groups.r.trim()) break;
    parts.push(m2.groups.r.trim());
    k = nextNonblank(lines, k + 1);
  }
  if (parts.length > 1) return [parts.join(' | '), ''];
  if (!search(RANGE_TOKEN_RE, cand)) return [cand, ''];   // 'A Pattern', 'Not established': the text, verbatim
  return rangeOf(cand);
}

/* a printed date as YYYY-MM-DD, or '' when it is not one */
export function toIso(s) {
  s = String(s).trim();
  let m = matchStart(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/, s);
  if (m) {
    const y = parseInt(m[3], 10);
    return iso(y < 100 ? y + 2000 : y, parseInt(m[1], 10), parseInt(m[2], 10));
  }
  m = matchStart(/^(\d{4})-(\d{2})-(\d{2})$/, s);
  if (m) return iso(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  m = matchStart(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/, s);
  if (m) return iso(parseInt(m[3], 10), month(m[2]), parseInt(m[1], 10));
  m = matchStart(/^([A-Za-z]{3,9})\.? (\d{1,2}), (\d{4})$/, s);
  if (m) return iso(parseInt(m[3], 10), month(m[1]), parseInt(m[2], 10));
  m = matchStart(/^(\d{1,2}) ([A-Za-z]{3,9}) (\d{4})$/, s);
  if (m) return iso(parseInt(m[3], 10), month(m[2]), parseInt(m[1], 10));
  return '';
}

function month(word) {
  return MONTHS.indexOf(upper(word).slice(0, 3)) + 1;
}

function iso(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900) return '';
  return String(y).padStart(4, '0') + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

export function findDate(text) {
  for (const pat of DATE_PATTERNS) {
    for (const m of String(text).matchAll(pat)) {
      const v = toIso(m[1]);
      if (v) return v;
    }
  }
  return null;
}

export class GenericParser {
  static get name() { return 'generic'; }
  get name() { return 'generic'; }

  static matches(text) { return false; }     // never chosen by name; the fallback for every unknown layout

  parse(text) {
    const lines = String(text).replace(/\f/g, '\n').split('\n');
    const results = [], unparsed = [];
    let header = null, heading = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const stripped = line.trim();
      if (!stripped || search(FOOTER_RE, line) || search(PAGE_RE, line)) continue;
      const cells = cellsOf(line);
      const h = headerOf(cells);
      if (h) {
        header = h;
        continue;
      }
      if (isHeading(cells)) {
        heading = squash(stripped);
        continue;
      }
      const r = readLine(cells, header);
      if (r === null) {
        if (cells.length >= 2 && isName(cells[0][1]) && matchStart(NUM_RE, cells[1][1]) && !search(DATE_IN_RE, stripped)) unparsed.push(stripped);
        continue;
      }
      let rng = r.range, unit = r.unit;
      if (!rng) {
        const [r2, u] = rangeOnNextLine(lines, i, header);
        rng = r2;
        if (u && !unit) unit = u;
      }
      results.push({ test_name: r.name, value: r.value, unit, ref_range: rng, lab_flag: r.flag, panel: heading });
    }
    const spec = search(SPECIMEN_RE, text);
    return { date_drawn: findDate(text), specimen_id: spec ? spec[1] : '', results, unparsed };
  }
}
