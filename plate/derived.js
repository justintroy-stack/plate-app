/* Derived markers: values computed from other markers on the same draw (ratios and indices such
   as TG:HDL, HOMA-IR, FIB-4, remnant cholesterol). A twin of labtrack/derived.py.

   They are never stored. Recomputing from the store on every read means a corrected value flows
   through automatically, and the store stays a record of what the lab reported.

   Formulas live in config/derived.csv, so a new index is a config row. Python evaluates them with
   a restricted walk over its own parse tree; JavaScript has no such tree and `eval` is exactly
   what must never run here, so this file carries a parser for the same grammar: numbers, names,
   unary plus and minus, + - * / **, parentheses, and calls to the short list of maths functions
   below. Everything else -- an attribute, a subscript, a lambda, a comprehension, a conditional,
   a string, a comparison -- is refused by name, with the message Python gives, so a bad config
   row fails the same way in both engines instead of running. */
import { fmtNum, pyRound, pyFloat, pyReprStr, isDigit, orEmpty, strip, lower, pySorted, sortedSet, PyValueError } from './py.js';
import { readRows } from './csv.js';
import { unpackInts3 } from './pyx.js';
import { parseExpression } from './pyexpr.js';
import { crLog, crLog10, pyPow, PyOverflowError, PyZeroDivisionError, PyTypeError } from './crmath.js';

export { PyOverflowError, PyZeroDivisionError };
const domain = () => new PyValueError('math domain error');

/* math.log(x) and math.log(x, base), on the correctly-rounded logarithm: JavaScript's own
   Math.log disagrees with the C library Python calls in the last bit about one value in a
   hundred, which is a difference the twin would see. */
function mathLog(x, base) {
  if (x <= 0) throw domain();
  if (base === undefined) return crLog(x);
  if (base <= 0) throw domain();
  return crLog(x) / crLog(base);
}
function minMax(which, args) {
  if (args.length === 0) throw new PyTypeError(which + ' expected at least 1 argument, got 0');
  if (args.length === 1) throw new PyTypeError("'float' object is not iterable");
  return which === 'min' ? Math.min(...args) : Math.max(...args);
}

export const FUNCS = {
  ln: mathLog,
  log: mathLog,
  log10: (x) => { if (x <= 0) throw domain(); return crLog10(x); },
  sqrt: (x) => { if (x < 0) throw domain(); return Math.sqrt(x); },
  abs: (x) => Math.abs(x),
  min: (...a) => minMax('min', a),
  max: (...a) => minMax('max', a),
  /* Every argument reaches a function as a float, because that is what the evaluator produces,
     and Python's round() will not take a float as its digit count. So a two-argument round
     always raises, in both engines. No shipped formula uses one. */
  round: (x, n) => {
    if (n !== undefined) throw new PyTypeError("'float' object cannot be interpreted as an integer");
    return pyRound(x);
  },
};
const BINOPS = new Set(['Add', 'Sub', 'Mult', 'Div', 'Pow']);

export function loadDerived(home, configDir = 'config') {
  const out = {};
  const text = home.read(configDir + '/derived.csv');
  if (text == null) return out;
  for (const r of readRows(text)) {
    const mid = strip(r.marker);
    if (!mid || !strip(r.formula)) continue;
    const dec = strip(orEmpty(r.decimals) || '2');
    out[mid] = {
      marker: mid, display_name: strip(orEmpty(r.display_name) || mid),
      category: strip(orEmpty(r.category) || 'ratios'), formula: r.formula.trim(),
      inputs: orEmpty(r.inputs).replace(/,/g, '|').split('|').map(a => a.trim()).filter(Boolean),
      unit: strip(r.unit), decimals: isDigit(dec) ? parseInt(dec, 10) : 2,
      requires_fasting: lower(strip(orEmpty(r.requires_fasting) || 'no')) === 'yes',
      note: strip(r.note),
    };
  }
  return out;
}

/* Evaluate an arithmetic formula over named variables. Raises ValueError on anything outside
   the whitelist, so a bad config row fails loudly instead of running. */
export function safeEval(expr, variables) {
  let tree;
  try {
    // ast.parse(expr, mode="eval") gives the tree; only a SyntaxError is wrapped, so the
    // ValueError a null byte raises travels on as Python lets it.
    tree = parseExpression(String(expr));
  } catch (e) {
    if (e && e.name === 'SyntaxError') throw new PyValueError('cannot parse formula ' + pyReprStr(String(expr)) + ': ' + e.message);
    throw e;
  }
  if (tree && tree.type === 'Expression') tree = tree.body;

  function ev(node) {
    if (node.type === 'Constant') {
      if (node.kind === 'num' || node.kind === 'bool') return pyFloat(node.value);
      throw new PyValueError('only numeric constants are allowed');
    }
    if (node.type === 'Name') {
      if (!(node.id in variables)) throw new PyValueError('unknown input ' + pyReprStr(node.id));
      return pyFloat(variables[node.id]);
    }
    if (node.type === 'UnaryOp' && (node.op === 'UAdd' || node.op === 'USub')) {
      const v = ev(node.operand);
      return node.op === 'UAdd' ? v : -v;
    }
    if (node.type === 'BinOp' && BINOPS.has(node.op)) {
      const a = ev(node.left), b = ev(node.right);
      if (node.op === 'Add') return a + b;
      if (node.op === 'Sub') return a - b;
      if (node.op === 'Mult') return a * b;
      if (node.op === 'Pow') return pyPow(a, b);
      if (b === 0) throw new PyValueError('division by zero');
      return a / b;
    }
    if (node.type === 'Call' && node.func.type === 'Name' && node.func.id in FUNCS) {
      if (node.keywords && node.keywords.length) throw new PyValueError('keyword arguments are not allowed');
      return pyFloat(FUNCS[node.func.id](...node.args.map(ev)));
    }
    throw new PyValueError('expression element not allowed in a formula: ' + node.type);
  }

  return ev(tree);
}

function ageOn(dob, isoDate) {
  if (!dob) return null;
  const [y, m, d] = unpackInts3(dob);
  const [ay, am, ad] = unpackInts3(isoDate);
  return ay - y - ((am < m || (am === m && ad < d)) ? 1 : 0);
}

/* Derived rows (same shape as store rows) for every draw date where all inputs are present.
   Rows carry lab='computed' so they are never confused with reported values. */
export function compute(rows, profile, specs) {
  if (specs === undefined || specs === null) throw new PyValueError('compute(): the specs must be loaded by the caller');
  if (!Object.keys(specs).length) return [];
  const dob = (profile || {}).dob || null;
  const byDate = new Map(), censored = new Map();
  for (const r of rows) {
    if (!r.marker) continue;
    let v;
    try { v = pyFloat(r.value_num); } catch (e) { continue; }
    // First reported value for a marker on a date wins; a second order of the same test would
    // otherwise make the choice ambiguous.
    if (!byDate.has(r.date_drawn)) byDate.set(r.date_drawn, new Map());
    const day = byDate.get(r.date_drawn);
    if (!day.has(r.marker)) day.set(r.marker, v);
    if ('<>'.includes(String(r.value === undefined ? '' : r.value).slice(0, 1))) {
      if (!censored.has(r.date_drawn)) censored.set(r.date_drawn, new Map());
      const c = censored.get(r.date_drawn);
      if (!c.has(r.marker)) c.set(r.marker, r.value);
    }
  }
  const out = [];
  for (const dateDrawn of sortedSet(byDate.keys())) {
    const vals = {};
    for (const [k, v] of byDate.get(dateDrawn)) vals[k] = v;
    const age = ageOn(dob, dateDrawn);
    if (age !== null) vals.age = age;
    for (const [mid, spec] of Object.entries(specs)) {
      if (spec.inputs.some(i => !(i in vals))) continue;
      let v;
      try {
        v = safeEval(spec.formula, vals);
      } catch (e) {
        if (e && (e.name === 'ValueError' || e.name === 'OverflowError')) continue;
        throw e;
      }
      if (v !== v || v === Infinity || v === -Infinity) continue;
      v = pyRound(v, spec.decimals);
      // A censored input ('<30') makes the result a bound, not a value. Say so rather than
      // presenting the number as exact.
      const day = censored.get(dateDrawn) || new Map();
      const approx = pySorted([...day.keys()])
        .filter(k => spec.inputs.includes(k))
        .map(k => k + ' reported as ' + day.get(k))
        .join('; ');
      out.push({ approx, date_drawn: dateDrawn, test_name: spec.display_name, marker: mid,
                 value: fmtNum(v), value_num: fmtNum(v), unit: spec.unit,
                 ref_range: '', ref_low: '', ref_high: '', lab_flag: '',
                 out_of_range: '', panel: 'Computed', lab: 'computed',
                 specimen_id: '', source_file: '', ingested_at: '' });
    }
  }
  return out;
}
