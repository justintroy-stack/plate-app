/* Lab-driven food targets. A line-for-line twin of labtrack/diet.py.

   Baseline targets come from the person's own plan (config/diet.csv); the regimen it names
   (config/regimens.csv) replaces the three nights-per-cycle counts when it states them. Rules
   in config/diet_rules.csv adjust them while a marker sits above or below its target under the
   chosen lens, each rule carrying its basis; a rule aimed at a count whose food the regimen
   leaves out is recorded as not applicable rather than fired. The plan's own numbers are an
   estimate from the body (targetsFromProfile: Mifflin-St Jeor times an activity factor, then
   the goal's deficit), and when a food tracking app's export is on file its expenditure
   estimate minus the plan's own deficit replaces the calorie figure. The output is a set of
   numbers and slot weights for the food planner to consume, with every adjustment explained.
   It changes targets the person already set; it does not prescribe treatment. */
import { readRows } from './csv.js';
import { ConfigError, lower, orEmpty, pyFloat, pyReprStr, pyRound, pySorted, strip } from './py.js';
import { daysBetween, parseIso } from './pydate.js';
import { COUNT_TAGS, leavesOut, loadFor, loadRegimens, numstr, regimenFromDiet } from './plate_config.js';
import { ageOn, loadPolicy, loadProfile } from './policy.js';
import { plateFor } from './rotation.js';
import { req } from './pyx.js';
import { loadTargets, targetShort, targetStatus } from './targets.js';
import { loadBody, loadIntake } from './tracker.js';

export const NUMERIC = ['kcal', 'protein_g', 'fiber_g', 'added_sugar_g', 'sat_fat_g', 'red_meat_slots', 'fish_slots', 'beans_slots', 'deficit_kcal'];

// ---- the body estimate: what a day asks for, from the person rather than from a file

// Mifflin-St Jeor times one of these; the usual five levels
export const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
export const GOALS = ['hold', 'lose', 'gain'];
export const RATES = { gentle: 250, steady: 500 };     // kcal a day under (or over) maintenance
export const BODY_KEYS = ['weight_lb', 'height_in', 'sex', 'dob', 'activity', 'goal', 'rate'];
export const PROTEIN_PER_LB = 0.8;
export const PROTEIN_BAND = [60, 220];                  // grams a day; 0.8 g per lb outside this is clamped to it
export const FIBER_PER_1000_KCAL = 14;
export const SAT_FAT_SHARE = 0.10;
export const ADDED_SUGAR_G = 20;                        // the plan's own decision, applied to everyone
export const KCAL_FLOOR = 1200;                         // the lowest a day goes here, whatever the arithmetic says
export const WEIGHT_BAND = [50, 700];
export const HEIGHT_BAND = [36, 96];
export const ESTIMATE_KEYS = ['kcal', 'protein_g', 'fiber_g', 'sat_fat_g', 'added_sugar_g', 'deficit_kcal'];
const BODY_LABEL = { weight_lb: 'weight', height_in: 'height', sex: 'sex', dob: 'date of birth', activity: 'activity', goal: 'goal', rate: 'rate' };

/* 'm' or 'f' from what a person typed ('m', 'male', 'Female'), else '' */
function sexOf(v) {
  v = lower(strip(v));
  return ['m', 'f', 'male', 'female'].includes(v) ? v.slice(0, 1) : '';
}

/* float(value), or null when Python would raise */
function floatOrNull(s) {
  try { return pyFloat(s); } catch (e) { return null; }
}

/* The value one About-you row would be written with, or a ConfigError saying why it cannot be,
   so an interview can check every answer before it writes any. A blank clears the row. */
export function checkBody(key, value) {
  if (!BODY_KEYS.includes(key)) throw new ConfigError(key + ' is not something About you asks');
  value = strip(value);
  if (!value) return value;
  if (key === 'weight_lb' || key === 'height_in') {
    const n = floatOrNull(value);
    if (n === null) throw new ConfigError(BODY_LABEL[key] + ' must be a number, not ' + pyReprStr(value));
    const [lo, hi] = key === 'weight_lb' ? WEIGHT_BAND : HEIGHT_BAND;
    const unit = key === 'weight_lb' ? 'lb' : 'inches';
    if (!(lo <= n && n <= hi)) throw new ConfigError(BODY_LABEL[key] + ' must be between ' + lo + ' and ' + hi + ' ' + unit + ', not ' + numstr(n));
    return numstr(n);
  }
  if (key === 'sex') {
    const s = sexOf(value);
    if (!s) throw new ConfigError('sex must be m or f, not ' + pyReprStr(value));
    return s;
  }
  if (key === 'dob') {
    try { parseIso(value); } catch (e) { throw new ConfigError('date of birth must be YYYY-MM-DD, not ' + pyReprStr(value)); }
    return value;
  }
  if (key === 'activity' && !has(ACTIVITY, value)) throw new ConfigError('activity must be one of ' + Object.keys(ACTIVITY).join(', ') + ', not ' + pyReprStr(value));
  if (key === 'goal' && !GOALS.includes(value)) throw new ConfigError('goal must be one of ' + GOALS.join(', ') + ', not ' + pyReprStr(value));
  if (key === 'rate' && !has(RATES, value)) throw new ConfigError('rate must be one of ' + Object.keys(RATES).join(', ') + ', not ' + pyReprStr(value));
  return value;
}

/* A day's numbers from a body: resting energy by Mifflin-St Jeor, times the activity factor,
   then the goal's deficit under it (lose), over it (gain) or none (hold); protein 0.8 g per lb
   clamped to PROTEIN_BAND; fibre 14 g per 1,000 kcal; saturated fat a tenth of the calories;
   added sugar 20 g flat. Calories to the nearest 10 and protein to the nearest 5: the estimate
   is within about 15 percent for any one person, and a number that looks exact would be lying
   about that. Every rounding is Python's round(), half to even. */
export function targetsFromBody(weight_lb, height_in, sex, age, activity, goal, rate) {
  const kg = weight_lb * 0.45359237;
  const cm = height_in * 2.54;
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (sex === 'm' ? 5 : -161);
  const maintenance = bmr * ACTIVITY[activity];
  const deficit = goal === 'hold' ? 0 : (goal === 'lose' ? RATES[rate] : -RATES[rate]);
  const kcal_raw = pyRound((maintenance - deficit) / 10) * 10;
  const kcal = Math.max(kcal_raw, KCAL_FLOOR);
  const protein_raw = pyRound(weight_lb * PROTEIN_PER_LB / 5) * 5;
  const protein = Math.min(PROTEIN_BAND[1], Math.max(PROTEIN_BAND[0], protein_raw));
  return { bmr: pyRound(bmr), maintenance: pyRound(maintenance / 10) * 10, kcal,
           protein_g: protein, protein_clamped: protein !== protein_raw, kcal_floored: kcal !== kcal_raw,
           fiber_g: pyRound(kcal * FIBER_PER_1000_KCAL / 1000), sat_fat_g: pyRound(kcal * SAT_FAT_SHARE / 9),
           added_sugar_g: ADDED_SUGAR_G, deficit_kcal: deficit };
}

/* The estimate from the profile's About-you rows: the numbers with the body they came from, or
   `missing`, the rows still needed (a row that cannot be read counts as missing). The rate is
   gentle unless stated, and is not needed to hold. `today` is an ISO date. */
export function targetsFromProfile(prof, today) {
  prof = prof || {};
  const val = k => strip(has(prof, k) ? prof[k] : '');
  const missing = BODY_KEYS.filter(k => k !== 'rate' && !val(k));
  if (missing.length) return { missing };
  const weight = floatOrNull(val('weight_lb')), height = floatOrNull(val('height_in'));
  if (weight === null || height === null) return { missing: ['weight_lb', 'height_in'].filter(k => floatOrNull(val(k)) === null) };
  const sex = sexOf(val('sex'));
  let age = null;
  try { age = ageOn(val('dob'), today); } catch (e) { age = null; }
  const activity = val('activity'), goal = val('goal'), rate = val('rate') || 'gentle';
  const bad = [['sex', !!sex], ['dob', age !== null], ['activity', has(ACTIVITY, activity)], ['goal', GOALS.includes(goal)], ['rate', has(RATES, rate)]]
    .filter(([, ok]) => !ok).map(([k]) => k);
  if (bad.length) return { missing: bad };
  const out = targetsFromBody(weight, height, sex, age, activity, goal, rate);
  return Object.assign(out, { missing: [], age, weight_lb: weight, height_in: height, sex, activity, goal, rate });
}

/* What About you would set, before anything is written: each answer checked the way the save
   checks it, then the estimate. `answers` are the interview's other choices, unused here and
   read by the plate sizing beside it. */
export function targetPreview(home, profile, answers, today) {
  const prof = {};
  for (const [key, value] of Object.entries(profile || {})) prof[strip(key)] = checkBody(strip(key), value);
  const estimate = targetsFromProfile(prof, today);
  const out = { estimate, plate: null, kcal: null };
  if (!estimate.missing.length) {
    const diet = loadDiet(home);
    for (const key of ['regimen', 'occasions', 'portions']) {
      if (answers && answers[key] != null) diet[key] = strip(String(answers[key]));
    }
    /* one figure sizes the plate and is the figure the line says: the body's estimate (diet.py's target_preview) */
    const kcal = pyFloat(String(estimate.kcal));
    out.kcal = kcal;
    out.plate = plateFor(loadFor(home, loadProfile(home), diet, 1), kcal);
  }
  return out;
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/* sum(list of floats): Python starts at 0 and adds left to right */
const sum = xs => xs.reduce((a, b) => a + b, 0);

/* config/diet.csv as {key: value}, both stripped */
export function loadDiet(home) {
  const out = {};
  const text = home.read('config/diet.csv');
  if (text != null) {
    for (const r of readRows(text)) if (r.key) out[r.key.trim()] = strip(r.value);
  }
  return out;
}

/* config/diet_rules.csv, every cell stripped, rows without a rule_id dropped */
export function loadRules(home) {
  const text = home.read('config/diet_rules.csv');
  if (text == null) return [];
  const out = [];
  for (const r of readRows(text)) {
    if (!strip(r.rule_id)) continue;
    const o = {};
    for (const [k, v] of Object.entries(r)) o[k] = strip(v);
    out.push(o);
  }
  return out;
}

/* marker -> {latest, previous, value, unit, date, target}: the position of the latest and the
   previous draw against the chosen lens. */
export function markerStates(home, store, lens) {
  const targets = loadTargets(home, { risk_tier: loadProfile(home).risk_tier, lens });
  const by = new Map();
  for (const r of store.load()) {
    if (r.marker) {
      if (!by.has(r.marker)) by.set(r.marker, []);
      by.get(r.marker).push(r);
    }
  }
  const out = {};
  for (const [m, rows0] of by) {
    const rows = pySorted(rows0, x => [req(x, 'date_drawn'), req(x, 'panel')]);
    const t = has(targets, m) ? targets[m] : null;
    const dates = [];
    for (const r of rows) {
      if (dates.includes(r.date_drawn)) continue;
      dates.push(r.date_drawn);
    }
    const latest = rows.filter(r => r.date_drawn === dates[dates.length - 1])[0];
    const prev = dates.length > 1 ? rows.filter(r => r.date_drawn === dates[dates.length - 2])[0] : null;
    const flag = orEmpty(latest.lab_flag);
    const pos = t ? targetStatus(latest, t)[0] : (flag.startsWith('H') ? 'above' : (flag.startsWith('L') ? 'below' : ''));
    const ppos = prev ? ((prev && t) ? targetStatus(prev, t)[0] : '') : '';
    out[m] = { latest: pos, previous: ppos, value: req(latest, 'value'), unit: req(latest, 'unit'), date: latest.date_drawn,
               target: t ? targetShort(t) : (latest.ref_range === undefined ? '' : latest.ref_range) };
  }
  return out;
}

function cond(state, c) {
  if (!state) return false;
  const lat = state.latest, prev = state.previous;
  if (c === 'above') return lat === 'above';
  if (c === 'below') return lat === 'below';
  if (c === 'persistently_above') return lat === 'above' && prev === 'above';
  if (c === 'persistently_below') return lat === 'below' && prev === 'below';
  if (c === 'in') return lat === 'in';
  return false;
}

/* Calories from the tracker's 28-day expenditure estimate minus the plan's deficit, with the
   plan's arithmetic cross-check (intake vs weight change) beside it. null under 14 days. */
export function calibrateCalories(home, diet) {
  const intake = loadIntake(home);
  const body = loadBody(home);
  const recent = intake.filter(r => !(r.kcal === '' || r.kcal == null)).slice(-28);
  if (recent.length < 14) return null;
  const exp = recent.filter(r => !(r.expenditure_kcal === '' || r.expenditure_kcal == null)).map(r => pyFloat(req(r, 'expenditure_kcal')));
  const kc = recent.map(r => pyFloat(req(r, 'kcal')));
  // a stated 0 (a goal of holding weight) is a deficit of nothing, not the old default of 350
  const deficit = (has(diet, 'deficit_kcal') && diet.deficit_kcal !== '' && diet.deficit_kcal != null) ? pyFloat(diet.deficit_kcal) : 350.0;
  const out = { days: recent.length, avg_intake: pyRound(sum(kc) / kc.length), deficit };
  if (exp.length) {
    out.tracker_expenditure = pyRound(sum(exp) / exp.length);
    out.kcal_from_tracker = pyRound(out.tracker_expenditure - deficit);
  }
  const dates = pySorted(recent.map(r => req(r, 'date')));
  const wb = new Map();
  for (const r of body) wb.set(req(r, 'date'), r);
  const wAt = (d) => {
    const b = wb.has(d) ? wb.get(d) : null;
    return (b && (b.trend_weight_lb || b.weight_lb)) ? pyFloat(req(b, 'trend_weight_lb') || req(b, 'weight_lb')) : null;
  };
  const w0 = wAt(dates[0]), w1 = wAt(dates[dates.length - 1]);
  if (w0 != null && w1 != null) {
    const span = Math.max(1, daysBetween(dates[dates.length - 1], dates[0]));
    const maint = out.avg_intake - (w1 - w0) * 3500.0 / span;
    out.weight_start = w0;
    out.weight_end = w1;
    out.weight_change = pyRound(w1 - w0, 1);
    out.implied_maintenance = pyRound(maint);
    out.kcal_from_weight = pyRound(maint - deficit);
  }
  return out;
}

/* The markers the food rules read, one entry each, with the panel and the cost tier the retest
   policy gives them and what a firing rule moves. A note rule and the calorie recalibration
   read nothing a lab prints. */
export function rulesRead(rules, registry, policy, regimen = null) {
  const out = [], seen = {};
  const unmoved = (regimen && regimen.unmoved_by) || [];
  for (const r of rules) {
    if (r.target === 'note' || r.adjustment === 'recalibrate') continue;
    const m = req(r, 'marker');
    let e = has(seen, m) ? seen[m] : null;
    if (e === null) {
      const pol = has(policy, m) ? policy[m] : null;
      e = seen[m] = { marker: m, display: registry.display(m), panel: pol ? pol.order_panel : '',
                      cost: pol ? pol.cost_tier : '', conditions: [], targets: [], unmoved: unmoved.includes(m) };
      out.push(e);
    }
    if (!e.conditions.includes(r.condition)) e.conditions.push(r.condition);
    if (!e.targets.includes(r.target)) e.targets.push(r.target);
  }
  return out;
}

/* The food targets: the plan's own numbers, the regimen's counts, the rules that fired against
   the marker states under the profile's lens, and the calorie calibration. */
export function buildDiet(home, store, registry) {
  const prof = loadProfile(home);
  const lens = prof.guideline_lens || 'conventional';
  const diet = loadDiet(home);
  const rules = loadRules(home);
  const states = markerStates(home, store, lens);
  const targets = {};
  for (const k of NUMERIC) if (diet[k]) targets[k] = pyFloat(diet[k]);
  const rid = regimenFromDiet(diet);
  const regimen = loadRegimens(home).find(r => r.id === rid) || null;
  if (regimen) {
    for (const k of Object.keys(COUNT_TAGS)) {
      if (regimen[k] != null) targets[k] = pyFloat(regimen[k]);
    }
  }
  const baseline = Object.assign({}, targets);
  const fired = [], notes = [];
  for (const rule of rules) {
    const m = req(rule, 'marker');
    if (req(rule, 'target') === 'kcal' && req(rule, 'adjustment') === 'recalibrate') continue;
    const st = has(states, m) ? states[m] : null;
    if (!cond(st, req(rule, 'condition'))) continue;
    const adj = rule.adjustment;
    const entry = { rule: req(rule, 'rule_id'), marker: m, display: registry.display(m), condition: rule.condition,
                    value: st.value, unit: st.unit, date: st.date, target_text: st.target,
                    basis: req(rule, 'basis'), note: req(rule, 'note') };
    if (rule.target === 'note') {
      notes.push(entry);
      continue;
    }
    const key = rule.target;
    if (!has(targets, key)) continue;
    if (regimen && (regimen.unmoved_by || []).includes(m)) {
      // the plan is unmoved by this marker: the food rule stands down, so dinner stays what the plan chose
      entry.target = key;
      entry.not_applicable = true;
      entry.unmoved = true;
      entry.note = 'Not applicable: the ' + lower(req(regimen, 'name')) + ' plan does not let ' + registry.display(m) +
                   ' move dinner, so dinner stays as it is.';
      notes.push(entry);
      continue;
    }
    if (regimen && has(COUNT_TAGS, key) && leavesOut([COUNT_TAGS[key]], regimen).length) {
      // the food behind this count is not on the regimen, so the rule has nothing to move
      entry.target = key;
      entry.not_applicable = true;
      entry.note = 'Not applicable: the ' + lower(req(regimen, 'name')) + ' plan leaves out ' + COUNT_TAGS[key] +
                   ', so this rule does not move the count.';
      notes.push(entry);
      continue;
    }
    const before = targets[key];
    if (adj.startsWith('max:')) targets[key] = Math.min(targets[key], pyFloat(adj.slice(4)));
    else if (adj.startsWith('min:')) targets[key] = Math.max(targets[key], pyFloat(adj.slice(4)));
    else if (adj.startsWith('+') || adj.startsWith('-')) targets[key] = targets[key] + pyFloat(adj);
    entry.target = key;
    entry.before = before;
    entry.after = targets[key];
    entry.changed = targets[key] !== before;
    fired.push(entry);
  }
  /* history beside the target, never the target (diet.py's build_diet) */
  const cal = calibrateCalories(home, diet);
  const constraints = {};
  for (const [k, v] of Object.entries(diet)) if (!NUMERIC.includes(k)) constraints[k] = v;
  const outStates = {};
  for (const [m, s] of Object.entries(states)) if (s.latest === 'above' || s.latest === 'below') outStates[m] = s;
  return { lens, constraints, regimen, baseline, targets, adjustments: fired, notes, calories: cal, states: outStates,
           reads: rulesRead(rules, registry, loadPolicy(home), regimen) };
}
