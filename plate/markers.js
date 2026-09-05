/* Marker registry: canonical marker ids and the printed names (aliases) that map to them.
   A twin of labtrack/markers.py: matching is exact after uppercasing and collapsing whitespace;
   nothing is inferred. */
import { readRows } from './csv.js';
import { orEmpty, PySystemExit, PyValueError, pyReprStr } from './py.js';
import { getCloseMatches } from './difflib.js';
import { saveRows } from './plate_config.js';

export const ALIAS_COLUMNS = ['alias', 'marker', 'source', 'note'];

export function norm(name) { return orEmpty(name).trim().replace(/\s+/g, ' ').toUpperCase(); }

/* Write one alias row: a printed name and the marker it joins, chosen by a person on the ingest
   preview. An earlier row for the same printed name is replaced, and a timestamped copy of the
   file is kept first like every config write. A twin of markers.add_alias. */
export function addAlias(home, alias, marker, source = 'app', note = '') {
  alias = orEmpty(alias).trim().replace(/\s+/g, ' ');
  marker = orEmpty(marker).trim();
  if (!alias) throw new PyValueError('An alias needs the printed name.');
  const reg = MarkerRegistry.load(home);
  if (!Object.prototype.hasOwnProperty.call(reg.markers, marker)) throw new PyValueError("No marker called '" + marker + "'.");
  const text = home.read('config/aliases.csv');
  const rows = text == null ? [] : readRows(text).filter(r => norm(r.alias) !== norm(alias));
  rows.push({ alias, marker, source, note });
  saveRows(home, 'aliases', ALIAS_COLUMNS, rows);
  return alias;
}

export class MarkerRegistry {
  constructor(markers, aliases, ignore) {
    this.markers = markers;        // id -> {display_name, category}
    this.aliases = aliases;        // norm(alias) -> id
    this.ignore = ignore || {};    // norm(printed name) -> reason; never stored
  }
  static load(home, configDir = 'config') {
    const markers = {}, aliases = {}, ignore = {};
    const mtext = home.read(configDir + '/markers.csv');
    if (mtext != null) {
      for (const r of readRows(mtext)) {
        if (r.marker) markers[r.marker.trim()] = { display_name: orEmpty(r.display_name).trim(), category: orEmpty(r.category).trim() };
      }
    }
    const atext = home.read(configDir + '/aliases.csv');
    if (atext != null) {
      for (const r of readRows(atext)) {
        if (r.alias && r.marker) {
          const mid = r.marker.trim();
          if (!(mid in markers)) throw new PySystemExit('aliases.csv refers to unknown marker ' + pyReprStr(mid) + ' (alias ' + pyReprStr(r.alias) + ')');
          aliases[norm(r.alias)] = mid;
        }
      }
    }
    const itext = home.read(configDir + '/ignore.csv');
    if (itext != null) {
      for (const r of readRows(itext)) {
        if (r.printed_name) ignore[norm(r.printed_name)] = orEmpty(r.reason);
      }
    }
    return new MarkerRegistry(markers, aliases, ignore);
  }
  ignored(printedName) { return norm(printedName) in this.ignore; }
  /* Marker id for a printed test name, or '' if there is no explicit alias. */
  resolve(printedName) { return this.aliases[norm(printedName)] || ''; }
  display(markerId) {
    const m = this.markers[markerId];
    return m && m.display_name ? m.display_name : markerId;
  }
  category(markerId) {
    const m = this.markers[markerId];
    return m ? m.category : '';
  }
  /* Marker id from an id, display name, or alias (case-insensitive). */
  lookup(query) {
    const q = norm(query);
    for (const [mid, m] of Object.entries(this.markers)) {
      if (q === norm(mid) || q === norm(m.display_name)) return mid;
    }
    return this.aliases[q] || '';
  }
  /* Closest markers for an unmapped printed name. Suggestions only; never applied. */
  suggest(printedName, n = 3) {
    const pool = {};
    for (const [mid, m] of Object.entries(this.markers)) {
      pool[norm(m.display_name || mid)] = mid;
      pool[norm(mid.replace(/_/g, ' '))] = mid;
    }
    for (const [a, mid] of Object.entries(this.aliases)) pool[a] = mid;
    const hits = getCloseMatches(norm(printedName), Object.keys(pool), n * 2, 0.6);
    const out = [];
    for (const h of hits) if (!out.includes(pool[h])) out.push(pool[h]);
    return out.slice(0, n);
  }
}
