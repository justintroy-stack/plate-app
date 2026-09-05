/* Labs change dinner: the food targets reshape the rotation. A line-for-line twin of
   labtrack/rotation.py.

   `buildPlan(cfg, diet, order)` turns the three count targets (red_meat_slots, fish_slots,
   beans_slots) into the smallest set of slot swaps that reaches them, each swap carrying the
   rule that asked for it and the stock it is gated on. A slot the regimen leaves out must go
   whatever the counts say: the distance is really (slots the regimen leaves out, count
   distance), compared the way Python compares tuples. Nothing is forced: what cannot be
   reached is reported as unmet, what cannot be replaced as unplaced. `describe` renders the
   plan as the plain lines the CLI prints. */
import { mealIndex, coldAverage, occasionShare, has, hasStr, get, getStr, req, truthy, pyIter, toFloat, pyIntOf } from './plate_config.js';
import { pyCmp, pyRound, pyD, pyG, sortedSet, isDigit, pyInt, lower } from './py.js';

export const COUNT_KEYS = [['red_meat_slots', 'red_meat'], ['fish_slots', 'fish'], ['beans_slots', 'beans']];
const COUNT_CLASSES = new Set(COUNT_KEYS.map(([, cls]) => cls));

/* 0 when the candidate is a plate of the same size as the one leaving, within a quarter of its
   calories; 1 otherwise (rotation.py _size_gap). */
function sizeGap(old, cand) {
  return Math.abs((get(cand, 'kcal') || 0) - (get(old, 'kcal') || 0)) <= 0.25 * (get(old, 'kcal') || 0) ? 0 : 1;
}

function klass(meal, cls) {
  // a bean night is any meal using something tagged beans, the tag regimens.csv speaks in
  if (cls === 'beans') return (meal.contains || []).includes('beans');
  return meal.protein_class === cls;
}

export function counts(order, meals) {
  const out = {};
  for (const [, cls] of COUNT_KEYS) {
    let n = 0;
    for (const mid of pyIter(order)) if (hasStr(meals, mid) && klass(meals[mid], cls)) n += 1;
    out[cls] = n;
  }
  return out;
}

function goalOf(targets) {
  const goal = {};
  for (const [key, cls] of COUNT_KEYS) {
    const v = get(targets, key);
    if (v != null) goal[cls] = pyIntOf(pyRound(toFloat(v)));
  }
  return goal;
}

export function distance(cnt, goal) {
  let d = 0;
  for (const [cls, g] of Object.entries(goal)) d += Math.abs(get(cnt, cls, 0) - g);
  return d;
}

/* How many slots hold a meal the regimen leaves out. */
function outOf(order, meals) {
  let n = 0;
  for (const mid of pyIter(order)) {
    const m = getStr(meals, mid);
    if (truthy(m) && truthy(get(m, 'excluded'))) n += 1;
  }
  return n;
}

/* Per-meal averages for the rotation plus the cold block attached to it: what one plate of the
   rotation occasion delivers. `occ` is required, never defaulted: an implicit "every slot" would
   quietly add breakfast's cold block to dinner's hot mean and call the sum a plate. */
export function estimate(order, cfg, meals, occ) {
  const hot = [];
  for (const m of pyIter(order)) if (hasStr(meals, m)) hot.push(meals[m]);
  const out = {};
  for (const field of ['kcal', 'protein_g', 'sat_fat_g', 'fiber_g']) {
    const vals = hot.filter(m => get(m, field) != null).map(m => m[field]);
    if (!vals.length) continue;
    let s = 0;
    for (const v of vals) s += v;
    out[field] = pyRound(s / vals.length + coldAverage(cfg, field, occ.id), 1);
  }
  return out;
}

/* What one plate of an occasion that carries no recipe delivers: its option pools alone. */
export function occasionEstimate(cfg, occ) {
  const out = {};
  for (const f of ['kcal', 'protein_g', 'sat_fat_g', 'fiber_g']) out[f] = pyRound(coldAverage(cfg, f, occ.id), 1);
  return out;
}

/* What a day of every occasion in play delivers per person, at the plate the config was loaded
   for: the rotation occasion's plate with its cold block, plus each other occasion's pools. */
export function dayEstimate(cfg) {
  const meals = mealIndex(cfg);
  const total = {};
  for (const occ of cfg.occasions) {
    const est = occ.rotation ? estimate(cfg.baseline, cfg, meals, occ) : occasionEstimate(cfg, occ);
    for (const [k, v] of Object.entries(est)) total[k] = pyRound((has(total, k) ? total[k] : 0) + v, 1);
  }
  return total;
}

/* One food group certain to land three or more times on a night of the rotation: the plate's
   own tags plus every slot in play whose every live option carries the tag, so no turn of the
   cold block avoids it, on three nights of the cycle at the least. The worst case, or null. A
   note for the person to read, never a rule the planner acts on. A twin of rotation.group_note. */
export function groupNote(cfg) {
  const meals = mealIndex(cfg);
  const certain = {};                              // tag -> the slots it lands in whatever they draw
  for (const sl of cfg.cold) {
    const opts = sl.opts.filter(o => !truthy(get(o, 'excluded')));
    if (!opts.length) continue;
    let common = new Set(opts[0].contains);
    for (const o of opts.slice(1)) common = new Set([...common].filter(t => o.contains.includes(t)));
    for (const tag of common) (certain[tag] = certain[tag] || []).push(sl.name);
  }
  const order = cfg.baseline;
  const tags = new Set(Object.keys(certain));
  for (const mid of order) for (const t of meals[mid].contains) tags.add(t);
  let best = null;
  for (const tag of sortedSet(tags)) {
    const base = (certain[tag] || []).length;
    const nights = order.filter(mid => meals[mid].contains.includes(tag));
    const times = base + (nights.length ? 1 : 0);
    const on = nights.length ? nights.length : order.length;
    if (times < 3 || on < 3) continue;               // a night or two is not a pattern
    const items = new Set();
    for (const mid of nights) for (const k of Object.keys(meals[mid].uses)) if (cfg.items[k].tags.includes(tag)) items.add(cfg.items[k].name);
    const cand = { tag, times, nights: on, of: order.length,
                   slots: (certain[tag] || []).slice(), items: sortedSet(items) };
    const key = [times, cand.nights];
    if (best === null || pyCmp(key, best[0]) > 0) best = [key, cand];
  }
  return best ? best[1] : null;
}

export const PLATE_MIN = 0.5, PLATE_MAX = 1.4;

/* The plate factor that makes a day of the plan, cooked as written, meet a calorie target: the
   target over the day's estimate at scale 1, to the nearest 0.05, held inside the bounds. `cfg`
   must be loaded at plate 1. A twin of rotation.plate_for, rounding as Python does. */
export function plateFor(cfg, kcal) {
  const day = dayEstimate(cfg);
  const base = (has(day, 'kcal') && day.kcal) ? day.kcal : 0;
  if (!base || !kcal) return { plate: 1, day_kcal: base, ratio: null, clamped: false, plate_kcal: base };
  const ratio = Number(kcal) / base;
  const snapped = pyRound(ratio * 20) / 20;
  let plate = Math.min(PLATE_MAX, Math.max(PLATE_MIN, snapped));
  plate = pyRound(plate, 2);
  return { plate, day_kcal: base, ratio: pyRound(ratio, 3), clamped: plate !== pyRound(snapped, 2), plate_kcal: pyRound(base * plate) };
}

/* The page stores meal ids; older states stored indexes into the baseline. */
export function normalizeOrder(order, cfg) {
  const base = cfg.baseline;
  const meals = mealIndex(cfg);
  if (!Array.isArray(order) || order.length !== base.length) return [...base];
  const out = [];
  order.forEach((v, pos) => {
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (typeof v === 'number' && 0 <= pyIntOf(v) && pyIntOf(v) < base.length) out.push(base[pyIntOf(v)]);
    else if (typeof v === 'string' && isDigit(v) && 0 <= pyInt(v) && pyInt(v) < base.length) out.push(base[pyInt(v)]);
    else if (typeof v === 'string' && has(meals, v)) out.push(v);
    else out.push(base[pos]);
  });
  return out;
}

/* diet: the dict from diet.build_diet(). order: the rotation as the phone holds it now (meal
   ids by position). Returns the swaps needed, in the order they should be taken. */
export function buildPlan(cfg, diet, order = null) {
  const meals = mealIndex(cfg);
  const pool = cfg.meals.filter(m => m.in_pool);
  const current = normalizeOrder(order, cfg);
  const targets = truthy(get(diet, 'targets')) ? diet.targets : {};
  const goal = goalOf(targets);
  const work = [...current];
  const swaps = [];
  let cnt = counts(work, meals);
  let dist = [outOf(work, meals), distance(cnt, goal)];
  const regimen = get(truthy(get(cfg, 'regimen')) ? cfg.regimen : {}, 'id', '');
  let guard = 0;
  while (pyCmp(dist, [0, 0]) > 0 && guard < 3 * work.length) {
    guard += 1;
    let best = null;
    const over = Object.entries(goal).filter(([cls, g]) => get(cnt, cls, 0) > g).map(([cls]) => cls);
    const under = Object.entries(goal).filter(([cls, g]) => get(cnt, cls, 0) < g).map(([cls]) => cls);
    const occurrences = {};
    for (const mid of work) occurrences[mid] = get(occurrences, mid, 0) + 1;
    work.forEach((mid, pos) => {
      const m = getStr(meals, mid);
      if (!truthy(m)) return;
      const leaving = truthy(get(m, 'excluded'));         // the regimen leaves it out: any pool meal may take the slot
      if (!leaving && !over.some(cls => klass(m, cls))) return;
      pool.forEach((cand, cand_i) => {
        if (cand.id === mid) return;
        if (!leaving) {
          const under_hit = under.some(cls => klass(cand, cls));
          const neutral = !COUNT_CLASSES.has(cand.protein_class) && !over.some(cls => klass(cand, cls));
          if (!(under_hit || (!under.length && neutral))) return;
        }
        const trial = [...work];
        trial[pos] = cand.id;
        const d = [outOf(trial, meals), distance(counts(trial, meals), goal)];
        if (pyCmp(d, dist) >= 0) return;
        const key = [d, sizeGap(m, cand), -(get(m, 'sat_fat_g') || 0), pos, get(occurrences, cand.id, 0), cand_i];
        if (best === null || pyCmp(key, best[0]) < 0) best = [key, pos, mid, cand.id];
      });
    });
    if (best === null) break;
    const [, pos, old, nu] = best;
    const before = Object.assign({}, cnt);
    work[pos] = nu;
    cnt = counts(work, meals);
    dist = [outOf(work, meals), distance(cnt, goal)];
    const changed = {};
    for (const cls of Object.keys(cnt)) if (before[cls] !== cnt[cls]) changed[cls] = [before[cls], cnt[cls]];
    const old_m = meals[old], new_m = meals[nu];
    const leaving = truthy(get(old_m, 'excluded'));
    const why = leaving ? [] : pyIter(get(diet, 'adjustments') || []).filter(a => truthy(get(a, 'changed'))
      && COUNT_KEYS.some(([key, cls]) => has(changed, cls) && get(a, 'target') === key));
    const gate = get(old_m, 'protein_item');
    const item = truthy(gate) ? get(cfg.items, gate) : null;
    swaps.push({ key: old + '>' + nu, slot: pos, from: old, to: nu,
      from_name: old_m.name, to_name: new_m.name,
      gate_item: gate, gate_name: truthy(item) ? item.name : '', gate_unit: truthy(item) ? item.unit : '',
      gate_use: truthy(gate) ? get(old_m.uses, gate) : null,
      changes: changed, why,
      regimen: leaving ? regimen : '', excluded: leaving ? [...(get(old_m, 'excluded') || [])] : [] });
  }
  const unmet = Object.entries(goal).filter(([cls, g]) => get(cnt, cls, 0) !== g)
    .map(([cls, g]) => ({ key: cls, goal: g, reached: get(cnt, cls, 0) }));
  const unplaced = [];
  work.forEach((mid, pos) => {
    const m = getStr(meals, mid);
    if (truthy(m) && truthy(get(m, 'excluded'))) unplaced.push({ slot: pos, meal: mid, name: m.name, excluded: [...m.excluded] });
  });
  const day = {};
  for (const k of ['kcal', 'protein_g', 'fiber_g', 'added_sugar_g', 'sat_fat_g']) if (has(targets, k)) day[k] = targets[k];
  const rot = cfg.occasions.find(o => o.id === cfg.rotation_occasion);
  // The day's targets are the person's. An occasion takes a share of them, and the counts stay
  // whole because they are per rotation, not per plate.
  const occasions = cfg.occasions.map(o => {
    const share = occasionShare(cfg, o);
    const ot = {};
    for (const [k, v] of Object.entries(day)) ot[k] = pyRound(v * share, 1);
    return { id: o.id, name: o.name, share, portions: o.portions, rotation: o.rotation,
      estimate: o.rotation ? estimate(work, cfg, meals, o) : occasionEstimate(cfg, o), targets: ot };
  });
  const rotShare = occasionShare(cfg, rot);
  const tk = {};
  for (const [k, v] of Object.entries(day)) tk[k] = pyRound(v * rotShare, 1);
  return { goal, counts: { current: counts(current, meals), target: cnt },
    order_current: current, order_target: work, swaps, unmet, unplaced,
    estimate: { current: estimate(current, cfg, meals, rot), target: estimate(work, cfg, meals, rot) },
    targets: tk, day_targets: day, occasions,
    lens: get(diet, 'lens', ''), regimen };
}

/* Plain lines for the CLI and for anyone reading the plan without the page. */
export function describe(plan, cfg) {
  const lines = [];
  const c = plan.counts.current, t = plan.counts.target;
  for (const [cls, g] of Object.entries(plan.goal)) {
    const reached = get(t, cls, 0);
    lines.push(cls.replace(/_/g, ' ').padEnd(9) + ' now ' + pyD(get(c, cls, 0)) + ', goal ' + pyD(g)
      + (reached === g ? '' : ' (reached ' + pyD(reached) + ')'));
  }
  const name = lower(get(truthy(get(cfg, 'regimen')) ? cfg.regimen : {}, 'name') || get(plan, 'regimen') || 'regimen');
  for (const s of plan.swaps) {
    let gate = '';
    if (truthy(s.gate_item)) gate = ' after the ' + (s.gate_name || s.gate_item) + ' on hand is used up';
    let rules;
    if (truthy(get(s, 'regimen'))) rules = 'not on the ' + name + ' plan: has ' + (get(s, 'excluded') || []).join(', ');
    else rules = sortedSet(s.why.map(a => req(a, 'rule'))).join(', ') || 'targets';
    lines.push('slot ' + pyD(s.slot + 1) + ': ' + s.from_name + ' -> ' + s.to_name + gate + '  [' + rules + ']');
  }
  for (const u of plan.unmet) {
    lines.push(u.key.replace(/_/g, ' ') + ': goal ' + pyD(u.goal) + ', only ' + pyD(u.reached) + ' reachable with the meals in meals.csv');
  }
  for (const u of (get(plan, 'unplaced') || [])) {
    lines.push('slot ' + pyD(u.slot + 1) + ': ' + u.name + ' is not on the ' + name + ' plan (has ' + u.excluded.join(', ')
      + ') and nothing in meals.csv can replace it');
  }
  const e = plan.estimate;
  if (truthy(get(e, 'target'))) {
    const parts = [];
    for (const [k, label] of [['kcal', 'kcal'], ['protein_g', 'g protein'], ['sat_fat_g', 'g sat fat'], ['fiber_g', 'g fiber']]) {
      if (has(e.target, k)) {
        const tgt = get(plan.targets, k);
        parts.push(pyG(e.target[k]) + ' ' + label + (tgt != null ? ' (target ' + pyG(tgt) + ')' : ''));
      }
    }
    lines.push('rotation estimate per meal, with the cold block: ' + parts.join(', '));
  }
  // Only worth saying when the day is split: at one occasion the line above already is the day.
  for (const o of (get(plan, 'occasions') || [])) {
    if (plan.occasions.length < 2) break;
    const parts = [];
    for (const [k, label] of [['kcal', 'kcal'], ['protein_g', 'g protein']]) {
      if (has(o.estimate, k)) parts.push(pyG(o.estimate[k]) + ' ' + label + ' (target ' + pyG(get(o.targets, k, 0)) + ')');
    }
    lines.push(o.name + ' takes ' + pyRound(o.share * 100, 0) + '% of the day: ' + parts.join(', '));
  }
  return lines;
}
