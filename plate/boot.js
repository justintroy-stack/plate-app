/* Boot: the server, inside the page.

   The page's own script (plate/app.js, lifted out of phone.html untouched) expects three things
   the Python server used to inject ahead of it: window.PLATE_CONFIG, window.storage and
   window.plateEvent. Here they are computed on the device instead. The home folder is read out
   of IndexedDB into memory, the packaged defaults are seeded where a file is missing (never
   overwritten, exactly as ensure_home does on disk), the food config and the rotation plan are
   built by the JavaScript twins of the Python modules, every /api/ call the page makes is
   answered from inside the page, and only then does the page's script run. Nothing about a
   person leaves the device. */
import { loadHome, flush, persist } from './fs.js';
import { DEFAULTS, SHIPPED, PERSONAL } from './defaults.js';
import { BUILD } from './build.js';
import { installApi } from './api.js';
import { payloadBuilt, getState, setState, recordEvents } from './plate.js';

const $ = (id) => document.getElementById(id);

function seedDefaults(home) {
  /* the folder layout and the generic config, seeded once; a personal file is only ever seeded empty */
  let created = 0;
  for (const name of [...SHIPPED, ...PERSONAL]) {
    const path = 'config/' + name + '.csv';
    if (!(name in DEFAULTS) || home.exists(path)) continue;
    home.write(path, DEFAULTS[name]);
    created++;
  }
  return created;
}

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
  const seeded = seedDefaults(home);
  if (seeded) await flush(home);
  persist().catch(() => {});

  const local = { version: BUILD.version, pdfjs: BUILD.pdfjs, files: home.paths().length, firstRun: seeded > 0 && !home.exists('labs/results.csv') };
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
        setState(home, k, stamp(v));
        await flush(home);
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
