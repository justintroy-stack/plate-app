/* The pdf.js worker, with Math.sumPrecise guaranteed first.

   A worker is its own realm: a stand-in installed on the page never reaches it. pdf.js runs its
   parsing -- where Math.sumPrecise is called -- inside this worker, so the stand-in has to be
   installed here too, before the library's own code runs. Static imports evaluate in source
   order, so pdfmath.js (which installs it the moment it is imported) runs to completion before
   pdf.worker.min.mjs begins. api.js points GlobalWorkerOptions.workerSrc at this file instead of
   the library's worker. Where the engine already has Math.sumPrecise this is a plain
   pass-through: pdfmath.js does nothing and the library's worker runs exactly as it always did. */
import './pdfmath.js';
import '../vendor/pdfjs/pdf.worker.min.mjs';
