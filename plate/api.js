/* Every /api/ call the page makes, answered from inside the page.

   The page fetches the same paths it fetched from the Python server (labtrack/server.py), and
   gets the same JSON back, so the page's own script is unchanged. window.fetch is wrapped: a
   same-origin /api/ path is routed here, anything else goes to the real fetch. Each handler is
   the server's handler with the disk replaced by the home in memory, and every write is
   flushed to IndexedDB before the reply, so a reload after a save finds it. */
import { flush, wipe } from './fs.js';
import { ownRestored } from './seeds.js';
import { readRows, formatDicts } from './csv.js';
import { ConfigError, PyValueError, pyRound } from './py.js';
import { MarkerRegistry } from './markers.js';
import { CsvStore } from './store.js';
import { loadProfile } from './policy.js';
import { loadHistory, appendHistory, updateHistory, removeHistory, CONDITIONS } from './history.js';
import { loadExplanations } from './explain.js';
import { loadBody, loadIntake } from './tracker.js';
import { buildDiet, checkBody, loadDiet, targetPreview, targetsFromProfile, regimenFor, ESTIMATE_KEYS } from './diet.js';
import { ackPlate, appendWeighIn, loadLog, stepPlate, stepped as bodyStepped, undoPlate, summary as bodySummary } from './body.js';
import { today } from './pydate.js';
import { buildSummary, buildTrend, buildPlan, suggestedDraw } from './planner.js';
import { payload, payloadBuilt, getState, storeState, currentOrder, recordEvents, tally, resize, sizeFor } from './plate.js';
import * as pc from './plate_config.js';
import { candidates, rowCandidates, review, catalog, MANUAL_LAB } from './ingest.js';
import { readPdf, configure } from './pdftext.js';
import { backupFromHome, readBackup } from './backup.js';

const RAW_DIR = 'labs/raw';
const PROFILE_EDITABLE = ['risk_tier', 'draw_cadence_months', 'near_limit_pct', 'dob', 'sex', 'guideline_lens'];
const CONFIG_FILES = ['markers', 'aliases', 'ignore', 'policy', 'targets', 'target_tiers', 'targets_functional', 'derived', 'explain', 'profile', 'history',
                      'diet', 'diet_rules', 'exposure', 'meals', 'kits', 'cold_slots', 'items', 'store_items', 'stores', 'flavor_pantry',
                      'equipment', 'cooking', 'regimens', 'occasions', 'rotations'];
const SECOND_PASS = 'Not in this version yet.';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
function bytes(buf, type, name) {
  const h = { 'Content-Type': type || 'application/octet-stream' };
  if (name) h['Content-Disposition'] = 'attachment; filename="' + name + '"';
  return new Response(buf, { status: 200, headers: h });
}

function writeProfile(home, key, value) {
  /* one key in profile.csv, the personal file an upgrade never overwrites (server._write_profile) */
  const path = 'config/profile.csv';
  const text = home.read(path);
  const rows = text == null ? [] : readRows(text);
  let found = false;
  for (const r of rows) if (r.key === key) { r.value = value; found = true; }
  if (!found) rows.push({ key, value });
  home.write(path, formatDicts(['key', 'value'], rows.map(r => ({ key: r.key, value: r.value }))));
}

function looksScanned(text) {
  const pages = Math.max(1, (text.match(/\f/g) || []).length + (text.endsWith('\f') ? 0 : 1));
  const alnum = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  return alnum / pages < 100;
}

async function bodyJson(init) {
  const b = init && init.body;
  if (!b) return {};
  if (typeof b === 'string') return JSON.parse(b || '{}');
  if (b instanceof ArrayBuffer || ArrayBuffer.isView(b)) return JSON.parse(new TextDecoder().decode(b) || '{}');
  if (typeof b.text === 'function') return JSON.parse((await b.text()) || '{}');
  return {};
}
async function bodyBytes(init) {
  const b = init && init.body;
  if (!b) return new Uint8Array(0);
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  if (typeof b.arrayBuffer === 'function') return new Uint8Array(await b.arrayBuffer());
  if (typeof b === 'string') return new TextEncoder().encode(b);
  return new Uint8Array(0);
}

let pdfjsMod = null;
async function pdfjs() {
  if (!pdfjsMod) {
    pdfjsMod = await import('../vendor/pdfjs/pdf.min.mjs');
    configure(pdfjsMod, new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href);
  }
  return pdfjsMod;
}

/* The food targets when they can be built, null when they cannot (server.py's _diet_or_none). */
export function dietOrNullOf(home) {
  try { return buildDiet(home, new CsvStore(home), MarkerRegistry.load(home)); } catch (e) { return null; }
}

export function installApi(home, ctx) {
  const realFetch = window.fetch.bind(window);
  const registry = () => MarkerRegistry.load(home);
  const store = () => new CsvStore(home);
  const dietOrNull = () => dietOrNullOf(home);
  /* { ok: true }, with the plate plate.resize sized to when it moved one -- omitted, not null,
     so a save that could not have changed the day (kcal, portions) still replies the one way
     it always has (server.py's _resize_reply) */
  const resizeReply = (sized) => (sized != null ? { ok: true, plate: sized } : { ok: true });
  const weigh = () => bodySummary(loadBody(home), loadDiet(home), loadProfile(home), loadLog(home), today(home.now.bind(home)), home);
  /* the scale's step applies itself at a weigh-in and Tonight says so with Undo (server.py's _auto_step) */
  const autoStep = () => {
    const v = weigh().verdict;
    if (v.state !== 'propose') return null;
    stepPlate(home, v.plate_next, today(home.now.bind(home)), loadDiet(home));
    const out = Object.assign({}, bodyStepped(loadDiet(home)) || {});
    Object.assign(out, { step: v.step, slope: v.slope, expected: v.expected, points: v.points, window_days: v.window_days, goal: v.goal });
    return out;
  };

  const GET = {
    '/api/summary': () => buildSummary(home, store(), registry()),
    '/api/trend': (q) => buildTrend(home, store(), registry(), q.get('marker') || ''),
    '/api/plan': (q) => {
      const st = store();
      const draw = q.get('draw') || suggestedDraw(home, st) || today(home.now.bind(home));
      const plan = buildPlan(home, st, registry(), draw, q.get('cadence') ? parseInt(q.get('cadence'), 10) : null);
      const sd = suggestedDraw(home, st);
      plan.suggested_draw = sd ? sd : null;
      return plan;
    },
    '/api/explain': () => loadExplanations(home),
    '/api/diet': () => {
      const d = buildDiet(home, store(), registry());
      try { d.rotation = payload(home, d).plan; } catch (e) { d.rotation = null; d.rotation_error = String(e && e.message || e); }
      return d;
    },
    '/api/history': () => ({ items: loadHistory(home).map(h => ({ date: h.date, category: h.category, item: h.item, status: h.status, detail: h.detail,
                                                                   affects: h.affects, interval_months: h.interval_months, last_done: h.last_done, condition: h.condition,
                                                                   protein_limit_g: h.protein_limit_g })),
                             profile: loadProfile(home), root: '', config_dir: '' }),
    '/api/files': () => {
      const rows = store().load();
      const byFile = {};
      for (const r of rows) byFile[r.source_file] = (byFile[r.source_file] || 0) + 1;
      const imported = new Set([...loadBody(home).map(r => r.source), ...loadIntake(home).map(r => r.source)]);
      const files = [], csvs = [];
      for (const n of home.list(RAW_DIR)) {
        const low = n.toLowerCase(), p = RAW_DIR + '/' + n;
        if (low.endsWith('.pdf')) files.push({ file: p, name: n, rows_stored: byFile[p] || 0 });
        else if ((low.endsWith('.csv') || low.endsWith('.xlsx') || low.endsWith('.xlsm')) && n !== 'previous_results_sheet.csv') csvs.push({ file: p, name: n, imported: imported.has(n) });
      }
      return { files, csvs, raw_dir: RAW_DIR, markers: catalog(registry()) };
    },
    '/api/body': () => {
      const body = loadBody(home), intake = loadIntake(home);
      const recent = intake.slice(-28);
      const avg = (k) => { const xs = recent.filter(r => r[k] !== '' && r[k] != null).map(r => parseFloat(r[k])); return xs.length ? pyRound(xs.reduce((a, b) => a + b, 0) / xs.length, 0) : null; };
      const avg28 = {};
      for (const k of ['kcal', 'protein_g', 'fiber_g', 'sugar_g', 'expenditure_kcal']) avg28[k] = avg(k);
      const d = dietOrNull();
      return { body: body.slice(-90), latest: body.length ? body[body.length - 1] : null, intake_days: intake.length, avg28: recent.length ? avg28 : null,
               weigh: weigh(), diet: d ? { targets: d.targets, baseline: d.baseline, calories: d.calories } : null,
               estimate: targetsFromProfile(loadProfile(home), today(home.now.bind(home)), regimenFor(home, loadDiet(home))) };
    },
    '/api/exposure': () => ({ error: SECOND_PASS }),
    '/api/associations': () => ({ error: SECOND_PASS }),
    '/api/lan': () => ({ lan: false, local: true, url: null, url_ip: null, host: null, ip: null,
                         device: { files: home.paths().length, reports: home.list(RAW_DIR).filter(n => n.toLowerCase().endsWith('.pdf')).length,
                                   results: home.exists('labs/results.csv') ? store().load().length : 0, build: ctx.local.version, pdfjs: ctx.local.pdfjs } }),
    '/api/plate/config': () => payloadBuilt(home),
    '/api/plate/plan': () => payloadBuilt(home).plan,
    '/api/plate/state': (q) => ({ key: q.get('key') || '', value: getState(home, q.get('key') || '') }),
    '/api/plate/tally': () => ({ tally: tally(home) }),
    '/api/config': (q) => {
      const name = q.get('name') || '';
      if (!CONFIG_FILES.includes(name)) return [{ error: 'unknown config' }, 404];
      return { name, path: 'config/' + name + '.csv', text: home.read('config/' + name + '.csv') || '' };
    },
    '/api/backup': () => bytes(backupFromHome(home), 'application/octet-stream'),
  };

  const POST = {
    '/api/plate/events': async (q, init) => {
      const body = await bodyJson(init);
      const n = recordEvents(home, body.events || []);
      await flush(home);
      return { ok: true, logged: n };
    },
    '/api/plate/state': async (q, init) => {
      const body = await bodyJson(init);
      const key = q.get('key') || '';
      if (!key || typeof body.value !== 'string') return [{ error: 'key and a string value are required' }, 400];
      /* the rotation the state carries is what the plate is sized against, so a save whose
         order moved (a swap landed) sizes it again and says so (server.py's /api/plate/state) */
      const [stored, winner, sized] = storeState(home, key, body.value, dietOrNull, today(home.now.bind(home)));
      await flush(home);
      const reply = { ok: true, stored, value: winner };
      if (sized != null) reply.plate = sized;
      return reply;
    },
    '/api/stores': async (q, init) => {
      const body = await bodyJson(init);
      if (body.remove) {
        pc.removeStore(home, String(body.key || '').trim());
        await flush(home);
        return { ok: true };
      }
      const adding = !String(body.key || '').trim();
      const key = pc.upsertStore(home, body);
      if (adding) {
        const chosen = String(loadProfile(home).stores || '').split('|').map(x => x.trim()).filter(Boolean);
        if (chosen.length && !chosen.includes(key)) writeProfile(home, 'stores', chosen.concat([key]).join('|'));
      }
      await flush(home);
      return { ok: true, key };
    },
    '/api/store_items': async (q, init) => {
      const body = await bodyJson(init);
      if (body.remove) pc.removeStoreItem(home, String(body.store || '').trim(), String(body.item || '').trim());
      else pc.upsertStoreItem(home, body);
      await flush(home);
      return { ok: true };
    },
    '/api/diet': async (q, init) => {
      const body = await bodyJson(init);
      const key = String(body.key || '').trim(), value = String(body.value || '').trim();
      if (!pc.DIET_EDITABLE.includes(key)) return [{ error: 'that setting is not editable here' }, 400];
      pc.setDiet(home, key, value);
      /* what this key changed can change what a day of the plan comes to, so the plate is
         sized again to the same target (server.py's /api/diet) */
      const sized = pc.RESIZE_KEYS.includes(key) ? resize(home, dietOrNull(), today(home.now.bind(home))) : null;
      await flush(home);
      return resizeReply(sized);
    },
    '/api/target': async (q, init) => {
      /* About you, before anything is written: the estimate for a set of answers, from the
         same function the save writes with (server.py's /api/target) */
      const body = await bodyJson(init);
      return targetPreview(home, body.profile || {}, body.diet || {}, today(home.now.bind(home)), currentOrder(home));
    },
    '/api/setup': async (q, init) => {
      /* first run, and Your target under Profile: every answer checked before any is written,
         the day's numbers estimated from About you and written last (server.py's /api/setup) */
      const body = await bodyJson(init);
      const diet = body.diet || {};
      const profile = {};
      for (const [k, v] of Object.entries(body.profile || {})) profile[String(k).trim()] = v;
      for (const key of Object.keys(diet)) pc.checkDiet(home, String(key).trim(), diet[key]);
      for (const key of Object.keys(profile)) profile[key] = checkBody(key, profile[key]);
      const stores = body.stores;
      if (stores != null) {
        const [shop, picks] = pc.choicesFromProfile({ stores: String(stores).trim() });
        const problem = pc.checkChoices(pc.load(home), shop, picks);
        if (problem) return [{ error: problem }, 400];
      }
      for (const key of Object.keys(diet)) pc.setDiet(home, String(key).trim(), diet[key]);
      if (stores != null) writeProfile(home, 'stores', String(stores).trim());
      for (const key of Object.keys(profile)) writeProfile(home, key, profile[key]);
      let estimate = null, sized = null;
      if (Object.keys(profile).length) {
        estimate = targetsFromProfile(loadProfile(home), today(home.now.bind(home)), regimenFor(home, loadDiet(home)));
        if (!estimate.missing.length) {
          for (const key of ESTIMATE_KEYS) pc.setDiet(home, key, pc.numstr(estimate[key]));
          /* the plate, from the day's target as the plan will read it, against the rotation the
             device holds, or the plan just chosen where it holds none, at scale 1 (sizeFor);
             the weigh-in window restarts */
          const d = dietOrNull();
          const kcal = (d && d.targets && d.targets.kcal) || estimate.kcal;
          sized = sizeFor(home, d, kcal);
          pc.setDiet(home, 'plate', pc.numstr(sized.plate));
          pc.setDiet(home, 'plate_since', today(home.now.bind(home)));
        }
      }
      await flush(home);
      return { ok: true, estimate, plate: sized };
    },
    '/api/weigh': async (q, init) => {
      /* one weigh-in, typed here: the date a recorded fact, today unless given (server.py's /api/weigh) */
      const body = await bodyJson(init);
      const on = String(body.date || '').trim() || today(home.now.bind(home));
      const point = appendWeighIn(home, on, body.weight_lb);
      await flush(home);
      const stepped = autoStep();
      await flush(home);
      return { ok: true, point, weigh: weigh(), stepped };
    },
    '/api/plate': async (q, init) => {
      /* Undo puts the plate the scale replaced back with its own date; Got it keeps the plate and
         drops the line; a plate given outright is set, the window restarting (server.py's /api/plate) */
      const body = await bodyJson(init);
      let value;
      if (body.undo) value = undoPlate(home, loadDiet(home));
      else if (body.ack) { ackPlate(home); value = pc.plateFromDiet(loadDiet(home)); }
      else value = stepPlate(home, body.plate, today(home.now.bind(home)));
      await flush(home);
      return { ok: true, plate: value };
    },
    '/api/occasions': async (q, init) => {
      const body = await bodyJson(init);
      pc.setOccasionPortions(home, String(body.id || '').trim(), body.value);
      await flush(home);
      return { ok: true };
    },
    '/api/import-tracker': async () => [{ error: 'A food tracking app\'s export is imported on the Mac in this version; the weight and intake it holds come across in a backup.' }, 400],
    '/api/ingest': async (q, init) => {
      /* a report file, rows a person typed or corrected on the preview, or both: the rows win
         when given, with the report's own info behind them (server.py's /api/ingest) */
      const body = await bodyJson(init);
      const file = String(body.file || ''), date = body.date || null;
      const reg = registry(), st = store();
      let rows = [], info = null;
      if (file) {
        if (!file.toLowerCase().endsWith('.pdf') || !file.startsWith(RAW_DIR + '/') || file.includes('..') || !home.exists(file)) {
          return [{ error: 'file must be a PDF inside ' + RAW_DIR }, 400];
        }
        const lib = await pdfjs();
        let text;
        try {
          ({ text } = await readPdf(home.readBytes(file), { pdfjs: lib }));
        } catch (e) {
          return [{ error: "Reading the PDF's text failed: " + (e && e.message || e) }, 400];
        }
        [rows, info] = candidates(home, { file, text, method: 'pdf.js ' + lib.version, registry: reg, date, scanned: looksScanned(text) });
      }
      if (body.rows != null) {
        const lab = String(body.lab || '').trim() || (info ? info.lab : MANUAL_LAB);
        [rows, info] = rowCandidates(home, { rows: body.rows, registry: reg, date: date || (info ? info.date : null), lab, base: info });
      } else if (!file) return [{ error: 'a report file, or typed rows, are needed' }, 400];
      const out = review(home, st, reg, rows, info, { supersede: !!body.supersede, replace: !!body.replace, commit: !!body.commit });
      if (body.commit) await flush(home);
      return out;
    },
    '/api/upload': async (q, init) => {
      let name = String(q.get('name') || 'upload.pdf').split('/').pop().split('\\').pop();
      name = name.replace(/[^A-Za-z0-9._ -]+/g, '_');
      const low = name.toLowerCase();
      if (!/\.(pdf|csv|xlsx|xlsm)$/.test(low)) return [{ error: 'only PDF lab reports, or a food tracking app\'s CSV or XLSX export, are accepted' }, 400];
      const data = await bodyBytes(init);
      const head = new TextDecoder('latin1').decode(data.slice(0, 4096));
      if (low.endsWith('.pdf') && !head.startsWith('%PDF')) return [{ error: 'that does not look like a PDF' }, 400];
      if (/\.(xlsx|xlsm)$/.test(low) && !head.startsWith('PK')) return [{ error: 'that does not look like a spreadsheet' }, 400];
      if (low.endsWith('.csv') && !/[,;\t]/.test(head)) return [{ error: 'that does not look like a CSV' }, 400];
      let dest = RAW_DIR + '/' + name;
      const dot = name.lastIndexOf('.');
      const base = RAW_DIR + '/' + name.slice(0, dot), ext = name.slice(dot);
      let i = 2;
      while (home.exists(dest)) { dest = base + ' (' + i + ')' + ext; i++; }
      home.write(dest, data);
      await flush(home);
      return { file: dest };
    },
    '/api/history': async (q, init) => {
      const body = await bodyJson(init);
      if (body.remove) {
        try { removeHistory(home, parseInt(body.index, 10)); } catch (e) { return [{ error: String(e && e.message || e) }, 400]; }
        /* a condition removed can put food back that a condition excluded, changing the day
           the plate was sized for */
        const sized = resize(home, dietOrNull(), today(home.now.bind(home)));
        await flush(home);
        return resizeReply(sized);
      }
      if (!String(body.item || '').trim()) return [{ error: 'item is required' }, 400];
      const cond = String(body.condition || '').trim().toLowerCase();
      if (cond && !CONDITIONS.includes(cond)) return [{ error: 'condition must be one of ' + CONDITIONS.join(', ') }, 400];
      const limit = String(body.protein_limit_g || '').trim();
      if (limit) {
        const n = Number(limit);
        if (!Number.isFinite(n)) return [{ error: 'protein limit must be a number' }, 400];
        if (!(n > 0)) return [{ error: 'protein limit must be more than 0' }, 400];
      }
      const row = {};
      for (const k of ['date', 'category', 'item', 'status', 'detail', 'affects', 'interval_months', 'last_done', 'condition', 'protein_limit_g']) row[k] = body[k] == null ? '' : body[k];
      if (cond !== 'kidney') row.protein_limit_g = '';   // a number the app compares, only where it says which condition it is for
      if (body.index != null) {
        try { updateHistory(home, parseInt(body.index, 10), row); } catch (e) { return [{ error: String(e && e.message || e) }, 400]; }
      } else {
        appendHistory(home, row);
      }
      // a condition added or changed can leave food out, changing the day the plate was sized for
      const sized = resize(home, dietOrNull(), today(home.now.bind(home)));
      await flush(home);
      return resizeReply(sized);
    },
    '/api/profile': async (q, init) => {
      const body = await bodyJson(init);
      const key = String(body.key || '').trim(), value = String(body.value || '').trim();
      if (!PROFILE_EDITABLE.includes(key) && !pc.PROFILE_KEYS.includes(key)) return [{ error: 'that profile key is not editable here' }, 400];
      if (pc.PROFILE_KEYS.includes(key)) {
        const [shop, picks] = pc.choicesFromProfile({ [key]: value });
        const problem = pc.checkChoices(pc.load(home), shop, picks);
        if (problem) return [{ error: problem }, 400];
      }
      writeProfile(home, key, value);
      await flush(home);
      return { ok: true };
    },
    '/api/restore': async (q, init) => {
      const data = await bodyBytes(init);
      const { files } = readBackup(data);
      await wipe();
      home.files.clear();
      for (const f of files) home.write(f.path, f.bytes);
      ownRestored(home);                       /* what the backup brought is the person's own, whatever its bytes */
      await flush(home);
      return { ok: true, files: files.length };
    },
  };

  window.fetch = async function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = ((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    const table = method === 'POST' ? POST : GET;
    const fn = table[url.pathname];
    if (!fn) return json({ error: 'not found' }, 404);
    try {
      const r = await fn(url.searchParams, init || {});
      if (r instanceof Response) return r;
      if (Array.isArray(r) && r.length === 2 && typeof r[1] === 'number') return json(r[0], r[1]);
      return json(r);
    } catch (e) {
      console.error(url.pathname, e);
      const status = (e instanceof ConfigError || e instanceof PyValueError || (e && e.name === 'ValueError')) ? 400 : 500;
      return json({ error: String(e && e.message || e) }, status);
    }
  };
}
