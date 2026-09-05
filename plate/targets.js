/* Researched target ranges per marker (config/targets.csv), one lens at a time. A line-for-line
   twin of labtrack/targets.py.

   These are evidence-based targets from named guideline sources, distinct from the population
   reference range a lab prints. The lab's printed range is always kept on each stored row; a
   target is an extra lens, and every row carries its basis, source URL, review date and a
   confidence grade so it can be challenged. */
import { readRows } from './csv.js';
import { fmtNum, lower, matchStart, orEmpty, pyFloat, PyValueError, strip } from './py.js';
import { RANGE_TOKEN_RE, parseRange } from './ranges.js';
import { pyStr } from './pyx.js';

export const LENSES = ['conventional', 'functional'];

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/* str.replace(a, b): every occurrence */
const rep = (s, a, b) => s.split(a).join(b);

/* The Target dataclass as a plain object, fields in its order. */
export function makeTarget(f) {
  return {
    marker: f.marker, target_text: f.target_text, low: f.low, high: f.high, low_inc: f.low_inc,
    high_inc: f.high_inc, unit: f.unit, basis: f.basis, source_url: f.source_url, reviewed: f.reviewed,
    confidence: f.confidence, notes: f.notes,
    lens: f.lens === undefined ? 'conventional' : f.lens,      // which guideline lens this row belongs to
    evidence: f.evidence === undefined ? '' : f.evidence,      // functional rows: outcome data | observational | ...
  };
}

export function hasBounds(t) { return t.low != null || t.high != null; }

/* Compact form of the target: '<90 mg/dL', '3.5-5.0 mmol/L', '>=40 mg/dL'. */
export function targetShort(t) {
  const f = x => fmtNum(x);
  let core;
  if (t.low != null && t.high != null) core = f(t.low) + '-' + f(t.high);
  else if (t.high != null) core = (t.high_inc ? '<=' : '<') + f(t.high);
  else if (t.low != null) core = (t.low_inc ? '>=' : '>') + f(t.low);
  else return Array.from(t.target_text).slice(0, 40).join('');
  return (core + ' ' + t.unit).trim();
}

/* Loose unit identity: '% of total Hgb' == '%', 'mL/min/1.73 m²' == 'mL/min/1.73m2',
   'ratio' == '(calc)' == ''. */
export function normUnit(u) {
  u = lower(u);
  u = rep(rep(rep(rep(u, '(calc)', ''), 'calc', ''), 'ratio', ''), ' ', '');
  u = rep(rep(rep(rep(u, 'μ', 'u'), 'µ', 'u'), '²', '2'), 'oftotalhgb', '');
  u = rep(rep(rep(rep(u, 'thousand/', 'x10^3/'), 'million/', 'x10^6/'), '10^3/', 'x10^3/'), 'xx10', 'x10');
  u = rep(rep(u, 'k/ul', 'x10^3/ul'), 'm/ul', 'x10^6/ul');
  u = rep(rep(rep(rep(u, 'percent', '%'), '(unitless)', ''), 'unitless', ''), 'index', '');
  return u;
}

export function unitCompatible(storedUnit, targetUnit) {
  const a = normUnit(storedUnit), b = normUnit(targetUnit);
  return !a || !b || a === b;
}

/* float(s) or None: a float even when integral, which is why the JSON twin prints it through
   fmtNum only where Python prints it through short(). */
function num(s) {
  s = strip(s);
  try { return pyFloat(s); } catch (e) { if (e instanceof PyValueError) return null; throw e; }
}

/* Targets for one lens.

   'conventional' (default): targets.csv plus the risk-tier overrides from target_tiers.csv.
   'functional': targets_functional.csv laid over the conventional set, so a marker with no
   functional row keeps its conventional target and says so via lens. */
export function loadTargets(home, opts = {}) {
  const riskTier = opts.risk_tier, lens = opts.lens;
  const out = loadBase(home);
  const tier = lower(strip(riskTier));
  const tp = 'config/target_tiers.csv';
  if (tier && home.exists(tp)) {
    for (const r of readRows(home.read(tp))) {
      if (lower(strip(r.tier)) !== tier) continue;
      const mid = strip(r.marker);
      const base = has(out, mid) ? out[mid] : null;
      if (base == null) continue;
      const text = strip(r.target_text);
      let lo = null, hi = null, li = true, hiInc = true;
      const tok = matchStart(RANGE_TOKEN_RE, rep(rep(text, '≤', '<='), '≥', '>='));
      if (tok) [lo, hi, li, hiInc] = parseRange(tok.groups.range);
      if (hi == null) hi = num(r.target_high);
      out[mid] = makeTarget({
        marker: mid, target_text: text, low: lo, high: hi, low_inc: li, high_inc: hiInc, unit: base.unit,
        basis: strip(orEmpty(r.basis) || base.basis) + ' [risk tier: ' + tier + ']',
        source_url: base.source_url, reviewed: base.reviewed, confidence: base.confidence, notes: base.notes,
      });
    }
  }
  if (lower(strip(lens)) === 'functional') {
    for (const [mid, t] of Object.entries(loadBase(home, 'targets_functional.csv', 'functional'))) {
      if (hasBounds(t)) out[mid] = t;
    }
  }
  return out;
}

/* Both lenses at once, for display side by side. */
export function loadBoth(home, opts = {}) {
  const riskTier = opts.risk_tier;
  return { conventional: loadTargets(home, { risk_tier: riskTier, lens: 'conventional' }),
           functional: loadTargets(home, { risk_tier: riskTier, lens: 'functional' }) };
}

function loadBase(home, filename = 'targets.csv', lens = 'conventional') {
  const out = {};
  const text = home.read('config/' + filename);
  if (text == null) return out;
  for (const r of readRows(text)) {
    const mid = strip(r.marker);
    if (!mid) continue;
    let low = num(r.target_low), high = num(r.target_high);
    let lowInc = true, highInc = true;
    const ttext = strip(r.target_text);
    // Only a range that *starts* the phrased target counts as the target; numbers deeper in
    // the sentence are tiers and commentary. Normalise unicode first.
    const normText = rep(rep(rep(rep(rep(ttext, '≤', '<='), '≥', '>='), '–', '-'), '−', '-'), '≈', '').trim();
    const tok = matchStart(RANGE_TOKEN_RE, normText);
    if (tok) {
      const [plo, phi, pli, phiInc] = parseRange(tok.groups.range);
      // The phrased target wins ('<5.7%' means high=5.7, exclusive); the numeric columns fill
      // in whatever the phrase does not state.
      if (plo != null) { low = plo; lowInc = pli; }
      if (phi != null) { high = phi; highInc = phiInc; }
      if (plo == null && phi == null) { lowInc = pli; highInc = phiInc; }
    }
    out[mid] = makeTarget({
      marker: mid, target_text: ttext, low, high, low_inc: lowInc, high_inc: highInc, unit: strip(r.unit),
      basis: strip(r.basis), source_url: strip(r.source_url), reviewed: strip(r.reviewed),
      confidence: strip(r.confidence), notes: strip(r.notes), lens, evidence: strip(r.evidence),
    });
  }
  return out;
}

/* 'above' / 'below' / 'in' / '' relative to bounds; qualifier is '<' or '>' from '<30'. */
export function compare(valueNum, qualifier, low, high, lowInc, highInc) {
  if (valueNum == null || (low == null && high == null)) return '';
  if (high != null) {
    if (valueNum > high || (!highInc && valueNum === high && qualifier !== '<')) return 'above';
  }
  if (low != null) {
    if (valueNum < low || (!lowInc && valueNum === low && qualifier !== '>')) return 'below';
    if (qualifier === '<' && valueNum <= low) return 'below';
  }
  return 'in';
}

/* Status of a stored row against its marker's target: ['above'|'below'|'in'|'', note]. */
export function targetStatus(row, target) {
  if (target == null || !hasBounds(target)) return ['', ''];
  if (!unitCompatible(row.unit, target.unit)) return ['', 'unit ' + pyStr(row.unit) + ' vs target ' + pyStr(target.unit)];
  let v;
  const raw = row.value_num;
  if (raw == null) return ['', ''];
  try { v = pyFloat(raw); } catch (e) { if (e instanceof PyValueError) return ['', '']; throw e; }
  const value = orEmpty(row.value);
  const qual = value.startsWith('<') ? '<' : (value.startsWith('>') ? '>' : '');
  return [compare(v, qual, target.low, target.high, target.low_inc, target.high_inc), ''];
}
