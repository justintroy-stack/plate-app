/* Plateside, the client-side app: the whole shell is kept here so the page works with no signal.
   Built by labtrack web build; the version is a hash of every file in the shell, so a new
   build is a new cache and the old one is dropped. Nothing personal is ever cached: the data
   lives in IndexedDB and the /api/ calls never leave the page. */
const VERSION = "bc989b1e6b4c";
const CACHE = 'plate-web-' + VERSION;
const ASSETS = ["index.html", "manifest.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "vendor/pdfjs/pdf.min.mjs", "vendor/pdfjs/pdf.worker.min.mjs", "fonts/plate-sans.woff2", "fonts/plate-mono.woff2", "fonts/plate-italic.woff2", "plate/api.js", "plate/app.js", "plate/backup.js", "plate/body.js", "plate/boot.js", "plate/crmath.js", "plate/csv.js", "plate/defaults.js", "plate/derived.js", "plate/diet.js", "plate/difflib.js", "plate/explain.js", "plate/fs.js", "plate/generic.js", "plate/history.js", "plate/home.js", "plate/ingest.js", "plate/markers.js", "plate/parsers.js", "plate/pdftext.js", "plate/planner.js", "plate/plate.js", "plate/plate_config.js", "plate/policy.js", "plate/py.js", "plate/pydate.js", "plate/pyexpr.js", "plate/pyx.js", "plate/quest.js", "plate/ranges.js", "plate/rotation.js", "plate/seeds.js", "plate/sha256.js", "plate/store.js", "plate/targets.js", "plate/tracker.js", "plate/build.js"];
const here = (p) => new URL(p, self.registration.scope).pathname;
/* Tolerant install: one missing file would otherwise leave the app with no worker at all. */
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
const STATIC = new Set(ASSETS.filter(a => a.startsWith('vendor/') || a.startsWith('fonts/') || a.endsWith('.png')).map(here));
const SHELL = new Set(ASSETS.filter(a => !STATIC.has(here(a))).map(here));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  const isPage = e.request.mode === 'navigate' || u.pathname === here('./') || u.pathname === here('index.html');
  if (isPage || SHELL.has(u.pathname)) {
    /* code: the network wins so a new build lands, the cache answers with no signal */
    const key = isPage ? here('index.html') : u.pathname;
    e.respondWith(fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
      return r;
    }).catch(() => caches.match(key)));
    return;
  }
  if (STATIC.has(u.pathname)) {
    /* the library, the fonts and the icons: the cache wins, refreshed in the background */
    e.respondWith(caches.match(e.request).then(hit => {
      const net = fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
