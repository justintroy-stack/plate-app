/* difflib.SequenceMatcher and get_close_matches, ported from CPython's difflib.py so the
   registry suggests the same markers, in the same order, that the Python engine suggests.

   Sequences are compared element by element; a string is split into code points first, the
   way Python iterates it. The junk and "popular element" (autojunk) heuristics are kept even
   though a printed test name never reaches 200 characters, so the port stays a port. */
import { fmtNum, pyCmp, pySorted, PyValueError } from './py.js';

function calculateRatio(matches, length) {
  if (length) return 2.0 * matches / length;
  return 1.0;
}

function seq(x) { return typeof x === 'string' ? Array.from(x) : Array.from(x || []); }

export class SequenceMatcher {
  constructor(isjunk = null, a = '', b = '', autojunk = true) {
    this.isjunk = isjunk;
    this.rawA = this.rawB = null;
    this.a = this.b = null;
    this.autojunk = autojunk;
    this.setSeqs(a, b);
  }

  setSeqs(a, b) { this.setSeq1(a); this.setSeq2(b); }

  setSeq1(a) {
    if (a === this.rawA) return;
    this.rawA = a;
    this.a = seq(a);
    this.matching_blocks = this.opcodes = null;
  }

  setSeq2(b) {
    if (b === this.rawB) return;
    this.rawB = b;
    this.b = seq(b);
    this.matching_blocks = this.opcodes = null;
    this.fullbcount = null;
    this._chainB();
  }

  _chainB() {
    const b = this.b;
    const b2j = this.b2j = new Map();
    for (let i = 0; i < b.length; i++) {
      const elt = b[i];
      let indices = b2j.get(elt);
      if (!indices) { indices = []; b2j.set(elt, indices); }
      indices.push(i);
    }
    // Purge junk elements
    const junk = this.bjunk = new Set();
    const isjunk = this.isjunk;
    if (isjunk) {
      for (const elt of b2j.keys()) if (isjunk(elt)) junk.add(elt);
      for (const elt of junk) b2j.delete(elt);
    }
    // Purge popular elements that are not junk
    const popular = this.bpopular = new Set();
    const n = b.length;
    if (this.autojunk && n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      for (const [elt, idxs] of b2j) if (idxs.length > ntest) popular.add(elt);
      for (const elt of popular) b2j.delete(elt);
    }
  }

  /* [i, j, k]: a[i:i+k] == b[j:j+k], the longest such block, earliest in a then in b. */
  findLongestMatch(alo = 0, ahi = null, blo = 0, bhi = null) {
    const a = this.a, b = this.b, b2j = this.b2j, bjunk = this.bjunk;
    if (ahi == null) ahi = a.length;
    if (bhi == null) bhi = b.length;
    let besti = alo, bestj = blo, bestsize = 0;
    // find longest junk-free match; j2len[j] = length of longest junk-free match ending
    // with a[i-1] and b[j]
    let j2len = new Map();
    const nothing = [];
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      const idxs = b2j.get(a[i]) || nothing;
      for (const j of idxs) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = newj2len;
    }
    // Extend the best by non-junk elements on each end.
    while (besti > alo && bestj > blo && !bjunk.has(b[bestj - 1]) && a[besti - 1] === b[bestj - 1]) {
      besti -= 1; bestj -= 1; bestsize += 1;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && !bjunk.has(b[bestj + bestsize])
           && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize += 1;
    }
    // Now suck up the matching junk on each side of it too.
    while (besti > alo && bestj > blo && bjunk.has(b[bestj - 1]) && a[besti - 1] === b[bestj - 1]) {
      besti -= 1; bestj -= 1; bestsize += 1;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && bjunk.has(b[bestj + bestsize])
           && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize += 1;
    }
    return [besti, bestj, bestsize];
  }

  /* [[i, j, n], ...] ascending in i and j, adjacent equal blocks collapsed, ending with the
     dummy [len(a), len(b), 0]. */
  getMatchingBlocks() {
    if (this.matching_blocks != null) return this.matching_blocks;
    const la = this.a.length, lb = this.b.length;
    const queue = [[0, la, 0, lb]];
    const matchingBlocks = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const x = this.findLongestMatch(alo, ahi, blo, bhi);
      const [i, j, k] = x;
      if (k) {
        matchingBlocks.push(x);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    matchingBlocks.sort(pyCmp);
    let i1 = 0, j1 = 0, k1 = 0;
    const nonAdjacent = [];
    for (const [i2, j2, k2] of matchingBlocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1) nonAdjacent.push([i1, j1, k1]);
        i1 = i2; j1 = j2; k1 = k2;
      }
    }
    if (k1) nonAdjacent.push([i1, j1, k1]);
    nonAdjacent.push([la, lb, 0]);
    this.matching_blocks = nonAdjacent;
    return this.matching_blocks;
  }

  ratio() {
    let matches = 0;
    for (const triple of this.getMatchingBlocks()) matches += triple[2];
    return calculateRatio(matches, this.a.length + this.b.length);
  }

  quickRatio() {
    if (this.fullbcount == null) {
      const fullbcount = this.fullbcount = new Map();
      for (const elt of this.b) fullbcount.set(elt, (fullbcount.get(elt) || 0) + 1);
    }
    const fullbcount = this.fullbcount;
    const avail = new Map();
    let matches = 0;
    for (const elt of this.a) {
      const numb = avail.has(elt) ? avail.get(elt) : (fullbcount.get(elt) || 0);
      avail.set(elt, numb - 1);
      if (numb > 0) matches += 1;
    }
    return calculateRatio(matches, this.a.length + this.b.length);
  }

  realQuickRatio() {
    const la = this.a.length, lb = this.b.length;
    return calculateRatio(Math.min(la, lb), la + lb);
  }
}

/* The best (no more than n) possibilities scoring at least cutoff against word, most similar
   first. heapq.nlargest on (score, x) tuples: a tie on the score is broken by the string,
   descending, and equal tuples keep their original order. */
export function getCloseMatches(word, possibilities, n = 3, cutoff = 0.6) {
  if (!(n > 0)) throw new PyValueError('n must be > 0: ' + fmtNum(n));
  if (!(0.0 <= cutoff && cutoff <= 1.0)) throw new PyValueError('cutoff must be in [0.0, 1.0]: ' + fmtNum(cutoff));
  const result = [];
  const s = new SequenceMatcher();
  s.setSeq2(word);
  for (const x of possibilities) {
    s.setSeq1(x);
    if (s.realQuickRatio() >= cutoff && s.quickRatio() >= cutoff && s.ratio() >= cutoff) {
      result.push([s.ratio(), x]);
    }
  }
  return pySorted(result, t => t, true).slice(0, n).map(t => t[1]);
}
