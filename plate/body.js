/* Weigh-ins, the trend, and the loop that steps the plate. A line-for-line twin of
   labtrack/body.py.

   A weigh-in is one row in labs/body_metrics.csv with source `app`. The trend is an exponential
   average (alpha 0.1) computed on read over every weight in date order. Once the weigh-ins since
   the plate last changed hold three points spanning 21 days, the trend's slope in pounds a week
   is compared with what the goal expects; off for the whole window, one plate step of 0.05 is
   proposed, at most one per 28 days, and the window restarts after a step. The app proposes;
   the person confirms. Every rounding is Python's round, half to even. */
import { readRows, formatDicts } from './csv.js';
import { ConfigError, PyValueError, pyFloat, pyRound, pyReprStr, pySorted, stampLocal, strip } from './py.js';
import { daysBetween, parseIso, addDays } from './pydate.js';
import { numstr, plateFromDiet, setDiet, PLATE_MIN, PLATE_MAX, PLATE_STEP } from './plate_config.js';
import { BODY_COLS, loadBody } from './tracker.js';

export const ALPHA = 0.1;
export const MIN_POINTS = 3;
export const WINDOW_DAYS = 21;
export const STEP_DAYS = 28;
export const WEIGHT_BAND = [50, 700];
const EXPECTED = { 'lose,steady': [-1.0, -0.5], 'lose,gentle': [-0.5, -0.25], 'hold,': [-0.25, 0.25], 'gain,': [0.25, 0.5] };
const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

export function expectedBand(goal, rate) {
  if (goal === 'lose') return EXPECTED['lose,' + (rate === 'steady' || rate === 'gentle' ? rate : 'gentle')];
  if (goal === 'gain') return EXPECTED['gain,'];
  return EXPECTED['hold,'];
}

/* [date, weight] as the row would be written, or a ConfigError saying why it cannot be */
export function checkWeighIn(onDate, weightLb) {
  onDate = strip(onDate);
  try { parseIso(onDate); } catch (e) { throw new ConfigError('the date must be YYYY-MM-DD, not ' + pyReprStr(onDate)); }
  let w;
  try {
    w = pyFloat(strip(weightLb == null ? '' : String(weightLb)));
  } catch (e) {
    if (e instanceof PyValueError) throw new ConfigError('weight must be a number, not ' + pyReprStr(weightLb == null ? 'None' : String(weightLb)));
    throw e;
  }
  if (!(WEIGHT_BAND[0] <= w && w <= WEIGHT_BAND[1])) throw new ConfigError('weight must be between ' + WEIGHT_BAND[0] + ' and ' + WEIGHT_BAND[1] + ' lb, not ' + numstr(w));
  return [onDate, w];
}

/* [{date, weight_lb, trend_lb}] in date order: an exponential average seeded by the first
   weight; a row whose weight cannot be read is skipped; the later of two rows on a date stands */
export function trend(rows) {
  const byDate = new Map();
  for (const r of rows) {
    let w;
    try { w = pyFloat(strip(has(r, 'weight_lb') && r.weight_lb != null ? String(r.weight_lb) : '')); } catch (e) { continue; }
    byDate.set(r.date, w);
  }
  const out = [];
  let t = null;
  for (const d of pySorted([...byDate.keys()])) {
    const w = byDate.get(d);
    t = t === null ? w : t + ALPHA * (w - t);
    out.push({ date: d, weight_lb: w, trend_lb: pyRound(t, 2) });
  }
  return out;
}

export function verdict(points, goal, rate, plate, since) {
  const win = points.filter(p => !since || p.date >= since);
  const [lo, hi] = expectedBand(goal, rate);
  const out = { state: '', points: win.length, window_days: 0, expected: [lo, hi], slope: null,
                plate, since: since || '', goal, rate, step: null, plate_next: null,
                latest: points.length ? points[points.length - 1] : null };
  if (!points.length) { out.state = 'no_weigh_ins'; return out; }
  if (win.length < MIN_POINTS) { out.state = 'too_few'; return out; }
  const span = daysBetween(win[win.length - 1].date, win[0].date);
  out.window_days = span;
  if (span < WINDOW_DAYS) { out.state = 'too_short'; return out; }
  const slope = pyRound((win[win.length - 1].trend_lb - win[0].trend_lb) / span * 7, 3);
  out.slope = slope;
  if (since && daysBetween(win[win.length - 1].date, since) < STEP_DAYS) { out.state = 'stepped_recently'; return out; }
  if (lo <= slope && slope <= hi) { out.state = 'on_track'; return out; }
  const step = slope < lo ? PLATE_STEP : -PLATE_STEP;
  const nxt = pyRound(plate + step, 2);
  out.step = step;
  if (!(PLATE_MIN <= nxt && nxt <= PLATE_MAX)) { out.state = 'at_bound'; return out; }
  out.state = 'propose';
  out.plate_next = nxt;
  return out;
}

/* one weigh-in into labs/body_metrics.csv, source app, replacing any row on that date, the
   trend recomputed into every app row, a timestamped copy kept first */
export function appendWeighIn(home, onDate, weightLb) {
  const [d, w] = checkWeighIn(onDate, weightLb);
  const path = 'labs/body_metrics.csv';
  let rows = loadBody(home).filter(r => r.date !== d).map(r => Object.assign({}, r));
  rows.push({ date: d, weight_lb: numstr(w), trend_weight_lb: '', source: 'app' });
  rows = pySorted(rows, r => r.date);
  const pts = new Map(trend(rows).map(p => [p.date, p]));
  for (const r of rows) if (r.source === 'app' && pts.has(r.date)) r.trend_weight_lb = numstr(pts.get(r.date).trend_lb);
  if (home.exists(path)) {
    const stamp = stampLocal(home.now());
    let dest = 'labs/backups/body_metrics-' + stamp + '.csv', n = 2;
    while (home.exists(dest)) { dest = 'labs/backups/body_metrics-' + stamp + '-' + n + '.csv'; n += 1; }
    home.copy(path, dest);
  }
  home.write(path, formatDicts(BODY_COLS, rows.map(r => { const o = {}; for (const c of BODY_COLS) o[c] = has(r, c) ? r[c] : ''; return o; })));
  return pts.get(d);
}

export function stepPlate(home, plate, onDate) {
  setDiet(home, 'plate', numstr(pyFloat(String(plate))));
  setDiet(home, 'plate_since', onDate);
  return plateFromDiet({ plate: numstr(pyFloat(String(plate))) });
}

/* how many of the last `days` days have a meal logged here; `today` is an ISO date */
export function coverage(logRows, today, days = 28) {
  const start = addDays(today, -(days - 1));
  const logged = new Set(logRows.map(r => String(has(r, 'logged_at') && r.logged_at != null ? r.logged_at : '').slice(0, 10)));
  return { days, logged: [...logged].filter(d => start <= d && d <= today).length };
}

export function loadLog(home) {
  const text = home.read('labs/meal_log.csv');
  return text == null ? [] : readRows(text);
}

export function summary(rows, diet, prof, logRows, today) {
  const pts = trend(rows);
  const plate = plateFromDiet(diet);
  const since = strip(has(diet, 'plate_since') ? diet.plate_since : '');
  const goal = strip((has(prof, 'goal') && prof.goal) || 'hold'), rate = strip((has(prof, 'rate') && prof.rate) || 'gentle');
  return { entries: pts.length, latest: pts.length ? pts[pts.length - 1] : null, trend: pts.slice(-90),
           verdict: verdict(pts, goal, rate, plate, since), plate, plate_since: since,
           goal, rate, coverage: coverage(logRows, today),
           sources: pySorted([...new Set(rows.map(r => (has(r, 'source') && r.source) || ''))]) };
}

/* the one line Tonight carries: a plate step the scale proposes, or null; no clock in it */
export function proposal(rows, diet, prof) {
  const v = verdict(trend(rows), strip((has(prof, 'goal') && prof.goal) || 'hold'), strip((has(prof, 'rate') && prof.rate) || 'gentle'),
                    plateFromDiet(diet), strip(has(diet, 'plate_since') ? diet.plate_since : ''));
  if (v.state !== 'propose') return null;
  return { step: v.step, plate: v.plate, plate_next: v.plate_next, slope: v.slope, expected: v.expected,
           points: v.points, window_days: v.window_days, goal: v.goal };
}
