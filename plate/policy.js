/* Retest policy: when is a marker due again, given its latest value, its history, the
   researched target (config/targets.csv) or, failing that, the lab's printed range, and the
   per-marker rules in config/policy.csv. Every decision carries the rule it used. A
   line-for-line twin of labtrack/policy.py.

   Direction matters: a value above target uses high_months, below target uses low_months,
   and an empty cell means that direction is not a concern (falls back to base_months).
   severe_high / severe_low are thresholds beyond which severe_months applies. */
import { readRows } from './csv.js';
import { lower, orEmpty, pyD, pyFloat, pyFloatStr, pyInt, pySorted, PyValueError, strip } from './py.js';
import { addDays, addMonths, daysBetween, parseIso } from './pydate.js';
import { parseRange } from './ranges.js';
import { compare, hasBounds, targetShort, unitCompatible } from './targets.js';
import { pyDate, PyKeyError, pyStr, PyTypeError, req, unpackInts3 } from './pyx.js';

export { addMonths };

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/* _int / _float: an empty cell is None */
function intCell(s) { s = strip(s); return s ? pyInt(s) : null; }
function floatCell(s) { s = strip(s); return s ? pyFloat(s) : null; }
/* int(r["key"]): KeyError without the column, TypeError on a short row's None */
function reqInt(r, k) {
  if (!has(r, k)) throw new PyKeyError(k);
  if (r[k] == null) throw new PyTypeError("int() argument must be a string, a bytes-like object or a number, not 'NoneType'");
  return pyInt(r[k]);
}

export function loadProfile(home) {
  const prof = {};
  const text = home.read('config/profile.csv');
  if (text != null) {
    for (const r of readRows(text)) if (r.key) prof[r.key.trim()] = strip(r.value);
  }
  return prof;
}

/* marker -> Policy, fields in the dataclass's order */
export function loadPolicy(home) {
  const out = {};
  const text = home.read('config/policy.csv');
  if (text == null) return out;
  for (const r of readRows(text)) {
    if (!r.marker) continue;
    out[r.marker.trim()] = {
      marker: r.marker.trim(),
      order_panel: strip(r.order_panel) || r.marker,
      ordered_by: lower(strip(orEmpty(r.ordered_by) || 'self')),          // provider | self
      role: lower(strip(orEmpty(r.role) || 'primary')),                   // primary | derived
      base_months: reqInt(r, 'base_months'),
      confirm_months: reqInt(r, 'confirm_months'),
      high_months: intCell(r.high_months),
      low_months: intCell(r.low_months),
      persistent_months: intCell(r.persistent_months),   // out in the same direction on 2+ consecutive draws
      severe_high: floatCell(r.severe_high),
      severe_low: floatCell(r.severe_low),
      severe_months: intCell(r.severe_months),
      once: lower(strip(orEmpty(r.once) || 'no')) === 'yes',
      routine: lower(strip(orEmpty(r.routine) || 'yes')) !== 'no',        // no = order only with a reason
      covered_by: strip(r.covered_by),                                    // non-empty = another marker covers this one
      cost_tier: lower(strip(r.cost_tier)),
      min_age: intCell(r.min_age),
      max_age: intCell(r.max_age),
      notes: strip(r.notes),
    };
  }
  return out;
}

/* age in whole years on an ISO date, from a 'YYYY-MM-DD' date of birth; None without one */
export function ageOn(dob, on) {
  if (!dob) return null;
  const [y, m, d] = unpackInts3(dob);
  const [oy, om, od] = parseIso(on);
  return oy - y - ((om < m || (om === m && od < d)) ? 1 : 0);
}

function qual(row) {
  const v = orEmpty(row.value === undefined ? '' : row.value);
  return v.startsWith('<') ? '<' : (v.startsWith('>') ? '>' : '');
}

function numOf(row) {
  const raw = row.value_num;
  if (raw == null) return null;
  try { return pyFloat(raw); } catch (e) { if (e instanceof PyValueError) return null; throw e; }
}

/* [low, high, low_inc, high_inc, basis, basis_text, note] for one stored row. */
export function boundsFor(row, target) {
  let note;
  if (target != null && hasBounds(target)) {
    if (unitCompatible(row.unit, target.unit)) {
      return [target.low, target.high, target.low_inc, target.high_inc, 'target', targetShort(target), ''];
    }
    note = 'target unit ' + pyStr(target.unit) + ' differs from stored ' + pyStr(row.unit) + '; used lab range';
  } else {
    note = '';
  }
  const refRange = row.ref_range === undefined ? '' : row.ref_range;
  const [lo, hi, li, hiInc] = parseRange(refRange);
  if (lo == null && hi == null) return [null, null, true, true, '', refRange, note];
  return [lo, hi, li, hiInc, 'lab range', refRange, note];
}

/* ['above' | 'below' | 'in' | '', low, high, basis, text, note] for a stored row. */
export function position(row, target) {
  const [lo, hi, li, hiInc, basis, text, note] = boundsFor(row, target);
  let pos = compare(numOf(row), qual(row), lo, hi, li, hiInc);
  if (!pos && basis === '' && row.lab_flag) {
    pos = String(row.lab_flag).startsWith('H') ? 'above' : 'below';   // lab flag, no numeric bounds
  }
  return [pos, lo, hi, basis, text, note];
}

/* Interval for a value close to a bound: the out-of-target interval for that side, or None
   when that side is not a concern (empty high/low months). */
function nearSideMonths(v, lo, hi, policy) {
  if (hi != null && (lo == null || Math.abs(hi - v) <= Math.abs(v - lo))) return policy.high_months;
  return policy.low_months;
}

export function nearLimit(v, lo, hi, pct) {
  if (v == null || (lo == null && hi == null)) return false;
  const span = (lo != null && hi != null) ? (hi - lo) : (hi != null ? hi : lo);
  const margin = Math.abs(span) * pct / 100.0;
  return (hi != null && hi - v <= margin) || (lo != null && v - lo <= margin);
}

/* The Assessment dataclass as a plain object, fields in its order. */
function assessment(base, r) {
  return {
    marker: base.marker, policy: base.policy, n: base.n, last_date: base.last_date, last_value: base.last_value,
    last_unit: base.last_unit, last_range: base.last_range,
    basis: r.basis, basis_text: r.basis_text, state: r.state, interval_months: r.interval_months,
    next_due: r.next_due, decision: r.decision, reason: r.reason,
  };
}
const none = { basis: '', basis_text: '', state: '', interval_months: null, next_due: null };

export function assess(marker, rows, policy, target, draw, cadenceMonths, nearPct, dob = null) {
  rows = pySorted(rows, r => [req(r, 'date_drawn'), req(r, 'panel')]);
  const n = rows.length;
  const latest = rows.length ? rows[rows.length - 1] : null;
  let prev = null;
  if (latest) {
    const earlier = rows.filter(r => r.date_drawn < latest.date_drawn);
    prev = earlier.length ? earlier[earlier.length - 1] : null;
  }
  const base = {
    marker, policy, n, last_date: latest ? req(latest, 'date_drawn') : null,
    last_value: latest ? req(latest, 'value') : '', last_unit: latest ? req(latest, 'unit') : '',
    last_range: latest ? req(latest, 'ref_range') : '',
  };
  if (policy == null) {
    return assessment(base, { ...none, decision: 'NO POLICY', reason: 'no row in config/policy.csv' });
  }
  const age = dob ? ageOn(dob, draw) : null;
  if (age != null && ((policy.min_age != null && age < policy.min_age) ||
                      (policy.max_age != null && age > policy.max_age))) {
    return assessment(base, { ...none, decision: 'OUTSIDE AGE', reason: 'policy age window ' +
      (policy.min_age ? pyStr(policy.min_age) : '') + '-' + (policy.max_age ? pyStr(policy.max_age) : '') +
      '; age at draw ' + pyD(age) });
  }
  if (policy.covered_by) {
    const pos = latest ? position(latest, target)[0] : '';
    const last = latest ? 'last ' + pyStr(latest.date_drawn) + ' = ' + pyStr(latest.value) + ' (' + (pos || 'no bounds') + ')'
                        : 'never measured';
    return assessment(base, { ...none, state: 'covered', decision: 'COVERED', reason: last + '; not needed: ' + policy.covered_by });
  }
  if (latest == null) {
    if (!policy.routine) {
      return assessment(base, { ...none, state: 'never measured', decision: 'OPTIONAL',
        reason: 'never measured; routine testing not recommended by guidelines (routine=no) - order only with a specific reason' });
    }
    return assessment(base, { ...none, state: 'never measured', decision: 'ORDER', reason: 'no baseline in the store' });
  }
  if (policy.once) {
    const [pos, , , basis, text] = position(latest, target);
    return assessment(base, { basis, basis_text: text, state: 'one-time, done', interval_months: null, next_due: null,
      decision: 'DONE', reason: 'one-time marker, measured ' + pyStr(latest.date_drawn) + ' (' + (pos || 'no bounds') + ' ' + pyStr(text) + ')' });
  }

  const [pos, lo, hi, basis, text, note] = position(latest, target);
  const v = numOf(latest);
  const prevPos = prev ? position(prev, target)[0] : '';
  const label = text ? (basis || 'printed range') + ' ' + pyStr(text) : 'no numeric range';
  const value = pyStr(latest.value);
  let state, months, rule;
  if (pos === 'above') {
    if (policy.severe_high != null && v != null && v >= policy.severe_high && policy.severe_months != null) {
      state = 'well above target'; months = policy.severe_months;
      rule = value + ' >= severe_high ' + pyFloatStr(policy.severe_high) + ' -> severe_months=' + pyD(months) +
        (months === 0 ? ' (0 = evaluate promptly)' : '');
    } else if (policy.high_months && prevPos === 'above' && policy.persistent_months) {
      state = 'persistently above target'; months = policy.persistent_months;
      rule = value + ' above ' + label + ', also above on ' + pyStr(prev.date_drawn) + ' -> persistent_months=' + pyD(months);
    } else if (policy.high_months) {
      state = 'above target'; months = policy.high_months;
      rule = value + ' above ' + label + ' (first time) -> high_months=' + pyD(months);
    } else {
      state = 'above target (not a concern in this direction)'; months = policy.base_months;
      rule = value + ' above ' + label + '; high_months empty -> base_months=' + pyD(months);
    }
  } else if (pos === 'below') {
    if (policy.severe_low != null && v != null && v <= policy.severe_low && policy.severe_months != null) {
      state = 'well below target'; months = policy.severe_months;
      rule = value + ' <= severe_low ' + pyFloatStr(policy.severe_low) + ' -> severe_months=' + pyD(months) +
        (months === 0 ? ' (0 = evaluate promptly)' : '');
    } else if (policy.low_months && prevPos === 'below' && policy.persistent_months) {
      state = 'persistently below target'; months = policy.persistent_months;
      rule = value + ' below ' + label + ', also below on ' + pyStr(prev.date_drawn) + ' -> persistent_months=' + pyD(months);
    } else if (policy.low_months) {
      state = 'below target'; months = policy.low_months;
      rule = value + ' below ' + label + ' (first time) -> low_months=' + pyD(months);
    } else {
      state = 'below target (not a concern in this direction)'; months = policy.base_months;
      rule = value + ' below ' + label + '; low_months empty -> base_months=' + pyD(months);
    }
  } else if (pos === '') {
    state = 'no numeric bounds'; months = policy.base_months;
    rule = 'no usable bounds (' + (text ? pyStr(text) : 'none') + ') and no lab flag -> base_months=' + pyD(months);
  } else if (prevPos === 'above' || prevPos === 'below') {
    state = 'recently back in target'; months = policy.confirm_months;
    rule = 'in ' + label + ' now; ' + pyStr(prev.date_drawn) + ' was ' + prevPos + ' -> confirm_months=' + pyD(months);
  } else if (nearLimit(v, lo, hi, nearPct) && nearSideMonths(v, lo, hi, policy)) {
    months = nearSideMonths(v, lo, hi, policy);
    state = 'near target limit';
    rule = 'within ' + pyD(nearPct) + '% of ' + label + ' -> treated like out of range on that side -> ' + pyD(months) + ' months';
  } else {
    state = 'in target, stable'; months = policy.base_months;
    rule = 'in ' + label + ' -> base_months=' + pyD(months);
  }
  if (note) rule += '; ' + note;
  if (!policy.routine && (pos === 'in' || pos === '')) {
    return assessment(base, { basis, basis_text: text, state, interval_months: null, next_due: null, decision: 'OPTIONAL',
      reason: 'last ' + pyStr(latest.date_drawn) + ' was ' + (pos === 'in' ? 'in target' : 'unflagged') +
        '; routine re-testing not recommended by guidelines (routine=no) - order only with a specific reason' });
  }
  const [y, m, d] = unpackInts3(latest.date_drawn);
  const nextDue = addMonths(pyDate(y, m, d), months);
  const following = addMonths(draw, cadenceMonths);
  // draw + (following - draw) / 2: a date plus a timedelta keeps only the whole days
  const midpoint = addDays(draw, Math.floor(daysBetween(following, draw) / 2));
  let decision, reason;
  if (nextDue <= draw) {
    const late = Math.floor(daysBetween(draw, nextDue) / 30);
    const when = late >= 1 ? 'overdue since ' + nextDue + ', ~' + pyD(late) + ' months' : 'due ' + nextDue;
    decision = 'ORDER'; reason = when + ' (' + rule + ')';
  } else if (nextDue <= midpoint) {
    decision = 'ORDER'; reason = 'due ' + nextDue + ', closer to this draw than to the next (~' + following + ') (' + rule + ')';
  } else {
    decision = 'SKIP'; reason = 'next due ' + nextDue + '; revisit at the draw after this one (~' + following + ') (' + rule + ')';
  }
  return assessment(base, { basis, basis_text: text, state, interval_months: months, next_due: nextDue, decision, reason });
}
