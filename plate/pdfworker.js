/* The pdf.js worker, with every stand-in in pdfcompat.js guaranteed first, and a listener for
   its own failures ahead of it.

   A worker is its own realm: a stand-in installed on the page never reaches it. pdf.js runs its
   parsing -- where Math.sumPrecise, Uint8Array.prototype.toHex, Promise.withResolvers and
   Promise.try are all called -- inside this worker, so the stand-ins have to be installed here
   too, before the library's own code runs. Static imports evaluate in source order, so
   pdfcompat.js (which installs them the moment it is imported) runs to completion, then
   pdfworkerdiag.js attaches its error listeners, and only then does pdf.worker.min.mjs begin --
   so a failure even during that load is heard. api.js points GlobalWorkerOptions.workerSrc at
   this file instead of the library's worker. Where the engine already has everything, this is a
   plain pass-through: pdfcompat.js does nothing and the library's worker runs as it always did. */
import './pdfcompat.js';
import './pdfworkerdiag.js';
import '../vendor/pdfjs/pdf.worker.min.mjs';
