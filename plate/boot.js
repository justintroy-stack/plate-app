/* Boot: the server, inside the page.

   The page's own script (plate/app.js, lifted out of phone.html untouched) expects three things
   the Python server used to inject ahead of it: window.PLATE_CONFIG, window.storage and
   window.plateEvent. Here they are computed on the device instead. The home folder is read out
   of IndexedDB into memory, the packaged defaults are seeded where a file is missing and a
   seeded file the person never changed catches up with this build (seeds.js), the food config and the rotation plan are
   built by the JavaScript twins of the Python modules, every /api/ call the page makes is
   answered from inside the page, and only then does the page's script run. Nothing about a
   person leaves the device. */
import { loadHome, flush, persist } from './fs.js';
import { DEFAULTS, SHIPPED, PERSONAL, LINEAGE } from './defaults.js';
import { syncCatalog } from './seeds.js';
import { BUILD } from './build.js';
import { installApi, dietOrNullOf } from './api.js';
import { payloadBuilt, getState, storeState, recordEvents } from './plate.js';
import { today } from './pydate.js';

const $ = (id) => document.getElementById(id);

function stamp(v) {
  /* the storage shim stamped every save with updated_at; the wins rule reads it */
  try { const s = JSON.parse(v); s.updated_at = Date.now(); return JSON.stringify(s); } catch (e) { return v; }
}

function showError(title, detail) {
  $('app').innerHTML = '<div class="stack"><section class="card a-hero" data-family="ember"><span class="t-label">Plateside</span>'
    + '<h1 class="t-display" style="margin-top:var(--s3)">' + title + '</h1>'
    + '<p class="t-body" style="margin-top:var(--s3);color:var(--ink-2)"></p></section></div>';
  $('app').querySelector('p').textContent = detail;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not load ' + src));
    document.body.appendChild(s);
  });
}

(async () => {
  let home;
  try {
    home = await loadHome();
  } catch (e) {
    showError('This browser cannot keep your data.', 'Plateside stores everything on the device in IndexedDB, and this browser refused to open it: ' + (e && e.message || e));
    return;
  }
  /* the generic config seeded where a file is missing, a personal file only ever seeded empty,
     and a shipped file this home was born with and never changed caught up with this build;
     anything the person changed is theirs and stays (his phone kept the seed it was born with
     through three builds and a Start over before this) */
  const { seeded, refreshed, added, kept } = syncCatalog(home, DEFAULTS, typeof LINEAGE === 'object' && LINEAGE ? LINEAGE : {}, SHIPPED, PERSONAL, (h) => payloadBuilt(h));
  if (home.dirty.size) await flush(home);
  persist().catch(() => {});
  /* a refresh this build could not make is said once per build, not on every open */
  let keptBefore = false;
  if (kept) {
    const k = 'lt:seeds:held', v = BUILD.version + '|' + kept;
    try { keptBefore = localStorage.getItem(k) === v; localStorage.setItem(k, v); } catch (e) {}
  }

  const local = { version: BUILD.version, pdfjs: BUILD.pdfjs, files: home.paths().length, firstRun: seeded.length > 0 && !home.exists('labs/results.csv'),
                  refreshed, added, kept, keptBefore };
  window.PLATE_LOCAL = local;

  /* the same rule the server enforced: a copy of the state is stored only when it beats the
     one already here; a logged meal is never un-logged by a save, only by a deliberate act */
  window.storage = {
    async get(k) {
      const v = getState(home, k);
      return v == null ? null : { value: v };
    },
    async set(k, v) {
      try {
        /* the rotation the state carries is what the plate is sized against: a save whose order
           moved (a swap landed) sizes it again, and the page says so and loads again once, the
           way the server's storage shim does on the same reply (storeState) */
        const [, , sized] = storeState(home, k, stamp(v), () => dietOrNullOf(home), today(home.now.bind(home)));
        await flush(home);
        if (sized) document.dispatchEvent(new CustomEvent('lt:resized', { detail: sized }));
        return true;
      } catch (e) { console.error(e); return false; }
    },
  };
  /* each logged meal, stamped here at the moment it is logged, lands in labs/meal_log.csv */
  window.plateEvent = function (ev) {
    try {
      recordEvents(home, [Object.assign({ at: new Date().toISOString() }, ev)]);
      flush(home).catch(e => console.error(e));
    } catch (e) { console.error(e); }
  };

  installApi(home, { local });

  let cfg;
  try {
    cfg = payloadBuilt(home);
  } catch (e) {
    showError('The food config did not load.', String(e && e.message || e));
    console.error(e);
    return;
  }
  window.PLATE_CONFIG = cfg;
  try { localStorage.setItem('lt:plate:config', JSON.stringify(cfg)); } catch (e) {}

  try {
    await loadScript('plate/app.js');
  } catch (e) {
    showError('The page did not load.', String(e && e.message || e));
    return;
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
