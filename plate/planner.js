/* Plan and summary as data structures, shared by the CLI (text) and the local UI (JSON). A
   line-for-line twin of labtrack/planner.py.

   Dates are ISO strings throughout: a draw date, a due date and date.min sort and compare the
   way Python's date objects do, and every date the oracle returns is already an isoformat(). */
import { compute as computeDerived, loadDerived } from './derived.js';
import { loadExplanations, situation } from './explain.js';
import { loadHistory, monitoringDue, touches } from './history.js';
import { addMonths, ageOn, assess, loadPolicy, loadProfile } from './policy.js';
import { lower, pyFloat, pyInt, pyMin, pySorted, PyValueError, sortedSet, strip, upper } from './py.js';
import { DATE_MIN, pyMaxDate, today } from './pydate.js';
import { pyDate, PyKeyError, pyStr, req, unpackInts3 } from './pyx.js';
import { loadBoth, loadTargets, targetShort, targetStatus } from './targets.js';

export const SECTIONS = [
  ['order', 'ADD TO THIS DRAW (you order these)'],
  ['skip', 'SKIP THIS DRAW (not due yet)'],
  ['optional', 'OPTIONAL (guidelines do not recommend routine testing; order only with a reason)'],
  ['covered', 'NOT NEEDED (covered by another marker, or no guideline role)'],
  ['provider', "PROVIDER'S STANDING ORDER (for information)"],
  ['done', 'ONE-TIME MARKERS ALREADY DONE'],
  ['other', 'NEEDS ATTENTION IN CONFIG'],
];
const COST_ORDER = { low: 0, medium: 1, high: 2 };

export class PyRuntimeError extends Error {
  constructor(message) { super(message); this.name = 'RuntimeError'; }
}

const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
/* dict.get(k): null when the key is not there */
const get = (o, k) => (has(o, k) ? o[k] : null);

function fmtLast(a) {
  if (!a.last_date) return 'never measured';
  const rng = a.last_range ? ' (' + a.last_range + ')' : '';
  return pyStr(a.last_value) + ' ' + pyStr(a.last_unit) + rng + ' on ' + pyStr(a.last_date);
}

export function assessmentDict(a, registry) {
  return { marker: a.marker, display: registry.display(a.marker),
           panel: a.policy ? a.policy.order_panel : '', by: a.policy ? a.policy.ordered_by : '',
           role: a.policy ? a.policy.role : '', cost: a.policy ? a.policy.cost_tier : '',
           last_date: a.last_date, last_value: a.last_value, last_unit: a.last_unit,
           last_range: a.last_range, last: fmtLast(a), basis: a.basis, basis_text: a.basis_text,
           state: a.state, interval_months: a.interval_months,
           next_due: a.next_due ? a.next_due : null, decision: a.decision, reason: a.reason };
}

export function historyDict(h) {
  return { date: h.date, category: h.category, item: h.item, status: h.status, detail: h.detail,
           affects: h.affects, interval_months: h.interval_months, last_done: h.last_done, condition: h.condition };
}

export function lastDrawDate(rows) {
  const dates = sortedSet(rows.map(r => req(r, 'date_drawn')));
  return dates.length ? dates[dates.length - 1] : null;
}

/* The next-draw plan: every marker the policy or the store knows, assessed against the profile's
   lens and tier, grouped by order panel, and sorted into the sections the CLI prints. `draw`
   defaults to today; `cadence` to the profile's, then 6 months. */
export function buildPlan(home, store, registry, draw = null, cadence = null) {
  const rows = store.load();
  const prof = loadProfile(home);
  const tier = prof.risk_tier || '', lens = prof.guideline_lens || 'conventional';
  const policy = loadPolicy(home), targets = loadTargets(home, { risk_tier: tier, lens }), history = loadHistory(home);
  if (!Object.keys(policy).length) throw new PyRuntimeError('No config/policy.csv found.');
  draw = draw || today(home.now.bind(home));
  cadence = pyInt(cadence || prof.draw_cadence_months || 6);
  const near = pyFloat(prof.near_limit_pct || 10);
  const dob = prof.dob || null;
  const byMarker = new Map();
  for (const r of rows) {
    if (req(r, 'marker')) {
      if (!byMarker.has(r.marker)) byMarker.set(r.marker, []);
      byMarker.get(r.marker).push(r);
    }
  }
  const derivedIds = new Set(Object.keys(loadDerived(home)));
  // a marker the policy orders for one sex only (PSA) is not on anyone else's plan at all: not
  // ordered, not skipped, not listed (a female profile was told to order a PSA, 2026-09-10)
  const sex = String(prof.sex || '').trim().toLowerCase().slice(0, 1);
  const markers = sortedSet([...Object.keys(policy), ...byMarker.keys()].filter(m => !derivedIds.has(m)))
    .filter(m => { const pm = get(policy, m); return !(pm && pm.sex && sex && pm.sex !== sex); });
  const assessments = markers.map(m => assess(m, byMarker.has(m) ? byMarker.get(m) : [], get(policy, m), get(targets, m),
                                              draw, cadence, near, dob));
  const active = history.filter(h => h.status === 'active' || h.status === 'confirm');

  const panels = new Map();
  for (const a of assessments) {
    const name = a.policy ? a.policy.order_panel : '(no policy)';
    if (!panels.has(name)) panels.set(name, []);
    panels.get(name).push(a);
  }

  const summarize = (name, members) => {
    let primaries = members.filter(a => a.policy && a.policy.role === 'primary');
    if (!primaries.length) primaries = members;
    const cost = members[0].policy ? members[0].policy.cost_tier : '';
    const by = members[0].policy ? members[0].policy.ordered_by : '';
    const orders = primaries.filter(a => a.decision === 'ORDER');
    let drivers, dec;
    if (orders.length) {
      drivers = pySorted(orders, a => a.next_due || DATE_MIN);
      dec = 'ORDER';
    } else {
      const due = primaries.filter(a => a.next_due);
      dec = null; drivers = [];
      if (due.length) {
        dec = 'SKIP';
        drivers = [pySorted(due, a => a.next_due)[0]];
      }
      for (const label of ['DONE', 'OPTIONAL', 'COVERED']) {
        const hits = primaries.filter(a => a.decision === label);
        if (dec === null && hits.length) { dec = label; drivers = hits; }
      }
      if (dec === null) { dec = primaries[0].decision; drivers = primaries.slice(0, 1); }
    }
    const context = active.filter(h => touches(h, name) || drivers.some(a => touches(h, a.marker)));
    return { name, cost, by, decision: dec,
             drivers: drivers.map(a => assessmentDict(a, registry)),
             members: members.map(a => assessmentDict(a, registry)),
             context: context.map(historyDict),
             _sort: [drivers.length ? pyMin(drivers.map(a => a.next_due || DATE_MIN)) : DATE_MIN,
                     has(COST_ORDER, cost) ? COST_ORDER[cost] : 9] };
  };

  const summaries = [...panels].map(([n, m]) => summarize(n, m));
  const buckets = {};
  for (const [k] of SECTIONS) buckets[k] = [];
  for (const sm of summaries) {
    if (sm.by === 'provider') buckets.provider.push(sm);
    else if (sm.decision === 'ORDER') buckets.order.push(sm);
    else if (sm.decision === 'SKIP') buckets.skip.push(sm);
    else if (sm.decision === 'OPTIONAL') buckets.optional.push(sm);
    else if (sm.decision === 'COVERED') buckets.covered.push(sm);
    else if (sm.decision === 'DONE') buckets.done.push(sm);
    else buckets.other.push(sm);
  }
  buckets.order = pySorted(buckets.order, sm => sm._sort);
  buckets.skip = pySorted(buckets.skip, sm => sm._sort);
  for (const k of ['optional', 'covered', 'provider', 'done', 'other']) buckets[k] = pySorted(buckets[k], sm => sm.name);
  for (const sm of summaries) delete sm._sort;
  const sections = [];
  for (const [k, t] of SECTIONS) {
    if (buckets[k].length || k === 'order' || k === 'skip') sections.push({ key: k, title: t, panels: buckets[k] });
  }

  const monitoring = [];
  for (const h of active) {
    if (h.interval_months) {
      const [due, text] = monitoringDue(h, draw);
      monitoring.push({ item: h.item, text, due: due ? due : null, overdue: !!(due && due <= draw) });
    }
  }
  const age = dob ? ageOn(dob, draw) : null;
  const ld = lastDrawDate(rows);
  return { draw, cadence, age, tier, lens,
           n_targets: assessments.filter(a => a.basis === 'target').length,
           last_draw: ld, sections, monitoring,
           context: active.map(historyDict),
           assessments: assessments.map(a => assessmentDict(a, registry)) };
}

/* Next routine draw: last draw + cadence, or today if that is already past. */
export function suggestedDraw(home, store) {
  const rows = store.load();
  const prof = loadProfile(home);
  const cadence = pyInt(prof.draw_cadence_months || 6);
  const ld = lastDrawDate(rows);
  if (!ld) return null;      /* the first draw sets the clock; no date is invented before it */
  const [y, m, d] = unpackInts3(ld);
  const nxt = addMonths(pyDate(y, m, d), cadence);
  return pyMaxDate(nxt, today(home.now.bind(home)));
}

/* float(r["value_num"]), or a ValueError / TypeError the caller swallows */
function valueNum(r) {
  const raw = req(r, 'value_num');
  if (raw == null) throw new PyValueError('float() argument must be a string or a real number');
  return pyFloat(raw);
}

/* Latest value per marker with lab flag, target status and a sparkline series. Includes
   markers computed from other markers (config/derived.csv). */
export function buildSummary(home, store, registry) {
  const prof = loadProfile(home);
  let rows = store.load();
  rows = rows.concat(computeDerived(rows, prof, loadDerived(home)));
  const lens = prof.guideline_lens || 'conventional';
  const both = loadBoth(home, { risk_tier: prof.risk_tier });
  if (!has(both, lens)) throw new PyKeyError(lens);
  const targets = both[lens];
  const otherLens = lens === 'conventional' ? 'functional' : 'conventional';
  const policy = loadPolicy(home);
  const byMarker = new Map();
  for (const r of rows) {
    const k = req(r, 'marker') || req(r, 'test_name');
    if (!byMarker.has(k)) byMarker.set(k, []);
    byMarker.get(k).push(r);
  }
  const out = [];
  for (const [, rs0] of byMarker) {
    const rs = pySorted(rs0, r => [req(r, 'date_drawn'), req(r, 'panel')]);
    const latest = rs[rs.length - 1];
    const mid = latest.marker;
    const t = mid ? get(targets, mid) : null;
    const [vs] = t ? targetStatus(latest, t) : ['', ''];
    const t2 = mid ? get(both[otherLens], mid) : null;
    const [vs2] = t2 ? targetStatus(latest, t2) : ['', ''];
    const pol = mid ? get(policy, mid) : null;
    const series = [];
    for (const r of rs) {
      let v;
      try { v = valueNum(r); } catch (e) { if (e instanceof PyValueError) continue; throw e; }
      series.push({ date: r.date_drawn, v });
    }
    out.push({ computed: latest.lab === 'computed', approx: latest.approx === undefined ? '' : latest.approx,
               marker: mid || '', display: mid ? registry.display(mid) : req(latest, 'test_name'),
               category: mid ? registry.category(mid) : '',
               // Computed markers have no policy row (they are never ordered), so they keep the
               // panel name the derived engine gave them.
               panel: pol ? pol.order_panel : (latest.panel || ''),
               by: pol ? pol.ordered_by : '', role: pol ? pol.role : '',
               date: latest.date_drawn, value: req(latest, 'value'), unit: req(latest, 'unit'),
               lab_range: req(latest, 'ref_range'), lab_flag: req(latest, 'lab_flag'),
               target: t ? targetShort(t) : '', vs_target: vs,
               target_lens: t ? t.lens : '', evidence: t ? t.evidence : '',
               alt_lens: otherLens, alt_target: t2 ? targetShort(t2) : '', alt_vs_target: vs2,
               n: rs.length, series });
  }
  const order = ['lipids', 'ratios', 'lipoprotein_nmr', 'inflammation', 'metabolic', 'renal', 'electrolytes',
                 'liver_protein', 'cbc', 'hormones', 'prostate', 'thyroid', 'iron', 'vitamins'];
  const rank = {};
  order.forEach((c, i) => { rank[c] = i; });
  const panelOrder = ['Lipid panel', 'ApoB', 'Lp(a)', 'Computed', 'hs-CRP', 'CMP', 'A1c', 'Insulin', 'CBC',
                      'Hormones', 'PSA', 'Thyroid', 'Ferritin', 'Vitamin D', 'Vitamin B12'];
  const prank = {};
  panelOrder.forEach((n, i) => { prank[n] = i; });
  const sorted = pySorted(out, x => [has(rank, x.category) ? rank[x.category] : 99, has(prank, x.panel) ? prank[x.panel] : 50,
                                     x.panel || 'zzz', x.role !== 'primary', lower(x.display)]);
  const dates = sortedSet(rows.map(r => req(r, 'date_drawn')));
  return { markers: sorted, draws: dates, last_draw: dates.length ? dates[dates.length - 1] : null,
           tier: has(prof, 'risk_tier') ? prof.risk_tier : '', lens, lens_set: !!prof.guideline_lens };
}

/* One marker's history: every stored point against both lenses, the target rows, the
   plain-language explanation and the one-sentence situation. */
export function buildTrend(home, store, registry, query) {
  const prof = loadProfile(home);
  let rows = store.load();
  rows = rows.concat(computeDerived(rows, prof, loadDerived(home)));
  const mid = registry.lookup(query);
  let hits, title;
  if (mid) {
    hits = rows.filter(r => req(r, 'marker') === mid);
    title = registry.display(mid);
  } else {
    const q = upper(strip(query));
    hits = rows.filter(r => upper(req(r, 'test_name')) === q);
    title = query;
  }
  hits = pySorted(hits, r => [req(r, 'date_drawn'), req(r, 'panel')]);
  const lens = prof.guideline_lens || 'conventional';
  const both = loadBoth(home, { risk_tier: prof.risk_tier });
  if (!has(both, lens)) throw new PyKeyError(lens);
  const t = mid ? get(both[lens], mid) : null;
  const otherLens = lens === 'conventional' ? 'functional' : 'conventional';
  const t2 = mid ? get(both[otherLens], mid) : null;
  const points = [];
  for (const r of hits) {
    const [vs] = t ? targetStatus(r, t) : ['', ''];
    let v;
    try { v = valueNum(r); } catch (e) { if (e instanceof PyValueError) v = null; else throw e; }
    points.push({ approx: r.approx === undefined ? '' : r.approx, computed: r.lab === 'computed',
                  date: r.date_drawn, value: req(r, 'value'), v, unit: req(r, 'unit'), lab_range: req(r, 'ref_range'),
                  ref_low: req(r, 'ref_low'), ref_high: req(r, 'ref_high'), lab_flag: req(r, 'lab_flag'),
                  vs_target: vs, source: req(r, 'lab'), printed_as: r.test_name, panel: r.panel });
  }
  const tdict = x => (x ? { text: x.target_text, short: targetShort(x), low: x.low, high: x.high, unit: x.unit,
                            basis: x.basis, source_url: x.source_url, confidence: x.confidence, reviewed: x.reviewed,
                            notes: x.notes, lens: x.lens, evidence: x.evidence } : null);
  const ex = mid ? get(loadExplanations(home), mid) : null;
  const last = points.length ? points[points.length - 1] : null;
  return { marker: mid || '', title, points, target: tdict(t), lens,
           alt_lens: otherLens, alt_target: tdict(t2),
           explain: ex ? Object.assign({}, ex) : null,
           situation: last ? situation(last.value, last.unit, last.vs_target, t ? targetShort(t) : '', lens) : '' };
}
