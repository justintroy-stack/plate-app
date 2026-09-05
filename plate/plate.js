/* The Plate's data: the config resolved for this person, the rotation plan, the state and the
   meal log. A twin of labtrack/plate.py with the disk replaced by the home in memory.

   Two rules live here and are kept whole:
   - a copy of the state is stored only when it beats the one already here (`wins`): a deliberate
     Start over or undo wins outright, otherwise more meals logged wins, otherwise the later edit;
     so a logged meal is never un-logged by a save;
   - every logged meal lands in labs/meal_log.csv with the time it was logged and what was eaten,
     deduplicated by cursor, and an undo removes its row so the meal really eaten at that cursor
     is not dropped on arrival. */
import { readDicts, readRows, formatRow, formatRows, formatDicts } from './csv.js';
import { isoLocal, stampLocal, pyInt, pyFloat, pySorted } from './py.js';
import { loadProfile } from './policy.js';
import { loadDiet, buildDiet } from './diet.js';
import { MarkerRegistry } from './markers.js';
import { CsvStore } from './store.js';
import * as pc from './plate_config.js';
import { buildPlan, normalizeOrder, groupNote } from './rotation.js';
import { proposal } from './body.js';
import { loadBody } from './tracker.js';

export const STATE_PATH = 'labs/plate_state.json';
export const MEAL_LOG = 'labs/meal_log.csv';
export const BACKUP_DIR = 'labs/backups';
export const STATE_KEY = 'plate:v8';
export const LOG_COLUMNS = ['logged_at', 'cursor', 'meal_index', 'meal_id', 'meal', 'kcal', 'protein_g', 'kind', 'note'];

/* The food config, resolved for the stores the profile says are in play, for the kitchen
   diet.csv describes, for the regimen it names and for the portions it is cooked for. */
export function config(home, plate = null) {
  return pc.loadFor(home, loadProfile(home), loadDiet(home), plate);
}

/* The rotation as the phone last mirrored it (meal ids by position), or null. */
export function currentOrder(home) {
  const raw = getState(home, STATE_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (s === null || typeof s !== 'object' || Array.isArray(s)) return null;
    return s.order === undefined ? null : s.order;
  } catch (e) { return null; }
}

/* Everything the page needs: the config plus, when the food targets are known, the plan that
   reshapes the rotation to meet them. */
export function payload(home, diet, cfg) {
  cfg = cfg || config(home);
  const out = Object.assign({}, cfg);
  out.plan = diet ? buildPlan(cfg, diet, currentOrder(home)) : null;
  out.plate_proposal = proposal(loadBody(home), loadDiet(home), loadProfile(home));
  out.group_note = groupNote(cfg);
  out.labs = labsOnFile(home);
  return out;
}

/* how much of the engine has anything to read: the draws and the rows in the store */
export function labsOnFile(home) {
  const rows = home.exists('labs/results.csv') ? new CsvStore(home).load() : [];
  return { draws: new Set(rows.map(r => r.date_drawn)).size, results: rows.length };
}

/* As the server serves it: the food targets when they can be built, and the Plate stands on its
   own when they cannot. */
export function payloadBuilt(home) {
  let diet = null;
  try { diet = buildDiet(home, new CsvStore(home), MarkerRegistry.load(home)); } catch (e) { diet = null; }
  return payload(home, diet);
}

export function rotationTable(home, cfg) {
  cfg = cfg || config(home);
  const meals = pc.mealIndex(cfg);
  return cfg.baseline.map(m => [meals[m].name, meals[m].kcal, meals[m].protein_g]);
}

// ---- state

function loadAll(home) {
  const t = home.read(STATE_PATH);
  if (t == null) return {};
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) { return {}; }
}

export function getState(home, key) {
  const v = loadAll(home)[key];
  return v === undefined ? null : v;
}

function meta(raw) {
  let s;
  try { s = raw ? JSON.parse(raw) : {}; } catch (e) { return [0, 0, 0]; }
  if (s === null || typeof s !== 'object' || Array.isArray(s)) s = {};
  const num = (k) => {
    const v = s[k];
    if (v == null || v === false || v === '' || v === 0) return 0;
    try { return typeof v === 'number' ? v : pyFloat(String(v)); } catch (e) { return 0; }
  };
  return [num('reset_at'), num('cursor'), num('updated_at')];
}

/* Does one copy of the state replace another? Deliberate Start over wins outright; otherwise the
   copy with more meals logged wins, because a cursor may not run backwards; a later edit breaks
   the tie. */
export function wins(candidate, current) {
  if (current == null) return true;
  const a = meta(candidate), b = meta(current);
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] >= b[2];
}

/* Store the state when it beats what is already here. Returns [stored, winner]. */
export function setState(home, key, value) {
  const all = loadAll(home);
  const oldRaw = all[key] === undefined ? null : all[key];
  if (!wins(value, oldRaw)) return [false, oldRaw];
  all[key] = value;
  home.write(STATE_PATH, JSON.stringify(all, null, 1));
  logIfMealLogged(home, oldRaw, value);
  return [true, value];
}

// ---- meal log

function loggedCursors(home) {
  const t = home.read(MEAL_LOG);
  if (t == null) return new Set();
  return new Set(readRows(t).map(r => r.cursor));
}

function stamp(home) { return stampLocal(home.now()); }

/* An older log has fewer columns; widen it once, keeping a copy first. */
function migrateLog(home) {
  const t = home.read(MEAL_LOG);
  if (t == null) return;
  const { fieldnames, rows } = readDicts(t);
  if (fieldnames.length === LOG_COLUMNS.length && fieldnames.every((f, i) => f === LOG_COLUMNS[i])) return;
  home.copy(MEAL_LOG, BACKUP_DIR + '/meal_log-' + stamp(home) + '.csv');
  home.write(MEAL_LOG, formatDicts(LOG_COLUMNS, rows.map(r => { const o = {}; for (const c of LOG_COLUMNS) o[c] = c in r ? r[c] : ''; return o; })));
}

/* Take the row(s) for one cursor out of the log, keeping a copy first. Returns how many rows
   were removed. */
export function removeLogged(home, cursor) {
  return dropRows(home, r => r.cursor !== String(cursor));
}

/* one 'also had' row out of the log: the undo of an extra, matched by its stamp and its label,
   because an extra belongs to no cursor */
export function removeExtra(home, at, meal) {
  return dropRows(home, r => !(r.kind === 'extra' && r.logged_at === at && r.meal === meal));
}

function dropRows(home, keepIf) {
  const t = home.read(MEAL_LOG);
  if (t == null) return 0;
  const { fieldnames, rows } = readDicts(t);
  const cols = fieldnames.length ? fieldnames : LOG_COLUMNS;
  const keep = rows.filter(keepIf);
  if (keep.length === rows.length) return 0;
  home.copy(MEAL_LOG, BACKUP_DIR + '/meal_log-' + stamp(home) + '.csv');
  home.write(MEAL_LOG, formatDicts(cols, keep));
  return rows.length - keep.length;
}

function appendLog(home, rows) {
  migrateLog(home);
  const existing = home.read(MEAL_LOG);
  let text = existing == null ? formatRow(LOG_COLUMNS) : existing;
  text += formatRows(rows.map(r => LOG_COLUMNS.map(c => (r[c] === undefined ? '' : r[c]))));
  home.write(MEAL_LOG, text);
}

function toInt(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') { try { return pyInt(v); } catch (e) { return null; } }
  return null;
}

/* A meal id, a baseline index, or nothing: give back [index, id, meal or null]. */
function resolveMeal(cfg, meals, ref, cursor) {
  const base = cfg.baseline;
  if (typeof ref === 'string' && ref in meals) return [base.includes(ref) ? base.indexOf(ref) : '', ref, meals[ref]];
  const idx = toInt(ref);
  if (idx !== null && idx >= 0 && idx < base.length) return [idx, base[idx], meals[base[idx]]];
  const i = ((cursor % base.length) + base.length) % base.length;
  return [i, base[i], meals[base[i]]];
}

function row(cfg, meals, e, cursor, at, defaultNote) {
  const ref = 'meal_id' in e ? e.meal_id : e.meal_index;
  const [idx, mid, meal] = resolveMeal(cfg, meals, ref, cursor);
  const kcal = e.kcal, pro = e.protein_g;
  return { logged_at: at, cursor, meal_index: idx, meal_id: mid,
           meal: e.meal || (meal ? meal.name : mid),
           kcal: (kcal == null || kcal === '') ? (meal ? meal.kcal : '') : kcal,
           protein_g: (pro == null || pro === '') ? (meal ? meal.protein_g : '') : pro,
           kind: e.kind || 'unknown', note: e.note || defaultNote };
}

/* Device-stamped meal events: [{cursor, meal_id, meal, kcal, protein_g, kind, note, at}].
   Deduplicated by cursor; the first report for a cursor wins; an undo removes the row. */
export function recordEvents(home, events) {
  const cfg = config(home);
  const meals = pc.mealIndex(cfg);
  const seen = loggedCursors(home);
  const rows = [], extras = [];
  for (const e of events || []) {
    if (!e || typeof e !== 'object') continue;
    if (e.kind === 'extra' || e.kind === 'undo_extra') {
      // something from stock outside the plan: its own row, on no cursor, never deduplicated;
      // its undo names the row by the stamp the device made and the label
      const at = String(e.at || isoLocal(home.now())).slice(0, 19);
      const label = String(e.meal || 'extra');
      if (e.kind === 'extra') {
        const kcal = e.kcal, pro = e.protein_g;
        extras.push({ logged_at: at, cursor: '', meal_index: '', meal_id: 'extra', meal: label,
                      kcal: (kcal == null || kcal === '') ? '' : kcal, protein_g: (pro == null || pro === '') ? '' : pro,
                      kind: 'extra', note: e.note || 'also had, outside the plan' });
      } else removeExtra(home, at, label);
      continue;
    }
    if (!('cursor' in e)) continue;
    const c = toInt(e.cursor);
    if (c === null) continue;
    if (e.kind === 'undo') {
      removeLogged(home, c);
      seen.delete(String(c));
      continue;
    }
    if (seen.has(String(c))) continue;
    seen.add(String(c));
    const at = String(e.at || isoLocal(home.now())).slice(0, 19);
    rows.push(row(cfg, meals, e, c, at, 'stamped on the device at log time'));
  }
  if (rows.length) appendLog(home, pySorted(rows, r => r.cursor));
  if (extras.length) appendLog(home, extras);
  return rows.length + extras.length;
}

/* The page persists after every change; a cursor increase means a meal was logged. The first
   save establishes the baseline only. Fallback only: the device normally sends stamped events
   first, and anything they covered is skipped, so a cursor is never logged twice. */
function logIfMealLogged(home, oldRaw, newRaw) {
  if (oldRaw == null) return;
  let old, cur;
  try {
    old = oldRaw ? JSON.parse(oldRaw) : {};
    cur = newRaw ? JSON.parse(newRaw) : {};
  } catch (e) { return; }
  if (old === null || typeof old !== 'object' || Array.isArray(old)) old = {};
  if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) cur = {};
  const oc = toInt(old.cursor || 0) || 0, nc = toInt(cur.cursor || 0) || 0;
  if (nc <= oc) return;
  const cfg = config(home);
  const meals = pc.mealIndex(cfg);
  const order = normalizeOrder(cur.order === undefined ? null : cur.order, cfg);
  const seen = loggedCursors(home);
  const rows = [];
  for (let c = oc; c < nc; c++) {
    if (seen.has(String(c))) continue;
    rows.push(row(cfg, meals, { meal_id: order[c % order.length] }, c, isoLocal(home.now()), 'server-side fallback stamp (sync time, not log time)'));
  }
  if (rows.length) appendLog(home, rows);
}
