/* Python behaviours the group A twins need that py.js and pydate.js do not carry yet.

   '%s' of a value that may be None, KeyError and TypeError with Python's messages, the lazy
   tuple unpacking of `y, m, d = (int(x) for x in s.split("-"))`, and date(y, m, d) validation.
   Each is here so the twin fails the way the oracle fails on the same malformed input. */
import { fmtNum, pyInt, pyReprStr, PyValueError } from './py.js';
import { toIso, daysIn } from './pydate.js';

/* KeyError('value') prints as 'value' (the repr of the key). */
export class PyKeyError extends Error {
  constructor(key) { super(pyReprStr(key)); this.name = 'KeyError'; }
}
export class PyTypeError extends Error {
  constructor(message) { super(message); this.name = 'TypeError'; }
}

/* '%s' % v for a cell value: None prints as 'None', a bool as True/False, a number as Python
   prints an int-if-integral number. A value Python holds as a float even when integral must
   go through pyFloatStr instead. */
export function pyStr(v) {
  if (v == null) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return fmtNum(v);
  return String(v);
}

/* row[key]: a KeyError when the key is not there, as Python raises it. */
export function req(row, key) {
  if (!Object.prototype.hasOwnProperty.call(row, key)) throw new PyKeyError(key);
  return row[key];
}

/* y, m, d = (int(x) for x in s.split("-")). The generator converts lazily: three parts are
   converted, then a fourth is converted (and may fail) before the unpack complains about it. */
export function unpackInts3(s) {
  const parts = String(s).split('-');
  const out = [];
  for (let i = 0; i < parts.length && i < 4; i++) out.push(pyInt(parts[i]));
  if (parts.length < 3) throw new PyValueError('not enough values to unpack (expected 3, got ' + parts.length + ')');
  if (parts.length > 3) throw new PyValueError('too many values to unpack (expected 3)');
  return out;
}

/* date(y, m, d) -> ISO string, with Python's own checks and messages. */
export function pyDate(y, m, d) {
  if (y < 1 || y > 9999) throw new PyValueError('year ' + y + ' is out of range');
  if (m < 1 || m > 12) throw new PyValueError('month must be in 1..12');
  if (d < 1 || d > daysIn(y, m)) throw new PyValueError('day is out of range for month');
  return toIso(y, m, d);
}
