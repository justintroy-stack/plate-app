/* Quest Diagnostics patient-portal PDFs. A twin of labtrack/parsers/quest.py; the registry that
   chooses a parser is parsers.js.

   Observed layout:

       PANEL NAME
       Analyte                    Value
       TEST NAME        123 H     Reference Range: 65-99 mg/dL

   Variants handled: unit right after the value with 'Reference Range' on a following line
   (LDL, ApoB, hs-CRP); percent-only rows with no range; '<30'-style values. Analyte names are
   printed in capitals, which is what keeps commentary lines out.

   The patterns below are Python's verbose (re.X) patterns written out: in verbose mode every
   unescaped space in the pattern is ignored, so 'NOT\ DETECTED' is the two words and the line
   breaks are nothing. A wrong character here silently changes a lab value, so each one is held
   to the Python original by tests/test_twin_b.py on every sample report. */
import { matchStart, search, findAll } from './py.js';
import { RANGE_TOKEN_RE, normalizeRange, splitRangeUnit } from './ranges.js';
import { fromUS } from './pydate.js';

const VALUE = "(?<value>[<>]\\s?=?\\s?\\d[\\d,]*(?:\\.\\d+)?|\\d[\\d,]*(?:\\.\\d+)?"
  + "|NEGATIVE|POSITIVE|NOT DETECTED|DETECTED|NORMAL|ABNORMAL|[AB])"
  + "(?:\\s+(?<flag>HH|LL|H|L))?";

export const RESULT_RE = new RegExp(
  "^\\s*(?<name>[A-Z][A-Z0-9 ,/()\\-.'+%]*?[A-Z0-9)%])\\s{2,}" + VALUE + "(?:\\s{2,}(?<rest>\\S.*?)|\\s*)$");
// Some send-out tests print mixed case (e.g. 'OxLDL'); accept those only when the line carries
// its own 'Reference Range', which commentary lines never do.
export const RESULT_MIXED_RE = new RegExp(
  "^\\s*(?<name>[A-Za-z][A-Za-z0-9 ,/()\\-.'+%]*?[A-Za-z0-9)%])\\s{2,}" + VALUE
  + "\\s{2,}(?<rest>Reference\\s+[Rr]ange:.*?)\\s*$");
export const ANALYTE_HEADER_RE = /^\s*Analyte\s+Value\s*$/;
export const REF_LINE_RE = /^\s*Reference\s+[Rr]ange:?\s*(?<r>.*)$/;
export const FOOTER_RE = /\b\d+\s*\/\s*\d+\b.*\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/;
export const LOOKS_LIKE_RESULT_RE = /^\s*[A-Z][A-Z ,/()\-]{2,}\s{2,}\S/;
const DATE_PATTERNS = [
  /Collected:\s*(\d{1,2}\/\d{1,2}\/\d{4})/,
  /Date\s+Collected:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/,
  /Collection\s+Date:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/,
];
const QUEST_RE = /Quest\s*Diagnostics|questdiagnostics\.com/i;

export class QuestParser {
  /* Python reads `name` off the class and off an instance alike; in JavaScript a class already
     has a `name`, so both are stated. */
  static get name() { return 'quest'; }
  get name() { return 'quest'; }

  static matches(text) { return !!search(QUEST_RE, text); }

  parse(text) {
    const lines = String(text).replace(/\f/g, '\n').split('\n');   // page breaks become line breaks
    const results = [], unparsed = [];
    let panel = '', inPanel = false, lastNonblank = null;
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const stripped = line.trim();
      if (matchStart(ANALYTE_HEADER_RE, line)) {
        panel = (lastNonblank || '').trim();
        inPanel = true;
        i += 1;
        continue;
      }
      if (stripped.toLowerCase().startsWith('performing sites')) inPanel = false;
      if (stripped) lastNonblank = stripped;
      if (!inPanel || !stripped || search(FOOTER_RE, line)) {
        i += 1;
        continue;
      }
      const m = matchStart(RESULT_RE, line) || matchStart(RESULT_MIXED_RE, line);
      if (!m) {
        if (matchStart(LOOKS_LIKE_RESULT_RE, line) && !matchStart(REF_LINE_RE, line)) unparsed.push(stripped);
        i += 1;
        continue;
      }
      const name = m.groups.name.replace(/\s+/g, ' ').trim();
      const rawValue = m.groups.value;
      const value = '<>'.includes(rawValue[0]) ? rawValue.replace(/\s+/g, '') : rawValue.trim();
      const rest = (m.groups.rest || '').trim();
      const ref = matchStart(REF_LINE_RE, rest);
      let unit, refRange;
      if (ref) {
        [refRange, unit] = splitRangeUnit(ref.groups.r);
      } else {
        unit = rest;
        refRange = lookaheadRange(lines, i);
      }
      results.push({ test_name: name, value, unit, ref_range: refRange, lab_flag: m.groups.flag || '', panel });
      i += 1;
    }
    const spec = search(/Specimen:\s*(\S+)/, text);
    return { date_drawn: findDate(text), specimen_id: spec ? spec[1] : '', results, unparsed };
  }
}

/* Range printed on a following line ('Reference range: <100', 'Reference Range   <90', or
   'Reference Range' then 'Optimal <1.0'). */
function lookaheadRange(lines, i) {
  let j = i + 1, seen = 0;
  while (j < lines.length && seen < 4) {
    const nxt = lines[j].trim();
    if (nxt) {
      seen += 1;
      if (matchStart(RESULT_RE, lines[j]) || matchStart(RESULT_MIXED_RE, lines[j]) || matchStart(ANALYTE_HEADER_RE, lines[j])) return '';
      const rm = matchStart(REF_LINE_RE, nxt);
      if (rm) {
        let cand = rm.groups.r.trim();
        if (!search(RANGE_TOKEN_RE, cand)) {
          let k = j + 1;
          while (k < lines.length && !lines[k].trim()) k += 1;
          cand = k < lines.length ? lines[k].trim() : '';
        }
        const toks = findAll(RANGE_TOKEN_RE, cand, 'range');
        if (toks.length >= 2 || (j + 1 < lines.length && matchStart(REF_LINE_RE, lines[j + 1].trim()))) {
          // Several ranges printed (e.g. by time of day). Keep the printed text verbatim; no
          // numeric bounds means no computed flag.
          const parts = [cand.replace(/\s+/g, ' ')];
          let k = j + 1;
          while (k < lines.length && matchStart(REF_LINE_RE, lines[k].trim())) {
            parts.push(matchStart(REF_LINE_RE, lines[k].trim()).groups.r.trim().replace(/\s+/g, ' '));
            k += 1;
          }
          return parts.join(' | ');
        }
        const tok = search(RANGE_TOKEN_RE, cand);
        return tok ? normalizeRange(tok.groups.range) : cand;
      }
    }
    j += 1;
  }
  return '';
}

function findDate(text) {
  for (const pat of DATE_PATTERNS) {
    const m = search(pat, text);
    if (m) return fromUS(m[1]);
  }
  return null;
}
