/* Worker-side diagnostics: the pdf.js worker's own uncaught errors, with their stacks, relayed to
   the page.

   pdf.js forwards a worker error's MESSAGE to the page but never its STACK -- its wrapReason
   rebuilds the exception from {name, message} alone -- so a crash inside the worker reaches the
   screen as one line of minified context ("undefined is not a function (near '...t of e...')")
   and nothing else, and three fixes were shipped against that one line before any of them could
   be checked against where it actually came from (2026-09-09). This listens in the worker realm,
   imported ahead of the library's worker in pdfworker.js -- a listener attached after would miss
   a failure during that load -- and posts what it hears on a BroadcastChannel that api.js, on the
   page, listens to. Same origin, no network, nothing personal: an error's name, message, stack and
   position, and what the engine natively had. Every line is guarded; a diagnostic must never
   itself become a reason the worker fails. */
import { NATIVE, INSTALLED } from './pdfcompat.js';

try {
  if (typeof BroadcastChannel === 'function') {
    const ch = new BroadcastChannel('plate-pdf-worker');
    const post = (m) => { try { ch.postMessage(m); } catch (_) { /* a diagnostic never throws */ } };
    self.addEventListener('error', (e) => post({
      kind: 'error', message: String((e && e.message) || e),
      file: e && e.filename, line: e && e.lineno, col: e && e.colno,
      stack: String((e && e.error && e.error.stack) || '').split('\n').slice(0, 8).join('\n'),
    }));
    self.addEventListener('unhandledrejection', (e) => {
      const r = e && e.reason;
      post({ kind: 'unhandledrejection', message: String((r && r.message) || r),
             stack: String((r && r.stack) || '').split('\n').slice(0, 8).join('\n') });
    });
    post({ kind: 'started', native: NATIVE, installed: INSTALLED });
  }
} catch (_) { /* no BroadcastChannel, or a sandbox that refuses one: the worker runs without it */ }
