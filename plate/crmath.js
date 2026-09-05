/* The maths functions a formula may call, with the digits Python's math module gives.

   Python's math.log and math.log10 call the C library, which on the Mac rounds correctly all
   but a few times in a hundred thousand. JavaScript's Math.log is a different algorithm and
   disagrees with it in the last bit about one time in fifty, so a value such as
   ln(triglycerides * glucose / 2) would round the same to two decimals and still differ as a
   raw number. The logs here are computed in double-double arithmetic (about 100 bits) and
   rounded once, which is the correctly rounded answer: the same digit the C library gives
   whenever the C library is right, which is all but one input in ten thousand.

   sqrt is exact in both languages, and pow agrees with the C library on every pair tried, so
   those wrap the language's own; pow only adds the special cases float_pow sorts out itself. */

const SPLITTER = 134217729;                       // 2^27 + 1, Dekker's split
const dv = new DataView(new ArrayBuffer(8));

/* double-double: [hi, lo] with hi = fl(hi + lo) */
function twoSum(a, b) { const s = a + b, bb = s - a; return [s, (a - (s - bb)) + (b - bb)]; }
function quickTwoSum(a, b) { const s = a + b; return [s, b - (s - a)]; }
function twoProd(a, b) {
  const p = a * b;
  let t = SPLITTER * a; const ah = t - (t - a), al = a - ah;
  t = SPLITTER * b; const bh = t - (t - b), bl = b - bh;
  return [p, ((ah * bh - p) + ah * bl + al * bh) + al * bl];
}
function ddAdd(a, b) { const [s, e] = twoSum(a[0], b[0]); return quickTwoSum(s, e + a[1] + b[1]); }
function ddNeg(a) { return [-a[0], -a[1]]; }
function ddMul(a, b) { const [p, e] = twoProd(a[0], b[0]); return quickTwoSum(p, e + a[0] * b[1] + a[1] * b[0]); }
function ddMulD(a, d) { const [p, e] = twoProd(a[0], d); return quickTwoSum(p, e + a[1] * d); }
function ddDiv(a, b) {
  const q1 = a[0] / b[0];
  let r = ddAdd(a, ddNeg(ddMulD(b, q1)));
  const q2 = r[0] / b[0];
  r = ddAdd(r, ddNeg(ddMulD(b, q2)));
  const q3 = r[0] / b[0];
  return ddAdd(quickTwoSum(q1, q2), [q3, 0]);
}

const LN2 = [0.6931471805599453, 2.3190468138462996e-17];
const LOG10E = [0.4342944819032518, 1.098319650216765e-17];
const SQRT2 = 1.4142135623730951;
const N = 24;                                     // terms of the atanh series: s^2 < 0.0295, so 2^-106 is reached by term 21
const COEF = [];
for (let k = 0; k <= N; k++) COEF.push(ddDiv([1, 0], [2 * k + 1, 0]));

/* ln(x) as a double-double, for x > 0 and finite. x = 2^k * m with m in [1/sqrt2, sqrt2), and
   ln(m) = 2 atanh(s) with s = (m - 1) / (m + 1). */
function ddLog(x) {
  let k = 0;
  if (x < 2.2250738585072014e-308) { x *= 18014398509481984; k = -54; }    // subnormal: scale by 2^54
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  k += ((hi >>> 20) & 0x7ff) - 1023;
  dv.setUint32(0, (hi & 0x800fffff) | 0x3ff00000);
  let m = dv.getFloat64(0);                       // [1, 2)
  if (m > SQRT2) { m *= 0.5; k += 1; }
  const s = ddDiv([m - 1, 0], twoSum(m, 1));      // m - 1 is exact
  const s2 = ddMul(s, s);
  let acc = COEF[N];
  for (let i = N - 1; i >= 0; i--) acc = ddAdd(ddMul(acc, s2), COEF[i]);
  let r = ddMul(ddMulD(s, 2), acc);
  if (k !== 0) r = ddAdd(ddMulD(LN2, k), r);
  return r;
}

/* Correctly rounded natural logarithm. Non-positive and non-finite inputs give what the C
   library gives; the caller raises Python's errors for them. */
export function crLog(x) {
  if (x !== x) return NaN;
  if (x === Infinity) return Infinity;
  if (x <= 0) return x === 0 ? -Infinity : NaN;
  if (x === 1) return 0;
  return ddLog(x)[0];
}

/* Correctly rounded base-10 logarithm. */
export function crLog10(x) {
  if (x !== x) return NaN;
  if (x === Infinity) return Infinity;
  if (x <= 0) return x === 0 ? -Infinity : NaN;
  if (x === 1) return 0;
  return ddMul(ddLog(x), LOG10E)[0];
}

export class PyOverflowError extends Error {
  constructor(message) { super(message); this.name = 'OverflowError'; }
}
export class PyZeroDivisionError extends Error {
  constructor(message) { super(message); this.name = 'ZeroDivisionError'; }
}
export class PyTypeError extends Error {
  constructor(message) { super(message); this.name = 'TypeError'; }
}

const isOddInteger = w => Math.abs(w) % 2 === 1;   // DOUBLE_IS_ODD_INTEGER: fmod(fabs(w), 2.0) == 1.0

/* float ** float exactly as CPython's float_pow: the special cases it decides itself, then
   the C library. A negative base with a fractional exponent is a complex number in Python,
   which nothing downstream can use (round() raises TypeError on it); here it raises the same
   TypeError at once. */
export function pyPow(v, w) {
  if (w === 0) return 1;
  if (v !== v) return v;
  if (w !== w) return v === 1 ? 1 : w;
  if (w === Infinity || w === -Infinity) {
    const av = Math.abs(v);
    if (av === 1) return 1;
    return (w > 0) === (av > 1) ? Math.abs(w) : 0;
  }
  if (v === Infinity || v === -Infinity) {
    const odd = isOddInteger(w);
    if (w > 0) return odd ? v : Math.abs(v);
    return odd ? (v < 0 ? -0 : 0) : 0;
  }
  if (v === 0) {
    if (w < 0) throw new PyZeroDivisionError('0.0 cannot be raised to a negative power');
    return isOddInteger(w) ? v : 0;
  }
  let negate = false;
  if (v < 0) {
    if (w !== Math.floor(w)) throw new PyTypeError("type complex doesn't define __round__ method");
    v = -v;
    negate = isOddInteger(w);
  }
  if (v === 1) return negate ? -1 : 1;
  let r = v ** w;
  if (negate) r = -r;
  if (r === Infinity || r === -Infinity) throw new PyOverflowError("(34, 'Result too large')");
  return r;
}
