/* Dates as Python's date module does them, on ISO strings.

   The engine never needs a time of day on a date: draw dates, due dates and ages are calendar
   arithmetic. Keeping them as 'YYYY-MM-DD' strings sidesteps every time-zone trap in Date and
   makes them compare and sort the way Python's date objects do. */
import { PyValueError, pyReprStr } from './py.js';

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function isLeap(y) { return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0); }
export function daysIn(y, m) { return m === 2 && isLeap(y) ? 29 : DAYS[m - 1]; }

/* date.fromisoformat('YYYY-MM-DD') -> [y, m, d]; anything else is a ValueError */
export function parseIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) throw new PyValueError('Invalid isoformat string: ' + pyReprStr(String(s)));
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12) throw new PyValueError('month must be in 1..12');
  if (d < 1 || d > daysIn(y, mo)) throw new PyValueError('day is out of range for month');
  return [y, mo, d];
}
function pad2(n) { return n < 10 ? '0' + n : String(n); }
export function toIso(y, m, d) { return String(y).padStart(4, '0') + '-' + pad2(m) + '-' + pad2(d); }
export function isValidIso(s) { try { parseIso(s); return true; } catch (e) { return false; } }

/* Python's own add_months: the same day, clipped to the month's length. */
export function addMonths(iso, months) {
  const [y0, m0, d0] = parseIso(iso);
  let m = m0 - 1 + months;
  const y = y0 + Math.floor(m / 12);
  m = ((m % 12) + 12) % 12 + 1;
  return toIso(y, m, Math.min(d0, daysIn(y, m)));
}
function ordinal(iso) { const [y, m, d] = parseIso(iso); return Math.round(Date.UTC(y, m - 1, d) / 86400000); }
/* (a - b).days */
export function daysBetween(a, b) { return ordinal(a) - ordinal(b); }
/* a + timedelta(days=n) */
export function addDays(iso, n) {
  const t = (ordinal(iso) + n) * 86400000;
  const d = new Date(t);
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
/* age in whole years on a date, from an ISO date of birth */
export function ageOn(dob, onIso) {
  if (!dob) return null;
  const [y, m, d] = String(dob).split('-').map(x => parseInt(x, 10));
  const [ay, am, ad] = parseIso(onIso);
  return ay - y - ((am < m || (am === m && ad < d)) ? 1 : 0);
}
/* date.today() on the device's own calendar */
export function today(clock) {
  const d = clock ? clock() : new Date();
  return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
/* datetime.strptime(s, "%m/%d/%Y").date().isoformat() */
export function fromUS(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim());
  if (!m) throw new PyValueError('time data ' + pyReprStr(String(s)) + ' does not match format \'%m/%d/%Y\'');
  const iso = toIso(+m[3], +m[1], +m[2]);
  parseIso(iso);
  return iso;
}
export const DATE_MIN = '0001-01-01';
export function pyMaxDate(a, b) { return a >= b ? a : b; }
