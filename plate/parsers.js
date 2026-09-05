/* Parser registry: a twin of labtrack/parsers/__init__.py.

   A lab with a layout of its own is a class in PARSERS; every other layout is read by the
   generic reader, which reads cells by their shape and is never verified, so the preview asks
   for every row to be checked. */
import { search } from './py.js';
import { QuestParser } from './quest.js';
import { GenericParser, cellsOf, squash, LETTER_RE } from './generic.js';

export const PARSERS = [QuestParser];
const KNOWN_LABS = [
  [/Quest\s*Diagnostics|questdiagnostics\.com/i, 'Quest Diagnostics'],
  [/LabCorp|Labcorp|Laboratory Corporation of America/i, 'Labcorp'],
  [/Sonora\s*Quest/i, 'Sonora Quest'],
  [/BioReference/i, 'BioReference'],
  [/ARUP\s+Laboratories/i, 'ARUP'],
  [/Mayo\s+Clinic\s+Laboratories/i, 'Mayo Clinic Laboratories'],
  [/Cleveland\s+HeartLab/i, 'Cleveland HeartLab'],
  [/Boston\s+Heart/i, 'Boston Heart'],
];

/* the lab that printed the report: one of the names above, else the first words on the page
   when they read as a name, else 'Unknown' */
export function detectLab(text) {
  text = String(text);
  for (const [pat, name] of KNOWN_LABS) if (search(pat, text)) return name;
  for (const line of text.replace(/\f/g, '\n').split('\n')) {
    const cells = cellsOf(line);
    if (!cells.length) continue;
    const first = squash(cells[0][1]);
    if (first.length >= 3 && first.length <= 40 && (first.match(LETTER_RE) || []).length >= 2 && !search(/[\d:]/, first)) return first;
    return 'Unknown';
  }
  return 'Unknown';
}

/* [parser, verified]. A layout no parser claims is read by the generic reader, unverified. */
export function pickParser(text) {
  for (const cls of PARSERS) if (cls.matches(text)) return [new cls(), true];
  return [new GenericParser(), false];
}
