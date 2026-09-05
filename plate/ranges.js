/* Numbers and reference ranges as printed by labs: '65-99', '<100', '> OR = 40', '< OR = 39'.
   A line-for-line twin of labtrack/ranges.py. */
import { fmtNum, matchStart, PyValueError } from './py.js';

export const RANGE_TOKEN_RE = /(?<range>[<>]\s*(?:OR\s*=\s*|=\s*)?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*-\s*\d[\d,]*(?:\.\d+)?)/i;

/* '1.41' -> [1.41, '']; '<30' -> [30.0, '<']; 'NEGATIVE' -> [null, ''] */
export function parseNumber(s) {
  const m = matchStart(/^([<>]?)\s*=?\s*(\d+(?:\.\d+)?)$/, String(s == null ? '' : s).replace(/,/g, '').trim());
  if (!m) return [null, ''];
  return [parseFloat(m[2]), m[1]];
}

/* [low, high, low_inclusive, high_inclusive] */
export function parseRange(rng) {
  if (!rng) return [null, null, true, true];
  const r = String(rng).replace(/,/g, '').trim();
  let m = matchStart(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/, r);
  if (m) return [parseFloat(m[1]), parseFloat(m[2]), true, true];
  m = matchStart(/^([<>])\s*(OR\s*=|=)?\s*(\d+(?:\.\d+)?)$/i, r);
  if (m) {
    const op = m[1], eq = !!m[2], num = parseFloat(m[3]);
    return op === '<' ? [null, num, true, eq] : [num, null, eq, true];
  }
  return [null, null, true, true];
}

/* 'L', 'H' or '' purely from the printed range. No judgment about severity. */
export function computeFlag(valueNum, qualifier, low, high, lowInc, highInc) {
  if (valueNum == null) return '';
  if (low != null && (valueNum < low || (!lowInc && valueNum === low && qualifier !== '>'))) return 'L';
  if (high != null && (valueNum > high || (!highInc && valueNum === high && qualifier !== '<'))) return 'H';
  return '';
}

export function normalizeRange(r) {
  r = String(r).trim().replace(/\s+/g, ' ');
  return r.replace(/\s*-\s*/g, '-');
}

/* '65-99 mg/dL' -> ['65-99', 'mg/dL']; '<5.0 (calc)' -> ['<5.0', '(calc)'] */
export function splitRangeUnit(s) {
  s = String(s).trim();
  const tok = matchStart(RANGE_TOKEN_RE, s);
  if (!tok) return [s, ''];                 // text range such as 'A Pattern' or 'Not established'; no unit
  return [normalizeRange(tok.groups.range), s.slice(tok[0].length).trim()];
}

export { fmtNum };

/* Fill value_num / ref_low / ref_high / out_of_range from the printed strings. */
export function enrich(row) {
  const [num, qual] = parseNumber(row.value == null ? '' : row.value);
  const [low, high, li, hi] = parseRange(row.ref_range == null ? '' : row.ref_range);
  row.value_num = num == null ? '' : fmtNum(num);
  row.ref_low = low == null ? '' : fmtNum(low);
  row.ref_high = high == null ? '' : fmtNum(high);
  row.out_of_range = computeFlag(num, qual, low, high, li, hi);
  return row;
}
