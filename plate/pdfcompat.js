/* Stand-ins for modern JS built-ins the vendored pdf.js 6.3.289 calls, for a browser that
   predates one or more of them.

   The first fix here (2026-09-09) covered only Math.sumPrecise and still crashed on the same
   report: sumPrecise is used deep in font-metric parsing, but pdf.js reaches at least three OTHER
   very-recent built-ins first, on every document, before font parsing is ever reached --
   Uint8Array.prototype.toHex() computes the document's "fingerprint" right after the file's
   trailer is read (worker), and Promise.withResolvers()/Promise.try() are pdf.js's own
   deferred-promise and message-dispatch primitives, called constantly on both the page and the
   worker side for essentially any request. A browser missing any ONE of these throws before
   sumPrecise's fix ever gets exercised -- which is exactly why the first fix, correct in
   isolation, did not resolve his crash. Grepped for the whole cluster this time, not just the
   first hit found (tasks/lessons.md has the rule this write-up follows).

   Two more real call sites were found and deliberately left unfixed: Uint8Array.prototype.
   toBase64()/fromBase64(), used only for embedded-font CSS data URLs and PDF signature
   verification -- pdftext.js never calls page.render() or touches signatures, only
   getTextContent(), so those paths are dead code for this app's actual usage; and
   Iterator.prototype.join(), which pdf.js already guards itself ("function"!=typeof
   Iterator.prototype.join && (Iterator.prototype.join = ...)) -- self-healing as long as the
   Iterator global exists at all, which every browser new enough to be missing only the 2025-era
   APIs above already has.

   Each installer here is install-only-if-missing: on a browser (or Node, or Chromium) that
   already has the real thing, every one of these is a no-op and pdf.js runs exactly as it always
   did. `target` is only for testing a realm that is not this one; real use always calls with no
   argument, patching whatever engine is actually running this file. */

const REALM = typeof globalThis !== 'undefined' ? globalThis : self;

/* Math.sumPrecise([...numbers]) -> their sum. Safari shipped it in 18.4 (March 2025). A Neumaier
   compensated sum: it keeps the rounding error a running total drops and folds it back at the
   end, so a long column of widths adds up without the drift a plain += accumulates. Not the
   language's exact-rounding algorithm, which pdf.js does not need here -- it sums short arrays of
   positive glyph metrics, where a compensated sum is correct to well under the last bit (checked
   against native Math.sumPrecise on eight cases including hard cancellation, tests/test_pdfcompat.py). */
export function installSumPrecise(target) {
  const g = target || REALM;
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

/* someBytes.toHex() -> a lowercase hex string, two characters per byte, no separator -- the
   plain, unambiguous encoding the spec defines (e.g. new Uint8Array([0,255]).toHex() === '00ff'). */
export function installToHex(target) {
  const g = target || REALM;
  if (typeof g.Uint8Array.prototype.toHex === 'function') return false;
  Object.defineProperty(g.Uint8Array.prototype, 'toHex', {
    value: function toHex() {
      let s = '';
      for (let i = 0; i < this.length; i++) s += this[i].toString(16).padStart(2, '0');
      return s;
    },
    writable: true, configurable: true, enumerable: false,
  });
  return true;
}

/* Promise.withResolvers() -> {promise, resolve, reject}, the deferred-promise triple every engine
   used to need a hand-rolled helper class for. `new this(...)` rather than `new Promise(...)` so
   it behaves correctly if ever called on a Promise subclass, matching the spec's own definition. */
export function installPromiseWithResolvers(target) {
  const g = target || REALM;
  if (typeof g.Promise.withResolvers === 'function') return false;
  Object.defineProperty(g.Promise, 'withResolvers', {
    value: function withResolvers() {
      let resolve, reject;
      const promise = new this((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    },
    writable: true, configurable: true, enumerable: false,
  });
  return true;
}

/* Promise.try(fn, ...args) -> a promise settled from calling fn(...args), catching a synchronous
   throw as a rejection instead of letting it escape uncaught. Evaluating fn(...args) as resolve's
   own argument means a synchronous throw happens inside the executor, which the Promise
   constructor already turns into a rejection -- so this needs no separate try/catch of its own. */
export function installPromiseTry(target) {
  const g = target || REALM;
  if (typeof g.Promise.try === 'function') return false;
  Object.defineProperty(g.Promise, 'try', {
    value: function _try(fn, ...args) {
      return new this((resolve) => resolve(fn(...args)));
    },
    writable: true, configurable: true, enumerable: false,
  });
  return true;
}

/* Every stand-in above, for one realm. Returns which ones actually had to install, so a test can
   tell "ran on an engine with everything" apart from "ran and patched something". */
export function installAll(target) {
  return {
    sumPrecise: installSumPrecise(target),
    toHex: installToHex(target),
    promiseWithResolvers: installPromiseWithResolvers(target),
    promiseTry: installPromiseTry(target),
  };
}

installAll();
