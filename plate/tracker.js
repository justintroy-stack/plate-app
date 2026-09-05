/* The two generic stores a food tracker feeds (labs/body_metrics.csv, labs/intake_daily.csv),
   read the way labtrack/importers/macrofactor.py reads them back. The importer itself (header
   detection, kg to lb, the merge) is not ported; the page only reads what it stored. */
import { readRows } from './csv.js';

export const BODY_COLS = ['date', 'weight_lb', 'trend_weight_lb', 'source'];
export const INTAKE_COLS = ['date', 'kcal', 'protein_g', 'fat_g', 'carb_g', 'fiber_g', 'sugar_g', 'added_sugar_g',
                            'sat_fat_g', 'sodium_mg', 'cholesterol_mg', 'expenditure_kcal', 'fasting', 'partial_logging', 'source'];

/* Every row reduced to the listed columns, '' for a column the file does not have (and null
   for a cell a short row does not have, as DictReader leaves it). */
function load(home, path, cols) {
  const text = home.read(path);
  if (text == null) return [];
  return readRows(text).map(r => {
    const o = {};
    for (const c of cols) o[c] = r[c] === undefined ? '' : r[c];
    return o;
  });
}

export function loadBody(home) { return load(home, 'labs/body_metrics.csv', BODY_COLS); }
export function loadIntake(home) { return load(home, 'labs/intake_daily.csv', INTAKE_COLS); }
