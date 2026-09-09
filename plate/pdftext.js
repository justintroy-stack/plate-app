/* A lab report's text, read in the page by pdf.js.

   pdf.js hands back positioned runs of text. pdftotext -layout hands back lines on a character
   grid, and the Quest parser was written against that grid: a name, two or more spaces, a value,
   one space, a flag, two or more spaces, the printed range. layoutLines() puts the runs back on
   that grid. It is the function the Phase 0 spike proved on every report in labs/raw (378 of 378
   results identical to the pdftotext run), copied from spike/index.html without a character
   changed, and a test holds it to that copy. Its rules: the same baseline is the same line, x
   maps to a column by the page's typical character width, a gap under a quarter of a character
   is the same word, under a character and a half is a word break, anything wider is a column
   break padded to where the run sits, and a run set smaller than its line (the ® in a panel
   name) joins the line within half the line's size instead of becoming a line of its own.

   readPdf() drives pdf.js with one worker for the life of the page, hands it bytes and never a
   URL (so it fetches nothing), and returns the pages as lines plus the text the parser reads. */

function layoutLines(items) {
  const runs = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;                  // bare spaces and end-of-line markers
    runs.push({ x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || 0,
                s: it.str.replace(/ /g, ' ') });
  }
  const widths = runs.filter(r => r.s.length >= 3 && r.w > 0).map(r => r.w / r.s.length).sort((a, b) => a - b);
  const cell = widths.length ? widths[widths.length >> 1] : 4;
  runs.sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const rows = [];
  for (const r of runs) {
    const row = rows[rows.length - 1];
    // A run set smaller than its line is a superscript or subscript (the ® in a panel name), and
    // sits off the baseline by up to half its line's size; pdftotext keeps it on the line, so this does.
    const smaller = row && Math.min(row.h, r.h) < 0.9 * Math.max(row.h, r.h);
    const tol = smaller ? 0.55 * Math.max(row.h, r.h) : Math.max(1.5, 0.45 * Math.min(row ? (row.h || 8) : 8, r.h || 8));
    if (row && Math.abs(row.y - r.y) <= tol) {
      row.runs.push(r);
      if (r.h > row.h) { row.y = r.y; row.h = r.h; }          // the largest run owns the baseline
    } else rows.push({ y: r.y, h: r.h, runs: [r] });
  }
  const lines = [];
  let prevY = null;
  for (const row of rows) {
    row.runs.sort((a, b) => a.x - b.x);
    if (prevY !== null && (prevY - row.y) > 1.8 * Math.max(row.h, 6)) lines.push('');   // a visible gap is a blank line
    let out = '', right = null;
    for (const r of row.runs) {
      const col = Math.round(r.x / cell);
      if (right === null) out = ' '.repeat(Math.max(0, col)) + r.s;
      else {
        const gap = (r.x - right) / cell;
        if (gap < 0.25) out += r.s;
        else if (gap < 1.5) out += ' ' + r.s;
        else out += ' '.repeat(Math.max(2, col - out.length)) + r.s;
      }
      right = r.x + r.w;
    }
    lines.push(out.replace(/\s+$/, ''));
    prevY = row.y;
  }
  return lines;
}

let PDFJS = null;      // the pdf.js module, once configured
let worker = null;     // one PDFWorker for the life of the page

/* remember the pdf.js module and tell it where its worker script is served from (same origin) */
export function configure(pdfjs, workerSrc) {
  PDFJS = pdfjs;
  if (workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  return pdfjs;
}

/* The worker is created once, on first use, and handed to every getDocument() call. A worker
   that getDocument() creates for itself belongs to the loading task and dies with it, which
   made the spike fetch the 1.2 MB worker script once per report; one the caller owns survives
   task.destroy(). */
function getWorker(pdfjs) {
  if (worker && worker.destroyed) worker = null;
  if (!worker) worker = new pdfjs.PDFWorker();
  return worker;
}

/* A page's text runs, read from pdf.js's own stream with a plain reader.

   pdf.js's getTextContent() is `for await (const t of e)` over that stream -- async iteration of
   a ReadableStream, a Web Streams feature Safari has never shipped -- so on an iPhone it threw
   "undefined is not a function (near '...t of e...')" at exactly that `t of e` (his report,
   2026-09-09, read at its own address by the diagnostic block after three fixes aimed elsewhere).
   getReader()/read() is the Streams API every browser has had since 2017, Safari included. The
   assembly is getTextContent()'s own -- the chunks' items in order -- so the items are the same,
   and the twin suite holds this to pdftotext's output as before. pdfcompat.js also installs the
   async iterator for anything else in the library that wants it; this path no longer needs it. */
async function textItems(page) {
  const reader = page.streamTextContent().getReader();
  const items = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return items;
      if (value && value.items) for (const it of value.items) items.push(it);
    }
  } finally { reader.releaseLock(); }
}

/* bytes → {numPages, pages: string[][] (one array of lines per page), text}. `text` is what
   pdftotext -layout would print: the lines of each page, and a form feed after every page. */
export async function readPdf(bytes, opts = {}) {
  const pdfjs = opts.pdfjs || PDFJS;
  if (!pdfjs) throw new Error('readPdf: call configure(pdfjs, workerSrc) first, or pass {pdfjs}');
  // pdf.js moves the buffer it is given into the worker, which leaves the caller's array empty.
  // The bytes may be the home's own copy of the report, so pdf.js gets a copy of its own.
  const data = new Uint8Array(bytes);
  const task = pdfjs.getDocument({ data, worker: getWorker(pdfjs) });
  try {
    const doc = await task.promise;
    const numPages = doc.numPages;
    const pages = [];
    for (let p = 1; p <= numPages; p++) {
      const page = await doc.getPage(p);
      pages.push(layoutLines(await textItems(page)));
    }
    return { numPages, pages, text: pages.map(ls => ls.join('\n') + '\n\f').join('') };
  } finally {
    // In pdf.js 6 the document has no destroy() of its own; the loading task's frees the
    // document on the worker side and leaves a worker it did not create alone.
    await task.destroy();
  }
}

export { layoutLines };
