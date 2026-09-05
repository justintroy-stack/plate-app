/* Python's arithmetic and formatting, so a twin gives the same digits the oracle gives.

   The engine was written in Python and the tests were written against Python's output. Where
   JavaScript and Python disagree on a digit -- round() is half-to-even on the exact value,
   repr(float) switches to an exponent at a different magnitude, float('') is an error rather
   than zero -- the twin uses these and not the language's own. */

export class PyValueError extends Error {
  constructor(message) { super(message); this.name = 'ValueError'; }
}
export class ConfigError extends PyValueError {
  constructor(message) { super(message); this.name = 'ConfigError'; }
}
export class PySystemExit extends Error {
  constructor(message) { super(message); this.name = 'SystemExit'; }
}

function incDigits(s) {
  /* '1299' -> '1300', '999' -> '1000' */
  const a = s.split('');
  let i = a.length - 1;
  while (i >= 0) {
    if (a[i] === '9') { a[i] = '0'; i--; }
    else { a[i] = String.fromCharCode(a[i].charCodeAt(0) + 1); return a.join(''); }
  }
  return '1' + a.join('');
}

/* Python's round(x, ndigits): half to even, decided on the exact decimal value of the double,
   not on x * 10**n. round(0.25, 1) is 0.2 here and in Python; Math.round(2.5) is 3, round(2.5) is 2. */
export function pyRound(x, ndigits = 0) {
  if (typeof x !== 'number') x = Number(x);
  if (!Number.isFinite(x)) return x;
  if (ndigits < 0) throw new Error('pyRound: negative ndigits is not needed here');
  const neg = x < 0;
  const ax = Math.abs(x);
  if (ax >= 1e21) return x;                              // every double this large is already an integer
  const s = ax.toFixed(Math.min(100, ndigits + 30));    // the exact expansion, far past a tie
  const dot = s.indexOf('.');
  const ip = dot < 0 ? s : s.slice(0, dot);
  const fp = dot < 0 ? '' : s.slice(dot + 1);
  let keep = ip + fp.slice(0, ndigits);
  const next = fp.length > ndigits ? fp.charCodeAt(ndigits) - 48 : 0;
  const rest = fp.slice(ndigits + 1);
  let up;
  if (next > 5) up = true;
  else if (next < 5) up = false;
  else if (/[1-9]/.test(rest)) up = true;
  else up = ((keep.charCodeAt(keep.length - 1) - 48) % 2) === 1;
  if (up) keep = incDigits(keep);
  const out = ndigits === 0 ? keep : keep.slice(0, keep.length - ndigits) + '.' + keep.slice(keep.length - ndigits);
  let v = Number(out);
  if (neg && v !== 0) v = -v;
  return v;
}

/* repr(float): the shortest digits that read back to the same double, an exponent below 1e-4
   or from 1e16, and always a fractional digit ('12.0'). */
export function pyRepr(x) {
  if (typeof x !== 'number') x = Number(x);
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const neg = x < 0;
  const [mant, expS] = Math.abs(x).toExponential().split('e');
  const exp = parseInt(expS, 10);
  const digits = mant.replace('.', '');
  let body;
  if (exp >= -4 && exp < 16) {
    if (exp >= 0) {
      const intPart = digits.slice(0, exp + 1).padEnd(exp + 1, '0');
      const frac = digits.slice(exp + 1);
      body = intPart + '.' + (frac || '0');
    } else {
      body = '0.' + '0'.repeat(-exp - 1) + digits;
    }
  } else {
    const m = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits;
    const ae = Math.abs(exp);
    body = m + 'e' + (exp < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
  }
  return (neg ? '-' : '') + body;
}

/* str(x) for a number that Python would hold as an int when integral and a float otherwise:
   what _num(), fmt_num() and _numstr() print. */
export function fmtNum(x) {
  if (typeof x !== 'number') x = Number(x);
  if (Number.isInteger(x)) return Math.abs(x) < 1e21 ? String(x) : BigInt(x).toString();
  return pyRepr(x);
}

/* str(x) for a value Python holds as a float even when integral: '160.0'. */
export const pyFloatStr = pyRepr;

/* '%d' % x */
export function pyD(x) { return String(Math.trunc(Number(x))); }

/* '%g' % x: six significant digits, trailing zeros dropped, an exponent below 1e-4 or from 1e6. */
export function pyG(x, prec = 6) {
  if (typeof x !== 'number') x = Number(x);
  if (!Number.isFinite(x)) return pyRepr(x);
  if (x === 0) return '0';
  let [mant, expS] = Math.abs(x).toExponential(prec - 1).split('e');
  const exp = parseInt(expS, 10);
  const digits = mant.replace('.', '');
  let body;
  if (exp < -4 || exp >= prec) {
    let m = digits.replace(/0+$/, '');
    m = m.length > 1 ? m[0] + '.' + m.slice(1) : m;
    const ae = Math.abs(exp);
    body = m + 'e' + (exp < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : String(ae));
  } else if (exp >= 0) {
    const intPart = digits.slice(0, exp + 1);
    const frac = digits.slice(exp + 1).replace(/0+$/, '');
    body = intPart + (frac ? '.' + frac : '');
  } else {
    const frac = ('0'.repeat(-exp - 1) + digits).replace(/0+$/, '');
    body = '0.' + frac;
  }
  return (x < 0 ? '-' : '') + body;
}

const FLOAT_RE = /^[+-]?(?:(?:\d(?:_?\d)*)?\.?(?:\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?)$/;
const quoted = (s) => pyReprStr(s);

/* float(s): whitespace trimmed, underscores between digits allowed, inf and nan, nothing else. */
export function pyFloat(s) {
  if (typeof s === 'number') return s;
  if (typeof s !== 'string') throw new PyValueError('float() argument must be a string or a real number, not ' + typeof s);
  const t = s.trim();
  const low = t.toLowerCase().replace(/^[+-]/, '');
  if (low === 'inf' || low === 'infinity') return t.startsWith('-') ? -Infinity : Infinity;
  if (low === 'nan') return NaN;
  if (!/\d/.test(t) || !FLOAT_RE.test(t)) throw new PyValueError('could not convert string to float: ' + quoted(s));
  return Number(t.replace(/_/g, ''));
}

/* int(s) for a decimal string. */
export function pyInt(s) {
  if (typeof s === 'number') return Math.trunc(s);
  if (typeof s !== 'string' || !/^\s*[+-]?\d(?:_?\d)*\s*$/.test(s)) {
    throw new PyValueError('invalid literal for int() with base 10: ' + quoted(s));
  }
  return parseInt(s.trim().replace(/_/g, ''), 10);
}

/* str.isdigit() for the ASCII digits the config files use. */
export function isDigit(s) { return typeof s === 'string' && /^\d+$/.test(s); }

/* Python orders strings by code point; JavaScript's < compares UTF-16 units, which differ for
   any character outside the basic plane. */
export function cmpStr(a, b) {
  a = String(a); b = String(b);
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i), cb = b.codePointAt(j);
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xFFFF ? 2 : 1;
    j += cb > 0xFFFF ? 2 : 1;
  }
  return (a.length - i) - (b.length - j) < 0 ? -1 : (a.length - i) - (b.length - j) > 0 ? 1 : 0;
}
/* sorted() for a list of strings */
export function sortedStr(arr) { return [...arr].sort(cmpStr); }

/* Python compares tuples element by element, and sorted() is stable. */
export function pyCmp(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { const c = pyCmp(a[i], b[i]); if (c) return c; }
    return a.length - b.length;
  }
  if (typeof a === 'boolean') a = a ? 1 : 0;
  if (typeof b === 'boolean') b = b ? 1 : 0;
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  return cmpStr(a, b);
}
export function pySorted(arr, key = x => x, reverse = false) {
  const out = arr.map((v, i) => [key(v), i, v]);
  out.sort((p, q) => (pyCmp(p[0], q[0]) || (p[1] - q[1])) * (reverse ? -1 : 1));
  if (reverse) {          // Python's reverse keeps equal keys in their original order
    const groups = [];
    for (const row of out) {
      const g = groups[groups.length - 1];
      if (g && pyCmp(g[0][0], row[0]) === 0) g.push(row); else groups.push([row]);
    }
    return groups.flatMap(g => g.sort((p, q) => p[1] - q[1])).map(x => x[2]);
  }
  return out.map(x => x[2]);
}
export function pyMin(arr, key = x => x) { return pySorted(arr, key)[0]; }
export function pyMax(arr, key = x => x) { const s = pySorted(arr, key); return s[s.length - 1]; }

/* set(...) sorted the way Python sorts strings and numbers. */
export function sortedSet(iterable, key) { return pySorted([...new Set(iterable)], key); }

function pad2(n) { return n < 10 ? '0' + n : String(n); }
/* datetime.now().isoformat(timespec="seconds"): local time, no zone. */
export function isoLocal(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T'
    + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
/* datetime.now().strftime("%Y%m%d-%H%M%S") */
export function stampLocal(d) {
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-'
    + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}
/* date.today().isoformat() */
export function todayLocal(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/* "a" or "" -> "" ; Python's (v or "") for a cell that may be missing */
export const orEmpty = v => (v == null || v === false ? '' : String(v));
/* str.strip() */
export const strip = v => orEmpty(v).trim();
/* str.lower(), str.upper() */
export const lower = v => orEmpty(v).toLowerCase();
export const upper = v => orEmpty(v).toUpperCase();

/* repr(str): single quotes unless the text has one and no double quote, as Python prints it
   inside an error message. */
export function pyReprStr(s) {
  s = String(s);
  const q = (s.includes("'") && !s.includes('"')) ? '"' : "'";
  let out = '';
  for (const ch of s) {
    if (ch === '\\') out += '\\\\';
    else if (ch === q) out += '\\' + q;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else out += ch;
  }
  return q + out + q;
}

/* re.match(pattern, s): a match at the start only. Pass a regex without the g or y flag. */
export function matchStart(re, s) {
  const sticky = new RegExp(re.source, re.flags.replace(/[gy]/g, '') + 'y');
  sticky.lastIndex = 0;
  return sticky.exec(s);
}
/* re.search */
export function search(re, s) {
  const plain = new RegExp(re.source, re.flags.replace(/[gy]/g, ''));
  return plain.exec(s);
}
/* re.findall for a pattern with one group: the group's text for every match */
export function findAll(re, s, group = 1) {
  const g = new RegExp(re.source, re.flags.replace(/[gy]/g, '') + 'g');
  const out = [];
  let m;
  while ((m = g.exec(s)) !== null) {
    out.push(typeof group === 'string' ? m.groups[group] : m[group]);
    if (m[0] === '') g.lastIndex++;
  }
  return out;
}
