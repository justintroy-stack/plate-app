/* Math.sumPrecise, for a browser that predates it.

   pdf.js 6 adds up glyph metrics with Math.sumPrecise (a 2025 addition to the language): it sits
   on the font-parsing path, so reading any report touches it. Safari shipped it in 18.4 (March
   2025). An iPhone on an older iOS -- or one too old to ever reach 18.4 -- has no such function,
   and pdf.js throws "undefined is not a function" the instant it reads a page. That is the crash
   on the link (his iPhone, 2026-09-09): invisible to Chromium and to modern Node, which both
   already have it, so it never showed in testing here.

   This installs a stand-in when, and only when, the engine has none -- in whatever realm imports
   it: the page's (api.js imports it), and the pdf.js worker's (pdfworker.js imports it before the
   library). Where the engine already has Math.sumPrecise, this leaves it untouched.

   The stand-in is a Neumaier compensated sum: it keeps the rounding error the running total drops
   and folds it back at the end, so a long column of widths adds up without the drift a plain +=
   accumulates. Not the language's exact-rounding algorithm, which pdf.js does not need -- it is
   fed short arrays of positive metrics, where the compensated sum is correct to well under the
   last bit. */
export function installSumPrecise(target) {
  const g = target || (typeof globalThis !== 'undefined' ? globalThis : self);
  if (typeof g.Math.sumPrecise === 'function') return false;
  g.Math.sumPrecise = function sumPrecise(values) {
    let sum = 0, comp = 0;                       // comp: the rounding error the running sum has shed
    for (const value of values) {
      const n = Number(value);
      const t = sum + n;
      comp += Math.abs(sum) >= Math.abs(n) ? (sum - t) + n : (n - t) + sum;
      sum = t;
    }
    return sum + comp;
  };
  return true;
}

installSumPrecise();
