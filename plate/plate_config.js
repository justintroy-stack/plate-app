/* The Plate's data, read from config: a line-for-line twin of labtrack/plate_config.py.

   Ten CSV files describe what the Plate cooks and buys (meals, kits, cold_slots, items,
   store_items, stores, flavor_pantry, equipment, cooking, regimens; a cooking row carries a
   portions band, and the rows are filtered to the size in play before a meal resolves).
   `load(home, {shop, picks,
   equipment, hands_on, regimen, portions})` reads them from the home and returns the same plain object the
   Python `load()` returns, field for field; the editors (`upsertStore`, `removeStore`,
   `upsertStoreItem`, `removeStoreItem`, `setDiet`) write the same bytes Python writes, keeping
   the same timestamped copy in labs/backups/ first. Python is the oracle: tests/test_twin_c.py
   runs both on the same files and holds them to identical output, error messages included.

   Every function that reads files takes the home first, the way the Python takes config_dir.
   Object fields keep Python's exact names. None is null, a tuple is an array, a set that Python
   returns sorted is a sorted array. */
import { readRows, readDicts, formatDicts } from './csv.js';
import { isValidIso } from './pydate.js';
import { ConfigError, PyValueError, pyFloat, pyRound, fmtNum, pyReprStr, pyRepr, strip, lower, sortedSet, pySorted, stampLocal } from './py.js';

export const FILES = ['meals', 'kits', 'cold_slots', 'items', 'store_items', 'stores', 'flavor_pantry', 'equipment', 'cooking', 'regimens',
  'occasions'];
export const SLOTS = 14;
// The most portions a household can declare. Not decoration: an unbounded count multiplied into
// every quantity would leave Python's arbitrary-precision ints and JavaScript's doubles able to
// disagree, and no kitchen cooks a hundred plates on a countertop oven.
export const PORTIONS_MAX = 100;
export const ZONE_ORDER = ['freezer', 'fridge', 'pantry'];
export const PROFILE_KEYS = ['stores', 'store_picks'];              // the store choice, kept in profile.csv
export const DIET_KEYS = ['equipment', 'hands_on_minutes', 'regimen', 'avoid', 'portions', 'occasions']; // the kitchen, the regimen, who eats and when, kept in diet.csv
// the diet.csv rows the app itself writes: the choices, the day's numbers About you estimates,
// and the plate: one factor per household that scales every recipe, and the date it last changed
export const TARGET_ROWS = ['kcal', 'protein_g', 'fiber_g', 'sat_fat_g', 'added_sugar_g', 'deficit_kcal'];
export const DIET_EDITABLE = ['regimen', 'avoid', 'portions', 'occasions', 'equipment', 'hands_on_minutes', 'plate', 'plate_since', 'plate_prev', 'plate_prev_since', ...TARGET_ROWS];
// The plate factor's bounds and step. Outside them a plan cannot be scaled that far: a recipe
// written for one adult does not survive being cut below half or grown past 140 percent.
export const PLATE_MIN = 0.5, PLATE_MAX = 1.4, PLATE_STEP = 0.05;
// A one-meal day's ceiling: the day's whole target rides on the rotation's one plate, the way a
// three-meal day splits it three ways, so the same recipe reasonably stretches further. Reached
// only when nothing beside the rotation occasion is a real meal (see isSolo).
export const PLATE_MAX_SOLO = 2.0;
// what each target row may hold: [low, high], inclusive; a deficit may be negative, which is a surplus
export const TARGET_BANDS = { kcal: [500, 10000], protein_g: [20, 500], fiber_g: [0, 200], sat_fat_g: [0, 300],
                              added_sugar_g: [0, 300], deficit_kcal: [-2000, 2000] };
export const DIET_COLUMNS = ['key', 'value', 'note'];
export const REGIMEN_COLUMNS = ['id', 'name', 'allows', 'excludes', 'red_meat_slots', 'fish_slots', 'beans_slots', 'unmoved_by', 'unheld', 'protein_per_lb', 'note'];
export const OCCASION_COLUMNS = ['id', 'name', 'portions', 'share', 'rotation', 'note'];
// The food groups an ingredient can belong to. A regimen speaks in these, so a tag outside the
// list is a typo and is refused rather than quietly excluding nothing.
// the first fourteen are food groups an item can belong to; the last four are what a kit or a
// pantry row is made of (dry spices, plant sauces and condiments, real sugar, the bowl's sweet
// flavourings), so a plan can leave those out too. No item carries them.
export const TAGS = ['beef', 'pork', 'poultry', 'fish', 'shellfish', 'dairy', 'egg', 'beans', 'grain', 'potato', 'fruit', 'nuts', 'vegetable', 'soy', 'gluten',
  'spice', 'sauce', 'sugar', 'sweet', 'purine', 'vegetarian', 'vegan'];
export const FOOD_TAGS = TAGS.slice(0, 15);
// A meal's own composition, derived from its ingredients, not a chip: no meat or fish at all
// (vegetarian), and within that, no dairy or egg either (vegan). Phase 14.
export const PLANT_TAGS = ['vegetarian', 'vegan'];
export const MEAT_FISH_TAGS = ['beef', 'pork', 'poultry', 'fish', 'shellfish'];
export const DAIRY_EGG_TAGS = ['dairy', 'egg'];
/* the tags a condition on the health history leaves out; an allow-list plan never counts them against an item (plate_config.CONDITION_TAGS) */
export const CONDITION_TAGS = ['gluten', 'purine'];
// The food behind each count the planner keeps. Red meat in this catalog is beef.
export const COUNT_TAGS = { red_meat_slots: 'beef', fish_slots: 'fish', beans_slots: 'beans' };
// units a thing is counted in rather than measured: a plate takes out whole ones
export const COUNTABLE_UNITS = ['each', 'eggs', 'slices', 'fillets', 'cans', 'links'];
// The same counts as the picker says them and as the planner counts them (plate_config.py)
export const COUNT_WORDS = { red_meat_slots: 'beef', fish_slots: 'fish', beans_slots: 'bean' };
// the targets a plan may declare it does not hold (regimens.csv unheld), and their words
export const UNHELD_KEYS = ['fiber_g', 'sat_fat_g', 'added_sugar_g'];
export const TARGET_WORDS = { fiber_g: 'fiber', sat_fat_g: 'saturated fat', added_sugar_g: 'added sugar' };
export const COUNT_CLASS = { red_meat_slots: 'red_meat', fish_slots: 'fish' };
export const STORE_COLUMNS = ['key', 'name', 'kind', 'list_threshold_meals', 'countdown', 'cadence', 'note'];
export const STORE_KINDS = ['warehouse', 'grocery', 'market'];
export const STORE_ITEM_COLUMNS = ['store', 'item', 'pack', 'buy', 'note'];
export const EQUIPMENT_COLUMNS = ['id', 'name', 'modes', 'note'];
export const COOKING_COLUMNS = ['equipment', 'meal', 'mode', 'temp_f', 'minutes', 'tray', 'band', 'hands_on'];

/* ---- Python's dict, truthiness and formatting, for the few spots where JavaScript differs.
   Exported for rotation.js, which needs the same ones. */

export class PyKeyError extends Error { constructor(message) { super(message); this.name = 'KeyError'; } }
export class PyTypeError extends Error { constructor(message) { super(message); this.name = 'TypeError'; } }
export class PyOverflowError extends Error { constructor(message) { super(message); this.name = 'OverflowError'; } }
export class PyFileNotFoundError extends Error { constructor(message) { super(message); this.name = 'FileNotFoundError'; } }

/* `k in d` for a dict: own keys only, so a store called "constructor" is not found on Object */
export const has = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
/* `k in d` when k comes from outside (an order, a pick): a number never matches a str key, and
   a list or a dict is the TypeError Python raises for an unhashable key */
export function hasStr(o, k) {
  if (k !== null && typeof k === 'object') throw new PyTypeError("unhashable type: '" + (Array.isArray(k) ? 'list' : 'dict') + "'");
  return typeof k === 'string' && has(o, k);
}
/* d.get(k, default) */
export const get = (o, k, d = null) => (has(o, k) ? o[k] : d);
export const getStr = (o, k, d = null) => (hasStr(o, k) ? o[k] : d);
/* d[k]: a KeyError when the column is not there, as Python raises it */
export function req(o, k) {
  if (!has(o, k)) throw new PyKeyError(pyReprStr(k));
  return o[k];
}
/* bool(x) for the values JSON and the CSV files carry */
export function truthy(v) {
  if (v == null || v === false) return false;
  if (v === true) return true;
  if (typeof v === 'number') return v !== 0;          // nan is truthy in Python too
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}
/* `x or ""` then str: what (data.get("name") or "").strip() sees */
export const optStr = v => (truthy(v) ? String(v) : '');
/* `for x in v`: a list as itself, a string as its characters, a dict as its keys */
export function pyIter(v) {
  if (v == null) throw new PyTypeError("'NoneType' object is not iterable");
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return [...v];
  if (typeof v === 'object') return Object.keys(v);
  throw new PyTypeError("'" + typeof v + "' object is not iterable");
}
/* '%s' % v for a JSON value */
export function pyStr(v) {
  if (v === undefined || v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}
/* '%r' % v for a JSON value */
export function pyReprAny(v) {
  if (typeof v === 'string') return pyReprStr(v);
  if (typeof v === 'number' && !Number.isInteger(v)) return pyRepr(v);
  return pyStr(v);
}
/* str(list) for a list of numbers: '[1, 2, 3]' */
export const pyList = nums => '[' + nums.map(fmtNum).join(', ') + ']';
/* float(v) for a JSON value: a bool is 1.0 or 0.0, None and a container are a TypeError */
export function toFloat(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') return pyFloat(v);
  throw new PyTypeError("float() argument must be a string or a number, not '" + (v == null ? 'NoneType' : Array.isArray(v) ? 'list' : typeof v === 'object' ? 'dict' : typeof v) + "'");
}
/* int(f) for a float: toward zero; nan and infinity are the errors Python raises */
export function pyIntOf(f) {
  if (Number.isNaN(f)) throw new PyValueError('cannot convert float NaN to integer');
  if (!Number.isFinite(f)) throw new PyOverflowError('cannot convert float infinity to integer');
  return Math.trunc(f);
}

/* ---- reading */

/* _rows: every cell stripped, a missing column absent, a missing cell '' */
export function rows(home, name, optional = false) {
  const text = home.read('config/' + name + '.csv');
  if (text == null) {
    if (optional) return null;
    throw new ConfigError('missing config/' + name + '.csv (run `labtrack init` to seed it)');
  }
  return readRows(text).map(r => {
    const o = {};
    for (const k of Object.keys(r)) o[k] = strip(r[k]);
    return o;
  });
}

/* store_items.csv, or, for a home from before it existed, the store, pack and buy columns
   that items.csv used to carry. */
function storeRows(home, itemRows) {
  const rs = rows(home, 'store_items', true);
  if (rs !== null) return rs;
  if (itemRows.length && has(itemRows[0], 'store')) {
    const out = [];
    for (const r of itemRows) {
      if (!get(r, 'key')) continue;
      out.push({ store: req(r, 'store'), item: r.key, pack: get(r, 'pack', ''), buy: get(r, 'buy', ''), note: '' });
    }
    return out;
  }
  throw new ConfigError('missing config/store_items.csv (run `labtrack init` to seed it)');
}

/* cooking.csv, or, for a home from before it existed, the mode, temperature, minutes and tray
   columns that meals.csv used to carry, each placed on the first appliance in equipment.csv
   that has the meal's mode. */
function cookingRows(home, mealRows, equip) {
  const rs = rows(home, 'cooking', true);
  if (rs !== null) return rs;
  if (mealRows.length && has(mealRows[0], 'mode')) {
    const out = [];
    for (const r of mealRows) {
      if (!get(r, 'id')) continue;
      const mode = get(r, 'mode', '');
      const on = Object.keys(equip).find(e => equip[e].modes.includes(mode));
      if (on === undefined) throw new ConfigError('meals.csv ' + r.id + ': no appliance in equipment.csv has the mode ' + pyReprStr(mode));
      out.push({ equipment: on, meal: r.id, mode, temp_f: get(r, 'temp_f', ''), minutes: get(r, 'minutes', ''), tray: get(r, 'tray', '') });
    }
    return out;
  }
  throw new ConfigError('missing config/cooking.csv (run `labtrack init` to seed it)');
}

/* _num: '' or None is the default; otherwise float(), held as an int when integral (the same
   JavaScript number either way) */
export function num(v, dflt = null) {
  if (v === '' || v == null) return dflt;
  const f = toFloat(v);
  pyIntOf(f);                    // int(f): nan and infinity raise here, as they do in Python
  return f;
}

/* _list: 'a|b' -> ['a', 'b'] */
export function list(v) {
  if (!truthy(v)) return [];
  return String(v).split('|').map(strip).filter(x => x);
}

/* What a meal or an option consumes, in each item's own unit, times the portions cooked.

   The multiplication happens here and nowhere else: `uses` is the only channel by which food
   leaves the kitchen, and the nutrition figures are their own fields, so "portions multiply
   consumption, never the targets" holds by construction. A quantity left empty stays null
   rather than becoming 0 — Python's `_num` returns None there and `None * 3` raises, so
   multiplying it here would be the twin quietly disagreeing. */
function usesOf(v, where, items, portions = 1, plate = 1) {
  const out = {};
  for (const part of list(v)) {
    if (!part.includes(':')) throw new ConfigError(where + ': uses entry ' + pyReprStr(part) + ' needs the form item:quantity');
    const i = part.indexOf(':');
    const k = strip(part.slice(0, i)), q = part.slice(i + 1);
    if (!has(items, k)) throw new ConfigError(where + ': uses unknown item ' + pyReprStr(k) + ' (add it to items.csv)');
    const n = num(strip(q));
    // at a plate other than 1 the product is rounded to four places (Python's round), so 16 * 0.8
    // is 12.8; at 1 the arithmetic is the file's own and is left exactly as it was
    let v = n === null ? null : (plate === 1 ? n * portions : pyRound(n * portions * plate, 4));
    // a thing counted, not measured, leaves the kitchen in the grain the recipe wrote it in: one
    // fillet, three eggs, never 0.85 of one; half an avocado stays a half
    if (v !== null && COUNTABLE_UNITS.includes(items[k].unit)) v = snap(v, grain(n));
    out[k] = v;
  }
  return out;
}

/* The grain a recipe counts a thing in (wholes, halves, quarters; null when finer), and a scaled
   count snapped to it, never below one grain (plate_config._grain, _snap). */
function grain(q0) { for (const g of [1, 0.5, 0.25]) if (q0 / g === Math.trunc(q0 / g)) return g; return null; }
function snap(q, g) { if (g === null || q === Math.trunc(q)) return q; return Math.max(g, pyRound(pyRound(q / g) * g, 4)); }

/* A nutrition column at the plate: the recipe's own figure at 1, else scaled and rounded to a
   whole unit (Python's round, half to even), because a plate is eaten whole. */
function nut(v, plate) {
  return (v === null || plate === 1) ? v : pyRound(v * plate);
}

/* A cooking row's portions band, `lo-hi` inclusive, or null for any size. Deliberately the
   smallest grammar that covers the need: a bare `3` is ambiguous once portions can be
   fractional, and `3+` needs an infinity sentinel that would have to survive JSON and two
   languages' number formatting. */
function bandOf(v, where) {
  const s = strip(v == null ? '' : String(v));
  if (!s) return null;
  const parts = s.split('-');
  let lo = null, hi = null;
  if (parts.length === 2) {
    try {
      lo = num(strip(parts[0]));
      hi = num(strip(parts[1]));
    } catch (e) {
      if (!(e instanceof PyValueError)) throw e;
      lo = null; hi = null;
    }
  }
  if (lo === null || hi === null || lo <= 0 || hi < lo) {
    throw new ConfigError(where + ': band ' + pyReprStr(s) + ' must be lo-hi, such as 1-2 (blank means any size)');
  }
  return [lo, hi];
}

function covers(band, portions) {
  return band === null || (band[0] <= portions && portions <= band[1]);
}

/* Two bands that both answer for some size. A blank band answers for every size. */
function overlaps(a, b) {
  if (a === null || b === null) return true;
  return a[0] <= b[1] && b[0] <= a[1];
}

function bandstr(band) {
  return band === null ? 'any size' : fmtNum(band[0]) + '-' + fmtNum(band[1]);
}

function tagsOf(v, where) {
  const tags = list(v);
  for (const tag of tags) {
    if (!TAGS.includes(tag)) throw new ConfigError(where + ': unknown tag ' + pyReprStr(tag) + ' (the tags are ' + TAGS.join(', ') + ')');
  }
  return tags;
}

/* occasions.csv, or, for a home from before it existed, one row for the dinner the app has
   always been: the occasion that carries the recipe, cooked for the portions diet.csv names. */
function occasionRows(home, portions) {
  const rs = rows(home, 'occasions', true);
  if (rs !== null) return rs;
  return [{ id: 'dinner', name: 'Dinner', portions: '', share: '1', rotation: 'yes', note: '' }];
}

/* The eating occasions, in file order, each with the portions it is cooked for and its share of
   the day. Exactly one carries the rotation: the 14 slots and the recipe are its own, and every
   other occasion is an option pool like a cold slot. An occasion's `portions` is empty until it
   differs from the household, because the yogurt bowl can be one portion while the roast is
   everybody's; empty means diet.csv's number.

   One cursor tick is one eating cycle — every occasion once. There is no second clock, so a
   three-occasion day advances the rotation by one meal per log, exactly as one occasion does. */
function loadOccasions(home, portions) {
  const out = [], seen = new Set();
  let rot = null;
  for (const r of occasionRows(home, portions)) {
    if (!get(r, 'id')) continue;
    if (seen.has(r.id)) throw new ConfigError('occasions.csv: duplicate occasion id ' + pyReprStr(r.id));
    seen.add(r.id);
    const where = 'occasions.csv ' + r.id;
    const raw_portions = strip(optStr(get(r, 'portions', '')) || '');
    const p = raw_portions ? num(raw_portions, portions) : portions;
    if (!(p > 0 && p <= PORTIONS_MAX)) {
      throw new ConfigError(where + ': portions must be more than 0 and at most ' + PORTIONS_MAX + ', not ' + numstr(p));
    }
    const share = num(get(r, 'share'), 1);
    if (share <= 0) throw new ConfigError(where + ': share must be a positive number of parts, not ' + numstr(share));
    const occ = { id: r.id, name: get(r, 'name', '') || r.id, portions: p,
      portions_own: raw_portions ? p : null, share,
      rotation: lower(get(r, 'rotation', '')) === 'yes', note: get(r, 'note', '') };
    if (occ.rotation) {
      if (rot !== null) throw new ConfigError('occasions.csv: ' + rot + ' and ' + occ.id + ' both carry the rotation; exactly one may');
      rot = occ.id;
    }
    out.push(occ);
  }
  if (!out.length) throw new ConfigError('occasions.csv has no rows');
  if (rot === null) throw new ConfigError('occasions.csv: no occasion carries the rotation (set rotation=yes on one)');
  return [out, rot];
}

/* The food groups a meal or an option contains: the union of its ingredients' tags. */
function containsOf(uses, items) {
  const all = [];
  for (const k of Object.keys(uses)) for (const tag of items[k].tags) all.push(tag);
  return sortedSet(all);
}

/* regimens.csv in file order, with the markers each plan is unmoved by (a food rule reading one
   of them stands down on that plan). An older home without the file has none. */
export function loadRegimens(home) {
  const out = [];
  for (const r of (rows(home, 'regimens', true) || [])) {
    if (!get(r, 'id')) continue;
    const where = 'regimens.csv ' + r.id;
    const reg = { id: r.id, name: get(r, 'name') || r.id, allows: tagsOf(get(r, 'allows', ''), where),
      excludes: tagsOf(get(r, 'excludes', ''), where), unmoved_by: list(get(r, 'unmoved_by', '')),
      unheld: list(get(r, 'unheld', '')), note: get(r, 'note', '') };
    for (const k of reg.unheld) {
      if (!UNHELD_KEYS.includes(k)) throw new ConfigError(where + ': unheld ' + pyReprStr(k) + ' is not a target a plan can leave out (' + UNHELD_KEYS.join(', ') + ')');
    }
    for (const k of Object.keys(COUNT_TAGS)) {
      try {
        reg[k] = num(get(r, k, ''));
      } catch (e) {
        if (e instanceof PyValueError) throw new ConfigError(where + ': ' + k + ' must be a number of nights');
        throw e;
      }
    }
    // the plan's own protein floor, grams per pound (Phase 13: vegan 0.6); blank means the estimate's own figure
    try { reg.protein_per_lb = num(get(r, 'protein_per_lb', '')); }
    catch (e) { throw new ConfigError(where + ': protein_per_lb must be a number of grams per pound'); }
    out.push(reg);
  }
  return out;
}

/* The regimen in play, by id, from diet.csv's `regimen` row. Empty means none. */
export function regimenFromDiet(diet) {
  return strip(optStr(get(truthy(diet) ? diet : {}, 'regimen'))) || null;
}

/* The occasions in play, from diet.csv's `occasions` row: ids from occasions.csv, `a|b`. Empty
   or missing means every occasion in the file. */
export function occasionsFromDiet(diet) {
  const v = list(get(truthy(diet) ? diet : {}, 'occasions', ''));
  return v.length ? v : null;
}

/* What the person leaves out on top of the regimen, from diet.csv's `avoid` row: tags, `a|b`.
   Empty or missing means nothing. */
export function avoidFromDiet(diet) {
  const v = list(get(truthy(diet) ? diet : {}, 'avoid', ''));
  return v.length ? v : null;
}

/* The plate factor in play, from diet.csv's `plate` row: blank means 1, the recipes as written.
   Written by the app from the day's target, never typed. */
export function plateFromDiet(diet) {
  try {
    return num(get(truthy(diet) ? diet : {}, 'plate', ''), 1);
  } catch (e) {
    if (e instanceof PyValueError) return 1;
    throw e;
  }
}

/* The config resolved for one home's choices: the stores the profile puts in play, and the
   kitchen, the regimen, the portions, the occasions and the plate diet.csv names. One resolver
   for the page, the plate sizing and the interview's preview; `plate` given overrides the row. */
export function loadFor(home, profile, diet, plate = null, avoidMore = null) {
  const [shop, picks] = choicesFromProfile(profile);
  const [equipment, hands_on] = kitchenFromDiet(diet);
  // avoidMore: tags left out on top of the person's own (a condition on the health history, Phase 13)
  const avoid = [...(avoidFromDiet(diet) || []), ...pyIter(avoidMore || []).filter(t => t)];
  return load(home, { shop, picks, equipment, hands_on, regimen: regimenFromDiet(diet), portions: portionsFromDiet(diet),
    occasions: occasionsFromDiet(diet), plate: plate === null ? plateFromDiet(diet) : plate, avoid: avoid.length ? avoid : null });
}

/* The portions in play, from diet.csv's `portions` row: how many adult portions the food is
   cooked for. Empty, missing or unreadable means 1. */
export function portionsFromDiet(diet) {
  try {
    return num(get(truthy(diet) ? diet : {}, 'portions', ''), 1);
  } catch (e) {
    if (e instanceof PyValueError) return 1;
    throw e;
  }
}

/* The tags of a meal or an option the regimen leaves out: what it excludes and, when it limits
   itself to a list, whatever is off that list. Empty means the regimen allows it. */
export function leavesOut(tags, regimen) {
  if (!truthy(regimen)) return [];
  const excl = new Set(pyIter(req(regimen, 'excludes')));
  const bad = new Set();
  for (const t of pyIter(tags)) if (excl.has(t)) bad.add(t);
  if (truthy(req(regimen, 'allows'))) {
    const allow = new Set(pyIter(regimen.allows));
    // an allow list speaks food groups (beef, dairy, egg); it was never asked about a
    // condition's tag or a dish's own vegetarian/vegan composition, so neither ever counts
    // against it here -- only the excludes line above, where a plan like Everything now names
    // vegetarian on purpose, ever does (Phase 14)
    for (const t of pyIter(tags)) if (!allow.has(t) && !CONDITION_TAGS.includes(t) && !PLANT_TAGS.includes(t)) bad.add(t);
  }
  return pySorted([...bad]);
}

/* whether a meal is one of the nights a count asks for, the way the planner counts them */
function countsAs(meal, key) {
  if (key === 'beans_slots') return (meal.contains || []).includes('beans');
  return meal.protein_class === COUNT_CLASS[key];
}

/* What a plan cannot fill from the catalog, in plain phrases for the picker (plate_config.py's
   plan_gaps: the same rule, the same words). */
/* A slot's name before its flourish: "Dessert bowl — sweet, cold, on purpose" is "Dessert bowl"
   in a sentence about it (plate_config.short_name). */
export function shortName(name) { return String(name || '').split(' — ')[0]; }

export function planGaps(regimen, meals, declared, cold, rotation_occasion) {
  const out = [];
  const fit = meals.filter(m => declared[m.id] && !leavesOut(m.contains, regimen).length);
  for (const sl of cold) {
    const total = sl.opts.length;
    let kept = 0;
    for (const o of sl.opts) if (!leavesOut(o.contains, regimen).length) kept += 1;
    const name = lower(shortName(sl.name));
    if (kept === 0 && sl.occasion !== rotation_occasion) out.push('no ' + name + ' fits');
    else if (kept === 1 && total > 1) out.push('one ' + name + ' option');
  }
  if (fit.length < 2 * SLOTS) out.push(fit.length + ' dinners fit, two rotations need ' + (2 * SLOTS));
  for (const key of Object.keys(COUNT_TAGS)) {
    const asked = regimen[key];
    if (asked == null || asked <= 0) continue;
    let n = 0;
    for (const m of fit) if (countsAs(m, key)) n += 1;
    if (n < asked) out.push('asks for ' + numstr(asked) + ' ' + COUNT_WORDS[key] + ' night' + (asked === 1 ? '' : 's') + ', ' + n + ' fit');
  }
  return out;
}

/* [shop, picks] from the profile's `stores` and `store_picks` rows. */
export function choicesFromProfile(profile) {
  profile = truthy(profile) ? profile : {};
  const shop = list(get(profile, 'stores', ''));
  const picks = {};
  for (const part of list(get(profile, 'store_picks', ''))) {
    if (part.includes(':')) {
      const i = part.indexOf(':');
      const item = part.slice(0, i), st = part.slice(i + 1);
      if (strip(item) && strip(st)) picks[strip(item)] = strip(st);
    }
  }
  return [shop.length ? shop : null, picks];
}

/* [equipment, hands_on] from diet.csv's `equipment` and `hands_on_minutes` rows. */
export function kitchenFromDiet(diet) {
  diet = truthy(diet) ? diet : {};
  const equipment = list(get(diet, 'equipment', ''));
  let hands_on;
  try {
    hands_on = num(get(diet, 'hands_on_minutes', ''));
  } catch (e) {
    if (e instanceof PyValueError) hands_on = null; else throw e;
  }
  return [equipment.length ? equipment : null, hands_on];
}

/* Why a choice cannot be saved, or null. */
export function checkChoices(cfg, shop, picks) {
  for (const st of pyIter(shop || [])) {
    if (!hasStr(cfg.stores, st)) return 'unknown store ' + pyReprAny(st);
  }
  for (const [item, st] of Object.entries(truthy(picks) ? picks : {})) {
    if (!has(cfg.items, item)) return 'unknown item ' + pyReprAny(item);
    if (!hasStr(cfg.items[item].offers, st)) return cfg.items[item].name + ' is not carried by ' + pyReprAny(st);
  }
  return null;
}

/* True when nothing beside the rotation occasion is a real meal's worth of the day (a
   one-occasion home, or dinner plus a snack): the day the rotation's one plate has to carry
   alone, the way OMAD does. */
function isSolo(occasions) {
  return !occasions.some(o => !o.rotation && o.share >= 1);
}

/* The plate factor's top for a set of occasions, resolved the same way load resolves which
   occasions are on: PLATE_MAX_SOLO when nothing beside the rotation occasion is a real meal,
   else the flat PLATE_MAX every multi-meal day already uses. wantedOccasions:
   occasionsFromDiet's return, or null for every occasion in the file. */
export function plateCeiling(home, wantedOccasions) {
  const [in_file] = loadOccasions(home, 1);
  const wanted = new Set(wantedOccasions || []);
  const occasions = in_file.filter(o => !wanted.size || wanted.has(o.id) || o.rotation);
  return isSolo(occasions) ? PLATE_MAX_SOLO : PLATE_MAX;
}

/* shop: the stores in play, in preference order (null: all, in file order).
   picks: {item: store} for items more than one store in play carries.
   equipment: the appliances in play, in preference order (null: all, in file order).
   hands_on: the hands-on budget in minutes a meal must fit inside to be in the pool (null: no ceiling).
   regimen: the way of eating in play, by id from regimens.csv (null, or an unknown id: nothing left out). */
export function load(home, opts = {}) {
  const opt = k => { const v = get(opts, k); return v === undefined ? null : v; };
  const shop = opt('shop'), equipment = opt('equipment'), hands_on = opt('hands_on'), regimen = opt('regimen'), avoidIn = opt('avoid');
  const occasions_in = opt('occasions');
  let picks = opt('picks');
  const portions_in = opt('portions');
  const household = portions_in === null ? 1 : num(portions_in, 1);
  if (!(household > 0 && household <= PORTIONS_MAX)) {
    throw new ConfigError('portions must be more than 0 and at most ' + PORTIONS_MAX + ', not ' + numstr(household));
  }
  const plate_in = opt('plate');
  const plate = plate_in === null ? 1 : num(plate_in, 1);
  const [in_file, rotation_occasion] = loadOccasions(home, household);
  // The occasions in play. The catalog is every row in the file, each marked on or off, so a
  // picker can offer the ones that are off; the rotation occasion cannot be turned off, because
  // the recipe has to belong somewhere.
  const wanted = new Set(occasions_in || []);
  const occasion_catalog = in_file.map(o => ({ id: o.id, name: o.name, rotation: o.rotation,
    on: !wanted.size || wanted.has(o.id) || o.rotation }));
  const on_ids = new Set(occasion_catalog.filter(c => c.on).map(c => c.id));
  const occasions = in_file.filter(o => on_ids.has(o.id));
  const occ_by_id = {};
  for (const o of occasions) occ_by_id[o.id] = o;
  const occ_order = occasions.map(o => o.id);
  const known_occasions = new Set(in_file.map(o => o.id));
  // The rotation occasion's cold block is the second course of a one-meal day. Beside another
  // meal-sized occasion (a share of one whole part or more) it is put away; a snack leaves it.
  const solo = isSolo(occasions);
  const plate_max = solo ? PLATE_MAX_SOLO : PLATE_MAX;
  if (!(PLATE_MIN <= plate && plate <= plate_max)) {
    throw new ConfigError('plate must be between ' + numstr(PLATE_MIN) + ' and ' + numstr(plate_max) + ', not ' + numstr(plate));
  }
  // The recipe belongs to one occasion, so the meals are cooked for its portions. The household
  // count itself goes back out as cfg.portions untouched: it is what diet.csv said, the Who eats
  // card shows it and writes it back, and an occasion's own count lives on the occasion.
  const portions = occ_by_id[rotation_occasion].portions;

  const stores = {}, store_catalog = [];
  for (const r of rows(home, 'stores')) {
    if (!get(r, 'key')) continue;
    const kind = lower(strip(get(r, 'kind', '')));
    stores[r.key] = { key: r.key, name: req(r, 'name'), threshold: num(get(r, 'list_threshold_meals'), 21),
      kind: STORE_KINDS.includes(kind) ? kind : (lower(get(r, 'countdown', '')) === 'yes' ? 'warehouse' : 'grocery'),
      countdown: lower(get(r, 'countdown', '')) === 'yes', cadence: get(r, 'cadence', ''),
      note: get(r, 'note', ''), shop: true };
    store_catalog.push(r.key);
  }
  if (!Object.keys(stores).length) throw new ConfigError('stores.csv has no rows');
  // The stores in play, in preference order. A name stores.csv no longer has is ignored, and
  // an empty choice means every store, so no choice can leave the kitchen with no store.
  let store_order = pyIter(shop || []).filter(s => hasStr(stores, s));
  if (!store_order.length) store_order = [...store_catalog];
  for (const k of Object.keys(stores)) stores[k].shop = store_order.includes(k);

  const item_rows = rows(home, 'items');
  const items = {}, item_order = [];
  for (const r of item_rows) {
    if (!get(r, 'key')) continue;
    items[r.key] = { key: r.key, name: req(r, 'name'), unit: req(r, 'unit'), zone: req(r, 'zone') || 'pantry',
      countdown: lower(get(r, 'countdown', 'yes')) !== 'no', note: get(r, 'note', ''),
      tags: tagsOf(get(r, 'tags', ''), 'items.csv ' + r.key),
      // per one unit of the item, for something had by amount outside the plan (Phase 12);
      // a file from before the columns carries null
      kcal: num(get(r, 'kcal')), protein_g: num(get(r, 'protein_g')), sat_fat_g: num(get(r, 'sat_fat_g')), fiber_g: num(get(r, 'fiber_g')),
      offers: {}, store: '', pack: 0, buy: '' };
    item_order.push(r.key);
  }
  // Whether this items.csv carries real food-group tags at all: a file from before the tags
  // column reads every item's tags as empty, the same shape as a fully tagged file's pantry
  // items. Meat, fish, dairy and egg are the tags a vegetarian or vegan derivation depends on;
  // with none anywhere, there is nothing to derive from (Phase 14).
  const tagged_catalog = Object.values(items).some(it => it.tags.some(t => MEAT_FISH_TAGS.includes(t) || DAIRY_EGG_TAGS.includes(t)));
  for (const r of storeRows(home, item_rows)) {
    if (!get(r, 'item') && !get(r, 'store')) continue;
    if (!has(stores, req(r, 'store'))) throw new ConfigError('store_items.csv: ' + req(r, 'item') + ' names store ' + pyReprStr(r.store) + ', not in stores.csv');
    if (!has(items, req(r, 'item'))) throw new ConfigError('store_items.csv: ' + r.store + ' carries ' + pyReprStr(r.item) + ', not in items.csv');
    items[r.item].offers[r.store] = { pack: num(get(r, 'pack'), 0), buy: get(r, 'buy', ''), note: get(r, 'note', '') };
  }
  // Resolve each item to one store: the pick if it stands, else the first store in play that
  // carries it. What no store in play carries is reported, never silently dropped.
  picks = truthy(picks) ? picks : {};
  const unsupplied = [];
  for (const k of item_order) {
    const it = items[k];
    if (!Object.keys(it.offers).length) throw new ConfigError('items.csv: no store carries ' + k + ' (add a row to store_items.csv)');
    let chosen = get(picks, k);
    if (!hasStr(it.offers, chosen) || !store_order.includes(chosen)) {
      chosen = store_order.find(s => has(it.offers, s));
      if (chosen === undefined) chosen = null;
    }
    if (chosen === null) { unsupplied.push(k); continue; }
    Object.assign(it, { store: chosen, pack: it.offers[chosen].pack, buy: it.offers[chosen].buy });
  }

  const equip = {}, equip_catalog = [];
  for (const r of rows(home, 'equipment')) {
    if (!get(r, 'id')) continue;
    equip[r.id] = { id: r.id, name: get(r, 'name') || r.id, modes: list(get(r, 'modes', '')), note: get(r, 'note', ''), on: true };
    equip_catalog.push(r.id);
  }
  if (!Object.keys(equip).length) throw new ConfigError('equipment.csv has no rows');
  // The appliances in play, in preference order. As with stores, an id equipment.csv no longer
  // has is ignored and an empty choice means everything.
  let equipment_order = pyIter(equipment || []).filter(e => hasStr(equip, e));
  if (!equipment_order.length) equipment_order = [...equip_catalog];
  for (const k of Object.keys(equip)) equip[k].on = equipment_order.includes(k);

  // The way of eating in play. An id regimens.csv does not know is ignored rather than fatal.
  const regimens = loadRegimens(home);
  let reg = null;
  if (truthy(regimen)) reg = regimens.find(r => r.id === regimen) || null;
  // What the person will not eat, on top of the regimen: the same rule, one more list. `eff`
  // is what leaves food out; `reg` stays the plan by name, with its counts.
  const avoid = sortedSet(pyIter(avoidIn || []).filter(t => TAGS.includes(t)));
  let eff = reg;
  if (avoid.length) {
    eff = Object.assign({}, reg || { id: '', name: '', allows: [], excludes: [], note: '' });
    eff.excludes = sortedSet([...eff.excludes, ...avoid]);
  }

  const kits = {};
  // a kit and a pantry row carry what they are made of, and the plan and the chips leave them
  // out by the same rule as a cold option; a file from before the column keeps every row
  for (const r of rows(home, 'kits')) {
    if (get(r, 'id')) {
      const ktags = tagsOf(get(r, 'tags', ''), 'kits.csv ' + r.id);
      kits[r.id] = { id: r.id, name: req(r, 'name'), instruction: get(r, 'instruction', ''), tags: ktags, excluded: leavesOut(ktags, eff) };
    }
  }

  const meals = [], seen_slots = new Map(), declared = {};
  const meal_rows = rows(home, 'meals');
  for (const r of meal_rows) {
    if (!get(r, 'id')) continue;
    const where = 'meals.csv ' + r.id;
    const needs = list(get(r, 'needs', ''));
    for (const e of needs) {
      if (!has(equip, e)) throw new ConfigError(where + ': needs unknown equipment ' + pyReprStr(e) + ' (add it to equipment.csv)');
    }
    for (const k of list(get(r, 'kits', ''))) {
      if (!has(kits, k)) throw new ConfigError(where + ': unknown kit ' + pyReprStr(k));
    }
    const uses = usesOf(get(r, 'uses', ''), where, items, portions, plate);
    if (get(r, 'thaw') && !has(items, r.thaw)) throw new ConfigError(where + ': thaw item ' + pyReprStr(r.thaw) + ' is not in items.csv');
    const protein_item = get(r, 'protein_item') || get(r, 'thaw') || '';
    if (protein_item && !has(uses, protein_item)) throw new ConfigError(where + ': protein_item ' + pyReprStr(protein_item) + ' is not among its uses');
    const slot = num(get(r, 'slot'));
    if (slot !== null) {
      if (!(1 <= slot && slot <= SLOTS) || seen_slots.has(slot)) {
        throw new ConfigError(where + ': slot ' + fmtNum(slot) + ' must be unique and between 1 and ' + SLOTS);
      }
      seen_slots.set(slot, r.id);
    }
    let contains = containsOf(uses, items);
    // vegetarian: none of its ingredients carry a meat or fish tag; vegan, within that, none
    // carry dairy or egg either. Read from the ingredients themselves, not protein_class -- a
    // dish classed by its main protein as egg can still use bacon or sausage alongside it, which
    // protein_class alone would miss (Phase 14).
    if (tagged_catalog && !MEAT_FISH_TAGS.some(t => contains.includes(t))) {
      const plantTags = DAIRY_EGG_TAGS.some(t => contains.includes(t)) ? ['vegetarian'] : ['vegetarian', 'vegan'];
      contains = pySorted([...new Set([...contains, ...plantTags])]);
    }
    declared[r.id] = lower(get(r, 'in_pool', 'yes')) !== 'no';
    meals.push({ id: r.id, slot, name: req(r, 'name'), sub: get(r, 'sub', ''), form: get(r, 'form', ''),
      thaw: get(r, 'thaw') || null, protein_item: protein_item || null,
      protein_class: get(r, 'protein_class', ''), kcal: nut(num(get(r, 'kcal'), 0), plate),
      protein_g: nut(num(get(r, 'protein_g'), 0), plate), sat_fat_g: nut(num(get(r, 'sat_fat_g')), plate),
      fiber_g: nut(num(get(r, 'fiber_g')), plate), kits: list(get(r, 'kits', '')), uses, portions,
      steps: list(get(r, 'steps', '')), needs, hands_on: num(get(r, 'hands_on')),
      cooking: {}, equipment: '', mode: '', temp_f: null, minutes: 0, tray: '', why_not: '',
      contains, excluded: leavesOut(contains, eff),
      excluded_items: Object.keys(uses).filter(k => items[k].tags.some(t => leavesOut(contains, eff).includes(t))),
      in_pool: declared[r.id], declared: declared[r.id], note: get(r, 'note', '') });
  }
  if (seen_slots.size !== SLOTS) {
    throw new ConfigError('meals.csv must fill slots 1-' + SLOTS + '; found ' + pyList(pySorted([...seen_slots.keys()])));
  }
  let baseline = [];
  for (let i = 1; i <= SLOTS; i++) {
    if (!seen_slots.has(i)) throw new PyKeyError(String(i));
    baseline.push(seen_slots.get(i));
  }
  // A regimen can carry its own rotation: rotations.csv, one row per slot, for a way of eating
  // the default rotation does not serve. meals.csv's slots stay the default, so a regimen with
  // no rows has the baseline it always had. Every regimen's rows are checked, in play or not.
  const rotations = {}, by_regimen = {};
  for (const x of regimens) by_regimen[x.id] = x;
  const mids = {};
  for (const m of meals) mids[m.id] = m;
  for (const r of (rows(home, 'rotations', true) || [])) {
    if (!get(r, 'regimen') && !get(r, 'meal')) continue;
    const where = 'rotations.csv ' + pyStr(get(r, 'regimen')) + '/' + pyStr(get(r, 'slot'));
    if (!has(by_regimen, get(r, 'regimen'))) continue;   // a regimen the file does not know: ignored, as with a store or an appliance
    const slot = num(get(r, 'slot'));
    if (!has(rotations, r.regimen)) rotations[r.regimen] = new Map();
    const own = rotations[r.regimen];
    if (slot === null || !(1 <= slot && slot <= SLOTS) || own.has(slot)) {
      throw new ConfigError(where + ': slot ' + pyReprStr(get(r, 'slot')) + ' must be unique and between 1 and ' + SLOTS);
    }
    if (!has(mids, get(r, 'meal'))) throw new ConfigError(where + ': unknown meal ' + pyReprStr(get(r, 'meal')) + ' (add it to meals.csv)');
    const off = leavesOut(mids[r.meal].contains, by_regimen[r.regimen]);
    if (off.length) {
      throw new ConfigError(where + ': ' + r.meal + ' has ' + off.join(', ') + ', which the ' + lower(by_regimen[r.regimen].name) + ' regimen leaves out');
    }
    own.set(slot, r.meal);
  }
  for (const rid of Object.keys(rotations)) {
    if (rotations[rid].size !== SLOTS) {
      throw new ConfigError('rotations.csv: ' + rid + ' must fill slots 1-' + SLOTS + '; found ' + pyList(pySorted([...rotations[rid].keys()])));
    }
  }
  if (reg && has(rotations, reg.id)) {
    baseline = [];
    for (let i = 1; i <= SLOTS; i++) baseline.push(rotations[reg.id].get(i));
  }
  // Plan B is the off-rotation meal the row itself keeps out of the pool. When the regimen
  // leaves it out it is withdrawn rather than offered with a caveat.
  // Plan B is the first off-rotation meal the row itself keeps out of the pool and the regimen
  // does not leave out, so a plant-based Plan B is one more row; none fitting means withdrawn.
  const pb = meals.find(m => m.slot === null && !declared[m.id] && !m.excluded.length);
  const plan_b = pb ? pb.id : null;

  // How each meal cooks on each appliance, then each meal resolved to the first appliance in
  // play that has a row for it.
  const by_id = {};
  for (const m of meals) by_id[m.id] = m;
  const cooked = new Set(), bands = new Map();
  for (const r of cookingRows(home, meal_rows, equip)) {
    if (!get(r, 'meal') && !get(r, 'equipment')) continue;
    if (!has(equip, req(r, 'equipment'))) throw new ConfigError('cooking.csv: ' + req(r, 'meal') + ' names equipment ' + pyReprStr(r.equipment) + ', not in equipment.csv');
    if (!has(by_id, req(r, 'meal'))) throw new ConfigError('cooking.csv: ' + r.equipment + ' cooks ' + pyReprStr(r.meal) + ', not in meals.csv');
    const mode = get(r, 'mode', ''), app = equip[r.equipment];
    if (mode && !app.modes.includes(mode)) {
      throw new ConfigError('cooking.csv: the ' + app.name + ' has no ' + mode + ' mode (it has ' + (app.modes.join(', ') || 'none') + ')');
    }
    const band = bandOf(get(r, 'band', ''), 'cooking.csv ' + r.equipment + '/' + r.meal);
    // Two rows answering for one size is a broken file whatever the household is, so the
    // refusal does not depend on the portions in play.
    const key = r.meal + '\u0000' + r.equipment;
    if (!bands.has(key)) bands.set(key, []);
    for (const other of bands.get(key)) {
      if (overlaps(band, other)) {
        throw new ConfigError('cooking.csv: ' + r.meal + ' on the ' + app.name + ' has two rows for '
          + bandstr(other) + ' and ' + bandstr(band) + '; the bands may not overlap');
      }
    }
    bands.get(key).push(band);
    cooked.add(r.meal);          // unfiltered: this is what tells "nothing cooks it" from "not at this size"
    if (!covers(band, portions)) continue;
    by_id[r.meal].cooking[r.equipment] = { mode, temp_f: num(get(r, 'temp_f')), minutes: num(get(r, 'minutes'), 0),
      tray: get(r, 'tray', ''), hands_on: num(get(r, 'hands_on')) };
  }
  // The pool is computed: the row's own declaration, then the kitchen, then the regimen, and
  // each reason travels with the meal (why_not for the kitchen, excluded for the regimen).
  const uncookable = [], excluded = [];
  for (const m of meals) {
    if (!cooked.has(m.id)) throw new ConfigError('meals.csv ' + m.id + ': no appliance cooks it (add a row to cooking.csv)');
    const on = equipment_order.find(e => has(m.cooking, e));
    // Resolve before judging: the hands-on ceiling reads the band's own timing when it has one,
    // so the settings have to be on the meal before the comparison happens.
    if (on !== undefined) {
      const settings = m.cooking[on];
      for (const k of ['mode', 'temp_f', 'minutes', 'tray']) m[k] = settings[k];
      if (settings.hands_on !== null) m.hands_on = settings.hands_on;
      m.equipment = on;
    }
    if (!Object.keys(m.cooking).length) {
      m.why_not = 'no cooking guidance for ' + fmtNum(portions) + ' portions';
    } else {
      const missing = on === undefined ? [Object.keys(m.cooking).map(e => 'the ' + equip[e].name).join(' or ')] : [];
      for (const e of m.needs) if (!equipment_order.includes(e)) missing.push('the ' + equip[e].name);
      if (missing.length) {
        m.why_not = 'needs ' + missing.join(' and ');
      } else if (hands_on != null && m.hands_on !== null && m.hands_on > hands_on) {
        m.why_not = fmtNum(m.hands_on) + ' min hands-on, over the ' + fmtNum(hands_on) + ' min budget';
      }
    }
    if (m.why_not) uncookable.push(m.id);
    if (m.excluded.length) excluded.push(m.id);
    m.in_pool = declared[m.id] && !m.why_not && !m.excluded.length;
  }

  // The cold block generalized: a slot is one option pool, and every pool belongs to an eating
  // occasion. Slot ids stay globally unique, because the page keys its offsets, its ticks and
  // its DOM by the bare id; two occasions sharing one would silently merge into one pool.
  const cold = [], by_slot = {}, cold_excluded = [], slot_occ = {};
  let put_away = false;    // dinner's cold block sat out beside another meal, so an empty list is not a broken file
  for (const r of rows(home, 'cold_slots')) {
    if (!get(r, 'slot')) continue;
    const where = 'cold_slots.csv ' + r.slot + '/' + pyStr(get(r, 'option'));
    const occ_id = strip(get(r, 'occasion', '') || '') || rotation_occasion;
    if (!known_occasions.has(occ_id)) throw new ConfigError(where + ': unknown occasion ' + pyReprStr(occ_id) + ' (add it to occasions.csv)');
    if (has(slot_occ, r.slot) && slot_occ[r.slot] !== occ_id) {
      throw new ConfigError('cold_slots.csv: slot ' + r.slot + ' names occasion ' + pyReprStr(slot_occ[r.slot])
        + ' on one row and ' + pyReprStr(occ_id) + ' on another');
    }
    slot_occ[r.slot] = occ_id;
    if (!has(occ_by_id, occ_id)) continue;   // an occasion that is off: its pools sit out, the way a store that is off does
    // a row of an occasion in play is read whole first, so a bad row is refused in the same
    // words whether or not its block is on the table tonight
    const uses = usesOf(get(r, 'uses', ''), where, items, occ_by_id[occ_id].portions, plate);
    const contains = containsOf(uses, items);
    const off = leavesOut(contains, eff);
    if (occ_id === rotation_occasion && !solo) { put_away = true; continue; }   // the cold block, put away beside another meal
    // the slot is named by its first option the plan keeps (plate_config.load): a bowl whose sweet
    // options the plan leaves out is not called "Dessert bowl" over plain yogurt
    if (!has(by_slot, r.slot)) {
      by_slot[r.slot] = { id: r.slot, name: get(r, 'slot_name', '') || r.slot, occasion: occ_id, opts: [], named_by_kept: !off.length };
      cold.push(by_slot[r.slot]);
    } else if (!off.length && !by_slot[r.slot].named_by_kept) {
      by_slot[r.slot].name = get(r, 'slot_name', '') || r.slot;
      by_slot[r.slot].named_by_kept = true;
    }
    if (off.length) cold_excluded.push({ slot: r.slot, label: req(r, 'label') });
    by_slot[r.slot].opts.push({ label: req(r, 'label'), kcal: nut(num(get(r, 'kcal'), 0), plate), protein_g: nut(num(get(r, 'protein_g'), 0), plate),
      sat_fat_g: nut(num(get(r, 'sat_fat_g')), plate), fiber_g: nut(num(get(r, 'fiber_g')), plate),
      uses, portions: occ_by_id[occ_id].portions, contains, excluded: off,
      excluded_items: Object.keys(uses).filter(k => items[k].tags.some(t => off.includes(t))) });
  }
  for (const sl of cold) delete sl.named_by_kept;
  if (!cold.length && !put_away) throw new ConfigError('cold_slots.csv has no rows');
  // In occasion order, so the flat list every consumer walks and the cards the page draws cannot
  // disagree about what comes first.
  cold.sort((a, b) => occ_order.indexOf(a.occasion) - occ_order.indexOf(b.occasion));
  // What each regimen on file would leave out, so a picker can say "9 of 15 meals fit".
  for (const r of regimens) {
    r.leaves_out_meals = meals.filter(m => leavesOut(m.contains, r).length).map(m => m.id);
    r.leaves_out_cold = [];
    for (const sl of cold) for (const o of sl.opts) if (leavesOut(o.contains, r).length) r.leaves_out_cold.push(o.label);
    r.gaps = planGaps(r, meals, declared, cold, rotation_occasion);
  }

  const flavor = [];
  for (const r of rows(home, 'flavor_pantry')) {
    if (!get(r, 'id')) continue;
    const ftags = tagsOf(get(r, 'tags', ''), 'flavor_pantry.csv ' + r.id);
    flavor.push({ id: r.id, name: req(r, 'name'), note: get(r, 'note', ''), tags: ftags, excluded: leavesOut(ftags, eff) });
  }
  const zones = [...ZONE_ORDER, ...sortedSet(Object.values(items).map(it => it.zone).filter(z => !ZONE_ORDER.includes(z)))];
  return { meals, baseline, plan_b, kits, cold,
    items, item_order, stores, store_order,
    store_catalog, store_picks: Object.assign({}, picks), unsupplied,
    equipment: equip, equipment_order, equipment_catalog: equip_catalog,
    hands_on_minutes: hands_on, uncookable, portions: household, plate, plate_max,
    regimens, regimen: reg, avoid, excluded, cold_excluded,
    occasions, occasion_catalog, rotation_occasion,
    rotations: pySorted(Object.keys(rotations)),
    zones, flavor };
}

export function mealIndex(cfg) {
  const out = {};
  for (const m of cfg.meals) out[m.id] = m;
  return out;
}

/* An occasion's share of the daily target: its parts over every occasion's parts. Shares are
   weights, not fractions that must sum to one — three equal occasions are 0.3333 in any fixed
   unit, which needs a tolerance, and a tolerance on a hand-edited file is a false-refusal
   generator. Summed in file order, so both engines agree bit for bit. */
export function occasionShare(cfg, occ) {
  let total = 0.0;
  for (const o of cfg.occasions) total += o.share;
  return occ.share / total;
}

/* Mean of a nutrient over the cold block, one option per slot drawn evenly. `occasion` limits
   it to the pools attached to one eating occasion; null is every slot, which is the whole day. */
export function coldAverage(cfg, field, occasion = null) {
  let total = 0.0;
  for (const sl of cfg.cold) {
    if (occasion !== null && get(sl, 'occasion') !== occasion) continue;
    const vals = sl.opts.filter(o => get(o, field) != null && !truthy(get(o, 'excluded'))).map(o => o[field]);
    if (vals.length) {
      let s = 0;
      for (const v of vals) s += v;
      total += s / vals.length;
    }
  }
  return total;
}

/* ---- editing the rows from the app
   Every writer loads the config as it would be after the write, in a scratch copy, and refuses
   a change that would break the Plate. Each write keeps a timestamped copy in labs/backups/ first. */

/* A key from a name: 'Whole Foods' -> whole_foods. */
export function slug(name) {
  return strip(optStr(name)).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'store';
}

function isTruthyWord(v) {
  return v === true || ['yes', 'true', '1', 'on'].includes(lower(strip(pyStr(v))));
}

/* _numstr: str(int(f)) when integral, str(f) otherwise */
export function numstr(f) {
  const x = toFloat(f);
  pyIntOf(x);
  return fmtNum(x);
}

function withCols(fields, needed) {
  return [...fields, ...needed.filter(c => !fields.includes(c))];
}

/* Rows as written, with the file's own column order kept and a missing cell null. */
function raw(home, name) {
  const p = 'config/' + name + '.csv';
  const text = home.read(p);
  if (text == null) throw new PyFileNotFoundError('[Errno 2] No such file or directory: ' + pyReprStr(p));
  const { fieldnames, rows: rs } = readDicts(text);
  return { fieldnames: [...fieldnames], rows: rs.map(r => Object.assign({}, r)) };
}

/* store_items.csv as written, or, for a home from before it existed, the rows the old
   items.csv columns imply, so the first edit creates the file. */
function rawStoreItems(home) {
  if (home.exists('config/store_items.csv')) {
    const { fieldnames, rows: rs } = raw(home, 'store_items');
    return [withCols(fieldnames, STORE_ITEM_COLUMNS), rs];
  }
  return [[...STORE_ITEM_COLUMNS], storeRows(home, rows(home, 'items'))];
}

function writeCsv(home, path, fieldnames, rs) {
  const out = rs.map(r => {
    const o = {};
    for (const c of fieldnames) { const v = get(r, c); o[c] = v == null ? '' : v; }
    return o;
  });
  home.write(path, formatDicts([...fieldnames], out, { lineterminator: '\n' }));
}

/* Write one config file, keeping a timestamped copy in labs/backups first. */
export function saveRows(home, name, fieldnames, rs) {
  const p = 'config/' + name + '.csv';
  if (home.exists(p)) {
    const stamp = stampLocal(home.now());
    let dest = 'labs/backups/' + name + '-' + stamp + '.csv', n = 2;
    while (home.exists(dest)) {
      dest = 'labs/backups/' + name + '-' + stamp + '-' + n + '.csv';
      n += 1;
    }
    home.copy(p, dest);
  }
  writeCsv(home, p, fieldnames, rs);
}

/* Load the config as it would be after writing `changes` ({name: [fieldnames, rows]}) in a
   scratch copy, so a write that would break the Plate is refused before it lands. */
export function tryRows(home, changes) {
  const scratch = home.clone();
  for (const [name, [fieldnames, rs]] of Object.entries(changes)) writeCsv(scratch, 'config/' + name + '.csv', fieldnames, rs);
  return load(scratch);
}

function itemNames(home) {
  return rows(home, 'items').filter(r => get(r, 'key')).map(r => [r.key, req(r, 'name')]);
}

/* Add a store, or change one by key. data: name, threshold (meals of supply), cadence,
   countdown, note; key names an existing row to change. Returns the key. */
export function upsertStore(home, data) {
  let { fieldnames: fields, rows: rs } = raw(home, 'stores');
  fields = withCols(fields, STORE_COLUMNS);
  const name = strip(optStr(get(data, 'name')));
  let key = strip(optStr(get(data, 'key')));
  if (!name) throw new ConfigError('a store needs a name');
  const existing = {};
  for (const r of rs) if (get(r, 'key')) existing[r.key] = r;
  if (key && !has(existing, key)) throw new ConfigError('unknown store ' + pyReprStr(key));
  for (const r of rs) {
    if (lower(strip(optStr(get(r, 'name')))) === lower(name) && get(r, 'key') !== key) {
      throw new ConfigError('there is already a store called ' + r.name);
    }
  }
  if (!key) {
    const base = slug(name);
    key = base;
    let n = 2;
    while (has(existing, key)) { key = base + '_' + n; n += 1; }
  }
  let thr = get(data, 'threshold');
  try {
    thr = (thr == null || thr === '') ? 21 : pyIntOf(toFloat(thr));
  } catch (e) {
    if (e instanceof PyTypeError || e instanceof PyValueError) throw new ConfigError('the list threshold must be a number of meals');
    throw e;
  }
  if (thr < 1) throw new ConfigError('the list threshold must be at least 1 meal');
  let row = get(existing, key);
  if (row === null) {
    row = { key, note: '' };
    rs.push(row);
  }
  Object.assign(row, { name, list_threshold_meals: fmtNum(thr), countdown: isTruthyWord(get(data, 'countdown')) ? 'yes' : 'no',
    cadence: strip(optStr(get(data, 'cadence'))) });
  if (get(data, 'kind') != null) {
    const kind = lower(strip(pyStr(data.kind)));
    if (kind && !STORE_KINDS.includes(kind)) throw new ConfigError("a store's kind is one of " + STORE_KINDS.join(', ') + ', not ' + pyReprStr(kind));
    row.kind = kind;
  }
  if (get(data, 'note') != null) row.note = strip(pyStr(data.note));
  tryRows(home, { stores: [fields, rs] });
  saveRows(home, 'stores', fields, rs);
  return key;
}

/* Take a store and every row it carries out. Refused when an item would be left with no
   store, naming the items, and when it is the last store. */
export function removeStore(home, key) {
  const { fieldnames: fields, rows: rs } = raw(home, 'stores');
  const names = {};
  for (const r of rs) if (get(r, 'key')) names[r.key] = get(r, 'name') || r.key;
  if (!hasStr(names, key)) throw new ConfigError('unknown store ' + pyReprAny(key));
  if (Object.keys(names).length === 1) throw new ConfigError(names[key] + ' is the last store; add another before removing it');
  const [ifields, irows] = rawStoreItems(home);
  const keep = irows.filter(r => get(r, 'store') !== key);
  const left = new Set(keep.map(r => get(r, 'item')));
  const stranded = itemNames(home).filter(([k]) => !left.has(k)).map(([, n]) => n);
  if (stranded.length) {
    throw new ConfigError('removing ' + names[key] + ' would leave ' + stranded.length + ' item' + (stranded.length === 1 ? '' : 's')
      + ' with no store: ' + stranded.join(', '));
  }
  const kept = rs.filter(r => get(r, 'key') !== key);
  tryRows(home, { stores: [fields, kept], store_items: [ifields, keep] });
  saveRows(home, 'store_items', ifields, keep);
  saveRows(home, 'stores', fields, kept);
}

/* Add or change what a store carries: store, item, pack (in the item's unit), buy, note. */
export function upsertStoreItem(home, data) {
  const items = Object.fromEntries(itemNames(home));
  const units = {};
  for (const r of rows(home, 'items')) if (get(r, 'key')) units[r.key] = get(r, 'unit', '');
  const stores = new Set();
  for (const r of rows(home, 'stores')) if (get(r, 'key')) stores.add(r.key);
  const store = strip(optStr(get(data, 'store'))), item = strip(optStr(get(data, 'item')));
  if (!stores.has(store)) throw new ConfigError('unknown store ' + pyReprStr(store));
  if (!has(items, item)) throw new ConfigError('unknown item ' + pyReprStr(item));
  let pack;
  try {
    pack = toFloat(get(data, 'pack'));
  } catch (e) {
    if (e instanceof PyTypeError || e instanceof PyValueError) throw new ConfigError('the pack size must be a number of ' + (get(units, item) || 'units'));
    throw e;
  }
  if (pack <= 0) throw new ConfigError('the pack size must be more than 0');
  const [fields, rs] = rawStoreItems(home);
  let row = rs.find(r => get(r, 'store') === store && get(r, 'item') === item);
  if (row === undefined) {
    row = { store, item, note: '' };
    rs.push(row);
  }
  Object.assign(row, { pack: numstr(pack), buy: strip(optStr(get(data, 'buy'))) });
  if (get(data, 'note') != null) row.note = strip(pyStr(data.note));
  tryRows(home, { store_items: [fields, rs] });
  saveRows(home, 'store_items', fields, rs);
}

/* Take one row out. Refused when it is the only store carrying the item. */
export function removeStoreItem(home, store, item) {
  const [fields, rs] = rawStoreItems(home);
  const keep = rs.filter(r => !(get(r, 'store') === store && get(r, 'item') === item));
  if (keep.length === rs.length) throw new ConfigError(pyStr(store) + ' does not carry ' + pyStr(item));
  if (!keep.some(r => get(r, 'item') === item)) {
    const name = getStr(Object.fromEntries(itemNames(home)), item, item);
    throw new ConfigError(pyStr(name) + ' would have no store left; give it another store first');
  }
  tryRows(home, { store_items: [fields, keep] });
  saveRows(home, 'store_items', fields, keep);
}

/* The note a fresh row gets when a key has never been written before. Only used the first time
   a key is set from the app; an installed home's own note is left alone otherwise. */
const DIET_NOTES = {
  avoid: 'What you will not eat, on top of the plan: food-group tags separated by |, e.g. dairy|pork. A meal or a cold option that has one leaves the pool. Chosen on first run and under Profile',
  regimen: 'How you eat, by id from regimens.csv; chosen under Profile',
  portions: 'Adult portions the food is cooked for; multiplies what a meal and the cold block '
            + 'consume, never the nutrition targets. Chosen under Profile',
  occasions: 'When you eat, by id from occasions.csv; empty means every occasion in the file, '
             + 'and the one carrying the rotation is always in play. Chosen under Profile',
  equipment: 'What the kitchen has, by id from equipment.csv, in preference order; empty means '
             + 'everything there. Chosen under Profile',
  hands_on_minutes: 'Hands-on budget per meal; a meal timed above it leaves the pool. Empty means '
                    + 'no ceiling. Chosen under Profile',
  kcal: "Calories a day: estimated from About you (Profile, Your target), or a food tracking app's expenditure minus the deficit when its export is on file",
  protein_g: 'Protein a day: 0.8 g per lb of body weight from About you, clamped to a sensible band',
  fiber_g: 'Fibre floor a day: 14 g per 1,000 kcal from About you',
  sat_fat_g: 'Saturated fat cap a day: a tenth of the calories from About you',
  added_sugar_g: "Added sugar cap a day: 20 g, the plan's own decision",
  deficit_kcal: 'How far under estimated maintenance the calories sit (negative means over, to gain); from the goal in About you',
  plate: "The plate: one factor scaling every recipe's quantities and nutrition together, sized from the day's target and stepped by the weigh-ins. Blank means 1, the recipes as written",
  plate_since: 'The date the plate last changed, which restarts the weigh-in window; the app writes it',
  plate_prev: "The plate the scale's last step replaced, kept until Got it or Undo on Tonight; the app writes it",
  plate_prev_since: 'The date that replaced plate had been set on, so Undo resumes its window; the app writes it',
};

/* One row in diet.csv, for the choices the app itself writes (DIET_EDITABLE). A regimen
   regimens.csv does not know, or a portions count outside 0 and PORTIONS_MAX, is refused; an
   empty value clears the choice (portions falls back to 1). */
/* The value one diet.csv row would be written with, or a ConfigError saying why it cannot be:
   the checks setDiet makes before it writes, on their own, so an interview can check every
   answer before it writes any. */
export function checkDiet(home, key, value) {
  if (!DIET_EDITABLE.includes(key)) throw new ConfigError(pyStr(key) + ' is not a setting the app writes');
  value = strip(optStr(value));
  if (key === 'regimen' && value && !loadRegimens(home).some(r => r.id === value)) throw new ConfigError('unknown regimen ' + pyReprStr(value));
  if (key === 'avoid' && value) tagsOf(value, 'avoid');
  if (key === 'occasions' && value) {
    const known = new Set(loadOccasions(home, 1)[0].map(o => o.id));
    for (const occ_id of list(value)) {
      if (!known.has(occ_id)) throw new ConfigError('unknown occasion ' + pyReprStr(occ_id) + ' (add it to occasions.csv)');
    }
  }
  if (key === 'equipment' && value) {
    const known = new Set(rows(home, 'equipment').filter(r => get(r, 'id')).map(r => r.id));
    for (const e of list(value)) {
      if (!known.has(e)) throw new ConfigError('unknown equipment ' + pyReprStr(e) + ' (add it to equipment.csv)');
    }
  }
  if (key === 'hands_on_minutes' && value) {
    let n;
    try {
      n = num(value);
    } catch (e) {
      if (e instanceof PyValueError) throw new ConfigError('hands-on minutes must be a number, not ' + pyReprStr(value));
      throw e;
    }
    if (n <= 0) throw new ConfigError('hands-on minutes must be more than 0, not ' + numstr(n));
  }
  if (key === 'portions' && value) {
    let p;
    try {
      p = num(value);
    } catch (e) {
      if (e instanceof PyValueError) throw new ConfigError('portions must be a number of people, not ' + pyReprStr(value));
      throw e;
    }
    if (!(p > 0 && p <= PORTIONS_MAX)) {
      throw new ConfigError('portions must be more than 0 and at most ' + PORTIONS_MAX + ', not ' + numstr(p));
    }
  }
  if (has(TARGET_BANDS, key) && value) {
    let n;
    try {
      n = num(value);
    } catch (e) {
      if (e instanceof PyValueError) throw new ConfigError(key + ' must be a number, not ' + pyReprStr(value));
      throw e;
    }
    const [lo, hi] = TARGET_BANDS[key];
    if (!(lo <= n && n <= hi)) throw new ConfigError(key + ' must be between ' + lo + ' and ' + hi + ', not ' + numstr(n));
    return numstr(n);
  }
  if ((key === 'plate' || key === 'plate_prev') && value) {
    let p;
    try {
      p = num(value);
    } catch (e) {
      if (e instanceof PyValueError) throw new ConfigError(key + ' must be a number, not ' + pyReprStr(value));
      throw e;
    }
    const { rows: drows } = raw(home, 'diet');
    const dietNow = {};
    for (const r of drows) if (r.key) dietNow[r.key] = r.value || '';
    const pmax = plateCeiling(home, occasionsFromDiet(dietNow));
    if (!(PLATE_MIN <= p && p <= pmax)) throw new ConfigError(key + ' must be between ' + numstr(PLATE_MIN) + ' and ' + numstr(pmax) + ', not ' + numstr(p));
    return numstr(p);
  }
  if ((key === 'plate_since' || key === 'plate_prev_since') && value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !isValidIso(value)) throw new ConfigError(key + ' must be a date, YYYY-MM-DD, not ' + pyReprStr(value));
  }
  return value;
}

export function setDiet(home, key, value) {
  value = checkDiet(home, key, value);
  let { fieldnames: fields, rows: rs } = raw(home, 'diet');
  fields = withCols(fields, DIET_COLUMNS);
  let row = rs.find(r => get(r, 'key') === key);
  if (row === undefined) {
    row = { key, note: DIET_NOTES[key] || '' };
    rs.push(row);
  }
  row.value = value;
  saveRows(home, 'diet', fields, rs);
}

/* How many people one eating occasion is cooked for, overriding the household count from
   diet.csv. An empty value clears the override, so the occasion follows the household count
   again. An occasion occasions.csv does not know, or a value outside 0 and PORTIONS_MAX, is
   refused. */
export function setOccasionPortions(home, occasionId, value) {
  value = strip(optStr(value));
  if (value) {
    let p;
    try {
      p = num(value);
    } catch (e) {
      if (e instanceof PyValueError) throw new ConfigError('portions must be a number of people, not ' + pyReprStr(value));
      throw e;
    }
    if (!(p > 0 && p <= PORTIONS_MAX)) {
      throw new ConfigError('portions must be more than 0 and at most ' + PORTIONS_MAX + ', not ' + numstr(p));
    }
  }
  let { fieldnames: fields, rows: rs } = raw(home, 'occasions');
  fields = withCols(fields, OCCASION_COLUMNS);
  const row = rs.find(r => get(r, 'id') === occasionId);
  if (row === undefined) throw new ConfigError('unknown occasion ' + pyReprStr(occasionId) + ' (add it to occasions.csv)');
  row.portions = value;
  tryRows(home, { occasions: [fields, rs] });
  saveRows(home, 'occasions', fields, rs);
}
