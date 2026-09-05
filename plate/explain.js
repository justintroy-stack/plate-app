/* Plain-language explanations for each marker (config/explain.csv). A twin of labtrack/explain.py.

   Deliberately generic: it describes the marker, never the reader. The personal half (your
   value, which lens judged it, whether it is above or below) is assembled at display time from
   your own stored data, so nothing here can assert anything about you. */
import { readRows } from './csv.js';
import { strip } from './py.js';
import { pyStr } from './pyx.js';

export const FIELDS = ['what_it_is', 'why_it_matters', 'what_moves_it', 'high_means', 'low_means', 'caveat'];

/* marker -> {marker, what_it_is, why_it_matters, what_moves_it, high_means, low_means, caveat} */
export function loadExplanations(home) {
  const out = {};
  const text = home.read('config/explain.csv');
  if (text == null) return out;
  for (const r of readRows(text)) {
    const mid = strip(r.marker);
    if (mid) {
      const e = { marker: mid };
      for (const k of FIELDS) e[k] = strip(r[k]);
      out[mid] = e;
    }
  }
  return out;
}

/* One sentence restating the reader's own number against the target that judged it. Pure
   formatting of stored data: it introduces no claim the data does not already carry. */
export function situation(value, unit, vsTarget, targetText, lens) {
  if (!value) return '';
  const v = pyStr(value) + (unit ? ' ' + pyStr(unit) : '');
  if (!targetText) {
    return 'Yours is ' + v + '. There is no researched target for this one, so it is read against the range your lab printed.';
  }
  if (vsTarget === 'above') return 'Yours is ' + v + ', above the ' + pyStr(targetText) + ' you are aiming for under the ' + pyStr(lens) + ' view.';
  if (vsTarget === 'below') return 'Yours is ' + v + ', below the ' + pyStr(targetText) + ' you are aiming for under the ' + pyStr(lens) + ' view.';
  if (vsTarget === 'in') return 'Yours is ' + v + ', inside the ' + pyStr(targetText) + ' target under the ' + pyStr(lens) + ' view.';
  return 'Yours is ' + v + '. Target ' + pyStr(targetText) + '.';
}
