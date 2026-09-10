
/* Plateside. No food data lives in this file: the server injects window.PLATE_CONFIG
   (config/meals.csv, kits, cold_slots, items, store_items, stores, flavor_pantry) plus the
   rotation plan the food targets ask for. Each item arrives already resolved to the one store
   the profile puts in play for it. State stays on the device; the shim mirrors it to the Mac.

   Time is a cursor that only moves when a meal is logged. No calendar anywhere. */
const store={
  async get(k){if(window.storage){try{const r=await window.storage.get(k);return r&&r.value?r.value:null;}catch(e){return null;}}
    try{return localStorage.getItem(k);}catch(e){return null;}},
  async set(k,v){if(window.storage){try{await window.storage.set(k,v);return true;}catch(e){return false;}}
    try{localStorage.setItem(k,v);return true;}catch(e){return false;}}
};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const RM=window.matchMedia?window.matchMedia('(prefers-reduced-motion: reduce)'):{matches:false};
/* ---- SOUND. A chime owned by the action: a meal logged, a cycle closed, a row catching what
   fell into it, a shop landing in stock. Synthesised from nothing (no file, no third party): a
   short sine with a fast decay, the mallet the odometer would make. Behind Sound under You
   (Appearance), on by default, off with one tap; the choice stays on this device. iOS unlocks
   audio only inside a tap, so the context is made on the first log and resumed there. Sound is
   not motion: Reduce Motion stills the sheet and leaves the chime. */
const SND={ctx:null,K:'lt:sound'};
function soundOn(){try{return localStorage.getItem(SND.K)!=='off';}catch(e){return true;}}
function soundSet(v){try{localStorage.setItem(SND.K,v?'on':'off');}catch(e){}}
function tone(at,hz,dur,gain,type){const c=SND.ctx,o=c.createOscillator(),g=c.createGain();o.type=type||'sine';o.frequency.setValueAtTime(hz,at);
  g.gain.setValueAtTime(0.0001,at);g.gain.exponentialRampToValueAtTime(gain,at+0.012);g.gain.exponentialRampToValueAtTime(0.0001,at+dur);
  o.connect(g);g.connect(c.destination);o.start(at);o.stop(at+dur+0.05);}
function chime(kind){
  if(!soundOn())return;
  try{
    const AC=window.AudioContext||window.webkitAudioContext; if(!AC)return;
    if(!SND.ctx)SND.ctx=new AC();
    if(SND.ctx.state==='suspended')SND.ctx.resume();
    const t=SND.ctx.currentTime+0.02;
    if(kind==='log'){tone(t,659.25,0.34,0.11);tone(t+0.11,783.99,0.42,0.11);}
    else if(kind==='cycle'){[523.25,659.25,783.99,1046.5].forEach((hz,i)=>tone(t+i*0.14,hz,i===3?0.9:0.34,0.11));tone(t+0.42,1318.5,0.9,0.05);}
    else if(kind==='catch'){tone(t,1174.7,0.09,0.035,'triangle');}
    else if(kind==='buy'){tone(t,783.99,0.3,0.09);tone(t+0.12,659.25,0.38,0.09);}
  }catch(e){}
}
/* a log's sound: the chime now, and the cycle's figure with the ring when the sheet shows it,
   or on its own under Reduce Motion, when there is no sheet */
function logSound(closes){chime('log');if(closes&&RM.matches)setTimeout(()=>chime('cycle'),520);}
/* ---- RINGS. One drawing for every ring: the cycle in the masthead, the cover on Kitchen, the
   cycle closing on the sheet. Emitted at `from` and filled to `to` on the next frame, so the
   arc moves only when the value did (fillRings, after each render); with no `from` it sits. */
function ringSVG(id,from,to,size,width,cls){const r=(size-width)/2,c=2*Math.PI*r,f0=from==null?to:from;
  return '<svg class="ring'+(cls?' '+cls:'')+'" id="'+id+'" width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" aria-hidden="true">'+
    '<circle class="ring-t" cx="'+size/2+'" cy="'+size/2+'" r="'+r+'" stroke-width="'+width+'"/>'+
    '<circle class="ring-a" cx="'+size/2+'" cy="'+size/2+'" r="'+r+'" stroke-width="'+width+'" stroke-dasharray="'+c.toFixed(2)+'" stroke-dashoffset="'+(c*(1-Math.max(0,Math.min(1,f0)))).toFixed(2)+'" data-to="'+(c*(1-Math.max(0,Math.min(1,to)))).toFixed(2)+'"/></svg>';}
function fillRings(){const arcs=document.querySelectorAll('.ring-a[data-to]');if(!arcs.length)return;
  requestAnimationFrame(()=>requestAnimationFrame(()=>arcs.forEach(a=>{a.style.strokeDashoffset=a.dataset.to;})));}
let RINGF=null;   /* the masthead ring as last painted, so a log fills it from where it was */
const icon=(n,cls)=>'<svg class="i'+(cls?' '+cls:'')+'" aria-hidden="true"><use href="#i-'+n+'"/></svg>';
/* Two hosts serve this page: the Mac's server injects the config, and the client-side build
   computes it on the device (plate/boot.js). The engine is the same; only where the files live
   changes, and the few sentences that say so. */
const LOCAL=!!window.PLATE_LOCAL, WHERE=LOCAL?'on this device':'on the Mac';

/* Everything the app says goes to one docked line, and to a live region so it is announced.
   It used to be a floating box with display:none and no announcement at all. */
/* The docked line is one short line; the full sentence goes to the live region, where length
   costs nothing and a screen reader wants all of it. */
/* say it now, and again once the page has been fetched again: every save that changes the day
   reloads 350 ms after its sentence, which no one can read in that time (his report,
   2026-09-08: "the Save message is extremely quick so I don't know what it actually said") */
function flash(m){say(m);try{sessionStorage.setItem('lt:flash',m);}catch(e){}}
function say(m,full){
  const el=document.getElementById('statusline');
  el.textContent=m;el.classList.add('on');
  /* up for as long as it takes to read: a short line 4.2 s, a long one up to 10 s */
  clearTimeout(window._tt);window._tt=setTimeout(()=>el.classList.remove('on'),Math.min(10000,4200+Math.max(0,m.length-60)*45));
  /* A swap that landed during this render is the more important sentence, so it rides along
     rather than being overwritten by the routine one. */
  const spoken=(full||m)+(FLIPSAY?' '+FLIPSAY:'');
  document.getElementById('say').textContent=spoken;
  FLIPSAY='';
}
const toast=say;

let CFG=window.PLATE_CONFIG||null;
try{if(CFG)localStorage.setItem('lt:plate:config',JSON.stringify(CFG));else CFG=JSON.parse(localStorage.getItem('lt:plate:config')||'null');}catch(e){}
if(!CFG){
  document.getElementById('app').innerHTML='<div class="stack"><section class="card a-hero" data-family="sprout"><span class="t-label">Plateside</span>'+
    '<h1 class="t-display" style="margin-top:var(--s3)">Open this once on the Mac.</h1>'+
    '<p class="t-body" style="margin-top:var(--s3);color:var(--ink-2)">The meals, the stock and the shopping come from Plateside on the Mac. '+
    'After one visit while it is reachable, this page keeps working on its own.</p></section></div>';
  throw new Error('no config');
}

/* ENGINE-CORE-START — everything from here to ENGINE-CORE-END is pure: no document, no
   storage, no window. tests/engine.py lifts this slice between the markers and runs it in node
   against a supplied CFG and S, so the cursor, the occasions, the draw and the forecast are
   proved by running rather than by grepping the served page. Markers, never line numbers. */
const N=CFG.baseline.length, H=120;
const MEALS={};CFG.meals.forEach(m=>MEALS[m.id]=m);
const BASE=CFG.baseline, PLANB=CFG.plan_b?MEALS[CFG.plan_b]:null;
const KITS=CFG.kits, SLOTS=CFG.cold, I=CFG.items, IORDER=CFG.item_order, STORES=CFG.stores, SORDER=CFG.store_order, ZONES=CFG.zones, FLAV=CFG.flavor;
const SCAT=CFG.store_catalog||SORDER, UNSUP=CFG.unsupplied||[];   /* every store, and what no store in play carries */
const EQUIP=CFG.equipment||{}, BUDGET=CFG.hands_on_minutes, NOCOOK=CFG.uncookable||[];   /* the kitchen: its appliances, the hands-on budget, what it cannot cook */
const REG=CFG.regimen||null, REGS=CFG.regimens||[], NOREG=CFG.excluded||[], NOCOLD=CFG.cold_excluded||[];   /* how you eat: the plan in play, every plan on file, what it leaves out */
const AVOID=CFG.avoid||[];              /* what the person will not eat, on top of the plan: food-group tags, and what the health history leaves out */
const CONDS=CFG.conditions||[], CAVOID=CFG.condition_avoid||[];   /* the conditions on the health history that fired, and the tags they leave out (Phase 13) */
const AVOID_OWN=AVOID.filter(t=>!CAVOID.includes(t));               /* the person's own chips, without what a condition added */
/* what a fact on the history can be marked as, in the words the screens use (diet.py's CONDITION_WORDS, pinned by test), and the lever each pulls */
const HCOND=[['celiac','celiac disease'],['gout','gout'],['hypertension','high blood pressure'],['diabetes','diabetes or prediabetes'],['kidney','a kidney condition']];
const HLEVER={celiac:'gluten out',gout:'purine-rich food out, red meat nights capped at 2',hypertension:'the fat cap and the fibre floor',diabetes:'the sugar cap and the fibre floor',kidney:'nothing moves here; protein is your kidney doctor\'s number'};
const condWord=id=>{const c=HCOND.find(x=>x[0]===id);return c?c[1]:id;};
/* what a fact's save did, in the lever's own words, for the sentence after Add or Save (his
   report, 2026-09-08: "Saved. Rebuilding the lists." for a kidney number) */
const condSaid=(id,limit)=>{if(!id)return '';const w=condWord(id).replace(/^\w/,c=>c.toUpperCase());
  return ' '+w+': '+(id==='kidney'&&limit?'your limit of '+fmt(Number(limit))+' g is on file beside your protein.':(HLEVER[id]||'')+'.');};
/* When you eat: the occasions, and the one that carries the recipe. One cursor tick is one
   eating cycle, every occasion once, so the rotation still advances by one meal per log. */
const OCC=CFG.occasions||[{id:'dinner',name:'Dinner',rotation:true}], ROT=(OCC.find(o=>o.rotation)||OCC[0]).id;
const occName=id=>{const o=OCC.find(x=>x.id===id);return o?o.name:id;};
const occPortions=id=>{const o=OCC.find(x=>x.id===id);return o&&o.portions?o.portions:PORTIONS;};
const planName=()=>REG?REG.name.toLowerCase():'chosen';
/* What a report can do on this plan, said the same way everywhere a report is invited. On a plan
   unmoved by the lipid markers (regimens.csv unmoved_by) a report is charted and dinner stays; the
   promise "add it and dinner adjusts" was printed on six surfaces and was false there. */
const planStays=()=>!!(REG&&(REG.unmoved_by||[]).length);
const Plan=()=>REG?REG.name:'your plan';
function reportLine(kind){
  const stays=planStays();
  return {head:stays?'Have a lab report? Add it and the numbers are charted.':'Have a lab report? Add it and dinner adjusts.',
    head2:stays?'Add a lab report and the numbers are charted.':'Add a lab report and dinner adjusts.',
    note:stays?'One report from the last year is enough. On '+Plan()+' a report is charted and dinner stays, as the plan asks.':'One report from the last year is enough to move a night or two of the rotation.',
    note2:stays?'One report from the last year is enough. On '+Plan()+' a report is charted and dinner stays, as the plan asks. ':'One report from the last year is enough: several of the food rules fire on a single draw and move a night or two of the rotation. ',
    now:stays?'One from the last year is enough. On '+Plan()+' the numbers are charted and dinner stays.':'One from the last year is enough to move a night or two of dinner.',
    did:stays?'and what dinner did about it, which on '+Plan()+' is nothing, as the plan asks':'and what dinner did about it',
    story:stays?['Add a lab report, and the numbers are charted','Any lab\'s PDF, or the numbers typed from paper. On '+Plan()+' a report is charted and dinner stays, as the plan asks; the added-sugar cap is the one number it can still tighten.']
               :['Add a lab report, and dinner adjusts','Any lab\'s PDF, or the numbers typed from paper. The markers set a few nights of the rotation, one swap at a time, only once the food you already bought is eaten.'],
    lens:stays?', except on '+Plan()+', where a report is charted and dinner stays':''}[kind];
}
/* a plan in one line for the interview: its own note (which says what it is unmoved by) and
   what it cannot fill from the catalog, said before it is chosen (plate_config's plan_gaps) */
const asksLine=r=>{if(!r)return '';const ks=COUNT_KEYS.filter(([k])=>r[k]!=null&&r[k]>0);if(!ks.length)return '';
  const one=ks.length===1&&r[ks[0][0]]===1;return ' Asks for '+list(ks.map(([k,w])=>fmt(r[k])+' '+w))+' night'+(one?'':'s')+' per cycle.';};
function planLine(r,avoid){
  let s=(!r?'Any meal in the catalog.':(r.note||''))+asksLine(r)+(r&&(r.gaps||[]).length?' Not a whole day yet: '+r.gaps.join('; ')+'.':'');
  const av=(avoid||[]).filter(t=>chipsFor(r).includes(t));if(!av.length)return s;
  const fit=planFit(r,av).length, g=planGaps(r,av);
  return s+' With '+tagWords(av)+' left out: '+(fit?fit+' dinner'+(fit===1?'':'s')+(g.length?'; '+g.join('; '):''):'nothing in the catalog fits, so leave something in or pick another plan')+'.';
}
/* how many more times a meal or an option the plan leaves out comes round before the stock
   behind it is gone: the smallest whole count over what it uses, the protein the labs gate a
   meal on, the items the plan leaves out for a cold option; null when there is nothing to count */
function staysFor(x){const keys=(x.excluded_items&&x.excluded_items.length)?x.excluded_items:x.protein_item?[x.protein_item]:Object.keys(x.uses||{});let n=null;
  keys.forEach(k=>{const u=(x.uses||{})[k];if(!u)return;const t=Math.floor((S.inv[k]||0)/u);if(n==null||t<n)n=t;});return n;}
const staysLine=x=>{const n=staysFor(x);return n===0?'The stock it was eating is gone, so it leaves at the next log.':
  'It stays until the stock it was eating is gone'+(n==null?'':', about '+n+' more time'+(n===1?'':'s'))+'.';};
/* What to say when a save resized the plate (plate.resize, server.py's /api/diet and
   /api/history): the same words targetLine already uses for the same fact, so the two never
   disagree. p is a save reply's own plate field: null when nothing needed to move. */
function plateResizeNote(p){
  if(!p)return '';
  const pct=Math.round(Math.abs(1-p.plate)*100);
  return ' Plates are '+(p.plate===1?'as written':'about '+pct+' percent '+(p.plate<1?'smaller':'larger')+' than written')+' now, from the next cook.';
}
/* How many people a thing is cooked for, said only when it is more than one: a screen that
   announces "1 person" to somebody eating alone is noise. `cookingFor()` is the mid-sentence
   phrase ("cooking for 3"), `peopleWord()` the noun phrase ("3 people") for a standalone
   sentence, and `qty()` below is what to take out, already multiplied by the portions the
   config was loaded for. PORTIONS is the household count diet.csv names: what Who eats shows
   and writes back, and what the Kitchen is stocked for. The plate on Tonight is cooked for the
   rotation occasion's own count, occPortions(ROT), which follows the household unless that
   occasion has a number of its own. Who eats is changed under Profile, never typed here. */
const PORTIONS=CFG.portions||1;
/* The plate: one factor per household, sized from the day's target and stepped by the
   weigh-ins, already multiplied into every `uses` quantity and every calorie the config
   carries. Said in food words, only when it is not the recipes as written. */
const PLATE=CFG.plate||1;
const plateWord=()=>PLATE===1?'':'plates about '+Math.round(Math.abs(1-PLATE)*100)+' percent '+(PLATE<1?'smaller':'larger')+' than written';
const cookingFor=n=>(n||1)>1?'cooking for '+fmt(n):'';
/* a cooking time as the readout prints it: minutes, or hours once it is a slow cooker's afternoon */
const timeParts=n=>n>=120?[String(Math.round(n/30)/2),'h']:[String(n),'min'];
const peopleWord=n=>fmt(n)+' '+(n===1?'person':'people');
const fmt=n=>Number.isInteger(n)?String(n):String(Math.round(n*100)/100);
/* "each" is a unit in the catalog and not a word anybody says out loud, so a countable item
   reads "3 russet potatoes" rather than "3 each russet potatoes", and one of a plural unit
   reads "1 cup" rather than "1 cups". */
const unitOf=(k,v)=>{const u=I[k].unit;if(!u||u==='each')return '';
  return (v===1&&u.length>1&&u.slice(-1)==='s'?u.slice(0,-1):u)+' ';};
/* A cook's figure (labtrack.plate_config.practical_qty is the twin): ounces under a pound,
   quarters for spoons and cups, halves for ounces and counts. What a person reads; the log
   still deducts the exact amount. 0.9375 lb is "15 oz", 1.7 tbsp is "1¾ tbsp". */
const FRACW={0.25:'¼',0.5:'½',0.75:'¾'};
const fracword=q=>{const w=Math.floor(q),r=Math.round((q-w)*100)/100;return r===0?String(w):(w?String(w):'')+(FRACW[r]||String(r));};
const pqty=(k,v)=>{const u=I[k]?(I[k].unit||''):'';v=Number(v);
  if(u==='lb')return v<1?Math.max(1,Math.round(v*16))+' oz':fracword(Math.round(v*4)/4)+' lb';
  if(u==='tbsp'||u==='tsp'||u==='cups'||u==='cup'){const q=Math.max(0.25,Math.round(v*4)/4);return fracword(q)+' '+(u==='cups'&&q<=1?'cup':u);}
  if(u==='oz')return fracword(Math.max(0.5,Math.round(v*2)/2))+' oz';
  return fracword(Math.max(0.5,Math.round(v*2)/2));};
/* the figure with the item's own words: "2 tbsp olive oil", "3 eggs", "1 russet potato", "3 cans tuna" */
const plabel=(k,v)=>{const it=I[k];if(!it)return String(v)+' '+k;const u=it.unit||'',name=it.name.toLowerCase(),q=pqty(k,v);
  if(u==='lb'||u==='oz'||u==='tbsp'||u==='tsp'||u==='cups'||u==='cup')return q+' '+name;
  const one=q==='1';
  if(u==='eggs')return q+' '+(one?'egg':'eggs');
  if(!u||u==='each'||name.endsWith(' '+u))return q+' '+(one?singular(name):name);
  if(u==='cans'&&name.startsWith('canned '))return q+' '+(one?'can':'cans')+' '+name.slice(7);
  return q+' '+(one&&u.endsWith('s')?u.slice(0,-1):u)+' '+name;};
const qty=u=>Object.entries(u||{}).filter(([k,v])=>v!=null&&I[k]).map(([k,v])=>plabel(k,v)).join(', ');
/* A step carries no number the card owns. Its tokens are resolved here for this kitchen and
   this plate (labtrack.plate_config.resolve_steps is the twin): {cook} the readout in words,
   {temp} the temperature alone or the appliance's own words, {rest:N} the card's minutes less
   an N-minute head start, {item} the plate's own amount of an ingredient. An oven home reads
   "32 min" on the card and in the step; a plate at 0.85 reads "1¾ tbsp" in both places. */
const TEMPLESS={Pan:'in the pan',Simmer:'at a simmer',Low:'on low',High:'on high',Micro:'in the microwave'};
const cookWords=m=>{if(!m.equipment)return 'cook as the card says';const n=m.minutes||0;
  return (m.temp_f!=null?m.temp_f+'°F '+(m.mode||''):(TEMPLESS[m.mode]||m.mode||''))+', '+(n>=120?fracword(Math.round(n/30)/2)+' h':n+' min');};
const stepText=(m,s)=>{const t=String(s).replace(/\{([a-z_]+)(?::(\d+))?\}/g,(all,k,n)=>{
  if(k==='cook')return cookWords(m);
  if(k==='temp')return m.temp_f!=null?m.temp_f+'°F':m.equipment?(TEMPLESS[m.mode]||m.mode||''):'as the card says';
  if(k==='rest')return String(Math.max(1,(m.minutes||0)-(+n||0)));
  if(I[k]&&m.uses&&m.uses[k]!=null)return plabel(k,usedAmt(m,k));
  return all;});
  return /^[a-z]/.test(t)?t[0].toUpperCase()+t.slice(1):t;};
const notOn=x=>{const cv=(x.excluded||[]).filter(t=>CAVOID.includes(t));
  if(cv.length){const c=CONDS.find(c=>(c.tags||[]).some(t=>cv.includes(t)));return 'Has '+tagWords(cv)+', which '+(c?c.word:'your history')+' on your history leaves out.';}
  const av=(x.excluded||[]).filter(t=>AVOID_OWN.includes(t));return av.length?'Has '+tagWords(av)+', which you leave out.':'Not on the '+planName()+' plan: has '+tagWords(x.excluded||[])+'.';};
const PLAN=CFG.plan||null, SWAPS=PLAN?PLAN.swaps:[], SWAP={};SWAPS.forEach(s=>SWAP[s.key]=s);
const FULL={},EMPTY={};IORDER.forEach(k=>{FULL[k]=I[k].pack;EMPTY[k]=0;});

let S={inv:{...FULL},cursor:0,checked:[],order:[...BASE],off:{},flav:[],init:false,pending:{},applied:[],gate0:{},seen:[],setup:false,tally:{},extras:[]},
    tab='tonight',partial=false,pOven=false,planB=false;
/* A landed swap is the loudest thing this app has to say and it happens perhaps twice a year,
   so applyDue() no longer announces it inline: it queues, and the next render decides how to
   show it. Otherwise the message it wrote was overwritten by 'Logged' on the very same line,
   and the moment the whole gate exists for was shown for zero milliseconds. */
let FLIPS=[],FLIPSRC='load';
/* The reward is owned by the action, never by arriving somewhere: ENTER is set only by a log,
   PAINTED is what the last render drew, and the difference between them is what moves. */
let ENTER=null,JUST=null,NOTE=null,NOTEARG='',PAINTED=null,SWEEP=null,PRESSED=null,FLIPSAY='';

function normOrder(o){
  if(!Array.isArray(o)||o.length!==N)return [...BASE];
  return o.map((v,pos)=>{
    if(typeof v==='number'&&BASE[v])return BASE[v];
    if(typeof v==='string'&&/^\d+$/.test(v)&&BASE[+v])return BASE[+v];
    return MEALS[v]?v:BASE[pos];});
}
function persist(){store.set('plate:v8',JSON.stringify(S)).then(ok=>{if(!ok)say("Live, but won't persist here");});}

/* ---- rotation lookups */
const posAt=d=>(S.cursor+d)%N;
const mealAt=d=>MEALS[S.order[posAt(d)]]||MEALS[BASE[posAt(d)]];
/* the kit tonight: the meal's kits, less any the plan or the chips leave out (a kit is made of
   something too: butter, a sauce, a spice), rotating one step per cycle over what stays */
function kitsOf(r){return(r&&r.kits?r.kits:[]).filter(k=>KITS[k]&&!(KITS[k].excluded&&KITS[k].excluded.length));}
function kitFor(r,d){const ks=kitsOf(r);if(!ks.length)return null;return KITS[ks[Math.floor((S.cursor+d)/N)%ks.length]]||null;}
const kitAt=d=>kitFor(mealAt(d),d);
/* A cold option the plan leaves out stays in rotation only while the stock behind it lasts:
   the depletion rule, kept whole, so a switch never strands a tub of yogurt. A slot with no
   option left drops out of the block. */
/* the cold slot's options actually in rotation: an option the plan, a chip or a condition
   leaves out drops now, the same "won't eat" rule a dinner swap follows (rotation.build_plan) --
   not held back by whatever is still on the shelf, which Kitchen names as stranded instead. */
function liveOpts(sl){const o=sl.opts.filter(x=>!(x.excluded&&x.excluded.length));return o.length?o:null;}
/* One slot's option on day d, and the cold block of an occasion for that day. A pool never
   repeats an item another pool of the same occasion already picked that day (his report,
   2026-09-08: breakfast's main and its side both banana and peanut butter): each slot skips, in
   its own turn order, any option sharing an item with what was picked before it, and keeps its
   natural pick only when every option collides. With nothing in common the pick is the one it
   always was, and the cycle button still turns it. `taken` is the set of item keys the earlier
   slots of the occasion hold; the engine's own tests call slotAt without one. */
function slotAt(sl,d,taken){const opts=liveOpts(sl);if(!opts)return null;const n=opts.length,start=(((S.cursor+d)%n)+n)%n;
  const ring=[];for(let i=0;i<n;i++)ring.push(opts[(start+i)%n]);
  const kept=taken&&taken.size?ring.filter(o=>!Object.keys(o.uses||{}).some(k=>taken.has(k))):ring;
  const pool=kept.length?kept:ring;return pool[(S.off[sl.id]||0)%pool.length];}
function coldAt(d,occ){const out=[],taken={};SLOTS.forEach(sl=>{const so=sl.occasion||ROT;if(occ&&so!==occ)return;
  const t=taken[so]||(taken[so]=new Set());const o=slotAt(sl,d,t);if(!o)return;
  Object.keys(o.uses||{}).forEach(k=>t.add(k));out.push({id:sl.id,name:sl.name,occ:so,...o});});return out;}
const activeMeal=()=>planB&&PLANB?PLANB:mealAt(0);
function coldTot(d,occ){const c=coldAt(d,occ);return{c:c.reduce((a,x)=>a+x.kcal,0),p:c.reduce((a,x)=>a+x.protein_g,0)};}

/* What the log about to be tapped will actually take out of stock. Both log paths use it,
   so what the press previews and what the log does cannot drift apart. */
/* What tonight's plate actually takes out, item by item: the recipe at the plate, or the amount
   the person set on Tonight (a 1.25 plate says 1.25 lb; the pack was 1 lb; the log should take
   1 lb). Keyed to the cursor and the meal, so a trade or a log makes it inert on its own. */
let USED={cursor:-1,meal:'',amt:{}};
const usedAmt=(m,k)=>(USED.cursor===S.cursor&&USED.meal===m.id&&USED.amt[k]!=null)?USED.amt[k]:m.uses[k];
function plateDraw(m){const d={};for(const k in m.uses){const v=usedAmt(m,k);if(v!=null)d[k]=v;}return d;}
function previewDraw(){
  const draw={};
  const hot=partial?pOven:true;
  if(hot){const m=activeMeal(),pd=plateDraw(m);for(const k in pd)draw[k]=(draw[k]||0)+pd[k];}
  coldAt(0).forEach(c=>{if(!partial||S.checked.includes(c.id))for(const k in c.uses)draw[k]=(draw[k]||0)+c.uses[k];});
  return draw;
}

/* ---- the gate: a planned swap waits until the stock the old meal was eating is used up.
   Remaining quantity is recorded when the plan is first seen and only ever goes down, so a
   restock in between never resets it. */
function adoptPlan(){
  const planned=new Set(SWAPS.map(s=>s.key));
  for(const k in S.pending)if(!planned.has(k))delete S.pending[k];
  for(const k in S.gate0)if(!planned.has(k)||!(k in S.pending))delete S.gate0[k];
  SWAPS.forEach(sw=>{
    if(S.applied.includes(sw.key))return;
    if(!S.order.includes(sw.from))return;                     // the plan was made against another order; wait for a fresh one
    if(!(sw.key in S.pending))S.pending[sw.key]=sw.gate_item?(S.inv[sw.gate_item]||0):0;
    /* what the gate started at, so the rail has a scale. pending only ever holds the
       remainder; a state from before this existed starts its frame at what is left now. */
    if(!(sw.key in S.gate0))S.gate0[sw.key]=S.pending[sw.key];
  });
  applyDue();
}
function noteDepletion(before){
  for(const k in S.pending){const sw=SWAP[k];if(!sw||!sw.gate_item)continue;
    const used=Math.max(0,(before[sw.gate_item]||0)-(S.inv[sw.gate_item]||0));
    S.pending[k]=Math.max(0,Math.round((S.pending[k]-used)*100)/100);}
  /* an item the rotation has stopped asking for, eaten down to nothing rather than binned */
  for(const k in before){
    if(before[k]>0&&(S.inv[k]||0)===0&&!consumedSet(targetOrder()).has(k))note('zero_'+k,I[k]?I[k].name:k);
  }
  applyDue();
}
function applyDue(){
  for(const k in S.pending){const sw=SWAP[k];if(!sw)continue;
    if(S.pending[k]>0)continue;
    const p=S.order.indexOf(sw.from);
    if(p<0){delete S.pending[k];delete S.gate0[k];continue;}
    S.order[p]=sw.to;S.applied.push(k);delete S.pending[k];delete S.gate0[k];
    FLIPS.push(sw);}
}
function setInv(k,v){const before={...S.inv};S.inv[k]=Math.max(0,Math.round(v*100)/100);noteDepletion(before);}
function deduct(draw){const before={...S.inv};for(const k in draw)S.inv[k]=Math.max(0,Math.round(((S.inv[k]||0)-draw[k])*100)/100);noteDepletion(before);}
/* the stock an Also-had entry actually took, put back (Phase 18): on the shelf, and on every
   gate it ate down by the same amount, the rail's own scale never left below what is pending;
   `bag` is shaped like S -- the state itself, or the undo snapshot, which is stale by the same
   amounts once an older entry is removed */
function giveBack(bag,took){
  for(const k in took){bag.inv[k]=Math.round(((bag.inv[k]||0)+took[k])*100)/100;
    for(const key in (bag.pending||{})){const sw=SWAP[key];if(!sw||sw.gate_item!==k)continue;
      bag.pending[key]=Math.round((bag.pending[key]+took[k])*100)/100;
      if(bag.gate0&&bag.gate0[key]!=null&&bag.gate0[key]<bag.pending[key])bag.gate0[key]=bag.pending[key];}}
}

/* ---- forecast: a forward simulation over the next 120 meals, with pending swaps
   flipping where their stock runs out. Nothing here is stored. */
function forecast(){
  const out={},sim={...S.inv},rem={...S.pending},order=[...S.order],flips={},seq=[],days=[];
  IORDER.forEach(k=>out[k]=H);
  for(let d=0;d<H;d++){
    for(const key in rem){const sw=SWAP[key];if(!sw){delete rem[key];continue;}
      if(rem[key]<=0){const p=order.indexOf(sw.from);if(p>=0){order[p]=sw.to;flips[key]=d;}delete rem[key];}}
    const m=MEALS[order[posAt(d)]]||MEALS[BASE[posAt(d)]];seq.push(m.id);
    const draw={...m.uses};
    coldAt(d).forEach(c=>{for(const k in c.uses)draw[k]=(draw[k]||0)+c.uses[k];});
    days.push(draw);
    for(const k in draw){sim[k]=(sim[k]||0)-draw[k];if(sim[k]<0&&out[k]===H)out[k]=d;
      for(const key in rem)if(SWAP[key].gate_item===k)rem[key]-=draw[k];}
  }
  return{L:out,flips,seq,order,days};
}
function targetOrder(){const t=PLAN&&PLAN.order_target;return(Array.isArray(t)&&t.length===N&&t.every(id=>MEALS[id]))?t:S.order;}
function consumedSet(order){const s=new Set();order.forEach(id=>{const m=MEALS[id];if(m)for(const k in m.uses)s.add(k);});
  SLOTS.forEach(sl=>(liveOpts(sl)||[]).forEach(o=>{for(const k in o.uses)s.add(k);}));if(PLANB)for(const k in PLANB.uses)s.add(k);return s;}
/* "My kitchen is stocked": a pack of everything the rotation you are heading to uses and none
   of what your plan leaves out, so a plan chosen before the first run is not gated on twelve
   pounds of beef the kitchen never held. With nothing left out, this is a pack of everything. */
function stockedFor(){const used=consumedSet(targetOrder()),inv={};IORDER.forEach(k=>inv[k]=used.has(k)?FULL[k]:0);return inv;}
/* The items a screen lists: what the rotation you are heading to uses, plus anything still in
   stock. A catalog written for many ways of eating carries items this kitchen never buys, and
   a Kitchen full of zero-stock rows for them would bury the ten things that matter. */
function liveItems(){const used=consumedSet(targetOrder());return IORDER.filter(k=>used.has(k)||(S.inv[k]||0)>0);}
function perCycle(order,k){let n=0;order.forEach(id=>{const m=MEALS[id];if(m&&m.uses[k])n+=m.uses[k];});
  SLOTS.forEach(sl=>{const opts=liveOpts(sl)||[];let a=0;opts.forEach(o=>{a+=(o.uses[k]||0);});if(opts.length)n+=a/opts.length*N;});return Math.round(n*10)/10;}
const storeOf=k=>STORES[I[k].store]||null;
/* the kind of store, as a small mark with a word: which kind carries an item, without printing
   the store's name on every row. The name stays on the list card and the tiles. */
const KINDWORD={warehouse:'Club',grocery:'Grocery',market:'Market'};
const storeMark=st=>st?'<span class="kmark" data-kind="'+esc(st.kind||'grocery')+'">'+icon(st.kind==='warehouse'?'club':'cart')+esc(KINDWORD[st.kind]||'Market')+'</span>':'';      /* null: no store in play carries it */
function runIn(F){const used=consumedSet(targetOrder());let m=H,w=null;
  /* the store the countdown follows: any store flagged for it, else the first one in play, the
     fallback countdownStore() already makes, so a home with no warehouse club counts down too */
  const anyCd=SORDER.some(k=>STORES[k]&&STORES[k].countdown), follows=st=>anyCd?!!st.countdown:st.key===SORDER[0];
  IORDER.forEach(k=>{const st=storeOf(k);if(!st||!follows(st)||!I[k].countdown||!used.has(k))return;if(F.L[k]<m){m=F.L[k];w=k;}});return{d:m,k:w};}
function need(F,st){const used=consumedSet(targetOrder());
  return IORDER.filter(k=>I[k].store===st.key&&used.has(k)&&F.L[k]<=st.threshold).sort((a,b)=>F.L[a]-F.L[b]);}
/* ---- a trip you call yourself: cover the next n meals from tonight. The one forecast read to
   a horizon: what those meals draw of each item the store carries, less what is on hand,
   rounded up to the pack. The app counts meals, so the horizon is meals; for a one-dinner
   home a meal is a day, and nothing here is a date. */
const tripQty=v=>String(Math.round(v*100)/100);
function drawOver(n,F){F=F||forecast();const tot={};F.days.slice(0,Math.max(0,Math.min(n,H))).forEach(draw=>{for(const k in draw)tot[k]=Math.round(((tot[k]||0)+draw[k])*100)/100;});return tot;}
/* one arithmetic for both lists: what n meals draw of k, less what is on hand, in packs */
function buyRow(k,n,tot){const have=Math.round((S.inv[k]||0)*100)/100, need=Math.round((tot[k]||0)*100)/100, short=Math.max(0,Math.round((need-have)*100)/100), pack=I[k].pack||0;
  const packs=short>0&&pack>0?Math.ceil(short/pack-1e-9):0;return {k,need,have,short,packs,units:pack>0?Math.round(packs*pack*100)/100:short};}
function tripNeed(sk,n,F){const used=consumedSet(targetOrder()), tot=drawOver(n,F);
  return IORDER.filter(k=>I[k].store===sk&&used.has(k)&&(tot[k]||0)>0).map(k=>buyRow(k,n,tot)).filter(r=>r.short>0);}
/* the store's own list with its quantities: it holds what runs out on or before the threshold
   meal, so its horizon is one meal past the threshold and every row on it is short */
function listRows(sk,F){F=F||forecast();const st=STORES[sk], ks=need(F,st), first=ks.length>0&&ks.every(k=>(S.inv[k]||0)===0),
  n=(first?Math.max(st.threshold||0,FIRST_RUN):(st.threshold||0))+1, tot=drawOver(n,F);return ks.map(k=>buyRow(k,n,tot));}
/* a first run, every item at zero, covers three weeks of meals whatever the store's own line, so
   a weekly store's list does not reopen after one meal */
const FIRST_RUN=21;
const countdownStore=()=>SORDER.map(k=>STORES[k]).find(s=>s.countdown)||STORES[SORDER[0]];

/* what the log is about to change, kept so it can be put back */
function snapshot(kind){const m=activeMeal();
  S.last={inv:Object.assign({},S.inv),cursor:S.cursor,checked:S.checked.slice(),order:S.order.slice(),
    pending:Object.assign({},S.pending),gate0:Object.assign({},S.gate0),applied:S.applied.slice(),
    meal:m.name,meal_id:m.id,kind:kind};}
/* ---- each logged meal is reported with what was actually eaten (kcal and protein as eaten) */
function report(kind,hot,coldIds){
  const slot=mealAt(0),m=activeMeal();let kcal=0,pro=0;
  /* the passport: a plate that was cooked is stamped, once per night it was, whatever kind of
     night (a partial with the hot meal eaten counts; a Plan B stamps the Plan B plate) */
  if(hot){S.tally=S.tally||{};S.tally[m.id]=(S.tally[m.id]||0)+1;if(S.last)S.last.cooked=true;}
  if(hot){kcal+=m.kcal;pro+=m.protein_g;}
  coldAt(0).forEach(c=>{if(coldIds.includes(c.id)){kcal+=c.kcal;pro+=c.protein_g;}});
  let note=kind==='full'?'ate it all':kind==='plan_b'?'Plan B instead of '+slot.name:(hot?'hot meal eaten':'hot meal not eaten')+'; cold: '+(coldIds.join(', ')||'none');
  if(window.plateEvent)window.plateEvent({cursor:S.cursor,meal_id:hot?m.id:slot.id,meal:hot?m.name:slot.name,kcal,protein_g:pro,kind,note});
}

/* A one-time note explains a mechanism at the one moment it is legible. Each fires once,
   ever, and rides the same save as the log that caused it. */
function note(k,arg){if(NOTE!==null||S.seen.includes(k))return;S.seen.push(k);NOTE=k;NOTEARG=arg||'';}

/* ---- "Also had": something from stock eaten outside the plan. Only what the plan holds can be
   had, because only that has units, calories and protein: the live options of every slot in
   play and a second helping of tonight's plate. Stock leaves exactly, the day counts it, and
   the cursor never moves. A thing the plan never held has no stock here and stays out. */
/* one preset, not a list: another helping of tonight's whole plate is a single tap that the
   by-amount rows below cannot reproduce in one step (his call, Phase 14 -- every canned combo
   this used to also offer is 1-3 items with a known amount, already reachable there, so keeping
   both was the still-canned feeling he flagged) */
/* prevDay: opened for the day already logged (from the Last-logged card, Phase 14), so
   "another helping" means the plate that day actually ate, not tonight's, which by then is a
   different meal already cooking. A parameter, not a read of the page's own EXTRAAT, so this
   stays a pure engine-core function the same as every other one here. The snapshot's own
   meal_id, looked up in the full catalog rather than read off S.order, so a marker's swap
   landing on that slot in the meantime cannot rename what was actually eaten; mealAt(-1) is
   only the fallback the Last-logged card itself falls back to, with no snapshot to read. */
function extraOptions(prevDay){
  const L=(prevDay&&S.last&&S.last.cursor===S.cursor-1&&S.last.kind!=='extra')?S.last:null;
  const m=L?(MEALS[L.meal_id]||mealAt(-1)):(prevDay?mealAt(-1):activeMeal());
  return [{key:'meal',label:'Another helping of '+m.name,kcal:m.kcal,protein_g:m.protein_g,uses:m.uses,slot:''}];
}
/* the running total of what was also had, for one cursor: kcal and protein for the items that
   carry figures, and how many did not (a home whose items carry none counts them in stock, not
   on the day, and the day line says so rather than pretending they were zero) */
function extrasFor(cur){return (S.extras||[]).filter(x=>x.cursor===cur);}
function extrasTotal(cur){
  const ex=extrasFor(cur);
  const priced=ex.filter(x=>x.kcal!=null);
  return {kcal:priced.reduce((a,x)=>a+x.kcal,0),protein_g:priced.reduce((a,x)=>a+x.protein_g,0),count:ex.length,unpriced:ex.length-priced.length};
}
/* ---- "Also had", by amount (his ask, 2026-09-06: "whenever it says 3 eggs, I actually eat 4
   ... I need the ability to add 1 additional egg instead of another 3 eggs"): anything on hand,
   in the item's own step. The label is the amounts in the block's own words ("1 egg", "0.5 cup
   2% cottage cheese"); the day is counted from each item's per-unit figures (items.csv, Phase
   12), and a home whose items carry none counts the amount in stock and not on the day, and
   says so. Stock is the truth here: what is on hand may have been eaten, whatever the plan
   thinks of it, the way a cold option the plan left out stays while its stock lasts. */
const singular=n=>/oes$/.test(n)?n.slice(0,-2):/s$/.test(n)?n.slice(0,-1):n;
/* One by-amount row, on hand or kept: the same shape either way, so a person cannot tell which
   list an item is in besides the words -- both step, both label, both log through extraFrom. */
function amtRow(k){const it=I[k],v=XAMT[k]||0,priced=it.kcal!=null&&it.protein_g!=null,u=it.unit||'',have=S.inv[k]||0;
  const per=priced?Math.round(it.kcal)+' kcal '+((!u||u==='each')?'each':'per '+unitOf(k,1).trim()):'no figures on this home';
  const meta=have>0?(fmt(have)+' '+unitOf(k,have)).trim()+' on hand · '+per:'your plan keeps this · '+per;
  /* the amount set sits under the name, never beside it: a value column squeezed a long name
     into a few characters once an amount was set (his report, 2026-09-08) */
  return '<div class="row"><span class="row__body"><span class="row__title">'+esc(it.name)+'</span>'+
    '<span class="row__meta">'+esc(meta)+'</span>'+(v>0?'<span class="row__note">Set: '+esc(amtLabel(k,v))+'</span>':'')+'</span>'+
    '<span class="step2"><button class="iconbtn" type="button" data-fk="xamt-less:'+esc(k)+'" onclick="act.extraAmt(\''+esc(k)+'\',-1)" aria-label="Less '+esc(it.name)+'">'+icon('minus')+'</button>'+
    '<button class="iconbtn" type="button" data-fk="xamt-more:'+esc(k)+'" onclick="act.extraAmt(\''+esc(k)+'\',1)" aria-label="More '+esc(it.name)+'">'+icon('plus')+'</button></span></div>';}
function amtLabel(k,v){return I[k]?plabel(k,v):'';}   /* a cook's figure: half a cup, never 0.5 cups */
function extraFrom(amt){const uses={},parts=[];let kcal=0,pro=0,priced=true;
  IORDER.forEach(k=>{const v=Number(amt&&amt[k]);if(!(v>0)||!I[k])return;uses[k]=v;parts.push(amtLabel(k,v));
    const c=I[k].kcal,p=I[k].protein_g;if(c==null||p==null)priced=false;else{kcal+=c*v;pro+=p*v;}});
  if(!parts.length)return null;
  return {key:'amt',label:parts.join(', '),kcal:priced?Math.round(kcal):null,protein_g:priced?Math.round(pro):null,uses,slot:'',priced};}
/* Every item the by-amount card can offer, split in two: on hand first (whatever the plan
   thinks of it -- stock is the truth, the way a cold option the plan left out stays while its
   stock lasts), then everything else the plan, the chips and a condition on the history all
   still keep, so a fresh home with nothing bought yet is not offered an empty card (his report,
   2026-09-07: "Also had still doesn't let you freely choose"). A kept item starts at zero and
   has no ceiling of its own; deduct() already floors stock at zero, so logging one counts on
   the day and leaves stock exactly where an untracked item always was. */
function extraItems(){const eff=effFor(REG,AVOID), on_hand=IORDER.filter(k=>(S.inv[k]||0)>0), had=new Set(on_hand);
  return {on_hand,kept:IORDER.filter(k=>!had.has(k)&&I[k]&&!leavesOut(I[k].tags||[],eff).length)};}
/* ---- the plan's rule, on the page: what a plan and the chips leave out, and what that costs,
   said before Save. The same three lines as plate_config.leaves_out and the same phrases as
   plan_gaps, pinned equal to the engine by test on every plan and chip combination; the
   picker needs them live, because the chips change under a person's thumb. */
const shortName=n=>String(n||'').split(' — ')[0];
function leavesOut(tags,reg){if(!reg)return[];const ex=new Set(reg.excludes||[]),bad=new Set();(tags||[]).forEach(t=>{if(ex.has(t))bad.add(t);});
  if((reg.allows||[]).length){const al=new Set(reg.allows);(tags||[]).forEach(t=>{if(!al.has(t)&&!COND_TAGS.includes(t))bad.add(t);});}return[...bad].sort();}
const COND_TAGS=['gluten','purine'];   /* what a condition on the history leaves out: never counted against an allow-list plan (plate_config.CONDITION_TAGS) */
function effFor(reg,avoid){if(!(avoid||[]).length)return reg;const e=Object.assign({},reg||{id:'',name:'',allows:[],excludes:[],note:''});
  e.excludes=[...new Set([...(e.excludes||[]),...avoid])].sort();return e;}
const CHIP_TAGS=['beef','pork','poultry','fish','shellfish','dairy','egg','beans','grain','potato','fruit','nuts','vegetable','soy','gluten'];   /* the food groups a person can leave out: plate_config.FOOD_TAGS */
const COUNT_KEYS=[['red_meat_slots','beef','red_meat'],['fish_slots','fish','fish'],['beans_slots','bean',null]];
const COUNT_TAG={red_meat_slots:'beef',fish_slots:'fish',beans_slots:'beans'}, CLASSWORD={red_meat:'beef',fish:'fish',beans:'bean'};
const TARGET_WORD={fiber_g:'fiber',sat_fat_g:'saturated fat',added_sugar_g:'added sugar'};
const countsAs=(m,key,cls)=>key==='beans_slots'?(m.contains||[]).includes('beans'):m.protein_class===cls;
/* the food groups a person can still leave out on a plan: what it keeps, never what it already leaves out */
function chipsFor(reg){if(!reg)return CHIP_TAGS.slice();if((reg.allows||[]).length)return CHIP_TAGS.filter(t=>reg.allows.includes(t));return CHIP_TAGS.filter(t=>!(reg.excludes||[]).includes(t));}
function planFit(reg,avoid){const e=effFor(reg,avoid);return CFG.meals.filter(m=>m.declared&&!leavesOut(m.contains,e).length);}
function planGaps(reg,avoid){const e=effFor(reg,avoid),out=[],fit=planFit(reg,avoid);
  SLOTS.forEach(sl=>{const total=sl.opts.length,kept=sl.opts.filter(o=>!leavesOut(o.contains,e).length).length,name=shortName(sl.name).toLowerCase();
    if(kept===0&&(sl.occasion||ROT)!==ROT)out.push('no '+name+' fits');else if(kept===1&&total>1)out.push('one '+name+' option');});
  if(fit.length<2*N)out.push(fit.length+' dinners fit, two rotations need '+(2*N));
  COUNT_KEYS.forEach(([key,word,cls])=>{const asked=reg?reg[key]:null;if(asked==null||asked<=0)return;const n=fit.filter(m=>countsAs(m,key,cls)).length;
    if(n<asked)out.push('asks for '+fmt(asked)+' '+word+' night'+(asked===1?'':'s')+', '+n+' fit');});
  return out;}
/* ENGINE-CORE-END */
let EXTRA=false;                        /* the Also had picker is open */
let XAMT={};                            /* the amounts set on the Also had picker's by-amount rows, until they are logged or the picker closes */
let EXTRAAT=null;                       /* which cursor what gets logged counts against: the day still on Tonight, or the one just finished */
let EXTRAOCC=null;                      /* which of today's occasions it was beside, on a home with more than one */
let XFMSG='';                           /* Something else's own error, if the name or a number is missing or bad */
let HMSG='';                            /* the Add a fact form's own message, under its button (Phase 17) */
let TRIP={};                            /* a trip being planned, per store: the meals it covers */

window.act={
 tab(t){if(COMMITTED&&t!==tab){returnTo({tab:t,mk:'overview',at:null});location.reload();return;}
   tab=t;partial=false;EXTRA=false;OPEN=null;TRADED=null;render();if(t==='markers'&&MK===null)loadMarkers();},
 theme(v){if(window.plateTheme)window.plateTheme(v);render();},
 /* You, from the round control in the masthead: your own settings, food-first. A second tap
    on the control goes back to the tab it was opened from; a card id lands on that card. */
 you(at){if(tab==='you'&&!at){tab=YOUFROM||'tonight';render();return;}
   if(tab!=='you')YOUFROM=tab;tab='you';OPEN=null;MSG='';
   if(at){FOLD[at]=true;SCROLLTO=at;}render();if(!at)window.scrollTo({top:0,behavior:'smooth'});if(MK===null)loadMarkers();},
 begin(s,how){S.inv={...EMPTY};if(s)S.inv=stockedFor();S.init=true;S.pending={};S.applied=[];S.gate0={};delete S.kitchen_start;tab=s?'tonight':'kitchen';adoptPlan();persist();render();
   if(s)say('Stocked: a pack of everything the rotation uses.');
   else if(how==='some')say('Own some of it already? Buy only what is missing, or plan a trip for the next few meals.');
   else say('Your kitchen starts empty. This first list stocks it.');},
 /* the quiet button on the first list: a pack of everything the rotation uses is already on the
    shelf, so the list closes and Tonight is the plate to cook */
 stocked(){S.inv=stockedFor();tab='tonight';persist();render();say('Stocked: a pack of everything the rotation uses.');},
 planB(o){planB=o&&!!PLANB;partial=false;render();},
 swap(){const p=posAt(0),q=posAt(1),t=S.order[p];S.order[p]=S.order[q];S.order[q]=t;
   planB=false;TRADED=MEALS[S.order[q]]?MEALS[S.order[q]].name:null;persist();render();
   say('Traded with the next meal.');},
 unswap(){const p=posAt(0),q=posAt(1),t=S.order[p];S.order[p]=S.order[q];S.order[q]=t;
   TRADED=null;persist();render();say('Trade undone.');},
 /* Any meal in the rotation can take tonight's slot. The cold block does not move with it:
    it rotates on its own index, which is what keeps an identical plate from recurring. */
 cook(i){const p=posAt(0),q=posAt(i),t=S.order[p];S.order[p]=S.order[q];S.order[q]=t;
   tab='tonight';OPEN=null;TRADED=MEALS[S.order[q]]?MEALS[S.order[q]].name:null;
   planB=false;persist();render();say(MEALS[S.order[p]].name+' is tonight.');},
 open(k){OPEN=OPEN===k?null:k;render();},
 /* the strip: open that meal's row and bring it into view. Reads nothing, writes nothing. */
 jumpRot(d){OPEN='r'+d;render();const el=document.querySelector('[data-fk="rot:'+d+'"]');
   if(el&&el.scrollIntoView)el.scrollIntoView({block:'center',behavior:'smooth'});},
 /* a tile on Kitchen: bring that card into view. Reads nothing, writes nothing. */
 /* a tile, the run-due card or a link into a folded card opens it first: a jump never lands on a closed card */
 jumpK(id){FOLD[id]=true;render();const el=document.getElementById(id);if(el&&el.scrollIntoView)el.scrollIntoView({block:'start',behavior:'smooth'});},
 fold(id,on){FOLD[id]=!on;render();},
 explain(){EXON=!EXON;render();},
 mk(v){MKVIEW=v;OPEN=null;MSG='';render();window.scrollTo({top:0,behavior:'smooth'});},
 allMk(){ALLOPEN=!ALLOPEN;render();},
 attnAll(){ATTNALL=!ATTNALL;render();},
 /* a marker's row: in the outside-target card if it is there, else in the list by panel.
    Reads nothing, writes nothing. */
 jumpTo(id){MKVIEW='overview';render();
   let el=document.querySelector('[data-fk="m:'+id+'"]');
   if(el){OPEN='m:'+id;}else{ALLOPEN=true;OPEN='p:'+id;}
   render();el=document.querySelector('[data-fk="'+OPEN+'"]');
   if(el&&el.scrollIntoView)el.scrollIntoView({block:'center',behavior:'smooth'});},
 trend(m){TRENDM=m;TREND=null;EXPO=null;MKVIEW='trend';tab='markers';OPEN=null;MSG='';render();
   window.scrollTo({top:0,behavior:'smooth'});if(MK===null)loadMarkers();},
 plan(){const d=document.getElementById('planDate'),c=document.getElementById('planCad');
   PLANQ={draw:d?d.value:'',cadence:c?c.value:''};DRAW=null;render();},
 async upload(){
   const inp=document.getElementById('upl'),file=inp&&inp.files&&inp.files[0];
   if(!file){MSG='Choose a file first.';render();return;}
   MSG='Uploading '+file.name+'…';render();
   try{const r=await api('/api/upload?name='+encodeURIComponent(file.name),{method:'POST',body:await file.arrayBuffer()});
     MSG='Saved as '+r.file+'.';FILES_STALE=true;
     if(/\.(csv|xlsx|xlsm)$/i.test(r.file))act.tracker(r.file);else act.preview(r.file);}
   catch(e){MSG=e.message;render();}},
 /* Nothing is stored until the preview has been seen and the button pressed. The first look at
    a report asks the parser; every look after that sends the rows as they read on the screen,
    corrected, mapped or left out, and a commit stores exactly those. */
 async preview(file,commit){
   if(file)ING={file:file,opts:{}};
   if(!ING||(!ING.file&&!ING.manual))return;
   const sup=document.getElementById('optSup'),rp=document.getElementById('optRep'),dt=document.getElementById('optDate'),lb=document.getElementById('optLab');
   const prev=ING.opts||{};
   const opts={supersede:sup?sup.checked:!!prev.supersede,replace:rp?rp.checked:!!prev.replace,
     date:dt?dt.value.trim():(prev.date||''),lab:lb?lb.value.trim():(prev.lab||'')};
   const f=ING.file||null,manual=!!ING.manual,edit=ING.edit||null,info=ING.info||null;
   const rows=edit?edit.filter(x=>x.keep).map(x=>({test_name:x.test_name||'',value:x.value||'',unit:x.unit||'',ref_range:x.ref_range||'',lab_flag:x.lab_flag||'',panel:x.panel||'',marker:x.marker||''})):null;
   ING={file:f,manual:manual,opts:opts,loading:true};render();
   try{const body={file:f||'',date:opts.date,lab:opts.lab,supersede:opts.supersede,replace:opts.replace,commit:!!commit};
     if(rows)body.rows=rows;
     const r=await api('/api/ingest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
     r.file=f;r.manual=manual;r.opts=opts;
     r.edit=r.rows.map(x=>({test_name:x.test_name,value:x.value,unit:x.unit,ref_range:x.ref_range,lab_flag:x.lab_flag,panel:x.panel,marker:x.marker,status:x.status,keep:true,open:false}));
     ING=r;
     if(commit&&r.result){MK_STALE=true;FILES_STALE=true;TREND=null;MKFILL=true;COMMITTED=true;say('Committed. '+r.result.written+' new rows written.');dinnerAfter(r);}}
   catch(e){ING={file:f,manual:manual,opts:opts,error:e.message,diag:e.diag||null,edit:edit,info:info,markers:MKCAT};}
   render();if(MK===null)loadMarkers();},
 /* results typed from a paper report, or one the reader could not read: the same preview */
 typeReport(){ING={manual:true,opts:{},info:{typed:true,date:'',lab:'',scanned:false},edit:[{test_name:'',value:'',unit:'',ref_range:'',lab_flag:'',panel:'',marker:'',status:'',keep:true,open:true}],markers:MKCAT};
   MSG='';render();const el=document.querySelector('[data-fk="ing:0:test_name"]');if(el)el.focus();},
 ingOpen(i){if(!ING||!ING.edit||!ING.edit[i])return;ING.edit[i].open=!ING.edit[i].open;render();},
 ingKeep(i,on){if(!ING||!ING.edit||!ING.edit[i])return;ING.edit[i].keep=!!on;render();},
 /* a field edited in place: the model changes, the screen does not redraw under the caret */
 ingSet(i,k,v){if(!ING||!ING.edit||!ING.edit[i])return;ING.edit[i][k]=v;},
 ingAdd(){if(!ING||!ING.edit)return;ING.edit.forEach(x=>x.open=false);
   ING.edit.push({test_name:'',value:'',unit:'',ref_range:'',lab_flag:'',panel:'',marker:'',status:'',keep:true,open:true});
   render();const el=document.querySelector('[data-fk="ing:'+(ING.edit.length-1)+':test_name"]');if(el)el.focus();},
 /* the rotation is rebuilt from the store on the next load; go there */
 seeRotation(){returnTo({tab:'rotation',mk:'overview',at:null});location.reload();},
 async tracker(file,commit){
   const f=file||(ING&&ING.file);if(!f)return;
   ING={file:f,kind:'tracker',loading:true};render();
   try{const r=await api('/api/import-tracker',{method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({file:f,commit:!!commit})});
     r.file=f;r.kind='tracker';ING=r;
     if(commit&&r.committed){BODY=null;ASSOC=null;FILES_STALE=true;say('Imported. Weight and intake are under Body.');}}
   catch(e){ING={file:f,kind:'tracker',error:e.message};}
   render();},
 trackerCommit(){act.tracker(null,true);},
 /* The client-side build keeps everything in this browser; a backup is the one file that
    holds all of it, and a restore replaces everything here with that file. */
 async backup(){
   try{const r=await fetch('/api/backup');if(!r.ok)throw new Error('The backup could not be built.');
     const b=await r.blob(),a=document.createElement('a'),u=URL.createObjectURL(b);
     const d=new Date(),p=n=>String(n).padStart(2,'0');
     a.href=u;a.download='plate-backup-'+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds())+'.plate';
     document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(u);a.remove();},2000);
     say('Backup ready: '+Math.round(b.size/1024)+' kB.');}
   catch(e){say(e.message);}},
 async restore(id){
   const inp=document.getElementById(id),file=inp&&inp.files&&inp.files[0];
   if(!file){MSG='Choose a backup file first.';render();return;}
   MSG='Restoring '+file.name+'…';render();
   try{const r=await api('/api/restore',{method:'POST',body:await file.arrayBuffer()});
     MSG='';flash('Restored '+r.files+' files. Reloading.');setTimeout(()=>location.reload(),600);}
   catch(e){MSG=e.message;render();}},
 async saveProfile(){
   const g=id=>document.getElementById(id);
   const post=(key,value)=>api('/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:key,value:value})});
   try{
     if(g('lensSel'))await post('guideline_lens',g('lensSel').value);
     if(g('tierSel'))await post('risk_tier',g('tierSel').value);
     if(g('cadIn')&&g('cadIn').value)await post('draw_cadence_months',g('cadIn').value);
     /* the reload every other settings-save on this page already uses (storeSave, saveRow,
        addHist...), not a bare null+render: this card's own HIST/MK were nulled to force a
        refetch, but viewProfile()'s and viewMarkers()'s own "not loaded yet" guards blank the
        WHOLE screen on null, so the very next render hid "Saved." behind a spinner until a
        background fetch quietly fixed it -- the same shape as the report-commit bug he found,
        one call away (his report, 2026-09-09). A full reload needs no such guard at all. */
     returnTo({at:'lens'});flash('Saved.');setTimeout(()=>location.reload(),350);}
   catch(e){MSG=e.message;render();}},
 sound(v){soundSet(v);render();if(v)chime('log');},
 /* the tier's line follows the select before Save, so a person reads what they are choosing */
 tierWord(v){const el=document.getElementById('tierline');if(el&&TIERWORD[v])el.textContent=tierLine(v);},
 storeToggle(sk){const P=spick(),on=new Set(P.shop);on.has(sk)?on.delete(sk):on.add(sk);P.shop=SCAT.filter(s=>on.has(s));SMSG='';render();},
 storePick(k,sk){spick().picks[k]=sk;SMSG='';render();},
 /* The catalog is resolved on the Mac and rides inside the page, so a saved choice fetches
    the page again rather than rebinding the engine's constants underneath a running state. */
 async saveStores(){const P=spick();
   if(!P.shop.length){SMSG='Keep at least one store in play.';render();return;}
   const post=(key,value)=>api('/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:key,value:value})});
   try{
     await post('stores',P.shop.join('|'));
     await post('store_picks',Object.keys(P.picks).map(k=>k+':'+P.picks[k]).join('|'));
     SMSG='';flash('Saved. Rebuilding the lists.');
     setTimeout(()=>location.reload(),350);
   }catch(e){SMSG=e.message;render();}},
 regimenPick(v){RSEL=v;RMSG='';render();},
 /* the interview's plan line follows the picker without a redraw (a redraw would reset the rail) */
 frKitchen(v){FRKITCHEN=v;document.querySelectorAll('[data-fk^="fr-kitchen:"]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.fk==='fr-kitchen:'+v)));
   const n=document.getElementById('fr-kitchen-note');if(n)n.textContent=FRKNOTE[v];},
 frPlan(v){const r=REGS.find(x=>x.id===v)||null, box=document.getElementById('fr-avoid-chips');
   if(box)box.outerHTML=fieldAvoid('fr-avoid-',ticked('fr-avoid-',CHIP_TAGS),r);
   const el=document.getElementById('fr-planline');if(el)el.textContent=planLine(r,ticked('fr-avoid-',CHIP_TAGS));},
 /* a chip ticked or cleared: the plan line under it says what the chips cost, without a redraw;
    on You the ticks are kept aside so a plan pick can redraw the card without losing them */
 chips(prefix){const av=ticked(prefix,CHIP_TAGS);let r=null;
   if(prefix==='fr-avoid-'){const sel=document.getElementById('fr-regimen');r=REGS.find(x=>x.id===(sel?sel.value:''))||null;}
   else{RAV=av;r=REGS.find(x=>x.id===(RSEL==null?(REG?REG.id:''):RSEL))||null;}
   const el=document.getElementById(prefix.replace('avoid-','planline'));if(el)el.textContent=planLine(r,av);},
 /* Who eats: the household number and any per-occasion override, saved the way the store
    picker is: post, then fetch the page again, since the resolved catalog rides inside it. */
 async saveWhoEats(){const g=id=>document.getElementById(id);
   const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   try{
     if(g('peopleIn'))await post('/api/diet',{key:'portions',value:g('peopleIn').value});
     for(const o of OCC){const el=g('occIn-'+o.id);if(!el)continue;
       const v=el.value.trim();
       /* Blank and never had one: leave it alone, never pin an untouched field to whatever the
          household happens to be right now. Blank but it DID have an override: post empty to
          clear it. Anything typed: post it. */
       if(v||o.portions_own!=null)await post('/api/occasions',{id:o.id,value:v});}
     returnTo({at:'whoeats'});flash('Saved. Rebuilding the lists.');setTimeout(()=>location.reload(),350);
   }catch(e){PMSG=e.message;render();}},
 /* First run: every answer in one post, checked before any is written (/api/setup), then the
    page fetched again with the rotation built for those answers. "Set up" is remembered in the
    state, so the stock question comes next and this screen never comes back on its own. */
 async saveSetup(){const g=id=>document.getElementById(id);
   const on=(prefix,keys)=>keys.filter(k=>{const el=g(prefix+k);return el&&el.checked;});
   /* the answers the preview reads are the answers the save writes, plus the kitchen */
   const diet=Object.assign(setupAnswers('fr-'),{equipment:on('fr-eq-',CFG.equipment_catalog).join('|'),hands_on_minutes:g('fr-time').value});
   const stores=on('fr-store-',SCAT).join('|');
   if(!diet.equipment){FRMSG='Tick at least one thing to cook on.';render();return;}
   if(!stores){FRMSG='Tick at least one store.';render();return;}
   /* the seventh card is required: a skipped one would put one person's plate on another's table */
   const miss=bodyMissing();
   if(miss.length){FRMSG='About you sizes your plates. Still needed: '+list(miss.map(k=>BODYLABEL[k]||k))+'.';render();return;}
   try{
     await api('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({diet,stores,profile:bodyProfile()})});
     /* The order this page holds is the rotation of the plan it was loaded with, not the one
        just chosen; saved as-is it would come back as fourteen slots the new plan leaves out and
        the planner would swap every one. An empty order is what loadState reads as "the
        baseline", and after the reload the baseline is the chosen plan's own rotation. */
     S.order=[];S.setup=true;S.guide=true;S.kitchen_start=FRKITCHEN;await store.set('plate:v8',JSON.stringify(S));
     flash('Building your rotation.');setTimeout(()=>location.reload(),350);
   }catch(e){FRMSG=e.message;render();}},
 /* About you: a typed value is kept, and the host is asked for the estimate once the card is
    complete. The line is written into the page directly, never through a redraw, so the caret
    stays where it was. */
 bodySet(k,v,prefix){BODYF[k]=v;if(k==='goal'){const el=document.getElementById(prefix+'rate');if(el&&el.parentNode)el.parentNode.style.visibility=v==='hold'?'hidden':'';}
   const line=document.getElementById(prefix+'target');clearTimeout(TGTT);TGT=null;
   if(line)line.textContent=targetLine();
   if(prefix==='fr-')frSync();
   if(!bodyMissing().length)TGTT=setTimeout(()=>act.estimate(prefix),250);},
 async estimate(prefix){
   const line=()=>document.getElementById(prefix+'target');
   if(bodyMissing().length){TGT=null;if(line())line().textContent=targetLine();return;}
   const asked=JSON.stringify(bodyProfile());
   try{const r=await api('/api/target',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile:bodyProfile(),diet:setupAnswers(prefix)})});
     if(JSON.stringify(bodyProfile())!==asked)return;      /* typed on while waiting: a newer ask is coming */
     TGT=r;}
   catch(e){TGT={error:e.message};}
   if(line())line().textContent=targetLine();
   if(prefix==='fr-')frSync();},
 /* The scale's step, undone or acknowledged. Undo puts the plate the scale replaced back with
    its own date and fetches the page again, since every quantity the config carries is scaled
    by the plate; Got it keeps the plate and drops the line. */
 async undoPlate(){
   try{await api('/api/plate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({undo:true})});
     flash('Plates back as they were.');setTimeout(()=>location.reload(),350);}
   catch(e){say(e.message);}},
 async ackPlate(){
   try{await api('/api/plate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ack:true})});
     CFG.plate_step=null;render();}
   catch(e){say(e.message);}},
 /* A weigh-in, typed on Body: one row, the date a recorded fact. The screen redraws; when the
    scale stepped the plate on it, the page is fetched again, scaled, and lands back here on the
    line that says so. */
 async weigh(){const g=id=>document.getElementById(id);
   const w=g('wIn')?g('wIn').value.trim():'', d=g('wDate')?g('wDate').value.trim():'';
   if(!w){MSG='Type your weight first.';render();return;}
   try{const r=await api('/api/weigh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({weight_lb:w,date:d})});
     if(r.stepped){returnTo({tab:'markers',mk:'body',at:'platecard'});flash('Weighed in. The scale stepped the plate: about 5 percent '+(r.stepped.step<0?'smaller':'larger')+' from the next cook.');setTimeout(()=>location.reload(),600);return;}
     BODY=null;MSG='';say('Weighed in: '+r.point.weight_lb+' lb, trend '+r.point.trend_lb+'.');}
   catch(e){MSG=e.message;}
   render();},
 /* Your target under Profile: About you saved the way first run saves it, then the page
    fetched again, since the targets and the plate ride inside it. */
 async saveTarget(){
   const miss=bodyMissing();
   if(miss.length){TMSG='Still needed: '+list(miss.map(k=>BODYLABEL[k]||k))+'.';render();return;}
   try{await api('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile:bodyProfile()})});
     returnTo({at:'yourtarget'});flash('Saved. Rebuilding the rotation.');setTimeout(()=>location.reload(),350);}
   catch(e){TMSG=e.message;render();}},
 /* Your kitchen and When you eat under Profile: the first-run answers, changed the way the
    other pickers are, one row at a time, then the page fetched again. */
 async saveKitchen(){const g=id=>document.getElementById(id);
   const post=(key,value)=>api('/api/diet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,value})});
   const eq=CFG.equipment_catalog.filter(e=>{const el=g('yk-eq-'+e);return el&&el.checked;}).join('|');
   if(!eq){KMSG='Tick at least one thing to cook on.';render();return;}
   try{await post('equipment',eq);const r=await post('hands_on_minutes',g('yk-time').value);
     returnTo({at:'yourkitchen'});flash('Saved. Rebuilding the lists.'+plateResizeNote(r.plate));setTimeout(()=>location.reload(),350);
   }catch(e){KMSG=e.message;render();}},
 async saveOccasions(){const g=id=>document.getElementById(id);
   const on=(CFG.occasion_catalog||[]).map(o=>o.id).filter(k=>{const el=g('yo-occ-'+k);return el&&el.checked;}).join('|');
   try{const r=await api('/api/diet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'occasions',value:on})});
     returnTo({at:'whenyoueat'});flash('Saved. Rebuilding the lists.'+plateResizeNote(r.plate));setTimeout(()=>location.reload(),350);
   }catch(e){OMSG=e.message;render();}},
 /* the plan is resolved on the Mac and rides inside the page, so a saved choice fetches the
    page again, as the store picker does */
 /* the pick itself is read fresh from the select at the tap, the way the chips beside it
    already are, not from RSEL alone: a mirrored variable can go stale under a picker's own
    native UI (his report, 2026-09-07, traced but not reproduced on a desktop pane -- the fix is
    to make it not matter which one was right). */
 async saveRegimen(){const sel=document.querySelector('[data-fk="regsel"]');
   const v=sel?sel.value:(RSEL==null?(REG?REG.id:''):RSEL), av=ticked('rg-avoid-',CHIP_TAGS).join('|');
   try{let r=await api('/api/diet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'regimen',value:v})});
     if(av!==AVOID_OWN.join('|'))r=await api('/api/diet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'avoid',value:av})});
     returnTo({at:'regimen'});flash('Saved. Dinners change from the next cook. Anything you own that this plan leaves out is on Kitchen.'+plateResizeNote(r.plate));setTimeout(()=>location.reload(),350);}
   catch(e){RMSG=e.message;render();}},
 sed(k,v){SED[k]=v;},
 snew(k,v){SNEW[k]=v;},
 /* a store changed in place under Stores: its name, kind, list line and cadence, by key; the
    countdown flag rides along unchanged, and the page is fetched again, since the lists and the
    kind marks are resolved with the catalog */
 storeEdit(sk){const st=STORES[sk];SEDIT=st?{key:sk,name:st.name,kind:st.kind||'grocery',threshold:String(st.threshold||''),cadence:st.cadence||'',msg:''}:{key:'',name:'',kind:'grocery',threshold:'',cadence:'',msg:''};render();if(st)act.jumpK('stores');},
 sedit(k,v){SEDIT[k]=v;},
 async storeSave(){
   if(!SEDIT.name.trim()){SEDIT.msg='Give the store a name.';render();return;}
   try{await api('/api/stores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:SEDIT.key,name:SEDIT.name,kind:SEDIT.kind,threshold:SEDIT.threshold,cadence:SEDIT.cadence,countdown:!!(STORES[SEDIT.key]||{}).countdown})});
     returnTo({at:'stores'});flash(SEDIT.name.trim()+' saved.');setTimeout(()=>location.reload(),350);}
   catch(e){SEDIT.msg=e.message;render();}},
 edItem(k){SED={item:k,store:'',pack:'',buy:'',msg:''};render();},
 edRow(sk){const o=(I[SED.item]&&I[SED.item].offers||{})[sk];if(!o)return;SED.store=sk;SED.pack=String(o.pack);SED.buy=o.buy||'';SED.msg='';render();},
 async saveRow(){
   if(!SED.item){SED.msg='Pick an item first.';render();return;}
   if(!SED.store){SED.msg='Pick a store.';render();return;}
   try{await api('/api/store_items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({store:SED.store,item:SED.item,pack:SED.pack,buy:SED.buy})});
     returnTo({item:SED.item});flash('Saved. Rebuilding the lists.');setTimeout(()=>location.reload(),350);}
   catch(e){SED.msg=e.message;render();}},
 async removeRow(sk,k){
   try{await api('/api/store_items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({store:sk,item:k,remove:true})});
     returnTo({item:k});flash('Removed. Rebuilding the lists.');setTimeout(()=>location.reload(),350);}
   catch(e){SED.msg=e.message;render();}},
 async addStore(){
   if(!SNEW.name.trim()){SNEW.msg='Give the store a name.';render();return;}
   try{const r=await api('/api/stores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:SNEW.name,threshold:SNEW.threshold,cadence:SNEW.cadence,countdown:SNEW.countdown,kind:SNEW.kind})});
     returnTo({store:r.key});flash(SNEW.name.trim()+' added.');setTimeout(()=>location.reload(),350);}
   catch(e){SNEW.msg=e.message;render();}},
 async removeStore(sk){
   try{await api('/api/stores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:sk,remove:true})});
     returnTo({});flash(STORES[sk].name+' removed.');setTimeout(()=>location.reload(),350);}
   catch(e){SMSG=e.message;render();}},
 /* A fact added, changed or removed fetches the page again, whatever the reply: a condition can
    leave food out of the pools and the rotation without moving the plate, and only a fresh
    config carries that (his report, 2026-09-08: celiac added under You, Kitchen still listing
    pasta and oats until a reload -- the item Phase 13 opened). The one field a fact cannot do
    without is said under the button that was tapped, with the field focused, not on a card
    above the form. */
 async addHist(){
   const g=id=>{const e=document.getElementById(id);return e?e.value:'';};
   const obj={item:g('hItem'),category:g('hCat'),status:g('hStatus'),date:g('hDate'),affects:g('hAff'),
     interval_months:g('hInt'),last_done:g('hLast'),detail:g('hDetail'),condition:g('hCond'),protein_limit_g:g('hCond')==='kidney'?g('hLimit'):''};
   if(!obj.item){HMSG='Give the fact a name: Item is required.';render();say(HMSG);const e=document.getElementById('hItem');if(e)e.focus();return;}
   if(HEDIT!=null)obj.index=HEDIT;
   try{const r=await api('/api/history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
     returnTo({at:'hist-form'});flash((HEDIT!=null?'Saved.':'Added.')+condSaid(obj.condition,obj.protein_limit_g)+plateResizeNote(r.plate));setTimeout(()=>location.reload(),350);}
   catch(e){HMSG=e.message;render();}},
 /* reopens Add a fact pre-filled, saving as a change to this row instead of a new one -- the
    same shape storeEdit already gives a store under Kitchen */
 editHist(i){HEDIT=i;HDEL=null;MSG='';HMSG='';SCROLLTO='hist-form';render();},
 cancelHistEdit(){HEDIT=null;MSG='';HMSG='';render();},
 askRemoveHist(i){HDEL=i;render();},
 cancelRemoveHist(){HDEL=null;render();},
 async removeHist(i){
   const row=(HIST&&HIST.items&&HIST.items[i])||{};
   try{const r=await api('/api/history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({index:i,remove:true})});
     returnTo({at:'hist-form'});flash('Removed.'+(row.condition?' '+condWord(row.condition).replace(/^\w/,c=>c.toUpperCase())+' no longer moves anything.':'')+plateResizeNote(r.plate));setTimeout(()=>location.reload(),350);}
   catch(e){HMSG=e.message;render();}},
 cycle(id){S.off[id]=(S.off[id]||0)+1;persist();render();},
 cooked(){FLIPSRC='log';ENTER='log';const draw=previewDraw();
   note(planB?'first_planb':'first_log');
   snapshot(planB?'plan_b':'full');
   report(planB?'plan_b':'full',true,SLOTS.map(sl=>sl.id));
   const wasB=planB,before={...S.inv};planB=false;
   deduct(draw);S.cursor++;S.checked=[];USED={cursor:-1,meal:'',amt:{}};persist();render();logSound(S.cursor%N===0);
   const lead=wasB?'Plan B logged. The freezer stayed sealed.':'Logged. Stock updated.';
   TRADED=null;say(lead,logLine(lead));fxSettle(settleInfo(draw,before,wasB?'Plan B: the freezer stayed sealed':'Ate it all'));},
 /* a tap that opens a sheet brings the sheet to the eye: on a phone the aside is the last grid
    row, so a card appended under the buttons is below the fold, and a render alone changes
    nothing in the viewport (found on his phone, 2026-09-06: the tap "did nothing") */
 openPartial(){partial=true;pOven=false;EXTRA=false;SCROLLTO='partial-card';render();},
 /* opened from Tonight, it counts against the day still ahead; opened from Last logged (his
    ask: Ate it all should not end the chance to add one more thing), it counts against the day
    that just closed instead. Either way it is still today in the app's own words, never a
    clock. */
 openExtra(prevDay){EXTRA=true;XAMT={};XFMSG='';partial=false;EXTRAAT=prevDay?S.cursor-1:S.cursor;
   EXTRAOCC=OCC.length>1?ROT:null;SCROLLTO='extra-card';render();say('Pick what you also had.');},
 closeExtra(){EXTRA=false;XAMT={};XFMSG='';EXTRAAT=null;EXTRAOCC=null;render();},
 extraOcc(id){EXTRAOCC=id;render();},
 /* something from stock outside the plan: its own row in the log on no cursor, and the one undo
    until the next log. The stamp is made here so the undo can name the row it takes out. A
    canned option and an amount set by hand take the one path, so the row, the undo, the stock
    and the status line cannot differ. */
 extra(key){const o=extraOptions(EXTRAAT===S.cursor-1).find(x=>x.key===key);if(!o)return;window.act.logExtra(o);},
 extraAmt(k,d){if(!I[k])return;const cur=XAMT[k]||0,have=S.inv[k]||0;
   /* on hand caps at what is there, the way a log always has; a kept item the plan allows but
      nothing was ever bought for has no stock to cap against, so the step is open */
   const cap=have>0?have:Infinity, nx=Math.max(0,Math.min(cap,Math.round((cur+d*stepOf(k))*100)/100));
   if(nx>0)XAMT[k]=nx;else delete XAMT[k];render();},
 extraLog(){const o=extraFrom(XAMT);if(!o)return;window.act.logExtra(o);},
 /* something the catalog does not hold at all: a name and, if known, its numbers -- typed, so
    read fresh from the fields at the tap rather than mirrored on every keystroke, the pattern
    peopleIn already uses. It has no stock and no ingredients: it counts on the day and never
    touches deduct(). */
 extraFreeLog(){const g=id=>{const e=document.getElementById(id);return e?e.value.trim():'';};
   const name=g('xfree-name');
   if(!name){XFMSG='Give it a name first.';render();return;}
   const kn=g('xfree-kcal'), pn=g('xfree-protein_g'), kcal=kn?Number(kn):null, pro=pn?Number(pn):null;
   if((kn&&!(kcal>=0))||(pn&&!(pro>=0))){XFMSG='Kcal and protein, if given, must be numbers.';render();return;}
   XFMSG='';window.act.logExtra({key:'free',label:name,kcal:kcal,protein_g:pro,uses:{}});},
 logExtra(o){
   const at=new Date().toISOString(), cur=EXTRAAT==null?S.cursor:EXTRAAT, occ=EXTRAOCC||ROT, occWord=occName(occ).toLowerCase();
   S.last={inv:Object.assign({},S.inv),cursor:cur,checked:S.checked.slice(),order:S.order.slice(),pending:Object.assign({},S.pending),
     gate0:Object.assign({},S.gate0),applied:S.applied.slice(),meal:o.label,meal_id:'extra',kind:'extra',occasion:occ,at:at};
   S.extras=(S.extras||[]).filter(x=>x.cursor>=cur-1);
   const entry={cursor:cur,kcal:o.kcal,protein_g:o.protein_g,label:o.label,occ:occ,at:at,uses:{}};
   S.extras.push(entry);
   if(window.plateEvent)window.plateEvent({cursor:cur,meal_id:'extra',meal:o.label,kcal:o.kcal,protein_g:o.protein_g,kind:'extra',note:'also had, with '+occWord,at:at});
   const movesStock=Object.keys(o.uses||{}).length>0;
   /* the entry keeps what actually left stock, item by item, never what was asked: a preset is
      not capped at what is on hand and deduct floors at nothing, so Remove (Phase 18) gives
      back exactly this and never makes stock out of nothing; a swap that lands on it is noted */
   const before={...S.inv}, f0=FLIPS.length;
   deduct(o.uses);
   for(const k in (o.uses||{})){const d=Math.round(((before[k]||0)-(S.inv[k]||0))*100)/100;if(d>0)entry.uses[k]=d;}
   if(FLIPS.length>f0)entry.landed=FLIPS.slice(f0).map(s=>s.key);
   EXTRA=false;XAMT={};XFMSG='';EXTRAAT=null;EXTRAOCC=null;persist();render();
   say('Also had '+o.label+', with '+occWord+'. '+(movesStock?'Stock updated.':'Counted on the day; nothing tracked to take from stock.'));},
 /* Any Also-had entry can be taken back, not only the newest (his report, 2026-09-08: two
    logged, the first wrong, no way back; and a new day's entry took the previous day's way
    back). The stock it actually took goes back on the shelf and on the gate it ate down, its
    row leaves the day and the log on the Mac (undo_extra, by stamp and label), and the undo
    snapshot is patched by the same amounts, so the newest entry's Undo, and a meal's, stay
    exact. The newest entry is the one-step undo itself. A swap that landed on its stock stays
    landed: a landing is only ever reversed by Undo or Start over. */
 removeExtra(at){
   const i=(S.extras||[]).findIndex(x=>x.at===at);if(i<0)return;const x=S.extras[i];
   if(S.last&&S.last.kind==='extra'&&S.last.at===at){window.act.undoLog();return;}
   giveBack(S,x.uses||{});if(S.last)giveBack(S.last,x.uses||{});
   S.extras.splice(i,1);
   if(window.plateEvent)window.plateEvent({cursor:x.cursor,meal_id:'extra',meal:x.label,kind:'undo_extra',note:'removed by the user',at:x.at});
   persist();render();
   const took=Object.keys(x.uses||{}).length>0;
   say('Removed. '+x.label+(took?' is back in stock.':' is off the day.')+(x.landed&&x.landed.length?' The swap that landed on it stays.':''));},
 /* the amount of one item tonight's plate takes: stepped in the item's own step, never below
    nothing, kept until the log that takes it */
 used(k,d){const m=activeMeal();if(USED.cursor!==S.cursor||USED.meal!==m.id)USED={cursor:S.cursor,meal:m.id,amt:{}};
   const cur=usedAmt(m,k);USED.amt[k]=Math.max(0,Math.round((cur+d*stepOf(k))*100)/100);render();},
 usedReset(){USED={cursor:-1,meal:'',amt:{}};render();},
 cancelPartial(){partial=false;render();},
 toggleOven(){pOven=!pOven;render();},
 logPartial(){FLIPSRC='log';ENTER='log';const draw=previewDraw();
   note(pOven&&planB?'first_planb':'first_log');note('first_partial');
   snapshot(pOven&&planB?'plan_b':'partial');
   report(pOven&&planB?'plan_b':'partial',pOven,[...S.checked]);
   const before={...S.inv};planB=false;
   deduct(draw);S.cursor++;S.checked=[];partial=false;USED={cursor:-1,meal:'',amt:{}};persist();render();logSound(S.cursor%N===0);
   TRADED=null;say('Logged what you ticked.',logLine('Logged what you ticked.'));
   fxSettle(settleInfo(draw,before,'In part: what you ticked'));},
 /* The last log is undoable until the next one. A deliberate undo is the one thing besides
    Start over that may move the cursor back, so it carries the same deliberate stamp and
    wins the sync against the other device's copy. The server removes the log row, because
    the log is deduplicated by cursor and a re-log tonight would otherwise be dropped. */
 undoLog(){let L=S.last;
   if(L&&L.cooked&&L.meal_id&&S.tally&&S.tally[L.meal_id]>0){S.tally[L.meal_id]--;if(!S.tally[L.meal_id])delete S.tally[L.meal_id];}
   if(L&&L.kind==='extra'){
     /* an extra put back: the stock it took, and its row on the Mac; the cursor never moved.
        The one just logged is always the last entry the running total holds, since nothing
        else ever adds to it and undo never reaches past the single most recent action. */
     S.inv=Object.assign({},L.inv);S.pending=Object.assign({},L.pending);S.gate0=Object.assign({},L.gate0);S.applied=L.applied.slice();S.order=L.order.slice();
     if(S.extras&&S.extras.length)S.extras.pop();
     S.last=null;
     if(window.plateEvent)window.plateEvent({cursor:L.cursor,meal_id:'extra',meal:L.meal,kind:'undo_extra',note:'undone by the user',at:L.at});
     persist();render();say('Undone. '+L.meal+' is back in stock.');return;}
   if(!L){
     /* No snapshot: the log was made on the previous page, or this is a second undo. Rebuild
        it from the slot: the meal that sat at the last cursor and the cold block beside it,
        as if the whole plate was eaten. The gate is put back by what that meal used of it. */
     if(S.cursor<=0)return;
     const m=mealAt(-1),inv=Object.assign({},S.inv),pend=Object.assign({},S.pending);
     const give=(u)=>{for(const k in (u||{}))inv[k]=Math.round(((inv[k]||0)+u[k])*100)/100;};
     give(m.uses);coldAt(-1).forEach(c=>give(c.uses));
     for(const k in pend){const sw=SWAP[k];if(sw&&m.uses&&m.uses[sw.gate_item])pend[k]=Math.round((pend[k]+m.uses[sw.gate_item])*100)/100;}
     L={inv:inv,cursor:S.cursor-1,checked:[],order:S.order.slice(),pending:pend,gate0:Object.assign({},S.gate0),
        applied:S.applied.slice(),meal:m.name,meal_id:m.id,kind:'full',rebuilt:true};
   }
   S.inv=Object.assign({},L.inv);S.cursor=L.cursor;S.checked=L.checked.slice();S.order=L.order.slice();
   S.pending=Object.assign({},L.pending);S.gate0=Object.assign({},L.gate0);S.applied=L.applied.slice();
   S.reset_at=Date.now();S.last=null;planB=false;partial=false;TRADED=null;
   if(window.plateEvent)window.plateEvent({cursor:L.cursor,meal_id:L.meal_id,meal:L.meal,kind:'undo',note:'undone by the user'});
   persist();render();say('Undone. '+L.meal+' is tonight again.'+(L.rebuilt?' Stock was put back as if the whole plate was eaten.':''));},
 toggle(id){JUST=id;S.checked=S.checked.includes(id)?S.checked.filter(x=>x!==id):[...S.checked,id];persist();render();},
 flavToggle(id){JUST=id;S.flav=S.flav.includes(id)?S.flav.filter(x=>x!==id):[...S.flav,id];persist();render();},
 copyFlav(){const m=FLAV.filter(p=>!(p.excluded&&p.excluded.length)&&!S.flav.includes(p.id)).map(p=>p.name);
   if(!m.length){say('Flavour pantry is complete.');return;}
   navigator.clipboard?navigator.clipboard.writeText(m.join('\n')).then(()=>say(m.length+' items copied.'),()=>say('Copy blocked')):say('Copy blocked');},
 bump(k,d){ENTER='bump';FLIPSRC='bump';setInv(k,(S.inv[k]||0)+d);persist();render();},
 /* the store's list, bought: what was bought is added to what is on hand, never reset to a pack */
 restock(sk){FLIPSRC='stock';ENTER='bump';const st=STORES[sk],rows=listRows(sk);rows.forEach(r=>setInv(r.k,(S.inv[r.k]||0)+r.units));persist();render();chime('buy');
   say(st.name+' run logged: '+rows.length+' item'+(rows.length===1?'':'s')+' added to stock.');},
 copy(sk){const st=STORES[sk],rows=listRows(sk);
   if(!rows.length){say('Nothing needed from '+st.name+'.');return;}
   const line=(r,full)=>I[r.k].name+' — '+tripQty(r.units)+' '+I[r.k].unit+' — '+(full?I[r.k].buy:I[r.k].buy.split('.')[0]);
   let t='';
   if(st.countdown){const g={};rows.forEach(r=>{(g[I[r.k].zone]=g[I[r.k].zone]||[]).push(line(r,true));});
     ZONES.forEach(z=>{if(g[z])t+=z.toUpperCase()+'\n'+g[z].join('\n')+'\n\n';});}
   else t=rows.map(r=>line(r,false)).join('\n');
   navigator.clipboard?navigator.clipboard.writeText(t.trim()).then(()=>say('Copied for the '+st.name+' list.'),()=>say('Copy blocked')):say('Copy blocked');},
 /* a trip you call yourself: cover the next N meals from tonight; Bought it adds exactly that */
 tripOpen(sk){TRIP[sk]=(STORES[sk]&&STORES[sk].threshold)||14;render();},
 tripSet(sk,n){n=parseInt(n,10);if(!isNaN(n)&&n>0)TRIP[sk]=Math.min(n,H);render();},
 tripClose(sk){delete TRIP[sk];render();},
 tripCopy(sk){const st=STORES[sk],rows=tripNeed(sk,TRIP[sk]||st.threshold||14);
   if(!rows.length){say('Nothing to buy at '+st.name+' for that many meals.');return;}
   const t=rows.map(r=>I[r.k].name+' — '+tripQty(r.units)+' '+I[r.k].unit+(r.packs>1?' ('+r.packs+' packs)':'')+' — needs '+tripQty(r.need)+', '+tripQty(r.have)+' on hand'+(I[r.k].buy?' — '+I[r.k].buy:'')).join('\n');
   navigator.clipboard?navigator.clipboard.writeText(t).then(()=>say('Copied the '+st.name+' trip.'),()=>say('Copy blocked')):say('Copy blocked');},
 tripBought(sk){FLIPSRC='stock';ENTER='bump';const st=STORES[sk],rows=tripNeed(sk,TRIP[sk]||st.threshold||14);
   rows.forEach(r=>setInv(r.k,(S.inv[r.k]||0)+r.units));
   delete TRIP[sk];persist();render();chime('buy');say(st.name+' trip logged: '+rows.length+' item'+(rows.length===1?'':'s')+' added to stock.');},
 closeNote(){NOTE=null;render();},
 /* the guide: Next puts the step it is showing behind you for good, and carries on as a tour
    from there, the next step in order whatever the state has done, the way Show me around again
    does. On a first run only the one due step is lit, so a Next on it used to empty the queue
    and land on the closing panel after "1 of 5"; the line finds the control. The button says
    Next because that is what it does (the review: "Skip repeatedly advanced to another step");
    the × beside it is the separate way out. */
 guideSkip(){if(GCLOSING){act.guideDone();return;}
   const p=guidePlan(guideView());if(p&&p.key&&!S.seen.includes(p.key))S.seen.push(p.key);
   if(!S.tour)S.tour=true;persist();guideSync();},
 /* Done on the closing panel: the word was said; Show me around again brings it back */
 guideDone(){if(!S.seen.includes('guide_close'))S.seen.push('guide_close');GLATER=[];persist();guideSync();},
 /* ×: the tour ends here, whatever step it was on; Show me around again under You brings it back */
 guideExit(){S.guide=false;S.tour=false;GLATER=[];GCLOSING=false;const g=document.getElementById('guide');if(g)g.classList.remove('closing');
   persist();guideSync();say('Tour ended. Find it again under You, The guide.');},
 installSeen(){if(!S.seen.includes('install_note'))S.seen.push('install_note');persist();render();},
 /* Show me around again: every step forgotten, the tour on, Tonight first. The guide was once
    shown once and never again; an app is not learnt in one pass. */
 guideAgain(){S.seen=S.seen.filter(k=>!GUIDE.some(s=>s.key===k)&&k!=='guide_close');GLATER=[];S.guide=true;S.tour=true;persist();tab='tonight';MKVIEW='overview';render();window.scrollTo({top:0});},
 guideFind(){if(GTARGET&&GTARGET.scrollIntoView)GTARGET.scrollIntoView({block:'center',behavior:'smooth'});},
 notNow(){if(!S.seen.includes('report_nudge'))S.seen.push('report_nudge');persist();render();},
 closeFlip(){const g=document.getElementById('gate');g.innerHTML='';},
 resetAsk(){RSTASK=true;render();},                                     /* first tap: ask, do not act */
 resetCancel(){RSTASK=false;render();},
 /* Restarting the rotation is not restarting the tour: seen keeps every guide step and
    guide_close, so the guide overlay stays exactly as dismissed as it was a moment ago (his
    report, 2026-09-09: "it STILL restarts the guide when you do the restart" -- seen used to be
    wiped to [], which is indistinguishable from a guide that has never been shown at all, since
    guide/S.guide only gates WHETHER the overlay is eligible to show, not whether each step has
    already been seen). The rotation's own one-time teaching notes (first_log, first_partial,
    first_planb, report_nudge) are dropped along with everything else not guide-related, since a
    restarted rotation is honestly a fresh first meal, first partial, first Plan B. */
 reset(){RSTASK=false;S={inv:{...FULL},cursor:0,checked:[],order:[...BASE],off:{},flav:S.flav,init:false,pending:{},applied:[],
   gate0:{},seen:S.seen.filter(k=>GUIDE.some(s=>s.key===k)||k==='guide_close'),guide:!!S.guide,reset_at:Date.now(),last:null,setup:true,tally:{},extras:[]};partial=false;planB=false;persist();render();}   /* deliberate, and the one thing allowed to move the cursor back on the other device */
};

/* What the log just did, said in the units the system owns: meals and cycles, never dates. */
/* the stock standing between a lab result and the slot it wants, in one sentence, or nothing */
function gateLine(){
  const live=SWAPS.filter(s=>S.order.includes(s.from)&&S.pending[s.key]!=null);
  if(!live.length)return '';
  const s=live[0],rem=Math.round(S.pending[s.key]*10)/10;
  return rem>0?rem+' '+(s.gate_unit||'')+' of '+(s.gate_name||'stock')+' left before slot '+(S.order.indexOf(s.from)+1)+' becomes '+s.to_name+'.'
              :(s.gate_name||'The stock')+' is gone. Slot '+(S.order.indexOf(s.from)+1)+' becomes '+s.to_name+' at the next log.';
}
function logLine(lead){
  const parts=[lead,'Meal '+(S.cursor%N||N)+' of cycle '+(Math.floor((S.cursor-1)/N)+1)+'.'];
  if(S.cursor>0&&S.cursor%N===0)parts.push('Cycle '+(S.cursor/N)+' closed with '+N+' meals logged.');
  const g=gateLine();if(g)parts.push(g);
  return parts.join(' ');
}

/* ---- what changed since the last paint. Motion is only ever the transition into a state
   the markup already holds, so killing every animation still leaves the page correct. */
function diff(F,run){
  const d={log:false,gate:{},L:{},cross:false,seal:false,armable:false};
  if(!PAINTED)return d;
  d.log=ENTER==='log'&&S.cursor>PAINTED.cursor;
  for(const k in PAINTED.pending){if(S.pending[k]!=null&&S.pending[k]<PAINTED.pending[k])d.gate[k]=true;}
  for(const k in F.L){if(PAINTED.L[k]!==F.L[k])d.L[k]=PAINTED.L[k];}
  d.cross=(PAINTED.run>6&&run<=6)||(PAINTED.run>2&&run<=2);
  d.seal=d.log&&S.cursor%N===0&&S.cursor>0;
  return d;
}

/* ==========================================================================
   THE VIEW. Everything above this line is the engine and is untouched: the
   cursor, the forecast, the depletion gate, the sync rules. Everything below
   only draws it.

   Four destinations and one navigation bar. The Plate used to live inside a
   fixed-position iframe on the phone shell, which is why the first touch was
   swallowed and scrolling stalled for a second or two. There is no iframe now.
   ========================================================================== */

let MK=null, MK_STALE=false, MKAT=null, MKLOAD=false, EXPLAIN={}, OPEN=null, EXON=false, TRADED=null, YOUFROM=null;

const VIEWS=[['tonight','Tonight'],['rotation','Rotation'],['kitchen','Kitchen'],['markers','Markers']];
const NAVGL={
  tonight:'<path d="M3 8h14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z"/><circle cx="10" cy="12.5" r="2.5"/><path d="M5.5 6V4"/>',
  rotation:'<path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6"/><path d="M16.5 3v3.5H13"/>',
  kitchen:'<path d="M4 3h12v14H4z"/><path d="M4 9h12"/><path d="M7 5.5v1.5M7 11.5V13"/>',
  markers:'<path d="M3 14.5 7 9l3.2 3.2L16.5 5"/><path d="M13 5h3.5v3.5"/>'
};
const gl=n=>'<svg class="gl" viewBox="0 0 20 20" aria-hidden="true">'+NAVGL[n]+'</svg>';

/* ---- the gauge: a slim track for how much of a pack is left. The fill is the family core;
        low is ember; an item being eaten down on purpose is ink -------------------------- */
function gauge(pct,cls){
  return '<span class="gauge"><i'+(cls?' class="'+cls+'"':'')+' style="width:'+Math.max(2,Math.min(100,pct))+'%"></i></span>';
}

/* ---- the gate rail: one segment per unit of stock standing between a lab
        result and the slot it wants to change ------------------------------ */
function gateRail(sw){
  const total=S.gate0[sw.key]||S.pending[sw.key]||1, left=Math.max(0,S.pending[sw.key]||0);
  const n=Math.max(1,Math.min(14,Math.round(total)));
  const goneN=Math.round((1-left/total)*n);
  let seg='';
  for(let i=0;i<n;i++)seg+='<i class="'+(i<goneN?'gone':'')+'"></i>';
  return '<div class="gate"><div class="gaterail">'+seg+'</div><div class="gatecap">'+
    '<span>'+(Math.round(left*10)/10)+' '+esc(sw.gate_unit||'')+' left</span>'+
    '<span>'+esc(sw.gate_name||sw.gate_item||'stock')+'</span></div></div>';
}

/* ---- the scale's proposal: a plate step in food words, confirmed with one button. The same
   card on Tonight and on Body, so the two cannot say different things about the same step. --- */
const slopeWords=s=>(s<0?'down ':'up ')+Math.abs(s).toFixed(2)+' lb';
const bandWords=b=>b[1]<=0?'down '+Math.abs(b[1]).toFixed(2)+' to '+Math.abs(b[0]).toFixed(2)+' lb':b[0]>=0?'up '+b[0].toFixed(2)+' to '+b[1].toFixed(2)+' lb':'within '+b[1].toFixed(2)+' lb either way';
/* The scale stepped the plate: one card on Tonight and on Body, the same function, saying what
   changed in food words, with Got it and Undo. It replaced a proposal with a Do it button: the
   step is 5 percent at most once in four weeks after three weeks of weigh-ins, small enough to
   apply itself, and a line with Undo is not silence. */
function plateCard(p){
  const pct=Math.round(Math.abs(1-p.plate)*100), dir=p.plate<p.plate_prev?'smaller':'larger';
  const line=p.plate===1?'Plates are back to the recipes as written, from the next cook.'
    :'Plates are about 5 percent '+dir+' from the next cook: about '+pct+' percent '+(p.plate<1?'smaller':'larger')+' than written.';
  return '<section class="card card--tint arrive" data-family="sprout" id="platecard"><span class="t-head" style="display:block">'+esc(line)+'</span>'+
    '<p class="t-note" style="margin-top:var(--s1)">The scale said so: over three weeks of weigh-ins the trend sat '+(dir==='smaller'?'above':'below')+' the band your goal expects. '+
    'The stock you own is eaten at the new size; nothing is rebought. Not what you wanted? Undo puts the old plate back.</p>'+
    '<div class="btnrow" style="margin-top:var(--s3)"><button class="btn btn--sm btn--ink" type="button" data-fk="plateok" onclick="act.ackPlate()">Got it</button>'+
    '<button class="btn btn--sm" type="button" data-fk="plateundo" onclick="act.undoPlate()">Undo</button></div></section>';
}

/* ---- the invitation: once, while no report is on file, dismissable, never a nag. Food words
   only; the markers and what they move sit one tap deeper, on the Markers overview. --- */
const LABS=CFG.labs||{draws:0,results:0};
function reportCard(){
  if(LABS.draws>0||S.seen.includes('report_nudge'))return '';
  return '<section class="card card--tint" data-family="sprout" id="reportcard"><span class="t-head" style="display:block">'+esc(reportLine('head'))+'</span>'+
    '<p class="t-note" style="margin-top:var(--s1)">'+esc(reportLine('note'))+' It never leaves this device.</p>'+
    '<div class="btnrow" style="margin-top:var(--s3)"><button class="btn btn--sm btn--ink" type="button" data-fk="addreport" onclick="act.tab(\'markers\');act.mk(\'reports\')">Add a report</button>'+
    '<button class="btn btn--sm" type="button" data-fk="notnow" onclick="act.notNow()">Not now</button></div></section>';
}

/* ---- one-time notes: a mechanism explained at the moment it is legible --- */
const NOTES={
  first_log:['Your first meal is logged','Time in Plateside is meals, not days. The cursor moved one place, and nothing here runs on a clock.'],
  first_partial:['Only what you ticked left your stock','A partial log is as honest a record as a full one. The forecast depends on it, so nothing about it is marked down.'],
  first_planb:['Plan B does not cost you a slot','The rotation did not advance past the meal you skipped. It is still next.'],
  gate_zero:['The stock that was holding a change back is gone','The slot flips at your next log, and the shopping list has already stopped buying for the old one.']
};
function noteCard(){
  if(NOTE===null||!NOTES[NOTE])return '';
  const n=NOTES[NOTE];
  return '<section class="card card--tint arrive" data-family="sprout"><span class="t-head" style="display:block">'+esc(n[0])+'</span>'+
    '<p class="t-note" style="margin-top:var(--s1)">'+esc(n[1])+'</p>'+
    '<button class="btn btn--sm btn--ink" type="button" data-fk="note" onclick="act.closeNote()" style="margin-top:var(--s3)">Got it</button></section>';
}

/* ==========================================================================
   THE LEDGER — the one daily action, given a moment that means what happened.
   A sheet rises from the bottom edge in ink. The plate drawn on it holds what
   tonight used as dots, one handful per unit of stock in the colour of the
   zone it came from; the plate tilts and they fall into the rows below, each
   row's count rolling from what was there to what is left; then the next
   meal. Food words and numbers, never praise. The page underneath has already
   logged the meal and scrolled to the new plate, which reads in as the sheet
   goes. With Reduce Motion on the sheet never comes: the words are in the
   live region and the page is already right. This replaced a field of embers
   with "Meal 12 logged" set over it in white, which celebrated, and the
   wrong thing. If anything here throws, the meal is still logged.
   ========================================================================== */
let LG={t:[],raf:null,on:false};
/* the plate a landing just resized (lt:resized), held until the ledger has finished, then one
   reload with its own line carried across (Phase 17) */
let RESIZED=null;
function afterResize(){
  const p=RESIZED;if(!p)return;RESIZED=null;
  returnTo({tab:tab,mk:MKVIEW,at:null});flash('Plates sized again for what is on your rotation now.'+plateResizeNote(p));
  setTimeout(()=>location.reload(),350);
}
const ZCOL={freezer:'--frost',fridge:'--sprout',pantry:'--clay'};
const cssVar=n=>(getComputedStyle(document.documentElement).getPropertyValue(n)||'').trim()||'#FFFFFF';
/* what the log did, for the sheet: each item tonight used, before and after. The plate's own
   ingredients first, in the recipe's order, then the cold block by the share of its stock the
   night took; a raw quantity would rank an ounce of cheese over a pound of beef. */
function settleInfo(draw,before,how){
  const q=v=>Math.round((v||0)*100)/100;
  const hot=(S.last&&MEALS[S.last.meal_id])?Object.keys(MEALS[S.last.meal_id].uses||{}):[];
  const rows=Object.keys(draw||{}).filter(k=>draw[k]>0&&I[k]).map(k=>({name:I[k].name,used:q(draw[k]),before:q(before[k]),after:q(S.inv[k]),unit:I[k].unit,zone:I[k].zone,
    hot:hot.indexOf(k),share:draw[k]/Math.max(before[k]||0,draw[k])}));
  rows.sort((a,b)=>((a.hot<0)-(b.hot<0))||(a.hot>=0&&b.hot>=0?a.hot-b.hot:0)||(b.share-a.share));
  const mid=S.last&&S.last.meal_id, times=mid&&S.last.cooked?stampsOf(mid):0;
  return {cursor:S.cursor,meal:S.last?S.last.meal:mealAt(-1).name,how:how,rows:rows,next:mealAt(0).name,gate:gateLine(),times:times,closes:S.cursor>0&&S.cursor%N===0};
}
/* a number that changed rolls to its new value: an odometer, every numeral a column that slides
   from the old digit to the new; a decimal point stays put */
function roll(el,from,to,dur){
  const dec=(Math.abs(from-Math.round(from))>1e-6||Math.abs(to-Math.round(to))>1e-6)?1:0;
  const a=from.toFixed(dec), b=to.toFixed(dec), n=Math.max(a.length,b.length), A=a.padStart(n,' '), B=b.padStart(n,' ');
  const G='0123456789 ', at=c=>{const i=G.indexOf(c);return i<0?10:i;};
  let h='';
  for(let i=0;i<n;i++){const cb=B[i];
    if(cb==='.'){h+='<b>.</b>';continue;}
    h+='<i data-to="'+at(cb)+'" style="transform:translateY(-'+(at(A[i])*100/11).toFixed(3)+'%);transition-duration:'+dur+'ms">'+G.split('').map(g=>'<span>'+(g===' '?'&nbsp;':g)+'</span>').join('')+'</i>';}
  el.className='odo';el.innerHTML=h;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{el.querySelectorAll('i').forEach(c=>{c.style.transform='translateY(-'+(+c.dataset.to*100/11).toFixed(3)+'%)';});}));
}
/* the plate: the app's own motif with a rim, tipping toward you; what tonight used rests on it
   as pieces in the colour of the zone each came from, slides off as it tips, and falls into its
   row: the row catches the first piece with a pulse and its count rolls to what is left */
function ledgerPlate(rows,release){
  const L=document.getElementById('ledger'), stage=L&&L.querySelector('.lp-stage'); if(!L||!stage)return;
  const rowEls=L.querySelectorAll('.ledger-row'), vals=L.querySelectorAll('.ledger-row .odo');
  const sx=stage.offsetLeft, sy=stage.offsetTop, w=stage.offsetWidth, h=stage.offsetHeight, cx=sx+w/2, cy=sy+h*0.5+6, R=68;
  const pieces=[];
  rows.forEach((r,i)=>{const col=cssVar(ZCOL[r.zone]||'--clay'), n=Math.min(7,Math.max(2,Math.round(2+5*(r.share||0)))), row=rowEls[i];
    if(!row)return;
    const ly=row.offsetTop+row.offsetHeight/2, lx=row.offsetLeft+row.offsetWidth-58;
    for(let j=0;j<n;j++){const a=(i/rows.length)*6.283+(j/n)*2.1+0.4, d=18+Math.sqrt(Math.random())*R*0.62;
      const el=document.createElement('i'); el.className='lpc'+(Math.random()<0.45?' round':''); el.style.setProperty('--pc',col);
      const size=8+Math.random()*6; el.style.width=size+'px'; el.style.height=size+'px'; L.appendChild(el);
      pieces.push({el,u:Math.cos(a)*d,v:Math.sin(a)*d,x:0,y:0,vx:0,vy:0,rot:Math.random()*360,spin:(Math.random()-0.5)*14,a:1,
        go:release+i*110+j*28+Math.random()*60,lx,ly,row,land:false,i:i});}});
  const t0=performance.now(), tilt0=500, tiltDur=820;
  const frame=()=>{
    const t=performance.now()-t0;
    const k=Math.max(0,Math.min(1,(t-tilt0)/tiltDur)), e=1-Math.pow(1-k,3), th=e*64*Math.PI/180, cos=Math.cos(th);
    let live=0;
    pieces.forEach(p=>{
      if(p.a<=0)return;
      if(t<p.go){p.x=cx+p.u;p.y=cy+p.v*cos-e*22;}
      else{
        if(!p.vy){p.vy=1.4+Math.random()*1.4;p.vx=(Math.random()-0.5)*1.6;}
        p.vy+=0.34;p.y+=p.vy;p.vx+=(p.lx-p.x)*0.012;p.x+=p.vx;p.rot+=p.spin;
        if(p.y>=p.ly-6){
          if(!p.land){p.land=true;
            if(!p.row.dataset.caught){p.row.dataset.caught='1';p.row.style.setProperty('--pc',p.el.style.getPropertyValue('--pc'));p.row.classList.add('catch');chime('catch');
              const b=vals[p.i]; if(b&&b.dataset.from!=null)roll(b,+b.dataset.from,+b.dataset.to,920);
              if(navigator.vibrate)try{navigator.vibrate(8);}catch(e){}}}
          p.a-=0.18;}
      }
      live++;
      p.el.style.transform='translate('+p.x.toFixed(1)+'px,'+p.y.toFixed(1)+'px) rotate('+p.rot.toFixed(0)+'deg)';
      p.el.style.opacity=Math.max(0,p.a).toFixed(2);
    });
    if(LG.on&&(live>0||t<release+800))LG.raf=requestAnimationFrame(frame);
  };
  LG.raf=requestAnimationFrame(frame);
}
function ledgerHide(){
  const L=document.getElementById('ledger'), S0=document.getElementById('lscrim'); if(!L||!LG.on)return;
  LG.t.forEach(clearTimeout); LG.t=[]; if(LG.raf)cancelAnimationFrame(LG.raf); LG.raf=null; LG.on=false;
  L.classList.remove('on'); if(S0)S0.classList.remove('on'); L.onclick=null;
  /* the new plate reads in as the sheet goes: the hero flips to it */
  const h=document.getElementById('hero');
  if(h){h.classList.add('settling');h.classList.add('flipin');setTimeout(()=>{h.classList.remove('settling');h.classList.remove('flipin');},1000);}
  setTimeout(guideRefresh,120);
  afterResize();
}
function fxSettle(info){
  if(RM.matches||!info)return;
  try{
    const L=document.getElementById('ledger'), S0=document.getElementById('lscrim'); if(!L)return;
    if(LG.on)ledgerHide();
    const at=(ms,fn)=>LG.t.push(setTimeout(fn,ms));
    const rows=info.rows.slice(0,5), more=info.rows.length-rows.length, q=v=>String(Math.round(v*10)/10);
    const release=560, rowAt=i=>300+i*70, landAt=i=>release+i*110+420, nextAt=landAt(Math.max(0,rows.length-1))+300;
    const m=S.last&&MEALS[S.last.meal_id]; L.dataset.family=m?famOf(m):'sprout';
    const cyc=Math.floor((info.cursor-1)/N)+1;
    L.innerHTML='<div class="lp-stage'+(info.closes?' cycle':'')+'"><div class="lp"></div>'+(info.closes?'<div class="lp-ring" id="lpring">'+ringSVG('lpr',0,0,176,4,'ring--lit')+'</div>':'')+'</div>'+
      '<div class="ledger-eye lrise" id="leye" style="animation-delay:120ms">Meal '+(info.cursor%N||N)+' · cycle '+cyc+' · logged</div>'+
      '<div class="ledger-big lrise" style="animation-delay:160ms">'+esc(info.meal)+'</div>'+
      '<div class="ledger-how lrise" style="animation-delay:200ms">'+esc(info.how)+(info.times?' · '+stampWord(info.times):'')+'</div>'+
      '<div class="ledger-rows">'+rows.map((r,i)=>{const u=r.unit==='each'?'':esc(r.unit)+' ';return '<div class="ledger-row lrise" style="animation-delay:'+rowAt(i)+'ms"><span><span class="ledger-name">'+esc(r.name)+'</span>'+
        '<span class="ledger-meta">'+esc(q(r.used))+' '+u+'tonight</span></span>'+
        '<span class="ledger-val"><b class="odo" data-from="'+r.before+'" data-to="'+r.after+'">'+esc(q(r.before))+'</b><span class="u">'+u+'left</span></span></div>';}).join('')+
        (more>0?'<div class="ledger-row lrise" style="animation-delay:'+rowAt(rows.length)+'ms"><span class="ledger-meta">and '+more+' more thing'+(more===1?'':'s')+' from stock</span></div>':'')+
        (rows.length?'':'<div class="ledger-row lrise" style="animation-delay:'+release+'ms"><span class="ledger-meta">Nothing left the stock.</span></div>')+'</div>'+
      '<div class="ledger-next" id="lnext"><span>Next up: <b>'+esc(info.next)+'</b>'+(info.gate?'<span class="ledger-meta">'+esc(info.gate)+'</span>':'')+'</span>'+icon('arrow')+'</div>';
    L.classList.add('on'); if(S0)S0.classList.add('on'); LG.on=true; L.onclick=ledgerHide;
    window.scrollTo({top:0,behavior:'smooth'});
    ledgerPlate(rows,release);
    /* a row no piece reached still rolls, so the count is never left where it was */
    rows.forEach((r,i)=>at(landAt(i)+380,()=>{const b=L.querySelectorAll('.ledger-row .odo')[i], row=L.querySelectorAll('.ledger-row')[i];
      if(b&&row&&!row.dataset.caught){row.dataset.caught='1';roll(b,r.before,r.after,920);}}));
    at(nextAt,()=>{const nx=document.getElementById('lnext');if(nx)nx.classList.add('wipe');});
    /* the cycle closing: after the last piece lands, a ring draws shut around the plate, the
       eyebrow says the cycle closed with its count of meals, and the figure plays */
    if(info.closes)at(nextAt+420,()=>{const rg=document.getElementById('lpring'),eye=document.getElementById('leye'),lp=L.querySelector('.lp'),st=L.querySelector('.lp-stage');
      if(rg&&lp&&st){const pr=lp.getBoundingClientRect(),sr=st.getBoundingClientRect();   /* centred on the plate as it lies, tilted */
        rg.style.margin='0';rg.style.left=(pr.left+pr.width/2-sr.left-rg.offsetWidth/2)+'px';rg.style.top=(pr.top+pr.height/2-sr.top-rg.offsetHeight/2)+'px';}
      if(rg){rg.classList.add('on');const a=rg.querySelector('.ring-a');if(a)a.style.strokeDashoffset='0';}
      if(eye){eye.textContent='Cycle '+cyc+' closed · '+N+' meals logged';eye.classList.remove('lrise');void eye.offsetWidth;eye.style.animationDelay='0ms';eye.classList.add('lrise');}
      chime('cycle');});
    at(info.hold?600000:Math.max(3800,nextAt+1500)+(info.closes?2200:0),ledgerHide);
  }catch(e){}
}

/* ==========================================================================
   MARKERS. Fetched from the Mac when it is reachable, and kept on the phone
   so the tab still answers with no signal. The tab is its specimen's parts:
   one card for the marker that changed dinner, with its number set large,
   the trend drawn small and the range scale against the range the lab
   printed; a sprout tint saying what it changed; cards of rows for the rest,
   a pill only when there is something to say; a clay tint for the next draw.
   No colour here means good or bad, and no line here is a diagnosis: the
   number, the trend, the range the lab printed and the rule that fired.
   ========================================================================== */
const MKCACHE='lt:markers';
function mkCacheRead(){try{const r=localStorage.getItem(MKCACHE);return r?JSON.parse(r):null;}catch(e){return null;}}
function mkCacheWrite(o){try{localStorage.setItem(MKCACHE,JSON.stringify(Object.assign({at:new Date().toISOString()},o)));}catch(e){}}
function agoLabel(iso){const d=Math.floor((Date.now()-new Date(iso))/86400000);
  return d<=0?'earlier today':d===1?'yesterday':d+' days ago';}

async function loadMarkers(){
  if(MKLOAD)return; MKLOAD=true;
  try{
    const [s,p,ex,dt]=await Promise.all([
      fetch('/api/summary').then(r=>r.json()),
      fetch('/api/plan').then(r=>r.json()),
      fetch('/api/explain').then(r=>r.json()).catch(()=>({})),
      fetch('/api/diet').then(r=>r.json()).catch(()=>null)]);
    if(s.offline||p.offline)throw new Error('offline');
    if(!ex.offline&&Object.keys(ex).length)EXPLAIN=ex;
    MK={s,p,diet:(dt&&!dt.offline)?dt:null}; MKAT=null;
    mkCacheWrite({s,p,ex:EXPLAIN,diet:MK.diet});
  }catch(e){
    const c=mkCacheRead();
    if(c){EXPLAIN=c.ex||EXPLAIN;MK={s:c.s,p:c.p,diet:c.diet||null};MKAT=c.at;}
    else MK='none';
  }
  MKLOAD=false; if(tab==='markers'||tab==='you')render();
}

/* The food targets, named the way he would say them rather than the way they are stored. */
const TLABEL={kcal:'Calories', protein_g:'Protein', fiber_g:'Fiber, at least',
  added_sugar_g:'Added sugar, daily cap', sat_fat_g:'Saturated fat, daily cap',
  red_meat_slots:'Beef nights per cycle', fish_slots:'Fish nights per cycle',
  beans_slots:'Bean nights per cycle', deficit_kcal:'Daily deficit'};
const tlabel=k=>TLABEL[k]||String(k).replace(/_/g,' ').replace(/ g$/,'');
const tunit=k=>(k==='kcal'||k==='deficit_kcal')?' kcal':/_g$/.test(k)?' g':'';
/* who moved a target's number: a fact on the history (Phase 13), else a marker */
const movedBy=(d,k)=>{const a=(d.adjustments||[]).find(a=>a.target===k&&a.changed);return a&&a.history?a.display+' on your history':'a marker';};
/* a condition that fired, in one sentence: what it leaves out, what it moved, or its note */
function condLine(c){const parts=[];if((c.tags||[]).length)parts.push('leaves '+tagWords(c.tags)+' out');
  (c.moves||[]).forEach(m=>parts.push(tlabel(m[0]).toLowerCase()+' '+fmt(m[1])+' to '+fmt(m[2])+tunit(m[0])));
  const head=c.word.replace(/^\w/,ch=>ch.toUpperCase())+' on your history';
  return parts.length?head+': '+parts.join(', ')+'.':((c.notes||[]).length?head+': '+c.notes.join(' '):head+'.');}
const WORDS=['no','one','two','three','four','five','six','seven','eight','nine'];
const word=n=>WORDS[n]||String(n);
const list=a=>a.length<2?a.join(''):a.slice(0,-1).join(', ')+' and '+a[a.length-1];

/* which markers moved a food target, and what they moved -------------------- */
function dietBy(){
  const by={};
  if(!MK||MK==='none'||!MK.diet||!MK.diet.adjustments)return by;
  MK.diet.adjustments.forEach(a=>{
    const e=by[a.marker]||(by[a.marker]={drive:false,moves:[],why:''});
    if(a.changed){e.drive=true;e.moves.push([tlabel(a.target),a.before,a.after,a.note||'',a.target]);}
    else if(!e.why)e.why=a.note||'This asks for a change another marker has already made, so nothing moves twice.';
  });
  /* a rule whose condition is met and that the plan does not let move dinner (a marker the plan
     is unmoved by, or a count whose food it leaves out): the marker says so instead of nothing */
  (MK.diet.notes||[]).forEach(n=>{if(!n.not_applicable)return;
    const e=by[n.marker]||(by[n.marker]={drive:false,moves:[],why:''});
    e.stood=true;if(!e.why)e.why=n.note||'';});
  return by;
}

/* the numeric edges of a target or a printed range: "<80", "> OR = 40", "60–120", "≤3".
   Used to order what sits outside target by how far out it is, and to place the band on
   the scale. Never shown as a number of its own. */
function bound(t){t=String(t||'').replace(/,/g,'').trim();let m;
  if((m=t.match(/^[<≤]\s*(?:or\s*)?=?\s*([\d.]+)/i)))return{hi:+m[1]};
  if((m=t.match(/^[>≥]\s*(?:or\s*)?=?\s*([\d.]+)/i)))return{lo:+m[1]};
  if((m=t.match(/^([\d.]+)\s*[–-]\s*([\d.]+)/)))return{lo:+m[1],hi:+m[2]};return null;}
const numOf=v=>{const n=parseFloat(String(v==null?'':v).replace(/[<>≤≥=,\s]/g,''));return isNaN(n)?null:n;};
const fmtN=v=>v==null?'–':String(Math.round(v*100)/100);
function howFar(m){const v=numOf(m.value);if(v==null)return 0;const b=bound(m.target);if(!b)return 0;
  if(m.vs_target==='above'&&b.hi!=null)return (v-b.hi)/Math.abs(b.hi||1);
  if(m.vs_target==='below'&&b.lo!=null)return (b.lo-v)/Math.abs(b.lo||1);return 0;}
function aiming(m){const b=bound(m.target);if(!b)return 'target '+m.target;
  if(b.lo!=null&&b.hi!=null)return 'aiming for '+b.lo+' to '+b.hi;
  if(b.hi!=null)return 'aiming under '+b.hi;return 'aiming over '+b.lo;}

/* the trend, said in one phrase: the draw before, or the last three */
function trendLine(m){const s=m.series||[],n=s.length;
  if(n<2)return 'one draw on record';
  const a=s[n-2].v,b=s[n-1].v;
  return b>a?'up from '+fmtN(a):b<a?'down from '+fmtN(a):'flat across '+n+' draws';}
function lastThree(m){const s=(m.series||[]).slice(-3);
  if(s.length<2)return 'one draw on record';
  return s.map(p=>fmtN(p.v)).join(' → ')+' over the last '+word(s.length)+' draws';}
/* what the lab said, and what the lens aims for: words beside the number, never a verdict */
function stateOf(m){const parts=[];
  if(m.lab_flag)parts.push('lab flag '+m.lab_flag);
  if(m.vs_target==='above'||m.vs_target==='below')parts.push(aiming(m));   /* in target is the pill's word */
  return parts;}
function heroState(m,d,lens){const parts=[];
  if(m.lab_flag)parts.push('The lab flagged it '+m.lab_flag+'.');
  if(m.vs_target==='above'||m.vs_target==='below')parts.push((m.vs_target==='above'?'Above':'Below')+' the '+m.target+' the '+lens+' view aims for.');
  else if(m.vs_target==='in')parts.push('Inside the '+m.target+' the '+lens+' view aims for.');
  else parts.push('No researched target for it; judged against the range the lab printed.');
  if(d&&d.drive)parts.push('This is the marker that changed dinner.');
  else if(d&&d.stood)parts.push('The '+planName()+' plan does not let it move dinner.');
  return parts.join(' ');}
/* a pill only when there is something to say, and one thing at a time: its place in the
   plan first, then the lab's own flag, then the target */
function statePill(m,dt){
  if(dt&&dt.drive)return '<span class="pill" data-family="plum"><i class="dot"></i>changed dinner</span>';
  if(dt&&dt.stood)return '<span class="pill pill--ghost">dinner stays</span>';
  if(dt)return '<span class="pill pill--ghost">same lever</span>';
  if(m.lab_flag)return '<span class="pill" data-family="ember"><i class="dot"></i>lab flag '+esc(m.lab_flag)+'</span>';
  if(m.vs_target==='above'||m.vs_target==='below')return '<span class="pill" data-family="plum">'+m.vs_target+' target</span>';
  if(m.vs_target==='in')return '<span class="pill pill--ghost">in target</span>';
  if(m.lab_range)return '<span class="pill pill--ghost">in the printed range</span>';
  return '';}

/* THE RANGE SCALE. The shaded band is the range the lab printed on that report, never one
   this app invented; the dot is the number; the tick is the draw before. Open-ended ranges
   ("<90") run the band to the track's edge. No colour in it means good or bad. */
function scale(m,opt){
  opt=opt||{};
  const v=numOf(m.value);if(v==null)return '';
  const b=bound(m.lab_range)||{},lo=b.lo!=null?b.lo:null,hi=b.hi!=null?b.hi:null;
  if(lo==null&&hi==null)return '';
  const ser=m.series||[],prev=ser.length>1?ser[ser.length-2].v:null;
  const pts=[v].concat(lo!=null?[lo]:[],hi!=null?[hi]:[],prev!=null?[prev]:[]);
  let d0=Math.min.apply(null,pts),d1=Math.max.apply(null,pts);
  if(d1===d0){const p=Math.abs(d0)*0.25||1;d0-=p;d1+=p;}
  const pad=(d1-d0)*0.18;d0-=pad;d1+=pad;
  const X=x=>Math.round(((x-d0)/(d1-d0))*1000)/10;
  const L=lo==null?0:X(lo),R=hi==null?100:X(hi);
  const aria=esc(m.value)+(m.unit?' '+esc(m.unit):'')+' against the printed range '+esc(m.lab_range)+(prev!=null?'; the draw before was '+fmtN(prev):'');
  return '<div class="scale'+(opt.fill?' fill':'')+'" role="img" aria-label="'+aria+'">'+
    '<div class="scaletrack"><div class="scaleband" style="left:'+L+'%;right:'+(Math.round((100-R)*10)/10)+'%"></div>'+
    (prev!=null?'<div class="scaleprev" style="left:'+X(prev)+'%"></div>':'')+
    '<div class="scaledot" style="left:'+X(v)+'%"></div></div>'+
    '<div class="scaleends">'+(lo!=null?'<span class="mono" style="left:'+L+'%">'+fmtN(lo)+'</span>':'')+
    (hi!=null?'<span class="mono" style="left:'+R+'%">'+fmtN(hi)+'</span>':'')+'</div>'+
    (opt.note?'<p class="t-note" style="margin-top:var(--s1)">Shaded is the range the lab printed, '+esc(m.lab_range)+'.'+
      (prev!=null?' The tick is the draw before.':'')+'</p>':'')+'</div>';
}

/* a marker as a row that opens in place: its own scale, its trend, what it moved on the
   plate or why it moves nothing further, the plain-words facts when the explainer is on,
   and the way to every draw */
function markerRow(m,dt,pre){
  const id=m.marker||m.display, key=(pre||'m:')+id, open=OPEN===key, e=(EXON&&m.marker)?EXPLAIN[m.marker]:null;
  const dir=m.vs_target==='above'?'over':m.vs_target==='below'?'under':'';
  const meta=[esc(m.value)+(m.unit?' '+esc(m.unit):''),trendLine(m)].concat(stateOf(m)).join(' · ');
  const line=e?String((dir==='over'&&e.high_means)||(dir==='under'&&e.low_means)||e.what_it_is||'').split(/(?<=\.)\s/)[0]:'';
  let body='<div class="mk__in">'+scale(m,{note:true});
  if(m.series&&m.series.length>1)body+='<div class="split" style="margin-top:var(--s3)"><span class="t-label">'+m.series.length+' draws</span>'+
    '<span class="mono" style="color:var(--ink-3)">'+esc(m.series[0].date)+' to '+esc(m.series[m.series.length-1].date)+'</span></div>'+spark(m.series);
  else body+='<p class="t-note" style="margin-top:var(--s3)">One draw on record, so there is no trend to draw yet.</p>';
  if(dt){
    body+='<dl class="facts">';
    if(dt.drive)dt.moves.forEach(v=>{body+='<dt>'+esc(v[0])+'</dt><dd><b>'+esc(v[1])+' → '+esc(v[2])+esc(tunit(v[4]))+'.</b> '+esc(v[3])+'</dd>';});
    else if(dt.stood)body+='<dt>Dinner stays</dt><dd>'+esc(dt.why)+'</dd>';
    else body+='<dt>Same lever</dt><dd>'+esc(dt.why)+'</dd>';
    body+='</dl>';
  }
  if(e){
    body+='<dl class="facts"><dt>What it is</dt><dd>'+esc(e.what_it_is)+'</dd>'+
      '<dt>Why it matters</dt><dd>'+esc(e.why_it_matters)+'</dd>'+
      (dir==='over'&&e.high_means?'<dt>Yours is above</dt><dd>'+esc(e.high_means)+'</dd>':'')+
      (dir==='under'&&e.low_means?'<dt>Yours is below</dt><dd>'+esc(e.low_means)+'</dd>':'')+
      (e.what_moves_it?'<dt>What moves it</dt><dd>'+esc(e.what_moves_it)+'</dd>':'')+
      (e.caveat?'<dt>Watch out</dt><dd>'+esc(e.caveat)+'</dd>':'')+'</dl>';
  } else if(!EXON){
    body+='<p class="t-note" style="margin-top:var(--s3)">Turn on <b>Explain these</b> for what this marker is, why it matters and what moves it.</p>';
  }
  if(m.marker)body+='<button class="btn btn--ink" type="button" data-fk="full:'+esc(id)+'" onclick="act.trend(\''+esc(m.marker)+'\')">Every draw and the chart</button>';
  body+='</div>';
  return '<div class="exp'+(open?' open':'')+'">'+
    '<button class="row" type="button" data-fk="'+esc(key)+'" onclick="act.open(\''+esc(key)+'\')" aria-expanded="'+open+'">'+
      '<span class="row__body"><span class="row__title">'+esc(m.display)+'</span><span class="row__meta">'+meta+'</span>'+
      (line?'<span class="row__note">'+esc(line)+'</span>':'')+'</span>'+statePill(m,dt)+'<span class="chev"></span></button>'+
    '<div class="exp-b"><div>'+body+'</div></div></div>';
}

function viewMarkers(){
  if(MK===null){loadMarkers();return '<div class="stack"><section class="card a-hero"><p class="t-body">Loading…</p></section></div>';}
  /* a report commit marks this stale rather than clearing it, for the same reason FILES_STALE
     exists in viewReports(): whichever markers sub-view is on screen -- reports, most often --
     would otherwise blank to this bare loading card for one render, hiding whatever it was
     already showing (the "Committed" card among it), and only quietly reappear once the
     background refetch below resolved. Serving the still-good MK for this one render and
     refreshing underneath it keeps the screen exactly as it was in the meantime. */
  if(MK_STALE){MK_STALE=false;loadMarkers();}
  if(MK==='none')return '<div class="stack"><section class="card a-hero" data-family="plum"><span class="t-label">Markers</span>'+
    '<p class="t-body" style="margin-top:var(--s2)">No labs saved on this phone yet.</p>'+
    '<p class="t-note" style="margin-top:var(--s2)">Open this once near the Mac and they stay here.</p></section></div>';
  let h='';
  if(MKAT)h+='<section class="card card--tint" data-family="clay" style="margin:12px var(--gutter) 0"><span class="t-head" style="display:block">The Mac is not reachable</span>'+
    '<p class="t-note" style="margin-top:var(--s1)">These are the labs saved on this phone, last updated '+esc(agoLabel(MKAT))+'.</p></section>';
  h+=chips();
  if(MKVIEW==='trend')return h+viewTrend();
  if(MKVIEW==='body')return h+viewBody();
  if(MKVIEW==='plan')return h+viewPlan();
  if(MKVIEW==='reports')return h+viewReports();
  return h+viewOverview();
}
let ALLOPEN=false, ATTNALL=false, MKFILL=false, SINCEALL=false;
/* calendar months between two ISO dates, to the nearest month: the one place the overview
   speaks in time, and it is a draw date's arithmetic, not a planner's clock */
const monthsBetween=(a,b)=>Math.max(0,Math.round((new Date(b)-new Date(a))/2629800000));
/* the words a rule's condition uses, said plainly */
const COND={above:'above its target',below:'below its target',persistently_above:'above its target on two draws running',persistently_below:'below its target on two draws running','in':'inside its target'};
/* the markers the food rules read, with the panel to order and what it costs: what a person
   deciding whether to pay for a panel needs to know, before any report is on file */
function readsCard(){
  const reads=(MK&&MK!=='none'&&MK.diet&&MK.diet.reads)||[];
  if(!reads.length)return '';
  let h='<section class="card"><div class="split"><span class="t-label">What a report can move</span><span class="mono" style="color:var(--ink-3)">'+reads.length+' markers</span></div>'+
    '<p class="t-note" style="margin:var(--s2) 0 var(--s1)">The food rules read these and nothing else: every other marker on a report is charted and moves nothing. Ask for the panel by name; the cost is the lab\'s tier, not a price.</p><div class="rows">';
  reads.forEach(r=>{h+='<div class="row"><span class="row__body"><span class="row__title">'+esc(r.display)+'</span>'+
    '<span class="row__meta">'+esc(r.panel||'its own panel')+' · '+(r.unmoved?'charted; the '+esc(planName())+' plan does not let it move dinner':!r.targets.length?'charted; nothing on the '+esc(planName())+' plan for it to move'
      :'moves '+esc(list(r.targets.map(t=>tlabel(t).toLowerCase())))+' when '+esc(list(r.conditions.map(c=>COND[c]||c))))+'</span></span>'+
    (r.cost?'<span class="pill pill--ghost">'+esc(r.cost)+' cost</span>':'')+'</div>';});
  return h+'</div></section>';
}
/* nothing on file yet: the way in, in food words, and what one report can move. The overview
   leads with it, and Full history shows it instead of a marker with "0 draws" over a paragraph
   of research: a screen with nothing on record invites, it does not lecture. */
function noReportCard(id){
  return '<section class="card" data-family="plum" style="border-radius:var(--r-xl);box-shadow:var(--lift-2)" id="'+(id||'noreport')+'"><span class="t-label">No report yet</span>'+
    '<p class="t-head" style="margin-top:var(--s3)">'+esc(reportLine('head2'))+'</p>'+
    '<p class="t-body" style="margin-top:var(--s2);color:var(--ink-2)">'+esc(reportLine('note2'))+
    'A second report, last year\'s say, lets the rules that wait to see a marker twice fire too. Any lab\'s PDF, or the numbers typed from paper. Nothing leaves this device.</p>'+
    '<div class="btnrow" style="margin-top:var(--s4)"><button class="btn btn--ink" type="button" data-fk="noreport" onclick="act.mk(\'reports\')">Add a report '+icon('arrow')+'</button></div></section>';
}
/* since your last draw: each marker that moved, the number then and now, and what dinner did
   about it in the rule's own words. The ones tied to dinner first, then by how far they moved. */
function sinceCard(prim,by,s){
  const moved=prim.filter(m=>m.series&&m.series.length>=2&&m.series[m.series.length-1].v!==m.series[m.series.length-2].v);
  if(!moved.length)return '';
  const rel=m=>{const a=m.series[m.series.length-2].v,b=m.series[m.series.length-1].v;return Math.abs(b-a)/(Math.abs(a)||1);};
  moved.sort((a,b)=>((by[b.marker]&&by[b.marker].drive)?1:0)-((by[a.marker]&&by[a.marker].drive)?1:0)||rel(b)-rel(a));
  const shown=SINCEALL?moved:moved.slice(0,6), hidden=moved.length-shown.length;
  let h='<section class="card" id="since"><div class="split"><span class="t-label">Since your last draw</span><span class="mono" style="color:var(--ink-3)">'+esc(s.draws[s.draws.length-2])+' to '+esc(s.draws[s.draws.length-1])+'</span></div><div class="rows">';
  shown.forEach(m=>{const a=m.series[m.series.length-2],b=m.series[m.series.length-1],d=by[m.marker];
    /* the moves in one sentence; the rules' own notes ride behind Explain these, where the
       rest of the overview keeps its plain-words facts */
    const did=d&&d.drive?'Dinner: '+d.moves.map(v=>v[0].toLowerCase()+' '+v[1]+' to '+v[2]+tunit(v[4])).join(', ')+'.'+(EXON?' '+d.moves.map(v=>v[3]).filter(Boolean).join(' '):''):'';
    h+='<div class="row"><span class="row__body"><span class="row__title">'+esc(m.display)+'</span>'+
      '<span class="row__meta">'+esc(fmtN(a.v))+' → '+esc(fmtN(b.v))+(m.unit?' '+esc(m.unit):'')+' · '+(b.v>a.v?'up':'down')+(m.vs_target==='above'||m.vs_target==='below'?' · now '+m.vs_target+' target':'')+'</span>'+
      (did?'<span class="row__note">'+esc(did)+'</span>':'')+'</span>'+(d&&d.drive?'<span class="pill" data-family="plum"><i class="dot"></i>changed dinner</span>':'')+'</div>';});
  h+='</div>';
  if(hidden>0||SINCEALL)h+='<button class="btn" type="button" data-fk="sinceall" style="width:100%;margin-top:var(--s4)" onclick="SINCEALL=!SINCEALL;render()">'+(SINCEALL?'Show fewer':hidden+' more moved')+'</button>';
  return h+'<p class="t-note" style="margin-top:var(--s3)">The number then and now, '+esc(reportLine('did'))+(EXON?', in the rules\' own words':'; turn on Explain these for the rules\' own words')+'. Nothing here is a verdict.</p></section>';
}
function viewOverview(){
  const s=MK.s, p=MK.p, by=dietBy();
  const prim=s.markers.filter(m=>m.role!=='derived'&&!m.computed);
  const comp=s.markers.filter(m=>m.computed);
  const out=prim.filter(m=>m.vs_target==='above'||m.vs_target==='below');
  /* the markers that changed dinner first, then the rest of what is outside target by how
     far out it sits; the first of them is the card that is the point of the screen */
  const rank=m=>{const d=by[m.marker];return (d?(d.drive?2:1):0)*100+Math.min(99,howFar(m)*100);};
  const attn=out.slice().sort((a,b)=>rank(b)-rank(a));
  const drivers=attn.filter(m=>by[m.marker]&&by[m.marker].drive);
  const hero=drivers[0]||attn[0]||prim[0]||null;
  const fill=MKFILL; MKFILL=false;
  let top='', main='', aside='';

  /* nothing on file yet: the overview leads with the way in, and says in food words what one
     report can move, and what a second one adds; the markers themselves sit one card down */
  if(!prim.length)top+=noReportCard()+readsCard();

  if(hero){
    const hd=by[hero.marker];
    top+='<section class="card" data-family="plum" style="border-radius:var(--r-xl);box-shadow:var(--lift-2)" aria-label="'+
      (hd&&hd.drive?'The marker that changed dinner':out.length?'The marker furthest outside its target':'Your markers')+'">'+
      '<div class="split"><div><span class="t-label">'+esc(hero.display)+'</span>'+
      '<div class="numrow" style="margin-top:var(--s3)"><b class="num num--xl">'+esc(hero.value)+'</b>'+(hero.unit?'<span class="t-unit" style="font-size:15px">'+esc(hero.unit)+'</span>':'')+'</div>'+
      '<p class="t-note" style="margin-top:var(--s2)">'+esc(lastThree(hero))+' · drawn '+esc(hero.date)+'</p></div>'+
      '<span class="chip chip--lg chip--round">'+icon('marker')+'</span></div>'+
      (hero.series&&hero.series.length>1?spark(hero.series):'')+
      scale(hero,{note:true,fill:fill})+
      '<p class="t-note" style="margin-top:var(--s3)">'+esc(heroState(hero,hd,s.lens))+'</p>'+
      (hero.marker?'<button class="btn btn--ink btn--sm" type="button" data-fk="hero" style="margin-top:var(--s4)" onclick="act.trend(\''+esc(hero.marker)+'\')">Every draw '+icon('arrow')+'</button>':'')+
      '</section>';
  }

  /* what the markers changed at dinner: each rule's move as a row, the same-lever markers named */
  if(MK.diet&&prim.length){
    top+='<section class="card card--tint" data-family="sprout"><span class="t-label">What this changed at dinner</span>';
    if(!drivers.length)top+='<p class="t-body" style="margin-top:var(--s2);color:var(--ink)">Nothing on your plate moved because of a marker. The plan stands as it was built.</p>';
    drivers.forEach(m=>{const d=by[m.marker];
      top+='<p class="t-body" style="margin-top:var(--s2);color:var(--ink)"><b>'+esc(m.display)+'</b> fired '+word(d.moves.length)+' rule'+(d.moves.length===1?'':'s')+'.</p><div class="rows">';
      d.moves.forEach(v=>{top+='<div class="row"><span class="row__body"><span class="row__title">'+esc(v[0])+'</span><span class="row__meta">was '+esc(v[1])+esc(tunit(v[4]))+'</span>'+
        (EXON&&v[3]?'<span class="row__note">'+esc(v[3])+'</span>':'')+'</span><b class="row__val">'+esc(v[2])+esc(tunit(v[4]))+'</b></div>';});
      top+='</div>';});
    const nameOf=k=>{const m=s.markers.find(x=>x.marker===k);return m?m.display:k;};
    const same=Object.keys(by).filter(k=>!by[k].drive&&!by[k].stood).map(nameOf), stood=Object.keys(by).filter(k=>!by[k].drive&&by[k].stood).map(nameOf);
    if(same.length)top+='<p class="t-note" style="margin-top:var(--s3)">'+esc(list(same))+' ask'+(same.length===1?'s':'')+' for the same lever'+(same.length===1?'':'s')+', so nothing moves twice.</p>';
    if(stood.length)top+='<p class="t-note" style="margin-top:var(--s3)">'+esc(list(stood))+' would move it, and the '+esc(planName())+' plan does not let '+(stood.length===1?'it':'them')+'. The number and the trend still show.</p>';
    if(drivers.length>1||(drivers.length&&drivers[0]!==hero))top+='<button class="btn btn--sm btn--quiet" type="button" data-fk="drv" style="margin-top:var(--s2);padding-left:0" onclick="act.jumpTo(\''+esc(drivers[drivers.length-1].marker)+'\')">See '+esc(drivers[drivers.length-1].display)+' '+icon('arrow')+'</button>';
    top+='</section>';
  }

  /* what sits outside target, the markers that changed dinner first; the rest folded behind
     a count, ordered by how far out they sit, one tap away */
  const rest=attn.filter(m=>m!==hero), tied=rest.filter(m=>by[m.marker]);
  const shown=ATTNALL?rest:rest.slice(0,Math.max(5,tied.length)), hidden=rest.length-shown.length;
  if(prim.length)main+='<section class="card"><div class="split" style="align-items:center"><span class="t-label">Outside target · '+out.length+' of '+prim.length+'</span>'+
    '<button class="btn btn--sm'+(EXON?' btn--ink':' btn--quiet')+'" type="button" data-fk="exsw" data-family="plum" role="switch" aria-checked="'+EXON+'"'+
    ' aria-label="Explain these in plain words"'+(EXON?'':' style="padding-right:0"')+' onclick="act.explain()">'+(EXON?'Explaining':'Explain these')+'</button></div>';
  if(prim.length){
    if(!rest.length)main+='<p class="t-body" style="margin-top:var(--s2)">'+(out.length?'Only the one above sits outside its target on the '+esc(s.lens)+' view.':'Everything sits inside its target on the '+esc(s.lens)+' view.')+'</p>';
    else main+='<div class="rows">'+shown.map(m=>markerRow(m,by[m.marker],'m:')).join('')+'</div>';
    if(hidden>0||ATTNALL)main+='<button class="btn" type="button" data-fk="attnall" style="width:100%;margin-top:var(--s4)" onclick="act.attnAll()">'+
      (ATTNALL?'Show fewer':hidden+' more outside target, by how far out')+'</button>';
    main+='<p class="t-note" style="margin-top:var(--s3)">Judged on the '+esc(s.lens)+' view · '+s.draws.length+' draws · last '+esc(s.last_draw||'date not recorded')+'</p></section>';
  }

  if(s.draws.length>=2)main+=sinceCard(prim,by,s);

  if(comp.length){const cOut=comp.filter(m=>m.vs_target==='above'||m.vs_target==='below').length;
    main+='<section class="card"><span class="t-label">Computed ratios · '+cOut+' of '+comp.length+' out</span><div class="rows">'+
      comp.map(m=>markerRow(m,by[m.marker],'c:')).join('')+'</div>'+
      '<p class="t-note" style="margin-top:var(--s3)">Never ordered, always derived: recomputed every time this opens, so correcting a reported value updates them. None appear on a draw order, because you never ask a lab for a ratio.</p></section>';}

  const panels=[];
  prim.forEach(m=>{const k=m.panel||'Other';if(panels.indexOf(k)<0)panels.push(k);});
  if(prim.length)main+='<section class="card"><div class="exp'+(ALLOPEN?' open':'')+'"><button class="row" type="button" data-fk="allmk" onclick="act.allMk()" aria-expanded="'+ALLOPEN+'" style="padding-top:0'+(ALLOPEN?'':';padding-bottom:0')+'">'+
    '<span class="row__body"><span class="row__title">All '+prim.length+' markers by panel</span><span class="row__meta">'+(prim.length-out.length)+' inside target · '+out.length+' outside · '+panels.length+' panels</span></span><span class="chev"></span></button></div>';
  if(ALLOPEN&&prim.length)panels.forEach(pn=>{
    const rows=prim.filter(m=>(m.panel||'Other')===pn), bad=rows.filter(m=>m.vs_target==='above'||m.vs_target==='below').length;
    main+='<div class="split" style="margin-top:var(--s4)"><span class="t-label">'+esc(pn)+'</span><span class="mono" style="color:var(--ink-3)">'+bad+' of '+rows.length+' out</span></div>'+
      '<div class="rows">'+rows.map(m=>markerRow(m,by[m.marker],'p:')).join('')+'</div>';});
  if(prim.length)main+='</section>';

  if(MK.diet){
    const d=MK.diet, keys=['kcal','protein_g','fiber_g','added_sugar_g','sat_fat_g','red_meat_slots','fish_slots','beans_slots']
      .filter(k=>k in d.targets&&!(COUNT_TAG[k]&&!d.targets[k]&&leavesOut([COUNT_TAG[k]],REG).length));   /* a count of nothing the plan has no food for is not a target */
    aside+='<section class="card card--tint" data-family="sprout"><span class="t-label">Your food targets now</span><div class="rows">';
    keys.forEach(k=>{const b=d.baseline[k],t=d.targets[k],changed=t!==b;
      const kc=k==='protein_g'?(d.conditions||[]).find(c=>c.id==='kidney'&&c.protein_limit_g):null;
      aside+='<div class="row"><span class="row__body"><span class="row__title">'+esc(tlabel(k))+'</span>'+
        '<span class="row__meta">'+(changed?'was '+esc(b)+esc(tunit(k))+', moved by '+esc(movedBy(d,k)):'as your plan was built')+
        (kc?' · your kidney limit on file: '+esc(fmt(kc.protein_limit_g))+' g':'')+'</span></span>'+
        '<b class="row__val">'+esc(t)+esc(tunit(k))+'</b></div>';});
    const conds=(d.conditions||[]).length?'<p class="t-note" style="margin-top:var(--s2)">'+esc(d.conditions.map(condLine).join(' '))+'</p>':'';
    const unheld=(d.unheld||[]).length?'<p class="t-note" style="margin-top:var(--s2)">'+esc(list(d.unheld.map(k=>TARGET_WORD[k]||k)).replace(/^\w/,c=>c.toUpperCase()))+(d.unheld.length>1?' are not targets':' is not a target')+' on '+esc(Plan())+': its plates are built without '+(d.unheld.length>1?'them':'it')+'.</p>':'';
    aside+='</div>'+conds+unheld+'<p class="t-note" style="margin-top:var(--s3)">'+(planStays()?'The rotation is built to hit these. On '+esc(Plan())+' a report is charted and dinner stays; the added-sugar cap is the one number a report can still tighten.'
      :'The rotation is built to hit these. A marker outside its target moves one of them, and the Rotation tab shows where that lands.')+'</p></section>';
  }

  /* the next draw: what to add to the order, and what it costs. Every test costs money. */
  const order=(p.sections||[]).find(x=>x.key==='order'), due=order?order.panels:[], mon=p.monitoring||[];
  const cost={};due.forEach(x=>{const c=x.cost||'';if(c)cost[c]=(cost[c]||0)+1;});
  const cl=['low','medium','high'].filter(k=>cost[k]).map(k=>cost[k]+' '+k);
  const nmk=due.reduce((n,x)=>n+((x.members||[]).length||1),0), gap=s.last_draw&&p.suggested_draw?monthsBetween(s.last_draw,p.suggested_draw):null;
  aside+='<section class="card card--tint" data-family="clay" id="ladder"><div style="display:flex;align-items:center;gap:var(--s4)">'+
    '<span class="chip chip--lg chip--round" style="background:color-mix(in srgb,var(--surface) 60%,transparent)">'+icon('bag')+'</span>'+
    '<div style="flex:1;min-width:0"><p class="t-head">Next draw'+(p.suggested_draw?' · '+esc(p.suggested_draw):'')+'</p>'+
    '<p class="t-note" style="color:var(--clay-ink)">'+(s.last_draw?(gap!=null?'About '+gap+' month'+(gap===1?'':'s')+' after your last draw, '+esc(s.last_draw)+', from the retest rules. ':'')
      :'No draw on record yet; the first one sets the clock. ')+
      due.length+' panel'+(due.length===1?'':'s')+', '+nmk+' marker'+(nmk===1?'':'s')+', to add to the order'+(due.length?': '+esc(due.map(x=>x.name).join(', ')):'')+'.'+
    (cl.length?' Cost: '+esc(cl.join(', '))+'.':'')+'</p></div></div>';
  mon.forEach(m=>{aside+='<p class="t-note" style="margin-top:var(--s3);color:var(--ink)"><b>'+esc(m.item)+'</b> · '+(m.overdue?'overdue at this draw':'monitoring')+(m.due?', due '+esc(m.due):'')+'</p>';});
  aside+='<div class="btnrow" style="margin-top:var(--s4)">'+addReportBtn()+'<button class="btn btn--sm" type="button" data-fk="godraw" onclick="act.mk(\'plan\')">See the draw plan '+icon('arrow')+'</button></div></section>';
  aside+='<p class="t-note" style="text-align:center;padding:var(--s2) var(--s5) 0">Numbers, ranges and which rule fired. No interpretation, no diagnosis, and nothing here is medical advice.</p>';

  /* nothing on file: one column, centred, never the invitation squeezed left of an empty main */
  if(!prim.length)return '<div class="stack stack--one"><div class="pile a-hero">'+top+main+aside+'</div></div>';
  return '<div class="stack"><div class="pile a-hero">'+top+'</div><div class="pile a-main">'+main+'</div><div class="pile a-aside">'+aside+'</div></div>';
}

/* ==========================================================================
   TONIGHT, ROTATION, KITCHEN
   ========================================================================== */
/* Tonight, in the system's parts: the one lit card is the meal, the two tint cards are the
   ways into the Kitchen, the recipe and the cold block are white cards of rows, the marker
   card is the Rotation's, and the one solid thing on the screen is the button that logs.
   Every number is a meal, a gram or a pack; nothing here is a day. */

/* a way in: a tint card that is a button, the number set large, a tap that goes somewhere */
function wayIn(fam,ico,label,num,unit,note,go){
  return '<button class="card card--tint" type="button" data-family="'+fam+'" data-fk="way:'+fam+'" onclick="'+go+'">'+
    '<span class="split"><span class="t-label">'+label+'</span><span class="chip chip--ontint">'+icon(ico)+'</span></span>'+
    '<span class="numrow" style="margin-top:var(--s4)"><b class="num num--lg">'+num+'</b><span class="t-unit">'+esc(unit)+'</span></span>'+
    '<span class="t-note" style="display:block;margin-top:var(--s1);color:var(--fam-ink)">'+note+'</span></button>';
}
/* a cold row: a well-shaped tick, the slot and what is in it, the grams, and on the plate
   itself the stepper that turns the slot. A tick tracks progress and moves no stock. */
function coldRow(c,pre,stepper){
  const on=S.checked.includes(c.id), id=pre+esc(c.id);
  /* an option the plan leaves out stays while its stock lasts, and says for how long */
  const off=(c.excluded&&c.excluded.length)?(() => {const n=staysFor(c);return 'not on your plan'+(n==null?'':n===0?', last time':', '+n+' more');})():'';
  return '<div class="row"><input class="tick tick--done" type="checkbox" id="'+id+'"'+(on?' checked':'')+
    ' data-fk="chk:'+esc(c.id)+'" onchange="act.toggle(\''+esc(c.id)+'\')">'+
    '<label class="row__body" for="'+id+'"><span class="row__title">'+esc(c.label)+'</span>'+
    ((c.name&&c.name!==c.id)||off?'<span class="row__meta">'+esc([c.name&&c.name!==c.id?c.name:'',off].filter(Boolean).join(' · '))+'</span>':'')+'</label>'+
    '<span class="row__val">'+c.kcal.toLocaleString()+' kcal · '+c.protein_g+' g</span>'+
    (stepper?'<span class="step2"><button class="iconbtn" type="button" data-fk="cyc:'+esc(c.id)+'" onclick="act.cycle(\''+esc(c.id)+'\')" '+
      'aria-label="Change this slot">'+icon('cycle')+'</button></span>':'')+'</div>';
}
/* Take out: a row per item the plate uses, with the amount the log will take and a stepper in
   the item's own step, so what leaves stock is what was used (his ask, 2026-09-06: "modify the
   amounts actually used right on the Tonight screen so that stock counts down appropriately").
   The recipe's amount stays in the row's meta once it differs. */
const STEP_OF={lb:0.25,oz:1,cups:0.5,tbsp:1};
const stepOf=k=>STEP_OF[I[k].unit]||1;
function takeOutRows(m){
  const ks=Object.keys(m.uses||{}).filter(k=>I[k]&&m.uses[k]!=null);if(!ks.length)return '';
  const changed=ks.some(k=>usedAmt(m,k)!==m.uses[k]);
  let h='<p class="t-note" style="margin-top:var(--s2)"><b>Take out.</b> Change an amount if you use more or less; the log takes what is set here.</p><div class="rows">';
  ks.forEach(k=>{const v=usedAmt(m,k), rec=m.uses[k];
    h+='<div class="row"><span class="row__body"><span class="row__title">'+esc(I[k].name)+'</span>'+
      (v!==rec?'<span class="row__meta">the recipe says '+esc(pqty(k,rec))+'</span>':'')+'</span>'+
      '<span class="row__val">'+esc(pqty(k,v))+'</span>'+
      '<span class="step2"><button class="iconbtn" type="button" data-fk="used-less:'+esc(k)+'" onclick="act.used(\''+esc(k)+'\',-1)" aria-label="Less '+esc(I[k].name)+'">'+icon('minus')+'</button>'+
      '<button class="iconbtn" type="button" data-fk="used-more:'+esc(k)+'" onclick="act.used(\''+esc(k)+'\',1)" aria-label="More '+esc(I[k].name)+'">'+icon('plus')+'</button></span></div>';});
  h+='</div>'+(changed?'<div class="btnrow" style="margin-top:var(--s2)"><button class="btn btn--sm" type="button" data-fk="used-reset" onclick="act.usedReset()">Back to the recipe</button></div>':'');
  return h;
}
/* What tonight's plate is of. "912 kcal on the plate" read as the whole day on his phone
   (2026-09-06), because nothing said dinner was one of three meals; so the line names the
   other occasions in play, adds today's options from their pools to the plate, and sets the
   day beside the target the plate was sized to. One meal a day: the cold block is the rest. */
function dayLine(m){
  const cold=coldAt(0), others=OCC.filter(o=>o.id!==ROT).map(o=>o.id);
  let kc=m.kcal, pr=m.protein_g;cold.forEach(c=>{kc+=c.kcal;pr+=c.protein_g;});
  const ex=extrasTotal(S.cursor);kc+=ex.kcal;pr+=ex.protein_g;
  const dt=(PLAN&&PLAN.day_targets)||{}, tgt=dt.kcal?', against your '+Math.round(dt.kcal).toLocaleString()+' a day':'';
  const also=ex.count?' Also had so far today: '+(ex.kcal||ex.protein_g?'about '+ex.kcal.toLocaleString()+' kcal and '+ex.protein_g+' g protein, counted in above':'not priced, counted in stock and not on the day')+
    (ex.unpriced&&(ex.kcal||ex.protein_g)?' (except '+ex.unpriced+' item'+(ex.unpriced===1?'':'s')+' this home carries no figures for)':'')+'.':'';
  /* a kidney limit on file sits beside the day's protein, where a person reads it, not as a
     last sentence after everything else (his report, 2026-09-08: "where does the 60 show?") */
  const kc2=CONDS.find(c=>c.id==='kidney'&&c.protein_limit_g), klim=kc2?' (your kidney limit on file: '+fmt(kc2.protein_limit_g)+' g)':'';
  const sum='about '+kc.toLocaleString()+' kcal and '+pr+' g protein';
  if(!others.length)return 'Tonight is your one meal of the day'+(cold.length?', with what you eat beside it: ':': ')+sum+klim+tgt+'.'+also;
  return 'Tonight is '+occName(ROT).toLowerCase()+', one of '+NUMWORD[OCC.length]+' today. With today\'s '+list(others.map(o=>occName(o).toLowerCase()))+': '+sum+' for the day'+klim+tgt+'.'+also;
}
/* the same running total, for a day already logged: the Last-logged card names every extra
   added since, not just the most recent one xRow shows */
function logDayLine(cur){
  const ex=extrasTotal(cur);
  if(!ex.count)return '';
  return 'Also had today: '+(ex.kcal||ex.protein_g?'about '+ex.kcal.toLocaleString()+' kcal and '+ex.protein_g+' g protein':'not priced, counted in stock and not on the day')+
    (ex.unpriced&&(ex.kcal||ex.protein_g)?' (except '+ex.unpriced+' item'+(ex.unpriced===1?'':'s')+' this home carries no figures for)':'')+'.';
}
const statBox=(label,num,unit)=>'<div class="stat"><span class="t-label">'+esc(label)+'</span><span class="numrow"><b class="num num--md">'+num+'</b>'+
  (unit?'<span class="t-unit">'+esc(unit)+'</span>':'')+'</span></div>';

/* the drawn plate for a meal: the base and the mark of its protein family, the family colour on
   the svg itself. red_meat is beef, fish and shellfish are fish, plant and pantry are beans. */
const PLATEMARK={red_meat:'beef',fish:'fish',shellfish:'fish',poultry:'poultry',pork:'pork',plant:'beans',pantry:'beans',egg:'egg',dairy:'dairy'};
const plateArt=(m,cls)=>'<svg class="mp'+(cls?' '+cls:'')+'" data-family="'+famOf(m)+'" aria-hidden="true"><use href="#mp-base"/><use href="#mark-'+(PLATEMARK[m.protein_class]||'beans')+'"/></svg>';
/* BEFORE YOU COOK — the one blocker, only when something tonight's plate needs is not on hand:
   what is missing and the run that brings it, above the plate. On a first run, when nothing is
   on the shelf at all, it says so in one line. Never a task count, never the lab report. */
function beforeCard(F,m){
  if(planB||partial)return '';
  const ks=Object.keys(m.uses||{}).filter(k=>I[k]&&m.uses[k]>0&&(S.inv[k]||0)<=0);
  if(!ks.length)return '';
  const every=Object.keys(m.uses||{}).filter(k=>I[k]).every(k=>(S.inv[k]||0)<=0);
  const st=storeOf(ks[0])||countdownStore(), buy=st?need(F,st):[];
  return '<section class="card card--tint before" data-family="clay" id="before"><span class="chip chip--ontint">'+icon('bag')+'</span><span class="row__body">'+
    '<span class="t-label">Before you cook</span>'+
    '<p class="t-body" style="margin-top:var(--s1);color:var(--ink)">'+(every?'Nothing for this plate is on the shelf yet. ':esc(list(ks.map(k=>I[k].name.toLowerCase())))+(ks.length===1?' is':' are')+' not on hand. ')+
    (st?'<b>'+esc(st.name)+' run</b>'+(buy.length?' · '+buy.length+' to buy':''):'')+'</p>'+
    (st?'<div class="btnrow" style="margin-top:var(--s2)"><button class="btn btn--sm btn--ink" type="button" data-fk="before:shop" onclick="act.tab(\'kitchen\');act.jumpK(\'k-store-'+esc(st.key)+'\')">Open the list</button></div>':'')+'</span></section>';
}
/* KEEP IT — how the link becomes an app, said once, after the first plate is logged rather than
   on the first screen; the You tab keeps the line for good. */
function installCard(){
  if(!(LOCAL&&!standalone())||S.cursor<1||S.seen.includes('install_note'))return '';
  return '<section class="card card--tint" data-family="sprout" id="installcard"><span class="t-head" style="display:block">Keep it on your phone</span>'+
    '<p class="t-note" style="margin-top:var(--s1)">'+esc(INSTALL)+'</p>'+
    '<button class="btn btn--sm btn--ink" type="button" data-fk="installseen" onclick="act.installSeen()" style="margin-top:var(--s3)">Got it</button></section>';
}
function viewTonight(F){
  const m=activeMeal(), nx=mealAt(1), kit=planB?null:kitAt(0), ct=coldTot(0,ROT);
  const run=runIn(F), cs=countdownStore(), st=run.d<=2?'now':run.d<=6?'watch':'';
  /* the plate first (the review: Tonight should start with tonight's meal), a blocker above it
     only when the plate cannot be cooked as it stands; the due list, the tiles and the report
     invitation sit below the log, out of the way and out of any count */
  let top=beforeCard(F,m), main='', aside='';

  top+='<section class="card card--lit hero" id="hero" data-family="sprout" aria-label="Tonight"><div class="hero-plate">'+plateArt(m,'mp--lg')+'</div><div class="hero-in">'+
    '<div class="hero-eyebrow"><span class="pip"></span><span>'+
      (planB?'Plan B — the freezer stays sealed':'Tonight — '+(cookingFor(occPortions(ROT))?cookingFor(occPortions(ROT))+', ':'')+'into the '+esc(EQUIP[m.equipment]?EQUIP[m.equipment].name:'oven'))+'</span></div>'+
    '<h1 class="mealname">'+esc(m.name)+'</h1>'+
    '<p class="mealsub">'+esc(m.sub||((m.mode||'')+', '+(m.form||'').toLowerCase()))+
      (kit?', with '+esc(kit.name.toLowerCase()):'')+'</p>'+
    '<div class="readout">'+
      '<div><div class="v">'+(m.temp_f==null?'—':m.temp_f)+(m.temp_f==null?'':'<span class="u">°F</span>')+'</div><div class="k">Temp</div></div>'+
      '<div><div class="v">'+(m.equipment?timeParts(m.minutes)[0]:'—')+'<span class="u">'+(m.equipment?timeParts(m.minutes)[1]:'min')+'</span></div><div class="k">Time</div></div>'+
      '<div><div class="v word">'+esc(m.mode)+'</div><div class="k">Mode</div></div>'+
    '</div>'+(m.why_not?'<p class="mealsub">Not for this kitchen as written: '+esc(m.why_not)+'.</p>':'')+
    (m.excluded&&m.excluded.length?'<p class="mealsub">'+esc(notOn(m))+' '+esc(staysLine(m))+'</p>':'')+
    '</div></section>';

  top+=noteCard();
  top+=installCard();
  if(CFG.plate_step)top+=plateCard(CFG.plate_step);
  let after='';
  /* everything also had, each with its figures: today's under its own card whether Tonight has
     been cooked yet or not (his ask, Phase 14: Ate it all should not end the chance to add one
     more thing), and the day just closed under its Last-logged row. His report, 2026-09-08: only
     the last entry ever showed, a second replaced the first, Undo blanked the row, and after Ate
     it all an entry for the current day showed nowhere. Undo sits on the last entry while it is
     the last thing logged; every other entry that carries its stamp has its own Remove (Phase
     18); an entry from before entries carried a name reads as one from stock, with no button. */
  const X=(S.last&&S.last.kind==='extra')?S.last:null;
  const xRows=cur=>{const ex=extrasFor(cur);return ex.map((x,i)=>{const last=X&&(x.at?X.at===x.at:(X.cursor===cur&&i===ex.length-1));
    const figs=x.kcal!=null?Math.round(x.kcal).toLocaleString()+' kcal · '+x.protein_g+' g protein':'no figures, so counted in stock and not on the day';
    return '<div class="row"><span class="row__body"><span class="row__title">Also had: '+esc(x.label||'something from stock')+(x.occ?', with '+esc(occName(x.occ).toLowerCase()):'')+'</span>'+
      '<span class="row__meta">'+esc(figs)+'</span></span>'+
      (last?'<button class="btn btn--sm" type="button" data-fk="undolog" onclick="act.undoLog()">Undo</button>'
        :x.at?'<button class="btn btn--sm" type="button" data-fk="xremove:'+esc(x.at)+'" onclick="act.removeExtra(\''+esc(x.at)+'\')">Remove</button>':'')+'</div>';}).join('');};
  const xNote=(cur,inset)=>{const ex=extrasFor(cur);if(!ex.length)return '';
    return '<p class="t-note" style="'+(inset?'margin:var(--s2) var(--s5) 0':'margin-top:var(--s2)')+'">'+(ex.length>1?esc(logDayLine(cur))+' ':'')+'Outside the plan; the rotation did not move.</p>';};
  if(extrasFor(S.cursor).length){
    after+='<section class="card" id="also-had-today"><span class="t-label">Also had today</span><div class="rows" style="margin-top:var(--s1)">'+xRows(S.cursor)+'</div>'+xNote(S.cursor,false)+'</section>';
  }
  if(S.cursor>0){
    /* the last log, and the one way back. No clock on it: the meal log on the Mac keeps the
       real stamp, because that is the record, and this screen is the planner. With no snapshot
       (a log from before undo existed, or a second undo) the kind is a guess, so it says
       "assumed"; the undo itself says it put the stock back as if the whole plate was eaten.
       Undo only ever undoes the single most recent thing, so it sits on whichever row that is:
       the last extra when one was logged since, the meal itself otherwise. */
    const L=(S.last&&S.last.cursor===S.cursor-1&&S.last.kind!=='extra')?S.last:null, pm=L?L:{meal:mealAt(-1).name,kind:'full'};
    const how=pm.kind==='partial'?'In part':pm.kind==='plan_b'?'As Plan B':'Ate it all';
    after+='<section class="card" style="padding:0 var(--s5) var(--s2)"><div class="rows"><div class="row">'+
      '<span class="row__body"><span class="row__title">Last logged: '+esc(pm.meal)+'</span>'+
      '<span class="row__meta">'+how+(L?'':' · assumed')+'</span></span>'+
      (X?'':'<button class="btn btn--sm" type="button" data-fk="undolog" onclick="act.undoLog()">Undo</button>')+'</div>'+
      xRows(S.cursor-1)+'</div>'+xNote(S.cursor-1,true)+
      '<div class="btnrow" style="margin:var(--s3) var(--s5) 0"><button class="btn" type="button" data-fk="extraprev" onclick="act.openExtra(true)">Also had</button></div></section>';
  }

  /* the two ways into the Kitchen, each the engine's own number and the same one the Kitchen
     prints: how far the stock reaches, and the countdown store's list */
  const buy=need(F,cs);
  after+=nowCard(F);
  after+='<div class="tiles">'+
    wayIn('frost','frost','Stock',run.d>=H?H+'+':run.d,'meals',
      run.k?esc(I[run.k].name)+(F.L[run.k]<=0?' is out':' runs out first'):'Nothing runs short inside '+H+' meals',
      "act.tab('kitchen')")+
    wayIn('clay','bag',esc(cs.name)+' run',buy.length,'to buy',
      buy.length?'Build the list'+(st==='now'?' now':'')+' · '+nMeals(run.d):'Nothing needed yet · the list opens at '+(cs.threshold||21)+' meals of supply',
      "act.tab('kitchen');act.jumpK('k-store-"+esc(cs.key)+"')")+'</div>';

  if(!partial){
    const ho=m.hands_on!=null?m.hands_on:BUDGET;   /* the meal's own timing, else the budget it was built inside */
    const meta=[cookingFor(occPortions(ROT)),plateWord(),ho!=null?ho+' min hands on':''].filter(Boolean).join(' · ');
    main+='<section class="card"><div class="split"><span class="t-label">How it cooks</span>'+
      (meta?'<span class="mono" style="color:var(--ink-3)">'+esc(meta)+'</span>':'')+'</div>'+
      takeOutRows(m)+
      (m.tray?'<p class="tray">'+esc(m.tray)+'</p>':'')+'<ol class="steps">';
    (m.steps||[]).forEach(x=>{main+='<li><p>'+esc(stepText(m,x))+'</p></li>';});
    if(kit)main+='<li><p><b>'+esc(kit.name)+'.</b> '+esc(kit.instruction)+'</p></li>';
    main+='</ol></section>';

    /* The rotation occasion's pools keep the card they have always had; any other occasion is
       its own card, headed by its name. With one occasion nothing new is printed. */
    let occNow=null;
    coldAt(0).forEach(c=>{
      if(c.occ!==occNow){
        if(occNow!==null)main+='</div></section>';
        occNow=c.occ;
        main+='<section class="card" data-family="frost"><div class="split"><span class="t-label">'+
          (c.occ===ROT?'Beside the plate':esc(occName(c.occ)))+'</span>'+
          '<span class="mono" style="color:var(--ink-3)">'+esc([cookingFor(occPortions(c.occ)),c.occ===ROT?'eat while it cooks':'its own rotation'].filter(Boolean).join(' · '))+'</span></div>'+
          (c.occ===ROT?'<p class="t-note" style="margin-top:var(--s2)">Ticks here track progress and do not change your stock. '+
            'Use <b>Log what I ate</b> if you only had some of it.</p>':'')+'<div class="rows">';
      }
      main+=coldRow(c,'cb-',true);
    });
    if(occNow!==null)main+='</div></section>';

    main+='<section class="card card--tint" data-family="frost" id="thawcard" style="display:flex;gap:var(--s4);align-items:flex-start">'+
      '<span class="chip chip--ontint">'+icon(nx.thaw?'frost':'check')+'</span><div style="flex:1;min-width:0">'+
      '<span class="t-label">'+(nx.thaw?'Move to the fridge after this':'Nothing to thaw')+'</span>'+
      '<p class="t-body" style="margin-top:var(--s1);color:var(--ink)">'+(nx.thaw?'<b>'+esc(I[nx.thaw]?I[nx.thaw].name:nx.thaw)+'.</b> Next up is '+esc(nx.name.toLowerCase())+'.'
        :'Next up is '+esc(nx.name.toLowerCase())+'. It cooks straight from frozen.')+'</p></div></section>';

    aside+='<section class="card"><div class="stats stats--2">'+
      statBox('kcal on the plate',(m.kcal+ct.c).toLocaleString(),'')+statBox('Protein',m.protein_g+ct.p,'g')+'</div>'+
      '<p class="t-note" style="margin-top:var(--s3)">'+esc(dayLine(m))+'</p>'+
      '<div class="actions" style="margin-top:var(--s4)">'+
      '<button class="btn btn-eat" data-fk="eat" onclick="act.cooked()">Ate it all</button>'+
      '<div class="btnrow"><button class="btn" data-fk="partial" onclick="act.openPartial()">Log what I ate</button>'+
      '<button class="btn" data-fk="trade" onclick="act.swap()">Trade with next</button></div>'+
      '<button class="btn" data-fk="extra" onclick="act.openExtra()">Also had</button>'+
      (TRADED?'<div class="undoline arrive" data-family="frost"><span>Traded with '+esc(TRADED)+'. What you eat beside it did not move; '+
        'it rotates on its own.</span>'+
        '<button class="btn btn--sm btn--ink" type="button" data-fk="untrade" onclick="act.unswap()">Undo</button></div>':'')+
      (PLANB&&!planB?'<button class="btn" data-fk="planb" onclick="act.planB(true)">Nothing thawed? '+esc(PLANB.name)+'</button>':'')+
      (planB?'<button class="btn" data-fk="planb" onclick="act.planB(false)">Back to the planned meal</button>':'')+
      '</div><p class="t-note" style="margin-top:var(--s3)">'+esc(nextGoal(F))+'</p>'+
      '<p class="t-note" style="margin-top:var(--s2)">Ate out? Nothing to log. Tonight\'s plate waits, and a night not logged costs nothing.</p></section>';
    aside+=after;
    aside+=whyCard(F,{label:whyLabel(),rail:true});
    aside+=reportCard();
    if(EXTRA){const xo=extraFrom(XAMT), xs=extraItems(), one=extraOptions(EXTRAAT===S.cursor-1)[0];
      aside+='<section class="card" id="extra-card" data-family="sprout"><span class="t-label">Also had</span>'+
      '<p class="t-note" style="margin:var(--s2) 0 var(--s1)">Something outside tonight\'s plate: on hand, anything else your plan keeps, or something else entirely. It counts on the day; the rotation does not move.</p>'+
      (OCC.length>1?'<div class="seg" role="radiogroup" aria-label="With which meal" style="margin:var(--s2) 0">'+
        OCC.map(o=>'<button type="button" role="radio" data-fk="extraocc:'+o.id+'" aria-checked="'+(EXTRAOCC===o.id)+'" onclick="act.extraOcc(\''+o.id+'\')">'+esc(occName(o.id))+'</button>').join('')+'</div>':'')+
      '<button class="row" type="button" data-fk="extra:'+esc(one.key)+'" onclick="act.extra(\''+esc(one.key)+'\')"><span class="row__body"><span class="row__title">'+esc(one.label)+'</span>'+
        '<span class="row__meta">'+Number(one.kcal).toLocaleString()+' kcal · '+one.protein_g+' g protein</span></span>'+icon('arrow')+'</button>'+
      /* by amount: a row per item, a stepper in the item's own step, one log for what was set
         (his ask: one more egg is one egg, not another three). On hand first, stock the truth
         whatever the plan thinks; then everything else the plan, the chips and a condition on
         the history still keep, so a fresh kitchen is not offered an empty card. */
      (xs.on_hand.length?'<span class="t-label" style="display:block;margin-top:var(--s5)">On hand</span>'+
        '<p class="t-note" style="margin:var(--s2) 0 var(--s1)">Anything on hand, in its own step: one egg, half a cup, a quarter pound.</p>'+
        '<div class="rows">'+xs.on_hand.map(amtRow).join('')+'</div>':'')+
      (xs.kept.length?'<span class="t-label" style="display:block;margin-top:var(--s5)">Everything else your plan keeps</span>'+
        '<p class="t-note" style="margin:var(--s2) 0 var(--s1)">Nothing bought yet through this app, but nothing your plan rules out either. Set what you had, then log it.</p>'+
        '<div class="rows">'+xs.kept.map(amtRow).join('')+'</div>':'')+
      (xo?'<p class="t-note" style="margin-top:var(--s3)"><b>'+esc(xo.label)+'.</b> '+(xo.priced?Number(xo.kcal).toLocaleString()+' kcal · '+xo.protein_g+' g protein.':'Counted in stock, not on the day: the items on this home carry no figures.')+'</p>'+
        '<div class="btnrow" style="margin-top:var(--s2)"><button class="btn btn--ink" type="button" data-fk="xamt-log" onclick="act.extraLog()">Log what you set</button></div>':'')+
      /* something the catalog does not hold at all: a name and, if known, its own numbers */
      '<span class="t-label" style="display:block;margin-top:var(--s5)">Something else</span>'+
      '<p class="t-note" style="margin:var(--s2) 0 var(--s1)">Not on this home at all. Name it; the numbers are yours to give if you know them.</p>'+
      '<div class="formgrid"><div class="field wide"><span>What it was</span><input type="text" id="xfree-name" data-fk="xfree-name" autocomplete="off"></div>'+
      '<div class="field"><span>Kcal</span><input type="number" id="xfree-kcal" data-fk="xfree-kcal" inputmode="numeric" min="0" step="any"></div>'+
      '<div class="field"><span>Protein, g</span><input type="number" id="xfree-protein_g" data-fk="xfree-protein_g" inputmode="numeric" min="0" step="any"></div></div>'+
      (XFMSG?'<p class="t-note" style="margin-top:var(--s2)">'+esc(XFMSG)+'</p>':'')+
      '<div class="btnrow" style="margin-top:var(--s2)"><button class="btn btn--ink" type="button" data-fk="xfree-log" onclick="act.extraFreeLog()">Log it</button></div>'+
      '<div class="btnrow" style="margin-top:var(--s3)"><button class="btn" data-fk="extraback" onclick="act.closeExtra()">Back</button></div></section>';}
  } else {
    let pc=pOven?m.kcal:0, pp=pOven?m.protein_g:0;
    coldAt(0).forEach(c=>{if(S.checked.includes(c.id)){pc+=c.kcal;pp+=c.protein_g;}});
    main+='<section class="card" id="partial-card" data-family="frost"><span class="t-label">Tick only what you ate</span><div class="rows">'+
      '<div class="row"><input class="tick tick--done" type="checkbox" id="cb-oven"'+(pOven?' checked':'')+' data-fk="oven" onchange="act.toggleOven()">'+
      '<label class="row__body" for="cb-oven"><span class="row__title">'+esc(m.name)+'</span></label>'+
      '<span class="row__val">'+m.protein_g+' g</span></div>';
    let occTick=ROT;
    coldAt(0).forEach(c=>{
      if(c.occ!==occTick){occTick=c.occ;main+='<div class="row"><span class="row__body"><span class="t-label">'+esc(occName(c.occ))+'</span></span></div>';}
      main+=coldRow(c,'cp-',false);
    });
    main+='</div><div class="stats stats--2" style="margin-top:var(--s4)">'+
      statBox('kcal ticked',pc.toLocaleString(),'')+statBox('Protein',pp,'g')+'</div>'+
      '<p class="t-note" style="margin-top:var(--s3)">Only what is ticked leaves your stock. Restaurant food was never in your pantry.</p>'+
      '<div class="actions" style="margin-top:var(--s4)"><button class="btn btn-eat" data-fk="logpart" onclick="act.logPartial()">Log it</button>'+
      '<button class="btn" data-fk="cancel" onclick="act.cancelPartial()">Back</button></div></section>';
    aside+=after;
  }
  return '<div class="stack"><div class="pile a-hero">'+top+'</div><div class="pile a-main">'+main+'</div><div class="pile a-aside">'+aside+'</div></div>';
}

/* ---- ALSO DUE: what else the loop asks for, below the plate and the log. A store run while
   its list is open, with the count; the thaw for the next meal; the plate step while the scale
   proposes one; the dinners lined up to change. Each line is a tap to its control, and when
   nothing is due it says so. Nothing on it is a clock: every line is a list, a meal or a fact
   on file. The plate is the line that never leaves, which is why it is not listed, and the lab
   report is optional, which is why it is not counted here (its own invitation sits lower).
   Phase 22: this card led the screen once (the review: tasks dominated dinner); a blocker above
   the plate now says the one thing that has to happen before cooking. -------------------- */
function nowCard(F){
  const rows=[];
  SORDER.forEach(sk=>{const st=STORES[sk],items=need(F,st);if(!items.length)return;
    const first=items.every(k=>(S.inv[k]||0)===0), k0=items[0];
    rows.push({ico:'bag',fam:'clay',fk:'now:shop:'+sk,go:"act.tab('kitchen');act.jumpK('k-store-"+esc(sk)+"')",
      title:esc(st.name)+' run · '+items.length+' to buy',
      meta:first?'Nothing on the shelf yet. Shop this first, then cook.':esc(I[k0].name)+(F.L[k0]<=0?' is out.':' runs out first.')});});
  const nx=mealAt(1);
  if(nx.thaw&&!planB)rows.push({ico:'frost',fam:'frost',fk:'now:thaw',go:"act.jumpK('thawcard')",
    title:'Move '+esc(I[nx.thaw]?I[nx.thaw].name.toLowerCase():nx.thaw)+' to the fridge',
    meta:'After tonight. Next up is '+esc(nx.name.toLowerCase())+'.'});
  if(CFG.plate_step)rows.push({ico:'check',fam:'sprout',fk:'now:plate',go:"act.jumpK('platecard')",
    title:'The scale stepped the plate',meta:'Read what changed. Undo if you want it back.'});
  const swapsLive=SWAPS.filter(s=>S.order.includes(s.from)&&S.pending[s.key]!=null);
  if(swapsLive.length)rows.push({ico:'sprout',fam:'sprout',fk:'now:swap',go:"act.tab('rotation')",
    title:swapsLive.length+' dinner'+(swapsLive.length===1?'':'s')+' lined up to change',meta:gateLine()});
  let h='<section class="card" id="now" aria-label="Also due"><div class="split"><span class="t-label">Also due</span>'+
    '<span class="mono" style="color:var(--ink-3)">'+(rows.length?rows.length+' thing'+(rows.length===1?'':'s')+' due':'in order')+'</span></div>';
  if(!rows.length)return h+'<p class="t-body" style="margin-top:var(--s2);color:var(--ink)">Nothing due but dinner.</p></section>';
  h+='<div class="rows" style="margin-top:var(--s1)">'+rows.map(r=>'<button class="row" type="button" data-fk="'+esc(r.fk)+'" onclick="'+r.go+'">'+
    '<span class="chip chip--round" data-family="'+r.fam+'">'+icon(r.ico)+'</span>'+
    '<span class="row__body"><span class="row__title">'+r.title+'</span><span class="row__meta">'+r.meta+'</span></span>'+icon('arrow')+'</button>').join('')+'</div>';
  return h+'</section>';
}

/* The rotation, in the system's parts: one lit card that says where you are and carries the
   strip, a card of rows that open in place, and a tinted card that says why the sequence looks
   the way it does. Every number is a meal or a cycle. No date and no clock live here (spec §7). */
/* A thumb's colour is the protein the rotation counts, and the row says the word beside it,
   so the colour can be read: beef is ember, fish and shellfish are frost, plant and bean plates
   are sprout, poultry is clay, pork is plum. It used to be the plate's shape in file order,
   which nobody could tell from looking. */
const PROTFAM={red_meat:'ember',pork:'plum',poultry:'clay',fish:'frost',shellfish:'frost',plant:'sprout',egg:'sprout',dairy:'sprout',pantry:'sprout'};
const PROTWORD={red_meat:'beef',pork:'pork',poultry:'poultry',fish:'fish',shellfish:'shellfish',plant:'plant-based',egg:'eggs',dairy:'dairy',pantry:'no thaw'};
const famOf=m=>PROTFAM[m.protein_class]||'sprout';
/* The food-group note under the rotation: one group that lands three or more times on a night
   whatever the cold block draws. The engine counts it in both twins; the page only says it. */
const TAGWORD={beef:'beef',pork:'pork',poultry:'poultry',fish:'fish',shellfish:'shellfish',dairy:'dairy',egg:'eggs',beans:'beans',grain:'grain',potato:'potato',fruit:'fruit',nuts:'nuts',vegetable:'vegetables',soy:'soy',gluten:'gluten',spice:'dry spices',sauce:'sauces and condiments',sugar:'sugar',sweet:'sweet flavourings',purine:'purine-rich food',vegetarian:'a plant-only dinner',vegan:'a vegan dinner',substitute:'a meat substitute'};
const tagWords=ts=>list((ts||[]).map(t=>TAGWORD[t]||t));
const NUMWORD=['no','one','two','three','four','five','six','seven','eight','nine'];
function groupLine(g){
  const word=TAGWORD[g.tag]||g.tag, parts=(g.slots||[]).map(s=>'the '+String(s).split(' — ')[0].toLowerCase());
  if(g.items&&g.items.length)parts.push('the '+list(g.items.map(x=>String(x).toLowerCase()))+' on the plate');
  return word.replace(/^\w/,c=>c.toUpperCase())+' lands '+(NUMWORD[g.times]||g.times)+' times '+(g.nights===g.of?'every night':'on '+g.nights+' of '+g.of+' nights')+': '+list(parts)+'. Nothing in your targets counts it; it is here so you can see it.';
}
const protWord=m=>PROTWORD[m.protein_class]||'';
const ord=n=>n+(['th','st','nd','rd'][(n%100>10&&n%100<14)?0:(n%10<4?n%10:0)]);

/* the passport: how many of the rotation's plates have been cooked at least once, and each
   plate's stamp count on its row. A plate cooked is a fact in the log; nothing here is praise. */
const stampsOf=id=>(S.tally&&S.tally[id])||0;
function passportLine(){const ids=S.order.filter(id=>MEALS[id]),done=ids.filter(id=>stampsOf(id)>0).length;
  return done?done+' of the '+ids.length+' plates cooked at least once.':'No plate cooked yet; each one is stamped the night it is.';}
const stampWord=n=>n===1?'cooked once':'cooked '+n+' times';
/* seven meals around tonight: the ones already logged sit behind, the current one is the deep fill */
function strip(){
  const cur=S.cursor+1, w0=Math.max(1,cur-3);
  let h='<div class="strip strip--meals strip--onlit" data-family="sprout" role="group" aria-label="The rotation from here">';
  for(let m=w0;m<w0+7;m++){const d=m-cur;
    if(d<0)h+='<button type="button" disabled data-logged aria-label="Meal '+m+', logged"><b>'+m+'</b></button>';
    else h+='<button type="button" data-fk="strip:'+m+'"'+(d===0?' aria-current="step"':'')+
      ' aria-label="Meal '+m+(d===0?', tonight':'')+'" onclick="act.jumpRot('+d+')"><b>'+m+'</b></button>';}
  return h+'</div>';
}

function rotRow(F,i){
  const x=MEALS[F.seq[i]]||mealAt(i), xk=kitFor(x,i), was=MEALS[S.order[posAt(i)]];
  const changed=was&&was.id!==x.id, sw=changed?SWAPS.find(s=>s.from===was.id&&s.to===x.id):null;
  const pend=changed?[]:SWAPS.filter(s=>s.from===x.id&&S.pending[s.key]>0);
  const open=OPEN==='r'+i, ct=coldTot(i,ROT), n=S.cursor+1+i;
  const st=stampsOf(x.id);
  const meta='Meal '+n+(protWord(x)?' · '+esc(protWord(x)):'')+' · '+(x.equipment?esc(x.mode||'')+(x.temp_f!=null?' '+x.temp_f+'°':'')+' · '+timeParts(x.minutes).join(' '):'not for this kitchen')+(st?' · '+stampWord(st):'');
  let note='';
  if(changed)note='Was '+was.name+'. The '+((sw&&(sw.gate_name||sw.gate_item))||'stock')+' runs out before this, so your labs take the slot.';
  else if(pend.length)note='Becomes '+pend[0].to_name+' once the '+(pend[0].gate_name||pend[0].gate_item)+' is gone.';
  else if(x.excluded&&x.excluded.length)note=notOn(x)+' '+staysLine(x);
  else if(x.why_not)note='Not for this kitchen as written: '+x.why_not+'.';
  let pill='';
  if(i===0)pill='<span class="pill" data-family="sprout"><i class="dot"></i>tonight</span>';
  else if(changed||pend.length)pill='<span class="pill" data-family="plum"><i class="dot"></i>'+(changed?'from your labs':'swap waiting')+'</span>';
  else if(x.excluded&&x.excluded.length)pill='<span class="pill" data-family="ember"><i class="dot"></i>not on your plan</span>';
  else if(x.why_not)pill='<span class="pill" data-family="ember"><i class="dot"></i>kitchen</span>';
  else if(x.thaw)pill='<span class="pill" data-family="frost"><i class="dot"></i>thaw</span>';
  const uses=Object.entries(x.uses||{}).map(([k,v])=>plabel(k,v)).join(', ');
  return '<div class="exp'+(open?' open':'')+'">'+
    '<button class="row" type="button" data-fk="rot:'+i+'" onclick="act.open(\'r'+i+'\')" aria-expanded="'+open+'">'+
      '<span class="row__thumb" data-family="'+famOf(x)+'">'+plateArt(x)+(st?'<span class="stampn" aria-hidden="true">'+st+'</span>':'')+'</span>'+
      '<span class="row__body"><span class="row__title">'+esc(x.name)+'</span><span class="row__meta">'+meta+'</span>'+
      (note?'<span class="row__note">'+esc(note)+'</span>':'')+'</span>'+pill+'<span class="chev"></span></button>'+
    '<div class="exp-b"><div><div class="rot__in">'+
      '<div class="stats">'+
        '<div class="stat"><span class="t-label">Temp</span><span class="numrow"><b class="num num--md">'+(x.temp_f==null?'—':x.temp_f)+'</b>'+(x.temp_f==null?'':'<span class="t-unit">°F</span>')+'</span></div>'+
        '<div class="stat"><span class="t-label">Time</span><span class="numrow"><b class="num num--md">'+(x.equipment?timeParts(x.minutes)[0]:'—')+'</b><span class="t-unit">'+(x.equipment?timeParts(x.minutes)[1]:'min')+'</span></span></div>'+
        '<div class="stat"><span class="t-label">Mode</span><span class="numrow"><b class="num num--md word">'+esc(x.mode||'—')+'</b></span></div>'+
      '</div><dl class="facts">'+
        (xk?'<dt>Flavour</dt><dd><b>'+esc(xk.name)+'.</b> '+esc(xk.instruction)+'</dd>':'')+
        '<dt>Uses</dt><dd>'+esc(uses)+'</dd>'+
        '<dt>Beside it</dt><dd>'+esc(coldAt(i,ROT).map(c=>c.label).join(', ')||'none: put away beside your other meals')+'</dd>'+
        '<dt>Macros</dt><dd><b>'+(x.kcal+ct.c).toLocaleString()+'</b> kcal, <b>'+(x.protein_g+ct.p)+'</b> g protein'+(ct.c?' with what is beside it':'')+'</dd>'+
        (x.tray?'<dt>Tray</dt><dd>'+esc(x.tray)+'</dd>':'')+
        (x.thaw?'<dt>Thaw</dt><dd>'+esc(I[x.thaw]?I[x.thaw].name:x.thaw)+', the meal before</dd>':'')+
        '<dt>Shape</dt><dd>'+esc(x.form||'Plate')+'</dd>'+
      '</dl>'+
      (i>0?'<button class="btn btn--ink" type="button" data-fk="cook:'+i+'" onclick="act.cook('+i+')">Cook this tonight instead</button>':'')+
    '</div></div></div></div>';
}

/* what the labs asked of the sequence, in one tinted card; the rows above show where it lands */
/* Why the rotation looks like this, in the markers family. The Rotation carries it in its
   aside; Tonight carries it as "From your markers" with the gate rail. One card, so the two
   tabs cannot say different things about the same swap. */
function whyCard(F,opt){
  opt=opt||{};
  let h='<section class="card card--tint'+(opt.cls?' '+opt.cls:'')+'" data-family="plum"><span class="t-label">'+esc(opt.label||'Why the rotation looks like this')+'</span>';
  const left=(PLAN&&PLAN.unplaced)||[], short=(PLAN&&PLAN.unmet)||[];
  /* nothing to move: the targets are the labs' only once a report is on file; before that they
     are the plan's own counts, and no screen may say a marker did anything (Phase 17) */
  if(!SWAPS.length&&!left.length&&!short.length)return h+'<p class="t-body" style="margin-top:var(--s2);color:var(--ink)">The rotation already matches every '+
    (LABS.draws?'target your labs ask for'+(REG?', and every meal in it is on the '+esc(planName())+' plan':'')
      :'count '+(REG?'the '+esc(planName())+' plan':'your rotation')+' asks for'+(REG?', and every meal in it is on the plan':''))+
    (planStays()?', which keeps dinner as it is whatever a report says.':LABS.draws?'. Nothing in it was moved by a marker.':'. No report is on file yet, so no marker has moved it.')+'</p></section>';
  SWAPS.forEach(sw=>{
    const pending=S.pending[sw.key]!=null&&S.pending[sw.key]>0, landed=S.applied&&S.applied.includes(sw.key), flip=F.flips[sw.key];
    const moves=list(Object.entries(sw.changes||{}).map(([c,v])=>(CLASSWORD[c]||c)+' nights '+v[0]+' to '+v[1]));
    const rules=[...new Set((sw.why||[]).map(a=>a&&(a.display||a.rule)).filter(Boolean))];
    const leaving=(sw.excluded||[]).length>0, mk=leaving?null:(sw.why||[]).map(a=>a&&a.marker).filter(Boolean)[0];
    /* a swap the plan asked for says so in its own words and points at no marker; a count the
       plan itself sets is the plan asking, never the markers (his report, 2026-09-08: a fresh
       home with no report on file read "Your markers ask for") */
    h+='<p class="t-body" style="margin-top:var(--s2);color:var(--ink)"><b>'+esc(sw.from_name)+' becomes '+esc(sw.to_name)+'.</b> '+
      (leaving?esc(notOn(sw)):(rules.length?'Your markers ask for ':REG?'The '+esc(planName())+' plan asks for ':'Your rotation\'s own counts ask for ')+esc(moves)+'.'+
        (rules.length?' The rule that fired: '+esc(rules.join(', '))+'.':''))+'</p>'+
      '<p class="t-note" style="margin-top:var(--s2)">'+(landed?'This one has landed.'
        :pending?'Nothing changes until the '+esc(sw.gate_name||'stock')+' you already own is eaten: '+(Math.round(S.pending[sw.key]*10)/10)+' '+esc(sw.gate_unit||'')+' left'+
          (flip!=null?', about '+flip+' meal'+(flip===1?'':'s')+' from now':'')+'.'
        :'It applies at the next log.')+'</p>';
    if(opt.rail&&pending)h+=gateRail(sw);
    if(mk)h+='<button class="btn btn--sm btn--quiet" type="button" data-fk="why:'+esc(mk)+'" style="margin-top:var(--s2);padding-left:0" '+
      'onclick="act.trend(\''+esc(mk)+'\')">See the marker '+icon('arrow')+'</button>';
  });
  if(left.length)h+='<p class="t-note" style="margin-top:var(--s3)">'+left.length+' meal'+(left.length===1?' is':'s are')+(left.every(u=>(u.excluded||[]).length&&(u.excluded||[]).every(t=>CAVOID.includes(t)))?' left out by a condition on your history':REG?' not on the '+esc(planName())+' plan':' have what you leave out')+' and nothing in the catalog can replace '+(left.length===1?'it':'them')+': '+
    esc([...new Set(left.map(u=>u.name))].join(', '))+'. '+(left.length===1?'It stays':'They stay')+' until a meal that fits is added.</p>';
  /* the search stopped with a count still short: not an unfinished swap, a genuine wall (no
     meal in the catalog reaches it without breaking another count), said once it is settled */
  if(short.length)h+='<p class="t-note" style="margin-top:var(--s3)">'+short.map(u=>(CLASSWORD[u.key]||u.key)+' nights: '+u.reached+' of its own '+u.goal+' reached').join('; ')+
    '. Nothing left in the catalog trades for more without breaking another count.</p>';
  return h+'</section>';
}
/* whose card this is on Tonight: the markers', the plan's, or both. A swap with no rule behind
   it is the plan's own count, so it is how you eat, never a marker. */
function whyLabel(){const marker=s=>!(s.excluded||[]).length&&(s.why||[]).length>0;
  if(!SWAPS.length)return LABS.draws?'From your markers':'From how you eat';   /* nothing moved: the markers' card only once a report is on file */
  const r=SWAPS.some(s=>!marker(s)),m=SWAPS.some(marker);return r&&m?'From how you eat and your markers':r?'From how you eat':'From your markers';}

function viewRotation(F){
  const cur=S.cursor+1, pos=S.cursor%N, cyc=Math.floor(S.cursor/N)+1, after=N-pos-1;
  let h='<div class="stack">';
  h+='<section class="card card--lit a-hero" data-family="sprout" style="border-radius:var(--r-xl)" aria-label="Where you are in the rotation">'+
    '<div class="split"><div><span class="t-label">Tonight is meal</span>'+
      '<div class="numrow" style="margin-top:var(--s3)"><b class="num num--xl">'+cur+'</b><span class="t-unit" style="font-size:15px">in cycle '+cyc+'</span></div>'+
      '<p class="t-note" style="margin-top:var(--s2)">The '+ord(pos+1)+' of '+N+' in this cycle'+(after?' · '+after+' more after tonight':' · the last one, then a new cycle')+'</p>'+
      '<p class="t-note" style="margin-top:var(--s1)">'+passportLine()+'</p></div>'+
    '<span class="chip chip--lg chip--onlit chip--round">'+gl('rotation')+'</span></div>'+
    '<span class="t-label" style="display:block;margin-top:var(--s5)">The rotation from here</span>'+
    '<div style="margin-top:var(--s3)">'+strip()+'</div></section>';
  h+='<section class="card a-main"><div class="split"><span class="t-label">The next '+N+' meals</span>'+
    '<span class="mono" style="color:var(--ink-3)">no dates, only meals</span></div><div class="rows">';
  for(let i=0;i<N;i++)h+=rotRow(F,i);
  const fams=new Set(S.order.map(k=>MEALS[k]&&MEALS[k].protein_class).filter(Boolean)), distinct=new Set(S.order).size===N;
  const legend=[...new Set([['red_meat','beef is orange'],['fish','fish and shellfish blue'],['shellfish','fish and shellfish blue'],['plant','plant and bean plates green'],['poultry','poultry tan'],['pork','pork plum']]
    .filter(([c])=>fams.has(c)).map(([,w])=>w))];
  h+='</div><p class="t-note" style="margin-top:var(--s4)">Open a meal to see it whole, or send it to tonight. '+
    (distinct?'A protein comes back roughly every '+N+' meals and its flavour kit has moved on by then, so an identical meal does not recur for months. ':'')+
    (legend.length?'The colour beside each meal is its protein, the thing the rotation counts: '+legend.join(', ')+'. ':'')+'Meals, kits and stock are yours to change '+WHERE+'.</p>'+
    (CFG.group_note?'<p class="t-note" style="margin-top:var(--s2)">'+esc(groupLine(CFG.group_note))+'</p>':'')+'</section>';
  h+=whyCard(F,{cls:'a-aside'});
  return h+'</div>';
}

/* The kitchen, in the system's parts. One lit card says how far the stock reaches, one solid
   card carries the one deadline, the tiles are the ways in, and every list is a card of rows.
   Every number here is meals or stock; nothing is a day. */
const ZFAM={freezer:'frost',fridge:'sprout',pantry:'clay'};
const capz=z=>String(z||'').replace(/^\w/,c=>c.toUpperCase());
const nMeals=d=>d+' meal'+(d===1?'':'s');
/* meals until something in this zone that the rotation uses runs out */
function zoneMeals(F,z,used){let m=H;IORDER.forEach(k=>{if(I[k].zone===z&&used.has(k)&&F.L[k]<m)m=F.L[k];});return m;}
/* A card that opens on a tap. Its label is the header row, its count or state the meta, the
   chevron, and the body in the .exp grid the Markers card and the lens card already use. Open
   state is FOLD[id], session-only like OPEN and ALLOPEN: a fold is a view choice, not the home's
   state. `open` is the default the first time; a jump into the card (act.jumpK from a tile or the
   run-due card, act.you from a link) opens it before scrolling, so a jump never lands on a closed
   card. The body renders only when open, as the Markers card does. Phase 20: Kitchen ran to 89
   rows and You to a dozen cards a person scrolled past to reach the one they came for. */
let FOLD={};
function fold(id,fam,title,meta,body,open){
  const on=FOLD[id]===undefined?!!open:!!FOLD[id];
  return '<section class="card" id="'+esc(id)+'"'+(fam?' data-family="'+esc(fam)+'"':'')+'><div class="exp'+(on?' open':'')+'">'+
    '<button class="row" type="button" data-fk="fold:'+esc(id)+'" onclick="act.fold(\''+esc(id)+'\','+on+')" aria-expanded="'+on+'" style="padding-top:0'+(on?'':';padding-bottom:0')+'">'+
    '<span class="row__body"><span class="row__title">'+title+'</span>'+(meta?'<span class="row__meta">'+meta+'</span>':'')+'</span><span class="chev"></span></button>'+
    '<div class="exp-b"><div>'+(on?body:'')+'</div></div></div></section>';
}
function tile(fam,ico,title,sub,id){
  return '<button class="tile" type="button" data-family="'+fam+'" data-fk="jump:'+esc(id)+'" onclick="act.jumpK(\''+esc(id)+'\')">'+
    '<span class="tile__top"><span class="tile__ico">'+icon(ico)+'</span><span class="tile__go">'+icon('arrow')+'</span></span>'+
    '<span><b class="tile__t">'+esc(title)+'</b><span class="tile__s">'+esc(sub)+'</span></span></button>';
}
function viewKitchen(F){
  const L=F.L, used=consumedSet(targetOrder()), cs=countdownStore(), run=runIn(F);
  const live=liveItems(), zs=ZONES.filter(z=>live.some(k=>I[k].zone===z)), zm={};
  zs.forEach(z=>zm[z]=zoneMeals(F,z,used));
  /* each store's run: the countdown store counts down; any other is its first short item */
  const runs={};
  SORDER.forEach(sk=>{const st=STORES[sk],items=need(F,st);
    runs[sk]={items,d:st.countdown?run.d:Math.min.apply(null,items.map(k=>L[k]).concat([H]))};});
  let due=null;
  SORDER.forEach(sk=>{const r=runs[sk];if(r.items.length&&(!due||r.d<due.d))due={sk:sk,items:r.items,d:r.d};});

  /* the lit card: how far the stock reaches, and the bars by zone against the list line */
  /* the chart's top is the tallest thing on it, the list line included, with a little air */
  const thr=(cs&&cs.threshold)||0, scale=Math.max.apply(null,[thr,1].concat(zs.map(z=>Math.min(zm[z],H))))*1.2;

  /* the cover as a gauge: full at twice the list line, so a fresh shop reads as half a ring
     with room to keep it high, and a run due reads as the arc closing on the list line */
  const gfull=Math.max(2*thr,28), gto=Math.min(1,Math.min(run.d,H)/gfull), gfrom=(ENTER==='bump'&&PAINTED&&PAINTED.run!=null)?Math.min(1,Math.min(PAINTED.run,H)/gfull):null;
  let hero='<section class="card card--lit" data-family="frost" style="border-radius:var(--r-xl)" aria-label="How far the stock reaches">'+
    '<div class="split"><div><span class="t-label">Covered without shopping</span>'+
    '<div class="numrow" style="margin-top:var(--s3)"><b class="num num--xl">'+(run.d>=H?H+'+':'<span id="krun">'+run.d+'</span>')+'</b><span class="t-unit" style="font-size:15px">meals</span></div>'+
    '<p class="t-note" style="margin-top:var(--s2)">'+(run.k?esc(I[run.k].name)+(L[run.k]<=0?' is out.':' runs out first.'):'Nothing the rotation uses runs short inside '+H+' meals.')+
      (PORTIONS>1?' Stocked for '+esc(peopleWord(PORTIONS))+' a meal.':'')+'</p></div>'+
    '<span class="gauge" aria-label="'+(run.d>=H?H+' or more':run.d)+' meals covered, the list starts at '+thr+'">'+ringSVG('kring',gfrom,gto,64,6,'ring--onlit')+'<span class="gauge-in">'+icon('frost')+'</span></span></div>'+
    '<span class="t-label" style="display:block;margin-top:var(--s5)">Meals by zone</span>'+
    '<div class="bars'+(ENTER==='bump'?' fill':'')+'" style="margin-top:var(--s3)">';
  zs.forEach(z=>{const v=Math.min(zm[z],H), pct=Math.max(3,Math.round(Math.min(100,v/scale*100)));
    hero+='<div class="barcol"><div class="bartrack">'+(thr?'<div class="ghost" style="height:'+Math.round(thr/scale*100)+'%"></div>':'')+
      '<div class="bar bar--core" style="height:'+pct+'%"><span class="barcap">'+(zm[z]>=H?H+'+':zm[z])+'</span></div></div>'+
      '<span class="barlbl">'+esc(capz(z))+'</span></div>';});
  hero+='</div><p class="t-note" style="margin-top:var(--s3)">How many meals until something in that zone runs out.'+
    (thr?' The hatched line is where the '+esc(cs.name)+' list starts, '+nMeals(thr)+'.':'')+'</p></section>';

  /* the one solid card: a store run within six meals, the crossing the engine already watches */
  if(due&&due.d<=6){const st=STORES[due.sk], k0=due.items[0];
    hero+='<button class="card card--solid" type="button" data-family="ember" data-fk="due" style="display:flex;align-items:center;gap:var(--s4);text-align:left;width:100%" '+
      'onclick="act.jumpK(\'k-store-'+esc(due.sk)+'\')">'+
      '<span class="chip chip--onsolid chip--round">'+icon('bag')+'</span>'+
      '<span style="flex:1;min-width:0"><span class="t-head" style="display:block">'+esc(st.name)+(due.d<=0?' run now':' run within '+nMeals(due.d))+'</span>'+
      '<span class="t-note" style="display:block">'+esc(I[k0].name)+(L[k0]<=0?' is out. ':' runs out first. ')+due.items.length+' thing'+(due.items.length===1?'':'s')+' on the list.</span></span>'+
      icon('arrow')+'</button>';}

  /* the tiles: one per store, one per zone; each a way in */
  hero+='<div class="tiles">';
  SORDER.forEach(sk=>{const st=STORES[sk], r=runs[sk];
    hero+=tile('clay','bag',st.name,r.items.length?r.items.length+' to buy · '+nMeals(r.d):r.d>=H?'nothing to buy':'nothing yet · '+nMeals(r.d),'k-store-'+sk);});
  zs.forEach(z=>{const n=live.filter(k=>I[k].zone===z).length;
    hero+=tile(ZFAM[z]||'frost',z==='freezer'?'frost':z==='fridge'?'fridge':'jar',capz(z),n+' item'+(n===1?'':'s')+' · '+(zm[z]>=H?'stocked deep':nMeals(zm[z])+' left'),'k-zone-'+z);});
  hero+='</div>';

  const nost=UNSUP.filter(k=>used.has(k));
  if(nost.length)hero+='<section class="card card--tint" data-family="clay"><span class="t-label">No store carries these</span>'+
    '<p class="t-body" style="margin-top:var(--s2);color:var(--ink)">'+esc(nost.map(k=>I[k].name).join(', '))+'. The rotation uses them, but no store in play carries them, so they stay off every list and out of the countdown.</p>'+
    '<button class="btn btn--sm btn--quiet" type="button" data-fk="gostores" style="margin-top:var(--s2);padding-left:0" onclick="act.you(\'stores\')">Choose stores '+icon('arrow')+'</button></section>';
  const nocook=NOCOOK.filter(k=>MEALS[k]&&S.order.includes(k));   /* only what is in the rotation, as below */
  if(nocook.length)hero+='<section class="card card--tint" data-family="ember"><span class="t-label">Not for this kitchen</span>'+
    '<p class="t-body" style="margin-top:var(--s2);color:var(--ink)">'+esc(nocook.map(k=>MEALS[k].name+' ('+MEALS[k].why_not+')').join(', '))+'. '+
    'A meal already in the rotation stays there, but your labs will never swap one of these in. The kitchen and the hands-on budget are yours to change under You.</p></section>';
  /* a dinner or a cold option the plan leaves out lands the next load now (Phase 15: a "won't
     eat" is not gated on stock the way a marker's "eat less of" is), so what is left to say here
     is what is still on the shelf for it: every item with stock the plan, a chip or a condition
     rules out, split by whether every tag that ruled it out is entirely a condition's or touches
     the plan or a chip too, so the two are never claimed uniform. */
  const eff=effFor(REG,AVOID);
  const stranded=IORDER.filter(k=>(S.inv[k]||0)>0&&I[k]&&leavesOut(I[k].tags||[],eff).length);
  const byCond=k=>CAVOID.length&&leavesOut(I[k].tags||[],eff).every(t=>CAVOID.includes(t));
  const condStock=stranded.filter(byCond), planStock=stranded.filter(k=>!byCond(k));
  if(condStock.length){
    /* one line per condition, its items listed once, rather than repeating the same reason on
       every row -- long and repetitive on a home with several stranded items for the one fact */
    const lines=CONDS.filter(c=>condStock.some(k=>(c.tags||[]).some(t=>(I[k].tags||[]).includes(t))))
      .map(c=>c.word.replace(/^\w/,ch=>ch.toUpperCase())+' leaves out '+tagWords(c.tags)+': '+
        list(condStock.filter(k=>(c.tags||[]).some(t=>(I[k].tags||[]).includes(t))).map(k=>amtLabel(k,S.inv[k])))+'.');
    hero+='<section class="card card--tint" data-family="ember"><span class="t-label">On hand, left out by your history</span>'+
      '<p class="t-body" style="margin-top:var(--s2);color:var(--ink)">'+esc(lines.join(' '))+
      ' Nothing here is served or bought again; log any of it by amount under Also had.</p>'+
      '<button class="btn btn--sm btn--quiet" type="button" data-fk="gohist" onclick="act.you(\'hist-form\')">See your history '+icon('arrow')+'</button></section>';
  }
  if((REG||AVOID.length)&&planStock.length){
    hero+='<section class="card card--tint" data-family="ember"><span class="t-label">On hand, left out by '+(REG?'the '+esc(planName())+' plan':'what you leave out')+'</span>'+
    '<p class="t-body" style="margin-top:var(--s2);color:var(--ink)">'+esc(list(planStock.map(k=>amtLabel(k,S.inv[k]))))+
    '. Nothing here is served or bought again; log any of it by amount under Also had.</p>'+
    '<button class="btn btn--sm btn--quiet" type="button" data-fk="goplan" style="margin-top:var(--s2);padding-left:0" onclick="act.you(\'regimen\')">Change how you eat '+icon('arrow')+'</button></section>';
  }

  /* what to buy, one card per store */
  let main='';
  SORDER.forEach(sk=>{const st=STORES[sk], items=runs[sk].items, first=items.length>0&&items.every(k=>(S.inv[k]||0)===0);
    let body='';
    if(TRIP[sk]){
      const n=TRIP[sk], rows=tripNeed(sk,n,F), opts=[3,5,7,10,14,21,28,42].filter(v=>v<=H);
      if(!opts.includes(n))opts.push(n);opts.sort((a,b)=>a-b);
      body+='<p class="t-note" style="margin:var(--s2) 0 var(--s1)">A trip you call yourself. What the next meals draw of everything this store carries, less what is on hand, rounded up to the pack. The app counts meals, so say how many this trip should cover.</p>'+
        '<div class="formgrid"><div class="field wide"><span>Cover the next</span><select data-fk="trip-n:'+esc(sk)+'" onchange="act.tripSet(\''+esc(sk)+'\',this.value)">'+
        opts.map(v=>'<option value="'+v+'"'+(v===n?' selected':'')+'>'+nMeals(v)+'</option>').join('')+'</select></div></div>';
      if(!rows.length)body+='<p class="t-body" style="margin-top:var(--s3)">Nothing to buy: what is on hand covers the next '+nMeals(n)+'.</p>';
      else{body+='<div class="rows" style="margin-top:var(--s2)">';
        rows.forEach(r=>{body+='<div class="row"><span class="row__body"><span class="row__title">'+esc(I[r.k].name)+'</span>'+
          '<span class="row__meta">needs '+tripQty(r.need)+' '+esc(I[r.k].unit)+' over '+nMeals(n)+' · '+tripQty(r.have)+' on hand'+(r.packs>1?' · '+r.packs+' packs':'')+'</span>'+
          (I[r.k].buy?'<span class="row__note">'+esc(I[r.k].buy)+'</span>':'')+'</span>'+
          '<span class="row__val">'+tripQty(r.units)+' '+esc(I[r.k].unit)+'</span></div>';});
        body+='</div>';}
      body+='<div class="btnrow" style="margin-top:var(--s4)">'+
        '<button class="btn" type="button" data-fk="trip-copy:'+esc(sk)+'" onclick="act.tripCopy(\''+esc(sk)+'\')">Copy the trip</button>'+
        (rows.length?'<button class="btn btn--ink" type="button" data-fk="trip-bought:'+esc(sk)+'" onclick="act.tripBought(\''+esc(sk)+'\')">Bought it</button>':'')+
        '<button class="btn" type="button" data-fk="trip-close:'+esc(sk)+'" onclick="act.tripClose(\''+esc(sk)+'\')">Back</button></div>';
    } else if(!items.length){
      body+='<p class="t-body" style="margin-top:var(--s2)">Nothing needed.'+(run.k?' '+esc(I[run.k].name)+' is next to run short, in '+nMeals(run.d)+'.':'')+'</p>'+
        '<div class="btnrow" style="margin-top:var(--s3)"><button class="btn" type="button" data-fk="trip:'+esc(sk)+'" onclick="act.tripOpen(\''+esc(sk)+'\')">Plan a trip</button></div>';
    } else {
      const tgt=targetOrder(), cur=S.order, by={};
      listRows(sk,F).forEach(r=>by[r.k]=r);
      body+='<div class="rows">';
      items.forEach(k=>{const a=perCycle(cur,k), b=perCycle(tgt,k), d=L[k], r=by[k];
        body+='<div class="row"><span class="row__body"><span class="row__title">'+esc(I[k].name)+'</span>'+
          '<span class="row__meta">'+(r?tripQty(r.units)+' '+esc(I[k].unit)+' · ':'')+esc(I[k].buy)+'</span>'+
          (a!==b?'<span class="row__note">'+b+' '+esc(I[k].unit)+' per '+N+' meals once the change lands, was '+a+'.</span>':'')+'</span>'+
          (first?'':d<=0?'<span class="pill" data-family="ember"><i class="dot"></i>out</span>':'<span class="pill pill--ghost">'+nMeals(d)+'</span>')+'</div>';});
      body+='</div>'+(first?'<p class="t-note" style="margin-top:var(--s3)">Your kitchen starts empty, so this list stocks it for '+nMeals(Math.max(st.threshold||0,FIRST_RUN))+'. Own most of it already? Say so and the list closes.</p>':'')+
        '<div class="btnrow" style="margin-top:var(--s4)">'+
        '<button class="btn" type="button" data-fk="copy:'+esc(sk)+'" onclick="act.copy(\''+esc(sk)+'\')">Copy the list</button>'+
        '<button class="btn btn--ink" type="button" data-fk="restock:'+esc(sk)+'" onclick="act.restock(\''+esc(sk)+'\')">Bought it</button></div>'+
        (first?'<button class="btn btn--quiet" type="button" data-fk="stocked" style="width:100%;margin-top:var(--s2)" onclick="act.stocked()">My kitchen is stocked already</button>':'')+
        '<button class="btn" type="button" data-fk="trip:'+esc(sk)+'" style="width:100%;margin-top:var(--s2)" onclick="act.tripOpen(\''+esc(sk)+'\')">Plan a trip</button>';
    }
    main+=fold('k-store-'+sk,'','What to buy · '+esc(st.name),storeMark(st)+' '+(items.length?items.length+' to buy':'nothing needed')+(first?' · first run':''),body,true);});

  /* what is on hand, one card per zone: quantity and meals as meta, the gauge, a note only
     when there is something to say, and two steppers */
  zs.forEach(z=>{const ks=live.filter(k=>I[k].zone===z);
    let body='<div class="rows">';
    ks.forEach(k=>{const d=L[k], down=!used.has(k), st=storeOf(k), thr=st?(st.threshold||0):0, nostore=!st&&!down;
      const q=stepOf(k)===1&&I[k].unit!=='oz'&&I[k].unit!=='tbsp'?Math.round(S.inv[k]||0):Math.round((S.inv[k]||0)*10)/10, pct=Math.round(((S.inv[k]||0)/(I[k].pack||1))*100);
      const cls=down?'out':(d<=thr?'low':'');
      const left=d>=H?'deep, over '+H+' meals':d<=0?'out':nMeals(d)+' left';
      const note=down?'Eating down: the rotation no longer uses this, so it stays off the list'
        :nostore?'Off every list: no store in play carries this':'';
      body+='<div class="row"><span class="row__body"><span class="row__title">'+esc(I[k].name)+'</span>'+
        '<span class="row__meta">'+q+' '+esc(I[k].unit)+' · '+left+(st&&!down?' · '+storeMark(st)+(d<=thr?' <em class="onlist">on the list</em>':''):'')+'</span>'+gauge(pct,cls)+
        (note?'<span class="row__note'+(nostore?' row__note--hot':'')+'">'+esc(note)+'</span>':'')+'</span>'+
        '<span class="step2">'+
        '<button class="iconbtn" type="button" data-fk="less:'+k+'" onclick="act.bump(\''+k+'\',-1)" aria-label="Less '+esc(I[k].name)+'">'+icon('minus')+'</button>'+
        '<button class="iconbtn" type="button" data-fk="more:'+k+'" onclick="act.bump(\''+k+'\',1)" aria-label="More '+esc(I[k].name)+'">'+icon('plus')+'</button>'+
        '</span></div>';});
    body+='</div>';main+=fold('k-zone-'+z,ZFAM[z]||'frost',esc(capz(z)),ks.length+' item'+(ks.length===1?'':'s')+' · '+(zm[z]>=H?'stocked deep':nMeals(zm[z])+' left'),body,false);});

  /* the flavour pantry, and the way out */
  const flav=FLAV.filter(p=>!(p.excluded&&p.excluded.length)), miss=flav.filter(p=>!S.flav.includes(p.id)).length;
  let fbody='<div class="rows">';
  flav.forEach(p=>{const on=S.flav.includes(p.id);
    fbody+='<div class="row"><input class="tick tick--done" type="checkbox" id="fl-'+esc(p.id)+'"'+(on?' checked':'')+
      ' data-fk="flav:'+esc(p.id)+'" onchange="act.flavToggle(\''+esc(p.id)+'\')">'+
      '<label class="row__body" for="fl-'+esc(p.id)+'"><span class="row__title">'+esc(p.name)+'</span><span class="row__meta">'+esc(p.note)+'</span></label></div>';});
  fbody+='</div>'+(miss?'<button class="btn" type="button" style="width:100%;margin-top:var(--s4)" data-fk="copyflav" onclick="act.copyFlav()">Copy the '+miss+' still missing</button>':'');
  const aside=fold('k-flav','clay','Flavour pantry','one-time buy'+(miss?' · '+miss+' still missing':''),fbody,false);

  return '<div class="stack"><div class="pile a-hero">'+hero+'</div><div class="pile a-main">'+main+'</div><div class="pile a-aside">'+aside+'</div></div>';
}


/* ==========================================================================
   MARKERS, THE WHOLE OF IT. What the Mac used to keep to itself now lives
   here as sub-views of one destination: the full chart for any marker, your
   body and intake, the next draw plan, adding a report, and your profile.
   Each is the same parts as the overview: cards in a stack, rows with a pill
   only when there is something to say, wells for inputs, the ink pill for
   the one commitment on a form. The same page at both sizes; the Mac has
   more room, and a stack--top puts the first card across both columns.
   ========================================================================== */
let COMMITTED=false;               /* a report was committed on this page: the plan it holds is the old one, so leaving the tab fetches the page again */
let MKVIEW='overview', TREND=null, TRENDM='apob', BODY=null, ASSOC=null, DRAW=null, PLANQ={}, MKCAT=[],
    FILES=null, FILES_STALE=false, ING=null, HIST=null, LAN=null, LOADING={}, MSG='';

/* Every /api call, one way. The service worker answers with {offline:true} when the Mac is
   not running; that is a sentinel, not data, and it must never reach a renderer. */
async function api(path,opts){
  const r=await fetch(path,opts);
  const j=await r.json();
  if(j&&j.offline)throw new Error('Plateside is not running on the Mac right now.');
  if(!r.ok||j.error){const err=new Error(j.error||('HTTP '+r.status));if(j.diag)err.diag=j.diag;throw err;}   /* diag: what a failed upload knows about itself (api.js diagnose()), shown under the error */
  return j;
}
/* fetch once, then redraw. A second call while the first is in flight is a no-op. */
function want(key,path,assign){
  if(LOADING[key])return;
  LOADING[key]=true;
  api(path).then(v=>{assign(v);}).catch(e=>{assign({error:e.message});})
    .finally(()=>{LOADING[key]=false;if(tab==='markers'||tab==='you')render();});   /* You fetches too: the history, the device, the markers' diet */
}
const errBox=e=>'<div class="callout warn">'+esc(e)+'</div>';
/* The block under a failed upload that one screenshot carries to whoever is fixing it: the stage,
   the error and where it was thrown, the build, the browser, what the engine had of its own before
   anything was installed for it, what the reader's worker said (api.js diagnose()). Nothing
   personal in it: no file name, no row, no value. It exists because three fixes went out against a
   single relayed line of minified context, "(near '...t of e...')", before any of them could be
   checked against where that line came from (2026-09-09). */
const diagBlock=d=>{if(!d)return '';
  const yn=o=>Object.keys(o||{}).map(k=>k+'='+(o[k]==='function'||o[k]===true?'yes':'no')).join(' ');
  const wk=(d.worker||[]).map(w=>String(w.kind||'')+(w.message?': '+w.message:'')+(w.native?' · engine had: '+yn(w.native)+' · installed for it: '+yn(w.installed):'')+(w.stack?'\n    '+String(w.stack).split('\n').slice(0,3).join('\n    '):'')).join('\n');
  return '<pre class="mono" style="white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.45;margin-top:var(--s3);padding:var(--s3);border-radius:8px;background:rgba(127,127,127,.12);color:var(--ink-3)">'+
    esc('DIAGNOSTIC — a screenshot of this box is enough\nbuild '+(d.build||'?')+'\n'+(d.ua||'')+'\nstage: '+(d.stage||'?')+'\n'+(d.name||'Error')+': '+(d.message||'')+
        '\nengine had: '+yn(d.native)+'\ninstalled for it: '+yn(d.installed)+'\n'+(d.stack||[]).join('\n')+(wk?'\nworker:\n'+wk:''))+'</pre>';};
const loading=()=>'<p class="t-body">Loading…</p>';

/* ---- a sparkline for any series: the same drawing at every size, one path in the family
   core. The stroke does not scale with the box, so the line is the same weight everywhere. */
function spark(series,opt){
  opt=opt||{};
  const pts=(series||[]).map(p=>[p.date||p[0],p.v!=null?p.v:p[1]]).filter(p=>p[1]!=null&&!isNaN(p[1]));
  if(pts.length<2)return '';
  const vals=pts.map(p=>+p[1]);
  let lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals);
  if(hi===lo)hi=lo+1;
  const pad=(hi-lo)*0.18;lo-=pad;hi+=pad;
  const W=300,H=opt.h||44,L=4,R=6,T=5,B=5;
  const x=i=>L+i*(W-L-R)/(pts.length-1),y=v=>T+(1-(v-lo)/(hi-lo))*(H-T-B);
  const d=pts.map((p,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(+p[1]).toFixed(1)).join(' ');
  return '<svg class="spark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="'+pts.length+' draws"'+
    (opt.h?' style="height:'+opt.h+'px"':'')+'><path d="'+d+'"/></svg>';
}

/* ==========================================================================
   THE CHART. Carried over from the Mac. Annotations live outside the plot:
   bounds in the left gutter, the latest reading and the lab's range in the
   right, so nothing is ever written across the data. Every draw is focusable
   and writes into a readout under the frame.
   ========================================================================== */
const MARK={above:'out',below:'low',in:'in'};
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function niceStep(raw){
  if(!(raw>0))return 1;
  const e=Math.pow(10,Math.floor(Math.log10(raw))),f=raw/e;
  return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*e;
}
function xTicks(x0,x1){
  const months=(x1-x0)/2629800000;
  const step=[1,2,3,6,12,24,60,120].find(s=>months/s<=6)||240;
  const d=new Date(x0);
  let idx=Math.floor((d.getUTCFullYear()*12+d.getUTCMonth())/step)*step;
  const out=[];
  for(let i=0;i<64&&out.length<12;i++){
    const t=Date.UTC(Math.floor(idx/12),idx%12,1);
    if(t>x1)break; if(t>=x0)out.push(t); idx+=step;
  }
  if(out.length<2){out.length=0;out.push(x0,x1);}
  let prev=null;
  return out.map(t=>{const dd=new Date(t),y=dd.getUTCFullYear();
    const lab=(y!==prev)?(step>=12?String(y):MON[dd.getUTCMonth()]+' '+y):MON[dd.getUTCMonth()];
    prev=y;return{t,lab};});
}
function chart(t){
  const pts=t.points.filter(p=>p.v!=null);
  if(!pts.length)return '<p class="t-note">No numeric values on record. The table below has every row as it was printed.</p>';
  const W=880,H=232,L=72,R=104,T=20,B=34,PW=W-L-R,PH=H-T-B;
  const xs=pts.map(p=>new Date(p.date).getTime());
  let x0=Math.min(...xs),x1=Math.max(...xs);if(x1===x0){x0-=15e9;x1+=15e9;}
  const last=pts[pts.length-1],ys=pts.map(p=>p.v);
  const dmin=Math.min(...ys),dmax=Math.max(...ys),all=ys.slice(),tg=t.target||null;
  if(tg){if(tg.low!=null)all.push(+tg.low);if(tg.high!=null)all.push(+tg.high);}
  if(last.ref_low)all.push(+last.ref_low);if(last.ref_high)all.push(+last.ref_high);
  let lo=Math.min(...all),hi=Math.max(...all);
  if(hi===lo){const p=(Math.abs(lo)||1)*0.1;hi=lo+p;lo-=p;}
  const step=niceStep((hi-lo)/4);
  let y0=Math.floor(lo/step)*step,y1=Math.ceil(hi/step)*step;
  if(y0<0&&Math.min(...all)>=0)y0=0; if(y1===y0)y1=y0+step;
  let dec=0;for(let sp=step;dec<6&&Math.abs(sp-Math.round(sp))>1e-9;dec++)sp*=10;
  const fmt=v=>(Math.abs(v)<1e-9?0:v).toFixed(dec);
  const X=v=>L+(v-x0)/(x1-x0)*PW,Y=v=>T+(y1-v)/(y1-y0)*PH;
  let g='<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(t.title)+', '+pts.length+' draws">';
  g+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+T+'" y2="'+T+'" class="c-edge"/>';
  g+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+(H-B)+'" y2="'+(H-B)+'" class="c-frame"/>';
  const rl=last.ref_low?+last.ref_low:null,rh=last.ref_high?+last.ref_high:null;
  if(rl!=null)g+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y(rl).toFixed(1)+'" y2="'+Y(rl).toFixed(1)+'" class="c-lab"/>';
  if(rh!=null)g+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y(rh).toFixed(1)+'" y2="'+Y(rh).toFixed(1)+'" class="c-lab"/>';
  let bandMid=null,bandTxt='';
  if(tg&&(tg.low!=null||tg.high!=null)){
    const top=tg.high!=null?Y(+tg.high):T,bot=tg.low!=null?Y(+tg.low):H-B;
    const yTop=Math.min(top,bot),hgt=Math.abs(bot-top);
    g+='<rect x="'+L+'" y="'+yTop.toFixed(1)+'" width="'+PW+'" height="'+Math.max(1,hgt).toFixed(1)+'" class="c-band"/>';
    [tg.high!=null?Y(+tg.high):null,tg.low!=null?Y(+tg.low):null].forEach(yy=>{if(yy==null)return;
      g+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+yy.toFixed(1)+'" y2="'+yy.toFixed(1)+'" class="c-bandedge"/>';});
    bandMid=yTop+Math.max(1,hgt)/2;bandTxt=String(tg.short||'').split(' ')[0];
    g+='<text x="'+(L-8)+'" y="'+(bandMid-3).toFixed(1)+'" text-anchor="end" class="ok">target</text>'+
       '<text x="'+(L-8)+'" y="'+(bandMid+10).toFixed(1)+'" text-anchor="end" class="ok">'+esc(bandTxt)+'</text>';
  }
  const aTop=Y(dmax),aBot=Y(dmin),thin=Math.abs(aBot-aTop)<PH*0.05;
  g+='<line x1="'+L+'" x2="'+L+'" y1="'+(thin?T:aTop).toFixed(1)+'" y2="'+(thin?H-B:aBot).toFixed(1)+'" class="c-frame"/>';
  const majors=[];for(let v=y0;v<=y1+step/1e6;v+=step)majors.push(+v.toFixed(6));
  const inRange=v=>thin||(v>=Math.min(dmin,dmax)-1e-9&&v<=Math.max(dmin,dmax)+1e-9);
  majors.forEach(v=>{if(!inRange(v))return;const y=Y(v);
    g+='<line x1="'+(L-9)+'" x2="'+L+'" y1="'+y.toFixed(1)+'" y2="'+y.toFixed(1)+'" class="c-frame"/>';
    if(bandMid==null||Math.abs(y-bandMid)>15)g+='<text x="'+(L-14)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end">'+fmt(v)+'</text>';});
  const inside=majors.filter(v=>v>Math.min(dmin,dmax)+1e-9&&v<Math.max(dmin,dmax)-1e-9);
  const grid=inside.length<=3?inside:[inside[0],inside[Math.floor(inside.length/2)],inside[inside.length-1]];
  grid.forEach(v=>{g+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+'" class="c-grid"/>';});
  if(last.unit)g+='<text x="'+(L-9)+'" y="'+(T-7)+'" text-anchor="end">'+esc(last.unit)+'</text>';
  xTicks(x0,x1).forEach(k=>{const x=X(k.t);if(x<L-1||x>W-R+1)return;
    g+='<line x1="'+x.toFixed(1)+'" x2="'+x.toFixed(1)+'" y1="'+(H-B)+'" y2="'+(H-B+5)+'" class="c-frame"/>'+
       '<text x="'+x.toFixed(1)+'" y="'+(H-B+20)+'" text-anchor="middle">'+esc(k.lab)+'</text>';});
  pts.forEach(p=>{const x=X(new Date(p.date).getTime());g+='<line x1="'+x.toFixed(1)+'" x2="'+x.toFixed(1)+'" y1="'+(H-B-5)+'" y2="'+(H-B)+'" class="c-rug"/>';});
  if(pts.length>1)g+='<path d="'+pts.map((p,i)=>(i?'L':'M')+X(new Date(p.date).getTime()).toFixed(1)+' '+Y(p.v).toFixed(1)).join(' ')+'" class="c-line"/>';
  g+='<line class="c-cross" x1="0" x2="0" y1="'+T+'" y2="'+(H-B)+'" style="display:none"/>';
  const bad=p=>p.vs_target==='above'||p.vs_target==='below'||(!p.vs_target&&!!p.lab_flag);
  pts.forEach((p,i)=>{const x=X(new Date(p.date).getTime()),y=Y(p.v),isLast=i===pts.length-1;
    if(isLast)g+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="6" fill="var(--surface)"/>';
    if(bad(p))g+='<path d="M'+x.toFixed(1)+' '+(y-5).toFixed(1)+'l4.6 8h-9.2z" class="c-out"/>';
    else g+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+(isLast?3.5:3)+'" class="c-dot'+(isLast?' last':'')+'"/>';});
  const lx=X(new Date(last.date).getTime()),ly=Y(last.v);
  g+='<line x1="'+Math.min(lx+8,W-R).toFixed(1)+'" x2="'+(W-R+2)+'" y1="'+ly.toFixed(1)+'" y2="'+ly.toFixed(1)+'" class="c-rug"/>'+
     '<path d="M'+(W-R+4)+' '+ly.toFixed(1)+'l7 -4.5v9z" fill="var(--ink)"/>'+
     '<text x="'+(W-R+15)+'" y="'+(ly+4).toFixed(1)+'" class="val">'+esc(last.value)+'</text>';
  if(rh!=null&&Math.abs(Y(rh)-ly)>12)g+='<text x="'+(W-R+6)+'" y="'+(Y(rh)+4).toFixed(1)+'">lab hi '+esc(last.ref_high)+'</text>';
  if(rl!=null&&Math.abs(Y(rl)-ly)>12)g+='<text x="'+(W-R+6)+'" y="'+(Y(rl)+4).toFixed(1)+'">lab lo '+esc(last.ref_low)+'</text>';
  const px=pts.map(p=>X(new Date(p.date).getTime()));
  pts.forEach((p,i)=>{const x=px[i],y=Y(p.v);
    const bl=i===0?L:(px[i-1]+x)/2,br=i===pts.length-1?W-R:(x+px[i+1])/2,bw=Math.max(1,br-bl);
    const vs=p.vs_target==='above'?'above target':p.vs_target==='below'?'below target':p.vs_target==='in'?'in target':'';
    const prev=i?pts[i-1]:null,dv=prev?+(p.v-prev.v).toFixed(4):null;
    const dir=dv==null?'':dv>0?'up':dv<0?'dn':'';
    const delta=dv==null?'first draw':dv===0?'no change since '+prev.date:(dv>0?'up ':'down ')+Math.abs(dv)+' since '+prev.date;
    const aria=p.date+', '+p.value+' '+p.unit+(vs?', '+vs:'')+(p.lab_range?', lab range '+p.lab_range:'')+', '+delta;
    g+='<rect class="c-hit" tabindex="0" role="img" aria-label="'+esc(aria)+'" x="'+bl.toFixed(1)+'" y="'+T+'" width="'+bw.toFixed(1)+'" height="'+PH+'"'+
       ' data-x="'+x.toFixed(1)+'" data-date="'+esc(p.date)+'" data-val="'+esc(p.value)+'" data-unit="'+esc(p.unit)+'"'+
       ' data-vs="'+esc(vs)+'" data-mark="'+(MARK[p.vs_target]||'none')+'" data-delta="'+esc(delta)+'" data-dir="'+dir+'"></rect>'+
       '<circle class="c-halo" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="8" fill="none" pointer-events="none"/>';});
  g+='</svg>';
  const key='<div class="c-key">'+
    (tg?'<span><svg width="22" height="10" aria-hidden="true"><rect x="0" y="1" width="22" height="8" class="c-band"/><line x1="0" x2="22" y1="1" y2="1" class="c-bandedge"/><line x1="0" x2="22" y1="9" y2="9" class="c-bandedge"/></svg>the target you are judged against, '+esc(tg.short||tg.text)+'</span>':'')+
    (rl!=null||rh!=null?'<span><svg width="22" height="10" aria-hidden="true"><line x1="0" x2="22" y1="5" y2="5" class="c-lab"/></svg>the lab’s own printed range on the latest report</span>':'')+'</div>';
  return g+'<p class="c-read" id="cRead" role="status" aria-live="polite"></p>'+key+
    (pts.length<2?'<p class="cap" style="margin-top:8px">One draw so far. A line needs two.</p>':'');
}
function wireChart(root){
  const svg=root.querySelector('svg.chart');if(!svg)return;
  const read=root.querySelector('#cRead'),cross=svg.querySelector('.c-cross'),hits=[...svg.querySelectorAll('.c-hit')];
  if(!hits.length||!read)return;
  const show=el=>{const d=el.dataset;
    read.innerHTML='<span class="mono">'+esc(d.date)+'</span><span class="val">'+esc(d.val)+' '+esc(d.unit)+'</span>'+
      (d.vs?'<span class="st"><span class="mark '+d.mark+'"></span>'+esc(d.vs)+'</span>':'')+
      '<span class="delta">'+(d.dir?icon('arrow','i-14 '+d.dir):'')+esc(d.delta)+'</span>';
    cross.setAttribute('x1',d.x);cross.setAttribute('x2',d.x);cross.style.display='';};
  const rest=()=>{show(hits[hits.length-1]);cross.style.display='none';};
  hits.forEach((el,i)=>{el.addEventListener('mouseenter',()=>show(el));el.addEventListener('focus',()=>show(el));
    el.addEventListener('blur',rest);
    el.addEventListener('keydown',ev=>{const k=ev.key;
      if(k!=='ArrowRight'&&k!=='ArrowLeft'&&k!=='ArrowUp'&&k!=='ArrowDown')return;ev.preventDefault();
      const n=(k==='ArrowRight'||k==='ArrowUp')?i+1:i-1;if(hits[n])hits[n].focus();});});
  svg.addEventListener('mouseleave',rest);rest();
}

/* ---- the chip row: Markers' sub-views -------------------------------------------------- */
const MKVIEWS=[['overview','All markers'],['trend','Full history'],['body','Body'],['plan','Next draw']];
/* Add a report is a task, not a view, so it is a button on the views that lead to it and not a
   chip in the row: four views fit one row at phone width; five wrapped. The reports screen is
   still MKVIEW 'reports', reached by this button, the Now card and the guide. */
const addReportBtn=extra=>'<button class="btn btn--sm btn--ink" type="button" data-fk="mkadd" onclick="act.mk(\'reports\')"'+(extra||'')+'>Add a report '+icon('plus')+'</button>';
function chips(){
  return '<div class="chips" role="tablist">'+MKVIEWS.map(([k,l])=>
    '<button type="button" role="tab" data-fk="mkv:'+k+'" aria-current="'+(MKVIEW===k)+'" onclick="act.mk(\''+k+'\')">'+l+'</button>').join('')+'</div>';
}

/* ---- FULL HISTORY: one marker, the chart, every draw, and what you ate before each ------ */
function viewTrend(){
  const s=MK&&MK!=='none'?MK.s:null;
  /* no draw on record: the invitation, never a marker picked at random with "0 draws" over its
     research notes (what a fresh home showed: Apolipoprotein B, and a paragraph of reference) */
  if(!s||!(s.draws&&s.draws.length))return '<div class="stack stack--one"><div class="pile a-hero">'+noReportCard('noreport-trend')+readsCard()+'</div></div>';
  let top='<section class="card" data-family="plum">';
  if(s){
    top+='<div class="field"><span>Marker</span><select data-fk="trendsel" onchange="act.trend(this.value)">'+
      s.markers.filter(m=>m.marker).map(m=>'<option value="'+esc(m.marker)+'"'+(m.marker===TRENDM?' selected':'')+'>'+
        esc(m.display)+(m.panel?' · '+esc(m.panel):'')+'</option>').join('')+'</select></div>';
  }
  if(!TREND||TREND.marker!==TRENDM){want('trend','/api/trend?marker='+encodeURIComponent(TRENDM),v=>{TREND=v;EXPO=null;});
    return '<div class="stack">'+top+'<div style="margin-top:var(--s4)">'+loading()+'</div></section></div>';}
  if(TREND.error)return '<div class="stack">'+top+errBox(TREND.error)+'</section></div>';
  const t=TREND;
  top+='<div class="split" style="margin-top:var(--s5)"><span class="t-label">'+esc(t.title)+'</span><span class="mono" style="color:var(--ink-3)">'+t.points.length+' draws</span></div>';
  if(t.situation)top+='<p class="t-body" style="margin:var(--s2) 0 var(--s3)">'+esc(t.situation)+'</p>';
  top+=chart(t);
  const tline=(tg,label)=>'<p class="t-note" style="margin-top:var(--s3)"><b style="color:var(--ink)">'+esc(label)+':</b> '+esc(tg.text)+
    ' · '+esc(tg.basis)+', confidence '+esc(tg.confidence)+(tg.evidence?', evidence '+esc(tg.evidence):'')+', reviewed '+esc(tg.reviewed)+
    (tg.source_url?' · <a href="'+esc(tg.source_url)+'" target="_blank" rel="noopener">source</a>':'')+'</p>';
  if(t.target)top+=tline(t.target,t.target.lens===t.lens?'Target, '+t.lens+' view':'Target, no '+t.lens+' row so '+t.target.lens+' used');
  else top+='<p class="t-note" style="margin-top:var(--s3)">No researched target for this marker; judged against the lab’s printed range.</p>';
  if(t.alt_target&&(!t.target||t.alt_target.text!==t.target.text))top+=tline(t.alt_target,'Also, '+t.alt_lens+' view');
  /* the research behind the target sits behind one tap, never as the first thing on a screen */
  if(t.target&&t.target.notes)top+='<div class="exp'+(OPEN==='tnotes'?' open':'')+'" style="margin-top:var(--s3)">'+
    '<button class="row" type="button" data-fk="tnotes" onclick="act.open(\'tnotes\')" aria-expanded="'+(OPEN==='tnotes')+'">'+
      '<span class="row__body"><span class="row__title">Why this target</span><span class="row__meta">the research behind the line, in its own words</span></span><span class="chev"></span></button>'+
    '<div class="exp-b"><div><p class="t-note" style="padding:0 0 var(--s3)">'+esc(t.target.notes)+'</p></div></div></div>';
  top+='</section>';
  let main='<section class="card"><div class="split"><span class="t-label">Every draw</span><span class="mono" style="color:var(--ink-3)">as the lab printed it</span></div>'+
    '<div class="scroll-x" style="margin-top:var(--s2)"><table class="data"><thead><tr><th class="n">Date</th><th class="n">Value</th><th>Lab range</th><th>Lab flag</th><th>vs target</th><th>Printed as</th></tr></thead><tbody>';
  t.points.forEach(p=>{
    const vs=p.vs_target==='above'?'<span class="pill hot">above</span>':p.vs_target==='below'?'<span class="pill hot">below</span>':p.vs_target==='in'?'<span class="pill ok">in</span>':'';
    main+='<tr><td class="n">'+esc(p.date)+'</td><td class="n">'+esc(p.value)+' <span class="cap" style="display:inline">'+esc(p.unit)+'</span>'+(p.approx?' <span class="pill">approx</span>':'')+'</td>'+
      '<td>'+esc(p.lab_range)+'</td><td>'+(p.lab_flag?'<span class="pill">lab '+esc(p.lab_flag)+'</span>':'')+'</td><td>'+vs+'</td>'+
      '<td class="wrap"><span class="cap">'+esc(p.printed_as)+(p.panel?' — '+esc(p.panel):'')+'</span></td></tr>';});
  main+='</tbody></table></div></section>';
  return '<div class="stack stack--top"><div class="pile a-hero">'+top+'</div><div class="pile a-main">'+main+'</div><div class="pile a-aside">'+viewExposure(t.marker)+'</div></div>';
}
let EXPO=null;
function viewExposure(marker){
  if(!EXPO||EXPO.marker!==marker){want('expo','/api/exposure?marker='+encodeURIComponent(marker),v=>{EXPO=v;EXPO.marker=EXPO.marker||marker;});return '';}
  if(EXPO.error||!EXPO.days)return '';
  const rows=EXPO.draws.filter(d=>d.exposure);
  let h='<section class="card" data-family="sprout"><div class="split"><span class="t-label">What you ate before each draw</span><span class="mono" style="color:var(--ink-3)">'+EXPO.days+' days back</span></div>';
  if(!rows.length)return h+'<p class="t-note" style="margin-top:var(--s2)">No logged food in the '+EXPO.days+' days before any of these draws yet.</p></section>';
  h+='<p class="t-note" style="margin:var(--s2) 0 var(--s3)">Averages per logged day. A row with under half the days logged is marked excluded and left out of any pattern-finding. This is context beside the number, not a cause.</p>';
  const n=v=>(v==null?'–':Math.round(v));
  h+='<div class="scroll-x"><table class="data"><thead><tr><th class="n">Draw</th><th class="n">'+esc(EXPO.display)+'</th><th class="n">Days logged</th><th class="n">kcal</th><th class="n">Protein</th><th class="n">Fiber</th><th class="n">Added sugar</th><th class="n">Sat fat</th><th class="n">Weight Δ</th></tr></thead><tbody>';
  EXPO.draws.forEach(d=>{const e=d.exposure;
    if(!e){h+='<tr><td class="n">'+esc(d.date)+'</td><td class="n">'+esc(d.value)+'</td><td colspan="7" class="cap">no food logged in this window</td></tr>';return;}
    const excl=e.coverage<0.5,cov=e.days_logged+'/'+e.days+(e.days_partial?' (+'+e.days_partial+' partial)':'');
    h+='<tr'+(excl?' class="excl"':'')+'><td class="n">'+esc(d.date)+'</td><td class="n">'+esc(d.value)+'</td>'+
      '<td class="n">'+(excl?'<span class="strike">'+cov+'</span> <span class="pill">excluded</span>':cov)+'</td>'+
      '<td class="n">'+n(e.avg.kcal)+'</td><td class="n">'+n(e.avg.protein_g)+'</td><td class="n">'+n(e.avg.fiber_g)+'</td><td class="n">'+n(e.avg.added_sugar_g)+'</td><td class="n">'+n(e.avg.sat_fat_g)+'</td>'+
      '<td class="n">'+(e.weight_change==null?'–':(e.weight_change>0?'+':'')+e.weight_change)+'</td></tr>';});
  return h+'</tbody></table></div></section>';
}

/* ---- BODY: your target and whether it is working. The target and where it came from, the
   plate in play, the scale's own record and its verdict, the coverage line, and the intake
   averages when a food tracking app's export is on file. Time is allowed here the way a draw
   date is on Markers: a weigh-in is dated. Numbers and the rule, never a verdict on the person. */
const todayIso=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());};
const ACTWORD={sedentary:'mostly sitting',light:'on your feet part of the day',moderate:'active most days',active:'training hard most days',very_active:'a physical job and training'};
function targetFrom(e,cal){
  if(e&&e.missing&&!e.missing.length){const h=Math.floor(e.height_in/12),i=fmt(e.height_in-h*12);
    return 'Estimated from your body: '+fmt(e.weight_lb)+' lb, '+h+' ft'+(i!=='0'?' '+i:'')+', '+e.age+', '+(ACTWORD[e.activity]||e.activity)+', '+(e.goal==='hold'?'holding your weight':e.goal==='lose'?'losing '+(e.rate==='steady'?'about a pound':'about half a pound')+' a week':'gaining '+(e.rate==='steady'?'about a pound':'about half a pound')+' a week')+'. Within about 15 percent for any one person; the scale corrects it.';}
  return 'Fill in About you under You, top right, and the estimate appears here.';
}
function verdictWords(v){
  const n=v.points, s=v.slope==null?'':slopeWords(v.slope), band=bandWords(v.expected||[0,0]);
  if(v.state==='no_weigh_ins')return 'No weigh-ins yet. Three weigh-ins spanning three weeks let the scale judge the plate.';
  if(v.state==='too_few')return n+' weigh-in'+(n===1?'':'s')+(v.since?' since the plate was set':'')+'. Three spanning three weeks let the scale judge the plate.';
  if(v.state==='too_short')return n+' weigh-ins over '+v.window_days+' days. Once they span three weeks the scale judges the plate.';
  if(v.state==='stepped_recently')return 'The trend moved '+s+' a week over '+n+' weigh-ins. The plate changed on '+v.since+', and the scale judges again four weeks after a change.';
  if(v.state==='on_track')return 'On track: the trend moved '+s+' a week over '+n+' weigh-ins, inside the '+band+' a week your goal expects.';
  if(v.state==='at_bound')return 'The trend moved '+s+' a week over '+n+' weigh-ins, outside the '+band+' your goal expects, and the plate is already as '+(v.step<0?'small':'large')+' as this plan goes.';
  if(v.state==='propose')return 'Off track: the trend moved '+s+' a week over '+n+' weigh-ins; your goal expects '+band+' a week. The plate steps at your next weigh-in.';
  return '';
}
function viewBody(){
  if(!BODY){want('body','/api/body',v=>{BODY=v;});}
  if(!ASSOC){want('assoc','/api/associations',v=>{ASSOC=v;});}
  if(!BODY)return '<div class="stack"><section class="card a-hero">'+loading()+'</section></div>';
  if(BODY.error)return '<div class="stack"><section class="card a-hero">'+errBox(BODY.error)+'</section></div>';
  const b=BODY,a=b.avg28||{},w=b.weigh||{},v=w.verdict||{state:'no_weigh_ins',points:0,expected:[0,0]},d=b.diet||null,e=b.estimate||null;
  const tk=d&&d.targets?d.targets:null, cal=d&&d.calories?d.calories:null;
  let top='<section class="card" data-family="plum"><div class="split"><span class="t-label">Your target</span><span class="mono" style="color:var(--ink-3)">and whether it is working</span></div>';
  if(tk)top+='<div class="stats stats--2" style="margin-top:var(--s3)">'+statBox('kcal a day',Math.round(tk.kcal||0).toLocaleString(),'')+statBox('Protein a day',Math.round(tk.protein_g||0),'g')+'</div>';
  top+='<p class="t-note" style="margin-top:var(--s3)">'+esc(targetFrom(e,cal))+'</p>'+
    '<p class="t-note" style="margin-top:var(--s2)"><b>'+esc(PLATE===1?'Plates as the recipes are written.':'Plates about '+Math.round(Math.abs(1-PLATE)*100)+' percent '+(PLATE<1?'smaller':'larger')+' than written.')+'</b>'+(w.plate_since?' Set on '+esc(w.plate_since)+'.':'')+'</p>'+
    '<button class="btn btn--sm btn--quiet" type="button" data-fk="gotarget" style="margin-top:var(--s2);padding-left:0" onclick="act.you(\'yourtarget\')">Change your target '+icon('arrow')+'</button></section>';
  top+='<section class="card" data-family="frost"><div class="split"><span class="t-label">The scale</span><span class="mono" style="color:var(--ink-3)">'+(w.entries||0)+' weigh-in'+(w.entries===1?'':'s')+'</span></div>';
  if(w.latest)top+='<div class="stats stats--2" style="margin-top:var(--s3)">'+statBox('lb on '+w.latest.date,fmtN(w.latest.weight_lb),'')+statBox('Trend',fmtN(w.latest.trend_lb),'lb')+'</div>';
  if(w.trend&&w.trend.length>1)top+='<div class="split" style="margin-top:var(--s4)"><span class="t-label">Trend</span><span class="mono" style="color:var(--ink-3)">'+esc(w.trend[0].date)+' to '+esc(w.trend[w.trend.length-1].date)+'</span></div>'+spark(w.trend.map(p=>({date:p.date,v:p.trend_lb})),{h:64});
  top+='<p class="t-body" style="margin-top:var(--s3);color:var(--ink)">'+esc(verdictWords(v))+'</p>';
  if(w.coverage)top+='<p class="t-note" style="margin-top:var(--s2)">Logged here: '+w.coverage.logged+' of the last '+w.coverage.days+' days. A day with no log is unknown, not zero; the scale is the only judge.</p>';
  top+='<div class="formgrid" style="margin-top:var(--s4)"><div class="field"><span>Weight, lb</span><input type="number" id="wIn" data-fk="win" inputmode="decimal" min="50" max="700" step="any"></div>'+
    '<div class="field"><span>On</span><input type="date" id="wDate" data-fk="wdate" value="'+todayIso()+'"></div></div>'+
    '<div class="btnrow" style="margin-top:var(--s3)"><button class="btn btn--ink" type="button" data-fk="weigh" onclick="act.weigh()">Log a weigh-in</button></div>'+
    (MSG?'<p class="t-note" style="margin-top:var(--s3)">'+esc(MSG)+'</p>':'')+'</section>';
  if(CFG.plate_step)top+=plateCard(CFG.plate_step);
  let main='';
  if(a.kcal||a.protein_g||a.expenditure_kcal){
    main+='<section class="card"><div class="split"><span class="t-label">Intake</span><span class="mono" style="color:var(--ink-3)">from your food tracking app</span></div><div class="stats stats--2" style="margin-top:var(--s3)">'+
      (a.kcal?statBox('kcal a day, last 28',Math.round(a.kcal).toLocaleString(),''):'')+(a.protein_g?statBox('Protein a day',Math.round(a.protein_g),'g'):'')+
      (a.expenditure_kcal?statBox('Burned, its estimate',Math.round(a.expenditure_kcal).toLocaleString(),'kcal'):'')+'</div>'+
      '<p class="t-note" style="margin-top:var(--s3)">'+b.intake_days+' logged days on file. Optional: nothing here needs it.</p></section>';
  }
  if(ASSOC&&!ASSOC.error&&ASSOC.markers&&ASSOC.markers.length){
    main+='<section class="card" data-family="plum"><div class="split"><span class="t-label">Food and blood, so far</span><span class="mono" style="color:var(--ink-3)">your own draws</span></div>'+
      '<p class="t-note" style="margin:var(--s2) 0 var(--s1)">'+esc(ASSOC.caution)+' Shown only where at least '+ASSOC.min_draws+' draws had food logged for most of the window.</p><div class="rows">';
    ASSOC.markers.forEach(m=>{
      main+='<button class="row" type="button" data-fk="as:'+esc(m.marker)+'" onclick="act.trend(\''+esc(m.marker)+'\')">'+
        '<span class="row__body"><span class="row__title">'+esc(m.display)+'</span><span class="row__meta">'+m.draws_used+' draws · '+m.days+'-day window</span>'+
        m.associations.map(f=>'<span class="row__note"><b>'+esc(f.field.replace(/_/g,' '))+'</b> '+esc(f.direction)+' · r '+(f.r>=0?'+':'')+f.r+'</span>').join('')+
        '</span>'+icon('arrow')+'</button>';});
    main+='</div></section>';
  }
  return '<div class="stack"><div class="pile a-hero">'+top+'</div><div class="pile a-main">'+main+'</div></div>';
}

/* ---- NEXT DRAW: what to order, what to skip, and why ----------------------------------- */
function viewPlan(){
  const q=new URLSearchParams();if(PLANQ.draw)q.set('draw',PLANQ.draw);if(PLANQ.cadence)q.set('cadence',PLANQ.cadence);
  const qs=q.toString(),path='/api/plan'+(qs?'?'+qs:'');
  if(!DRAW||DRAW._path!==path){want('plan',path,v=>{DRAW=v;DRAW._path=path;});return '<div class="stack"><section class="card a-hero">'+loading()+'</section></div>';}
  if(DRAW.error)return '<div class="stack"><section class="card a-hero">'+errBox(DRAW.error)+'</section></div>';
  const p=DRAW;
  let top='<section class="card" data-family="clay"><span class="t-label">Next draw</span>'+
    '<div class="inline" style="margin-top:var(--s3)"><div class="field"><span>Planned draw date</span><input type="date" data-fk="plandate" id="planDate" value="'+esc(p.suggested_draw||PLANQ.draw?p.draw:'')+'"></div>'+
    '<div class="field"><span>Routine cadence, months</span><input type="number" data-fk="plancad" id="planCad" value="'+esc(p.cadence)+'" min="1" max="60"></div>'+
    '<button class="btn btn--ink" type="button" data-fk="planbtn" onclick="act.plan()">Plan this draw</button></div>'+
    '<div class="btnrow" style="margin-top:var(--s3)">'+addReportBtn()+'</div>'+
    '<p class="t-note" style="margin-top:var(--s3)">'+(p.suggested_draw||PLANQ.draw?esc(p.draw)+' draw'+(p.draw===p.suggested_draw?', the next routine one':''):'No draw on record yet: pick a date for the first one, or read the plan as of today')+' · '+esc(p.tier||'no')+' tier · age '+(p.age??'–')+' · '+p.n_targets+' markers judged against researched targets. Every line below shows the rule it used.</p></section>';
  if(p.context&&p.context.length)top+='<section class="card card--tint" data-family="clay"><span class="t-label">Personal context</span><div class="rows">'+p.context.map(c=>
    '<div class="row"><span class="row__body"><span class="row__title">'+esc(c.item)+'</span><span class="row__meta">'+esc(c.category)+(c.date?' · '+esc(c.date):'')+'</span></span>'+
    (c.status==='confirm'?'<span class="pill" data-family="ember"><i class="dot"></i>please confirm</span>':'')+'</div>').join('')+'</div></section>';
  const show={order:3,skip:1,optional:1,covered:1,provider:2,done:3,other:3};
  let main='';
  p.sections.forEach(s=>{
    main+='<section class="card"'+(s.key==='order'?' data-family="clay"':'')+'><div class="split"><span class="t-head">'+esc(s.title.toLowerCase().replace(/^\w/,c=>c.toUpperCase()))+'</span><span class="mono" style="color:var(--ink-3);flex:none">'+s.panels.length+'</span></div>';
    if(!s.panels.length)main+='<p class="t-note" style="margin-top:var(--s2)">None.</p>';
    else{
      main+='<div class="rows">';
      s.panels.forEach(pn=>{const n=show[s.key]||2;
        main+='<div class="row"><span class="row__body"><span class="row__title">'+esc(pn.name)+'</span>'+
          pn.drivers.slice(0,n).map(d=>'<span class="row__note"><b>'+esc(d.display)+'</b> '+esc(d.last)+'<br>'+esc(d.reason||d.state||'')+'</span>').join('')+
          (pn.drivers.length>n?'<span class="row__note">and '+(pn.drivers.length-n)+' more</span>':'')+
          (pn.context||[]).map(c=>'<span class="row__note">context: '+esc(c.item)+(c.detail?' — '+esc(c.detail):'')+'</span>').join('')+
          '</span><span class="pill" data-family="clay">'+esc(pn.cost||'?')+' cost</span></div>';});
      main+='</div>';
    }
    main+='</section>';});
  let aside='';
  if(p.monitoring&&p.monitoring.length)aside+='<section class="card"><span class="t-label">Non-lab monitoring</span><div class="rows">'+p.monitoring.map(m=>
    '<div class="row"><span class="row__body"><span class="row__title">'+esc(m.item)+'</span><span class="row__meta">'+esc(m.text||'')+'</span></span>'+
    (m.overdue?'<span class="pill" data-family="ember"><i class="dot"></i>'+esc(m.due||'overdue')+'</span>':'<span class="pill pill--ghost">'+esc(m.due||'not scheduled')+'</span>')+'</div>').join('')+'</div></section>';
  return '<div class="stack stack--top"><div class="pile a-hero">'+top+'</div><div class="pile a-main">'+main+'</div><div class="pile a-aside">'+aside+'</div></div>';
}

/* ---- ADD A REPORT: a lab report from any lab, results typed from paper, or a food tracking
   app's export, each previewed before anything is stored. Lab reports lead: tracking is optional --- */
function counter(c){
  const cell=(name,n,alert)=>'<div class="ctr-c'+(n>0?' on':'')+(alert&&n>0?' need':'')+'"><span class="k">'+esc(name)+'</span><span class="v">'+n+'</span></div>';
  return '<div class="ctr"><div class="ctr-g">'+cell('conflict',c.CONFLICT,true)+cell('supersede',c.SUPERSEDE,false)+'</div>'+
    '<div class="ctr-g">'+cell('new',c.NEW,false)+cell('already stored',c.SAME,false)+cell('duplicate',c.DUP,false)+'</div></div>';
}
function viewReports(){
  if(!FILES){want('files','/api/files',v=>{FILES=v;});return '<div class="stack"><section class="card a-hero">'+loading()+'</section></div>';}
  /* An upload, a commit or a tracker import marks the file list stale rather than clearing it: a
     commit's own "Committed" card sits on this same screen, and clearing FILES to force a refetch
     used to blank the whole page -- that card included -- back to a bare spinner for one render,
     so the confirmation was gone before it could be seen and only reappeared, correctly, once the
     background fetch resolved. Nothing was actually wrong; it just never stayed on screen long
     enough to read (his report, 2026-09-09: "unclear to know that its committed... only when you
     go to a different page and go back does it show"). Now the stale list keeps showing while a
     fresh one loads quietly behind it, and the row updates in place once it lands. */
  if(FILES_STALE){FILES_STALE=false;want('files','/api/files',v=>{FILES=v;});}
  if(FILES.error)return '<div class="stack"><section class="card a-hero">'+errBox(FILES.error)+'</section></div>';
  const f=FILES;
  let top='<section class="card" data-family="plum"><span class="t-label">Add a report</span>'+
    '<p class="t-body" style="margin:var(--s2) 0 var(--s4)">A lab report PDF from any lab. Nothing is stored until you see the preview and press the button.</p>'+
    '<div class="filepick"><input type="file" id="upl" data-fk="upl" accept=".pdf,.csv,.xlsx,.xlsm,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">'+
    '<button class="btn btn--ink" type="button" data-fk="uplbtn" onclick="act.upload()">Upload and preview</button></div>'+
    '<div class="btnrow" style="margin-top:var(--s3)"><button class="btn" type="button" data-fk="typebtn" onclick="act.typeReport()">Type the results</button></div>'+
    '<p class="t-note" style="margin-top:var(--s2)">No PDF, or one the app cannot read? Type the results from the paper and they take the same road.</p>'+
    '<p class="t-note" style="margin-top:var(--s2)">Optional: a food tracking app\'s export adds your weight and intake. The steps differ per app; in MacroFactor it is More, Data Management, Data Export, Quick Export, and the .xlsx it gives you works as-is.</p>'+
    (MSG?'<p class="t-note" style="margin-top:var(--s3)">'+esc(MSG)+'</p>':'')+'</section>';
  MKCAT=f.markers||MKCAT;
  if(ING)top+=viewIngest();
  let main='<section class="card"><div class="split"><span class="t-label">Lab reports on file</span><span class="mono" style="color:var(--ink-3)">'+f.files.length+'</span></div><div class="rows">';
  f.files.forEach(x=>{main+='<div class="row"><span class="row__body"><span class="row__title">'+esc(x.name)+'</span>'+
    '<span class="row__meta">'+(x.rows_stored?x.rows_stored+' rows stored':'not ingested')+'</span></span>'+
    '<button class="btn btn--sm" type="button" data-fk="prev:'+esc(x.file)+'" onclick="act.preview(\''+esc(x.file)+'\')">Preview</button></div>';});
  main+='</div></section>';
  let aside='';
  if(f.csvs&&f.csvs.length){aside+='<section class="card"><div class="split"><span class="t-label">Food tracking exports</span><span class="mono" style="color:var(--ink-3)">'+f.csvs.length+'</span></div><div class="rows">';
    f.csvs.forEach(x=>{aside+='<div class="row"><span class="row__body"><span class="row__title">'+esc(x.name)+'</span>'+
      '<span class="row__meta">'+(x.imported?'imported':'not imported')+'</span></span>'+
      '<button class="btn btn--sm" type="button" data-fk="trk:'+esc(x.file)+'" onclick="act.tracker(\''+esc(x.file)+'\')">Preview import</button></div>';});
    aside+='</div></section>';}
  aside+='<p class="t-note" style="padding:0 var(--s2)">'+(LOCAL?'Reports stay on this device. Keep a backup after each upload: You, top right, then Your data.':'Files live in '+esc(f.raw_dir)+'. Dropping one there works too.')+'</p>';
  return '<div class="stack stack--top"><div class="pile a-hero">'+top+'</div><div class="pile a-main">'+main+'</div><div class="pile a-aside">'+aside+'</div></div>';
}
function viewIngest(){
  const r=ING;
  if(r.loading)return '<section class="card">'+loading()+'</section>';
  if(r.error&&!r.edit)return '<section class="card">'+errBox(r.error)+diagBlock(r.diag)+'</section>';
  if(r.kind==='tracker'){
    const c=r.counts;
    let h='<section class="card"><span class="t-label">Food tracking export</span><p class="t-head" style="margin-top:var(--s2)">'+esc(r.file)+'</p>';
    if(r.committed)h+='<div class="callout good">Imported. Weight and intake now show under Body.</div>';
    h+='<p class="t-note" style="margin-top:var(--s2)">Columns recognised: '+Object.entries(r.mapping).map(([k,v])=>'<b>'+esc(k)+'</b> from '+esc(v)).join(', ')+'</p>';
    if(r.sheets_used&&r.sheets_used.length)h+='<p class="t-note" style="margin-top:var(--s1)"><b>Read from:</b> '+esc(r.sheets_used.join(', '))+(r.sheets&&r.sheets.length>r.sheets_used.length?' (of '+r.sheets.length+' sheets in the file)':'')+'</p>';
    if(r.bad_dates)h+='<p class="t-note" style="margin-top:var(--s1)">'+r.bad_dates+' rows had a date that could not be read.</p>';
    h+='<div class="scroll-x" style="margin-top:var(--s3)"><table class="data"><thead><tr><th></th><th class="n">Rows in file</th><th class="n">New</th><th class="n">Unchanged</th><th class="n">Updated</th><th class="n">Stored after</th></tr></thead><tbody>'+
      '<tr><td>Weight</td><td class="n">'+r.body_rows+'</td><td class="n">'+c.body.new+'</td><td class="n">'+c.body.same+'</td><td class="n">'+c.body.changed+'</td><td class="n">'+c.body.total_after+'</td></tr>'+
      '<tr><td>Daily intake</td><td class="n">'+r.intake_rows+'</td><td class="n">'+c.intake.new+'</td><td class="n">'+c.intake.same+'</td><td class="n">'+c.intake.changed+'</td><td class="n">'+c.intake.total_after+'</td></tr></tbody></table></div>';
    if(!r.committed)h+='<div style="margin-top:var(--s4)"><button class="btn btn--ink" type="button" data-fk="trkcommit" onclick="act.trackerCommit()"'+((c.body.new+c.body.changed+c.intake.new+c.intake.changed)===0?' disabled':'')+'>Import</button></div>'+
      '<p class="t-note" style="margin-top:var(--s3)">Writes to labs/body_metrics.csv and labs/intake_daily.csv. Re-importing the same file changes nothing.</p>';
    return h+'</section>';
  }
  /* A lab report, or results typed in: one card says what was read and how, the fields the
     whole report shares, the counter and the buttons; a second card is the rows, each one
     opening in place to be corrected, mapped or left out. Nothing is stored until Commit. */
  const info=r.info||{}, c=r.counts||null, st=r.opts||{}, edit=r.edit||[], mk=r.markers||[];
  const names={};mk.forEach(m=>names[m[0]]=m[1]);
  const typed=!!r.manual, scanned=!!info.scanned, checked=!!c;
  let h='<section class="card"><span class="t-label">'+(typed?'Typed results':'Lab report')+'</span>'+
    '<p class="t-head" style="margin-top:var(--s2)">'+esc(typed?'Typed in':info.file||'')+'</p>';
  if(r.error)h+=errBox(r.error);
  if(scanned)h+='<div class="callout warn">This report has no text layer (it looks scanned), so nothing could be read from it. Type the values you want to keep below, then commit.</div>';
  else if(typed)h+='<p class="t-note" style="margin-top:var(--s2)">Type what the report says, as printed. Nothing is stored until you check the lines and press Commit.</p>';
  else h+='<p class="t-note" style="margin-top:var(--s2)">'+(info.verified?'Read with '+esc(info.method)+' (parser '+esc(info.parser)+').':'Read by the shape of its rows, not by a layout the app knows, so check every row before you commit. Read with '+esc(info.method)+'.')+
    (info.specimen?' Specimen '+esc(info.specimen)+'.':'')+'</p>';
  if(r.result){
    const al=r.result.aliases||0;
    h+='<div class="callout good">Committed. '+r.result.written+' new row'+(r.result.written===1?'':'s')+' written'+(r.result.superseded?', '+r.result.superseded+' typed row'+(r.result.superseded===1?'':'s')+' replaced':'')+(r.result.replaced?', '+r.result.replaced+' conflicting row'+(r.result.replaced===1?'':'s')+' replaced':'')+'.'+
      (al?' '+al+' printed name'+(al===1?' will match':'s will match')+' by itself next time.':'')+
      (LOCAL?' Lab results are the irreplaceable part, so keep a copy now. <button class="btn btn--sm" type="button" data-fk="bkup" onclick="act.backup()">Back up</button>':'')+'</div>';
    if(r.dinner)h+='<div class="callout" style="background:var(--sprout-wash);color:var(--ink)"><b>'+esc(r.dinner.line)+'</b>'+
      (r.dinner.changed?' <button class="btn btn--sm btn--ink" type="button" data-fk="seerot" onclick="act.seeRotation()">See the rotation</button>':'')+'</div>';
  }
  h+='<div class="formgrid" style="margin-top:var(--s3)"><div class="field"><span>Drawn</span><input type="text" id="optDate" data-fk="optdate" inputmode="numeric" placeholder="YYYY-MM-DD" value="'+esc(st.date||info.date||'')+'"></div>'+
    '<div class="field"><span>Lab</span><input type="text" id="optLab" data-fk="optlab" placeholder="'+esc(typed?'Where it was drawn':'Unknown')+'" value="'+esc(st.lab||info.lab||'')+'"></div></div>';
  if(checked)h+='<p class="t-body" style="margin-top:var(--s3)">'+edit.length+' row'+(edit.length===1?'':'s')+(typed||scanned?' typed':' read')+'</p>'+counter(c);
  h+='<div class="formgrid" style="margin-top:var(--s3)"><label class="row" style="padding:6px 0"><input class="tick" type="checkbox" id="optSup" data-fk="optsup"'+(st.supersede?' checked':'')+'><span class="row__body row__title" style="white-space:normal">Replace hand-typed rows for this draw</span></label>'+
    '<label class="row" style="padding:6px 0;border-top:0"><input class="tick" type="checkbox" id="optRep" data-fk="optrep"'+(st.replace?' checked':'')+'><span class="row__body row__title" style="white-space:normal">Overwrite conflicting rows</span></label></div>'+
    '<div class="btnrow" style="margin-top:var(--s3)"><button class="btn" type="button" data-fk="reprev" onclick="act.preview(null)">'+(checked?'Check again':'Check the lines')+'</button>'+
    '<button class="btn btn--ink" type="button" data-fk="commit" onclick="act.preview(null,true)"'+((!checked||(c.NEW+c.SUPERSEDE+(st.replace?c.CONFLICT:0))===0||r.result)?' disabled':'')+'>Commit</button></div>'+
    '<p class="t-note" style="margin-top:var(--s3)">Commit stores what is on this screen: the rows that are ticked, as they read here. Re-importing the same report changes nothing.</p>';
  const nomatch=edit.filter(x=>x.keep&&!x.marker).length;
  if(nomatch)h+='<p class="t-note" style="margin-top:var(--s2)">'+nomatch+' printed name'+(nomatch===1?' has':'s have')+' no match yet. Open the row to say which trend it joins, or leave it: it is stored as printed and joins none.</p>';
  if(info.unparsed&&info.unparsed.length)h+='<div class="callout warn">Lines that looked like results but were not read, in case one matters: '+info.unparsed.map(esc).join(' — ')+'. Add a line below to keep one.</div>';
  if(info.ignored&&info.ignored.length)h+='<p class="t-note" style="margin-top:var(--s2)">Skipped, per ignore.csv: '+esc(info.ignored.join('; '))+'.</p>';
  h+='</section>';
  /* the rows: a tick to keep or leave out, the printed name and what was read, a pill when there
     is something to say, and the row opened to its fields */
  h+='<section class="card"><div class="split"><span class="t-label">'+(typed?'The lines':'The rows')+'</span><span class="mono" style="color:var(--ink-3)">'+edit.filter(x=>x.keep).length+' to store</span></div><div class="rows">';
  edit.forEach((x,i)=>{h+=ingRow(x,i,names,r.unmapped||{},mk);});
  h+='</div><div class="btnrow" style="margin-top:var(--s4)"><button class="btn" type="button" data-fk="ingadd" onclick="act.ingAdd()">Add a line</button></div>';
  if(!edit.length)h+='<p class="t-note" style="margin-top:var(--s3)">Nothing here yet. Add a line for each result you want to keep: the name as the report prints it, the number, and the unit and range if it shows them.</p>';
  return h+'</section>';
}
/* one row of the preview: the meta says what was read; opened, the same things are fields */
function ingRow(x,i,names,unmapped,mk){
  const open=!!x.open, meta=[x.value+(x.unit?' '+x.unit:''),x.lab_flag?'flag '+x.lab_flag:'',x.ref_range?'range '+x.ref_range:'',x.marker?'joins '+(names[x.marker]||x.marker):''].filter(Boolean).join(' · ');
  const w=(x.status||'').split(' ')[0];
  let pill='';
  if(x.keep&&!x.marker)pill='<span class="pill" data-family="ember"><i class="dot"></i>no match</span>';
  else if(w==='CONFLICT')pill='<span class="pill hot"><i class="dot"></i>conflict</span>';
  else if(w==='NEW')pill='<span class="pill ok"><i class="dot"></i>new</span>';
  else if(w==='SAME')pill='<span class="pill pill--ghost">already stored</span>';
  else if(w==='DUP')pill='<span class="pill pill--ghost">duplicate</span>';
  else if(w==='SUPERSEDE')pill='<span class="pill pill--ghost">replaces a typed row</span>';
  const sugg=unmapped[x.test_name]||[];
  const cats={};mk.forEach(m=>{(cats[m[2]||'other']=cats[m[2]||'other']||[]).push(m);});
  let opts='<option value=""'+(x.marker?'':' selected')+'>No match: stored as printed, joins no trend</option>';
  if(sugg.length)opts+='<optgroup label="Closest">'+sugg.map(id=>'<option value="'+esc(id)+'"'+(x.marker===id?' selected':'')+'>'+esc(names[id]||id)+'</option>').join('')+'</optgroup>';
  Object.keys(cats).forEach(cat=>{opts+='<optgroup label="'+esc(cat.replace(/_/g,' '))+'">'+cats[cat].map(m=>'<option value="'+esc(m[0])+'"'+(x.marker===m[0]?' selected':'')+'>'+esc(m[1]||m[0])+'</option>').join('')+'</optgroup>';});
  const f=(k,label,ph,wide)=>'<div class="field'+(wide?' wide':'')+'"><span>'+label+'</span><input type="text" data-fk="ing:'+i+':'+k+'" placeholder="'+esc(ph||'')+'" value="'+esc(x[k]||'')+'" oninput="act.ingSet('+i+',\''+k+'\',this.value)"></div>';
  return '<div class="exp ingrow'+(open?' open':'')+'">'+
    '<div class="row"><input class="tick tick--keep" type="checkbox" data-fk="ingkeep:'+i+'" aria-label="Keep this row"'+(x.keep?' checked':'')+' onchange="act.ingKeep('+i+',this.checked)">'+
    '<button class="row__body" type="button" data-fk="ingopen:'+i+'" onclick="act.ingOpen('+i+')" aria-expanded="'+open+'">'+
      '<span class="row__title">'+esc(x.test_name||'New line')+'</span><span class="row__meta">'+esc(meta||(x.test_name?'':'name, number, unit and range'))+(x.panel?(meta?' · ':'')+esc(x.panel):'')+'</span></button>'+pill+'<span class="chev"></span></div>'+
    '<div class="exp-b"><div><div class="rot__in"><div class="formgrid">'+
      f('test_name','Test, as printed','Ferritin',true)+f('value','Number','412')+f('unit','Unit','ng/mL')+f('ref_range','Range printed','30-400')+f('lab_flag','Flag printed','H or High')+
      '<div class="field wide"><span>Joins the trend for</span><select data-fk="ing:'+i+':marker" onchange="act.ingSet('+i+',\'marker\',this.value);render()">'+opts+'</select></div>'+
      f('panel','Panel','',true)+
    '</div></div></div></div></div>';
}
/* After a commit the plan is rebuilt from the store, and dinner answers in one line, in the
   words the Rotation uses: which plate becomes which, gated on the stock already owned. The
   marker behind it sits one tap deeper, on the Rotation's why-card, never here. */
async function dinnerAfter(r){
  try{const cfg=await api('/api/plate/config');const now=(cfg.plan&&cfg.plan.swaps)||[];
    const had=new Set(SWAPS.map(s=>s.key)),has=new Set(now.map(s=>s.key));
    const added=now.filter(s=>!had.has(s.key)),gone=SWAPS.filter(s=>!has.has(s.key));
    let line;
    if(added.length)line='Dinner changes: '+added.map(s=>s.from_name+' becomes '+s.to_name+(s.gate_name?', once the '+s.gate_name+' you have is gone':'')).join('; ')+'.';
    else if(gone.length)line='Dinner: '+gone.map(s=>s.from_name+' stays, the swap to '+s.to_name+' is no longer asked for').join('; ')+'.';
    else if(now.length)line='Dinner is unchanged: the swap already waiting still stands.';
    else{const d=await api('/api/diet').catch(()=>null), stood=[...new Set(((d&&d.notes)||[]).filter(n=>n.unmoved).map(n=>n.display))];
      line=stood.length?'Dinner stays as it is: the '+planName()+' plan does not let '+list(stood)+' move dinner.':'Dinner stays as it is: the rotation already meets what your labs ask for.';}
    if(ING===r){r.dinner={line:line,changed:added.length>0||gone.length>0};render();}}
  catch(e){}
}

/* ---- HOW YOU EAT: the plan in play, and what another would leave out --------------------- */
let RSEL=null,RMSG='',RAV=null;         /* the picker's unsaved choice, and its unsaved chips */
function viewRegimen(){
  const cur=RSEL==null?(REG?REG.id:''):RSEL, r=REGS.find(x=>x.id===cur)||null;
  const fit=x=>planFit(x,[]).length;                 /* the dinners a person can rotate through: declared, and not left out */
  let h='<section class="card" id="regimen" data-family="sprout"><div class="split"><span class="t-label">How you eat</span>'+
    '<span class="mono" style="color:var(--ink-3)">'+(r?fit(r)+' dinners':'any meal')+'</span></div>'+
    '<p class="t-note" style="margin:var(--s2) 0 var(--s1)">A plan says what a meal may contain and how many nights of each protein a cycle asks for. Your labs adjust those counts on top of it, where the plan lets them.</p>'+
    '<div class="formgrid"><div class="field wide"><span>Plan</span><select data-fk="regsel" onchange="act.regimenPick(this.value)">'+
    '<option value=""'+(cur===''?' selected':'')+'>No plan: any meal in the catalog</option>'+
    REGS.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===cur?' selected':'')+'>'+esc(x.name)+' · '+fit(x)+' dinners</option>').join('')+'</select></div></div>';
  const rav=RAV||AVOID_OWN;
  h+='<span class="t-label" style="display:block;margin-top:var(--s4)">Leave out</span><p class="t-note" style="margin:var(--s1) 0 0">Anything you will not eat, on top of the plan. A meal, a cold option, a kit or a pantry row that has it leaves the pool.</p>'+fieldAvoid('rg-avoid-',rav,r);
  if(AVOID_OWN.length){const gone=[...new Set(S.order.filter(k=>MEALS[k]&&(MEALS[k].excluded||[]).some(t=>AVOID_OWN.includes(t))))];
    h+='<p class="t-note" style="margin-top:var(--s2)">You leave out '+esc(list(AVOID_OWN.map(t=>TAGWORD[t]||t)))+'. '+(gone.length?gone.length+' of your '+N+' rotation nights change ('+esc(gone.map(k=>MEALS[k].name).join(', '))+'), each once the stock it was eating is gone.':'Nothing in your rotation has it.')+'</p>';}
  if(!r)h+='<p class="t-body" id="rg-planline" style="margin-top:var(--s3);color:var(--ink)">'+esc(planLine(null,rav))+'</p>';
  if(r){
    const out=new Set(r.leaves_out_meals||[]), gone=S.order.filter(k=>out.has(k)), names=[...new Set(gone.map(k=>MEALS[k]?MEALS[k].name:k))];
    h+='<p class="t-body" id="rg-planline" style="margin-top:var(--s3);color:var(--ink)">'+esc(planLine(r,rav))+'</p>';
    if(planFit(r,rav).length===0)h+='<div class="callout warn" style="margin-top:var(--s3)">No meal in the catalog fits this plan with what you leave out, so the rotation would stand as it is until one is added.</div>';
    else if(gone.length)h+='<p class="t-note" style="margin-top:var(--s2)">'+gone.length+' of your '+N+' rotation nights would change ('+esc(names.join(', '))+'), each once the stock it was eating is gone.</p>';
    /* what the plan and the chips together leave out of the pools, as a count and the groups,
       never a list of the food itself: a wall of labels a person will not eat is noise, and the
       rows say the rest. Counted here over every option, both reasons at once: the plan's own
       count alone fell from 2 to 1 when gluten was ticked, since an option the chip had already
       removed no longer counted as the plan's, and what the chip removed was said nowhere (his
       screenshot, 2026-09-08). */
    {const gone=new Set();let n=0;SLOTS.forEach(sl=>sl.opts.forEach(o=>{const t=leavesOut(o.contains,r), c=(o.contains||[]).filter(x=>rav.includes(x));
        if(!t.length&&!c.length)return;n++;t.forEach(x=>gone.add(x));c.forEach(x=>gone.add(x));}));
      if(n)h+='<p class="t-note" style="margin-top:var(--s2)">'+n+' cold option'+(n===1?' leaves':'s leave')+': anything with '+esc(tagWords([...gone]))+'.</p>';}
  }
  h+='<div class="btnrow" style="margin-top:var(--s4)"><button class="btn btn--ink" type="button" data-fk="regsave" onclick="act.saveRegimen()">Save</button></div>'+
    (RMSG?'<p class="t-note" style="margin-top:var(--s3)">'+esc(RMSG)+'</p>':'')+'</section>';
  return h;
}

/* ---- WHO EATS: how many people the kitchen cooks for ------------------------------------- */
let PMSG='';                            /* the picker's save error, if any */
/* Read fresh from the DOM at Save, not mirrored into a variable on every keystroke: this input
   has no oninput handler and the view is never re-rendered while it is being typed into, the
   same pattern the cadence field under Profile already uses. */
function viewWhoEats(){
  let h='<section class="card" id="whoeats" data-family="sprout"><div class="split"><span class="t-label">Who eats</span>'+
    '<span class="mono" style="color:var(--ink-3)">'+esc(peopleWord(PORTIONS))+'</span></div>'+
    '<p class="t-note" style="margin:var(--s2) 0 var(--s1)">How many people the kitchen cooks for. This multiplies what a meal buys and uses; it never changes your calorie or protein targets. A meal with no cooking guidance at this size says so on Kitchen rather than guessing.</p>'+
    '<div class="formgrid"><div class="field"><span>People</span><input type="number" id="peopleIn" data-fk="peoplein" min="1" max="100" step="1" value="'+esc(fmt(PORTIONS))+'"></div></div>';
  if(OCC.length>1){
    h+='<p class="t-note" style="margin-top:var(--s3)">Each occasion below follows that number unless it has its own.</p><div class="formgrid">'+
      OCC.map(o=>'<div class="field"><span>'+esc(o.name)+'</span><input type="number" id="occIn-'+esc(o.id)+'" data-fk="occin-'+esc(o.id)+'" min="1" max="100" step="1" placeholder="'+esc(fmt(PORTIONS))+'" value="'+(o.portions_own!=null?esc(fmt(o.portions_own)):'')+'"></div>').join('')+
      '</div>';
  }
  h+='<div class="btnrow" style="margin-top:var(--s4)"><button class="btn btn--ink" type="button" data-fk="peoplesave" onclick="act.saveWhoEats()">Save</button></div>'+
    (PMSG?'<p class="t-note" style="margin-top:var(--s3)">'+esc(PMSG)+'</p>':'')+'</section>';
  return h;
}
/* the interview's other answers as /api/setup would send them, for an estimate that has to
   know the plan; the Profile card has no interview beside it and sends none */
function setupAnswers(prefix){
  if(prefix!=='fr-')return {};
  const g=id=>document.getElementById(id), on=(pre,keys)=>keys.filter(k=>{const el=g(pre+k);return el&&el.checked;});
  if(!g('fr-regimen'))return {};
  return {regimen:g('fr-regimen').value,portions:g('fr-people').value,occasions:on('fr-occ-',(CFG.occasion_catalog||[]).map(o=>o.id)).join('|'),avoid:on('fr-avoid-',CHIP_TAGS).join('|')};
}
/* ---- YOUR KITCHEN, WHEN YOU EAT, and FIRST RUN ------------------------------------------- */
let KMSG='',OMSG='',FRMSG='';          /* the cards' and the interview's save errors, if any */
const TIMES=[[10,'About 10 minutes'],[20,'About 20 minutes'],[30,'About 30 minutes'],[60,'As long as it takes']];
/* One renderer per question, used by the interview and by the Profile card alike, so the two
   cannot drift. Read fresh from the DOM at Save, like the other pickers. */
function fieldKitchen(prefix,on){
  return '<div class="rows">'+CFG.equipment_catalog.map(e=>'<div class="row"><input class="tick" type="checkbox" id="'+prefix+esc(e)+'" data-fk="'+prefix+esc(e)+'"'+(on.includes(e)?' checked':'')+'>'+
    '<label class="row__body" for="'+prefix+esc(e)+'"><span class="row__title">'+esc(EQUIP[e].name)+'</span>'+(EQUIP[e].note?'<span class="row__meta">'+esc(EQUIP[e].note)+'</span>':'')+'</label></div>').join('')+'</div>';
}
function fieldTime(id,cur){
  const opts=TIMES.slice();
  if(cur!=null&&!opts.some(o=>o[0]===cur))opts.unshift([cur,'About '+fmt(cur)+' minutes']);
  opts.push(['','No ceiling']);
  return '<div class="formgrid" style="margin-top:var(--s3)"><div class="field wide"><span>Hands-on time you will give a meal</span><select id="'+id+'" data-fk="'+id+'">'+
    opts.map(([v,l])=>'<option value="'+v+'"'+((cur==null?v==='':v===cur)?' selected':'')+'>'+l+'</option>').join('')+'</select></div></div>';
}
function fieldOccasions(prefix,on){
  return '<div class="rows">'+(CFG.occasion_catalog||[]).map(o=>'<div class="row"><input class="tick" type="checkbox" id="'+prefix+esc(o.id)+'" data-fk="'+prefix+esc(o.id)+'"'+(on.includes(o.id)?' checked':'')+(o.rotation?' disabled':'')+'>'+
    '<label class="row__body" for="'+prefix+esc(o.id)+'"><span class="row__title">'+esc(o.name)+'</span>'+(o.rotation?'<span class="row__meta">carries the rotation</span>':'')+'</label></div>').join('')+'</div>';
}
/* what you will not eat: one tick per food group the engine knows, the same renderer in the
   interview and under How you eat. Read fresh from the DOM at Save, like the other pickers. */
function fieldAvoid(prefix,on,reg){
  return '<div class="ticks" id="'+prefix+'chips">'+chipsFor(reg).map(t=>'<label class="tick-pill" for="'+prefix+t+'"><input class="tick" type="checkbox" id="'+prefix+t+'" data-fk="'+prefix+t+'"'+(on.includes(t)?' checked':'')+
    ' onchange="act.chips(\''+prefix+'\')"><span>'+esc(TAGWORD[t])+'</span></label>').join('')+'</div>';
}
function ticked(prefix,keys){return keys.filter(k=>{const el=document.getElementById(prefix+k);return el&&el.checked;});}
function viewKitchenCard(){
  return '<section class="card" id="yourkitchen" data-family="clay"><div class="split"><span class="t-label">Your kitchen</span>'+
    '<span class="mono" style="color:var(--ink-3)">'+esc(CFG.equipment_order.map(e=>EQUIP[e].name).join(' · '))+'</span></div>'+
    '<p class="t-note" style="margin:var(--s2) 0 var(--s1)">A meal is written for each of these; one your kitchen cannot cook leaves the pool and says so. The time is a ceiling: a meal that needs more hands-on minutes sits out.</p>'+
    fieldKitchen('yk-eq-',CFG.equipment_order)+fieldTime('yk-time',BUDGET)+
    '<div class="btnrow" style="margin-top:var(--s4)"><button class="btn btn--ink" type="button" data-fk="yksave" onclick="act.saveKitchen()">Save</button></div>'+
    (KMSG?'<p class="t-note" style="margin-top:var(--s3)">'+esc(KMSG)+'</p>':'')+'</section>';
}
function viewOccasionsCard(){
  return '<section class="card" id="whenyoueat" data-family="frost"><div class="split"><span class="t-label">When you eat</span>'+
    '<span class="mono" style="color:var(--ink-3)">'+OCC.length+' a day</span></div>'+
    '<p class="t-note" style="margin:var(--s2) 0 var(--s1)">Dinner carries the recipe and is always on. The rest are quick options that rotate on their own; one log still means the whole day.</p>'+
    fieldOccasions('yo-occ-',OCC.map(o=>o.id))+
    '<div class="btnrow" style="margin-top:var(--s4)"><button class="btn btn--ink" type="button" data-fk="yosave" onclick="act.saveOccasions()">Save</button></div>'+
    (OMSG?'<p class="t-note" style="margin-top:var(--s3)">'+esc(OMSG)+'</p>':'')+'</section>';
}
/* ---- THE STORY. What Plateside is and the order it happens in, said once in five plain lines,
   because the first person it was shown to could not be told without a speech. It opens the
   interview and sits under Profile, drawn by one function so the two cannot drift. Food words
   throughout; the engine is named once and stays underneath. ---- */
const STORY=[
  ['Tell it about you','Six short questions: how you eat and who eats, what you cook on, when you eat, where you shop, your body, and what is in the kitchen now. It builds a rotation of dinners and sizes the plates for you.'],
  ['Cook tonight, log it, shop when it says','Tonight is one plate, with what to take out and how it cooks. Log what you ate and the stock counts down; the list for each store opens when it is time to go. No calendar: time moves when you eat.'],
  ['Add a lab report, and dinner adjusts','Any lab\'s PDF, or the numbers typed from paper. The markers set a few nights of the rotation, one swap at a time, only once the food you already bought is eaten.'],
  ['Weigh in, and the plate corrects itself','A few weigh-ins over three weeks tell it whether the plate is right. It steps the plate and says so on Tonight; Undo if you want it back.'],
  ['Know the next draw before you pay for it','It says when the next draw is due, what to order and what it costs, and after the retest, what moved, and whether dinner did anything about it.'],
];
function storyCard(opt){
  opt=opt||{};
  let body='<p class="t-note" style="margin:var(--s2) 0 var(--s1)">What to cook, what to buy, and when. Your weight goal sizes the plate; your blood work shapes the rotation underneath.</p><ol class="steps">';
  STORY.forEach(([t,d],i)=>{if(i===2&&planStays())[t,d]=reportLine('story');body+='<li><p><b>'+esc(t)+'.</b> '+esc(d)+'</p></li>';});   /* the report step, in this plan's words */
  body+='</ol>';
  if(opt.fold)return '<div class="'+(opt.cls||'')+'">'+fold(opt.id||'story','','How Plateside works','five steps, in order',body,false)+'</div>';
  return '<section class="card'+(opt.cls?' '+opt.cls:'')+'" id="'+(opt.id||'story')+'"><div class="split"><span class="t-label">How Plateside works</span><span class="mono" style="color:var(--ink-3)">in order</span></div>'+body+'</section>';
}

/* ---- THE PRIVACY LINE. One sentence, in his words, on the first screen and under Your data.
   It is literally true and a test holds the code to it: tests/test_privacy.py fails the build
   if the package or the page reaches any host. A draft until he writes the final words. ---- */
const PRIVACY=LOCAL?'Nothing you type or upload leaves this device. There is no account and no server of ours, and in this version nothing at all goes out.'
  :'Nothing you type or upload leaves this Mac and your own phone. There is no account and no server of ours, and in this version nothing at all goes out.';
const PRIVACY_TEST='A test holds the code to that sentence: the build fails if the app reaches any host.';
/* how the link becomes an app, in Safari's own words; said only while it is still a page in a browser */
const INSTALL='To keep it: in Safari tap Share, then Add to Home Screen. From then on it opens like an app, with its own icon, and works with no signal.';
const standalone=()=>!!(window.navigator.standalone||(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches));

/* ---- ABOUT YOU: the body the plate is sized from ----------------------------------------- */
/* Typed values live here across a redraw (the SED pattern), and one renderer serves the
   interview and the Profile card alike. The estimate itself is never computed on the page: the
   host answers /api/target with the same function /api/setup writes from, so the line shown is
   the line written. Nothing typed here leaves the device; on the Mac it is written to
   config/profile.csv, a file version control never sees. */
let BODYF={weight_lb:'',ft:'',inch:'',sex:'',dob:'',activity:'',goal:'',rate:'gentle'}, BODYSEED=false, TGT=null, TGTT=null, TMSG='';
const ACTS=[['sedentary','Mostly sitting'],['light','On my feet part of the day'],['moderate','Active most days'],['active','Training hard most days'],['very_active','A physical job, and training']];
const GOALSEL=[['hold','Hold my weight'],['lose','Lose weight'],['gain','Gain weight']];
const RATESEL=[['gentle','Gently, about half a pound a week'],['steady','Steadily, about a pound a week']];
const BODYLABEL={weight_lb:'weight',height_in:'height',sex:'sex',dob:'date of birth',activity:'how active you are',goal:'your goal'};
/* the Profile card starts from what the profile holds; the interview starts blank */
function bodySeed(pr){if(BODYSEED)return;BODYSEED=true;const h=parseFloat(pr.height_in||''),ft=isNaN(h)?null:Math.floor(h/12);
  BODYF={weight_lb:pr.weight_lb||'',ft:ft==null?'':String(ft),inch:ft==null?'':fmt(h-ft*12),sex:pr.sex||'',dob:pr.dob||'',
    activity:pr.activity||'',goal:pr.goal||'',rate:pr.rate||'gentle'};}
/* the rows /api/setup writes, from the fields: height in inches from feet and inches */
function bodyProfile(){const ft=parseFloat(BODYF.ft),inch=parseFloat(BODYF.inch||'0');
  return {weight_lb:String(BODYF.weight_lb||'').trim(),height_in:isNaN(ft)?'':fmt(ft*12+(isNaN(inch)?0:inch)),sex:BODYF.sex,dob:BODYF.dob,
    activity:BODYF.activity,goal:BODYF.goal,rate:BODYF.goal==='hold'?'':BODYF.rate};}
function bodyMissing(){const p=bodyProfile();return ['weight_lb','height_in','sex','dob','activity','goal'].filter(k=>!p[k]);}
/* the one line: the estimate, what is still needed, or what the host refused */
function targetLine(){
  const miss=bodyMissing();
  if(miss.length)return 'Still needed: '+list(miss.map(k=>BODYLABEL[k]||k))+'. Then your target appears here.';
  if(!TGT)return 'Working it out…';
  if(TGT.error)return TGT.error;
  const e=TGT.estimate||{}, k=TGT.kcal!=null?TGT.kcal:e.kcal;
  if(e.missing&&e.missing.length)return 'Still needed: '+list(e.missing.map(k=>BODYLABEL[k]||k))+'.';
  let s='About '+k.toLocaleString()+' kcal and '+e.protein_g+' g protein a day'+(e.protein_plan?', the '+e.protein_plan.toLowerCase()+' plan\'s floor of '+e.protein_per_lb+' g per lb':'')+(e.goal==='hold'?'.':e.goal==='lose'?', to lose '+(e.rate==='steady'?'about a pound':'about half a pound')+' a week.':', to gain '+(e.rate==='steady'?'about a pound':'about half a pound')+' a week.');
  if(e.kcal_floored)s+=' Held at '+e.kcal.toLocaleString()+' kcal, the lowest the plates go.';
  if(e.protein_clamped)s+=' Protein is held to '+e.protein_g+' g, the edge of the band the plan uses.';
  const p=TGT.plate;
  if(p&&p.ratio!=null){const pct=Math.round(Math.abs(1-p.plate)*100), dir=p.plate<1?'smaller':'larger';
    if(p.clamped)s+=' The plates cannot be scaled that far: they stop at '+pct+' percent '+dir+' than the recipes as written, about '+p.plate_kcal.toLocaleString()+' kcal a day.';
    else s+=p.plate===1?' Plates as the recipes are written.':' Plates about '+pct+' percent '+dir+' than the recipes as written.';
    /* the plate on the shelf is not this one yet: say what Save does, in the same words */
    if(S.setup&&Math.abs(p.plate-PLATE)>1e-9)s+=' They are '+(PLATE===1?'as written':'about '+Math.round(Math.abs(1-PLATE)*100)+' percent '+(PLATE<1?'smaller':'larger'))+' now; save, and they follow.';}
  return s;
}
function fieldBody(prefix){
  const set=k=>'onchange="act.bodySet(\''+k+'\',this.value,\''+prefix+'\')" oninput="act.bodySet(\''+k+'\',this.value,\''+prefix+'\')"';
  const sel=(k,opts,ph)=>'<select id="'+prefix+k+'" data-fk="'+prefix+k+'" '+set(k)+'>'+(ph?'<option value=""'+(BODYF[k]?'':' selected')+'>'+ph+'</option>':'')+
    opts.map(([v,l])=>'<option value="'+v+'"'+(BODYF[k]===v?' selected':'')+'>'+l+'</option>').join('')+'</select>';
  const inp=(k,type,extra)=>'<input type="'+type+'" id="'+prefix+k+'" data-fk="'+prefix+k+'" value="'+esc(BODYF[k])+'" '+set(k)+(extra||'')+'>';
  return '<div class="formgrid">'+
    '<div class="field"><span>Weight, lb</span>'+inp('weight_lb','number',' inputmode="decimal" min="50" max="700" step="any"')+'</div>'+
    '<div class="field"><span>Sex</span>'+sel('sex',[['m','Male'],['f','Female']],'Choose')+'</div>'+
    '<div class="field"><span>Height, feet</span>'+inp('ft','number',' inputmode="numeric" min="3" max="8" step="1"')+'</div>'+
    '<div class="field"><span>and inches</span>'+inp('inch','number',' inputmode="decimal" min="0" max="11.9" step="any" placeholder="0"')+'</div>'+
    '<div class="field wide"><span>Date of birth</span>'+inp('dob','date','')+'</div>'+
    '<div class="field wide"><span>How active you are</span>'+sel('activity',ACTS,'Choose')+'</div>'+
    '<div class="field"><span>Goal</span>'+sel('goal',GOALSEL,'Choose')+'</div>'+
    '<div class="field"'+(BODYF.goal==='hold'?' style="visibility:hidden"':'')+'><span>How fast</span>'+sel('rate',RATESEL)+'</div>'+
    '</div><p class="t-body" id="'+prefix+'target" data-fk="'+prefix+'target" style="margin-top:var(--s3);color:var(--ink)">'+esc(targetLine())+'</p>';
}
/* Your target under Profile: the day's numbers and the body they came from, changed here */
function viewTargetCard(pr){
  bodySeed(pr||{});
  /* a complete body with no line yet: ask once, the way a keystroke would */
  if(!TGT&&!bodyMissing().length&&!TGTT)TGTT=setTimeout(()=>act.estimate('yt-'),0);
  return '<section class="card" id="yourtarget" data-family="plum"><div class="split"><span class="t-label">Your target</span><span class="mono" style="color:var(--ink-3)">sizes your plates</span></div>'+
    '<p class="t-head" style="display:block;margin-top:var(--s2)">'+esc(PLATE===1?'Plates as the recipes are written.':'Plates about '+Math.round(Math.abs(1-PLATE)*100)+' percent '+(PLATE<1?'smaller':'larger')+' than the recipes as written.')+'</p>'+
    '<p class="t-note" style="margin:var(--s2) 0 var(--s3)">Sized from your body and your goal, and corrected by the scale over the weeks that follow. Change anything here and save; the plates follow.</p>'+
    fieldBody('yt-')+
    '<div class="btnrow" style="margin-top:var(--s4)"><button class="btn btn--ink" type="button" data-fk="ytsave" onclick="act.saveTarget()">Save</button></div>'+
    (TMSG?'<p class="t-note" style="margin-top:var(--s3)">'+esc(TMSG)+'</p>':'')+'</section>';
}
/* The first screen a stranger sees: seven questions, one save, then the stock question. The
   defaults here are a common kitchen and three meals a day, not the shipped file's values,
   because the shipped values are one person's and this screen exists to replace them. About
   you starts blank and is required: a skipped card would put one person's plate on another's
   table. */
function viewFirstRun(){
  const common=['oven','stovetop','microwave'].filter(e=>EQUIP[e]);
  const eqOn=common.length?common:CFG.equipment_order;
  const occOn=(CFG.occasion_catalog||[]).filter(o=>o.rotation||o.id==='breakfast'||o.id==='lunch').map(o=>o.id);
  const regDefault=REGS.some(x=>x.id==='omnivore')?'omnivore':(REG?REG.id:'');
  const fit=x=>planFit(x,[]).length;                 /* the dinners a person can rotate through */
  /* the rail: one segment per card, lit as each card comes into view, the body card's only when
     it is complete; and the bar that rises with the target line and the button once it is. The
     rail sits before the stack, which is a grid of named areas that would place it last. */
  let h='<div class="fr-rail" id="frrail" aria-hidden="true">'+FR_CARDS.map((c,i)=>'<i data-i="'+i+'"></i>').join('')+'<span id="frlabel">Set up your kitchen</span></div>';
  h+='<div class="stack stack--top">';
  h+='<section class="card card--lit hero hero--setup a-hero" data-family="sprout"><div class="hero-in">'+
    '<h1 class="mealname">Set up your kitchen</h1>'+
    '<p class="mealsub">Six short questions, then a rotation and a shopping list built for the way you eat, with plates sized for you.</p>'+
    '<p class="mealsub" style="margin-top:var(--s2)">'+esc(PRIVACY)+'</p></div></section>';
  /* the story folds: the five lines are one tap away, and the first question is on the first
     screen (the review: the first screen had no setup field). How to keep the link as an app
     comes after the first plate is logged, on Tonight, not here. */
  h+=storyCard({cls:'a-main',id:'story-fr',fold:true});
  /* the questions, one pile in the aside area: a bare card in the named-area grid is auto-placed
     into shared rows, and on the Mac the tall How you eat card left a void beside it */
  h+='<div class="pile a-aside">';
  h+='<section class="card fr-card" id="fr-c0"><span class="t-label">How you eat</span>'+
    '<div class="formgrid" style="margin-top:var(--s2)"><div class="field wide"><span>Plan</span><select id="fr-regimen" data-fk="fr-regimen" onchange="act.frPlan(this.value)">'+
    REGS.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===regDefault?' selected':'')+'>'+esc(x.name)+' · '+fit(x)+' dinners</option>').join('')+
    '<option value=""'+(regDefault===''?' selected':'')+'>No plan: any meal in the catalog</option></select></div>'+
    '<div class="field"><span>People</span><input type="number" id="fr-people" data-fk="fr-people" min="1" max="100" step="1" value="'+esc(fmt(PORTIONS))+'"></div></div>'+
    '<p class="t-note" id="fr-planline" style="margin:var(--s2) 0 0">'+esc(planLine(REGS.find(x=>x.id===regDefault)||null,AVOID_OWN))+'</p>'+
    '<span class="t-label" style="display:block;margin-top:var(--s4)">Leave out</span><p class="t-note" style="margin:var(--s1) 0 0">Anything you will not eat, on top of the plan. A meal, a cold option, a kit or a pantry row that has it leaves the pool.</p>'+fieldAvoid('fr-avoid-',AVOID,REGS.find(x=>x.id===regDefault)||null)+'</section>';
  h+='<section class="card fr-card" id="fr-c1"><span class="t-label">What you cook on</span>'+
    '<p class="t-note" style="margin:var(--s2) 0 var(--s1)">A meal is written for each of these. Tick what your kitchen has.</p>'+
    fieldKitchen('fr-eq-',eqOn)+fieldTime('fr-time',20)+'</section>';
  h+='<section class="card fr-card" id="fr-c2"><span class="t-label">When you eat</span>'+
    '<p class="t-note" style="margin:var(--s2) 0 var(--s1)">Dinner carries the recipe and is always on. The rest are quick options that rotate on their own.</p>'+
    fieldOccasions('fr-occ-',occOn)+'</section>';
  h+='<section class="card fr-card" id="fr-c3"><span class="t-label">Where you shop</span>'+
    '<p class="t-note" style="margin:var(--s2) 0 var(--s1)">Each store gets its own list and pack sizes. A store can be added later under You, top right.</p><div class="rows">'+
    SCAT.map(sk=>'<div class="row"><input class="tick" type="checkbox" id="fr-store-'+esc(sk)+'" data-fk="fr-store-'+esc(sk)+'"'+(SORDER.includes(sk)?' checked':'')+'>'+
      '<label class="row__body" for="fr-store-'+esc(sk)+'"><span class="row__title">'+esc(STORES[sk].name)+'</span><span class="row__meta">'+esc(String(STORES[sk].cadence||'').replace(/^\w/,c=>c.toUpperCase()))+'</span></label></div>').join('')+'</div></section>';
  h+='<section class="card fr-card" id="fr-c4" data-family="plum"><span class="t-label">About you</span>'+
    '<p class="t-note" style="margin:var(--s2) 0 var(--s3)">Your plates are sized from this. It is an estimate, within about 15 percent for any one person; the scale corrects it over the weeks that follow.</p>'+
    fieldBody('fr-')+'</section>';
  h+=fieldKitchenNow();
  h+='<div class="fr-cta" id="frcta" hidden><span class="fr-cta-line" id="frctaline"></span><button class="btn btn-eat" type="button" data-fk="fr-save2" onclick="act.saveSetup()">Build my rotation</button></div>';
  h+='<section class="card"><div class="actions"><button class="btn btn-eat" type="button" data-fk="fr-save" onclick="act.saveSetup()">Build my rotation</button></div>'+
    (FRMSG?'<p class="t-note" style="margin-top:var(--s3)">'+esc(FRMSG)+'</p>':'')+
    '</section>';
  if(LOCAL)h+='<section class="card"><span class="t-label">Already using Plateside?</span>'+
    '<p class="t-note" style="margin:var(--s2) 0 var(--s3)">Bring everything across from a backup: your reports, your results, your stock and your log. Nothing is sent anywhere.</p>'+
    '<div class="filepick"><input type="file" id="rst0" data-fk="rst0" accept=".plate,.bin,application/octet-stream">'+
    '<button class="btn" type="button" data-fk="rst0btn" onclick="act.restore(\'rst0\')">Restore from a backup</button></div>'+
    (MSG?'<p class="t-note" style="margin-top:var(--s3)">'+esc(MSG)+'</p>':'')+'</section>';
  return h+'</div></div>';
}
/* the six cards of the interview, in order, and what the rail says beside each */
const FR_CARDS=['How you eat','What you cook on','When you eat','Where you shop','About you','Your kitchen now'];
/* what is on the shelf already, asked before the first list is ever shown (the review: a
   40-item list before asking whether the kitchen is empty). Empty is the honest default. */
let FRKITCHEN='empty';
const FRKNOTE={empty:'The first store list stocks it, about three weeks of dinners.',
  some:'The first list opens; buy only what is missing, or plan a trip for the next few meals.',
  stocked:'A pack of everything the rotation uses is counted as on hand, and Tonight is the plate to cook.'};
function fieldKitchenNow(){
  return '<section class="card fr-card" id="fr-c5"><span class="t-label">Your kitchen now</span>'+
    '<p class="t-note" style="margin:var(--s2) 0 var(--s2)">What is on the shelf already. Nothing is counted until you say so.</p>'+
    '<div class="seg" role="radiogroup" aria-label="What is in your kitchen now">'+
    [['empty','Empty'],['some','Some of it'],['stocked','Stocked']].map(([v,w])=>'<button type="button" role="radio" data-fk="fr-kitchen:'+v+'" aria-checked="'+(FRKITCHEN===v)+'" onclick="act.frKitchen(\''+v+'\')">'+w+'</button>').join('')+'</div>'+
    '<p class="t-note" id="fr-kitchen-note" style="margin-top:var(--s2)">'+esc(FRKNOTE[FRKITCHEN])+'</p></section>';
}
let FRSEEN=[], FROBS=null;
/* after the interview paints: the rail lights each card as it comes into view, About you only
   once it is complete; the Build bar rises once the target line has something to say */
function frSync(){
  const rail=document.getElementById('frrail'); if(!rail){if(FROBS){FROBS.disconnect();FROBS=null;}return;}
  const segs=rail.querySelectorAll('i'), label=document.getElementById('frlabel');
  /* a sweep on every paint as well as the observer: a jump or a restored position can skip
     whole cards without the observer ever seeing them (DESIGN.md, the reveal note) */
  const sweep=()=>document.querySelectorAll('.fr-card').forEach(c=>{const r=c.getBoundingClientRect();
    if(r.top<window.innerHeight*0.72&&r.bottom>0){const i=+c.id.slice(5);if(!FRSEEN.includes(i))FRSEEN.push(i);}});
  const paint=()=>{
    sweep();
    const done=!bodyMissing().length;
    segs.forEach((el,i)=>el.className=(i===4?done:FRSEEN.includes(i))?'lit':'');
    const next=[0,1,2,3].find(i=>!FRSEEN.includes(i));
    if(label)label.textContent=next!=null?FR_CARDS[next]:!done?'About you':!FRSEEN.includes(5)?FR_CARDS[5]:'Ready to build';
    const cta=document.getElementById('frcta'), line=document.getElementById('frctaline');
    if(cta){cta.hidden=!done;if(line)line.textContent=done?targetLine():'';}
  };
  if(!FROBS){
    FROBS=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){const i=+e.target.id.slice(5);if(!FRSEEN.includes(i))FRSEEN.push(i);}});paint();},{threshold:0.35});
    document.querySelectorAll('.fr-card').forEach(c=>FROBS.observe(c));
    document.getElementById('app').addEventListener('input',()=>paint(),{passive:true});
    document.getElementById('app').addEventListener('change',()=>paint(),{passive:true});
    let t=null;window.addEventListener('scroll',()=>{if(!t&&document.getElementById('frrail'))t=setTimeout(()=>{t=null;paint();},80);},{passive:true});
  }
  paint();
}
/* ---- STORES: which stores are in play and, where two carry an item, which one ----------- */
let SPICK=null,SMSG='';                 /* the picker's unsaved choice: {shop:[...], picks:{}} */
let SED={item:'',store:'',pack:'',buy:'',msg:''}, SNEW={name:'',threshold:'',cadence:'',countdown:false,kind:'grocery',msg:''};
let SEDIT={key:'',name:'',kind:'grocery',threshold:'',cadence:'',msg:''};   /* a store being changed under Stores, by key */   /* the editor's typed values, kept across a redraw */
let HEDIT=null;                         /* a history row being changed, by position -- reopens Add a fact pre-filled */
let HDEL=null;                          /* a history row asking to be removed, by position, until confirmed or backed out of */
let RSTASK=false;                       /* the rotation restart, asked and awaiting a confirm on the You tab */
/* A save fetches the page again, because the catalog is resolved on the Mac and rides inside
   it; this remembers where he was so the reload lands him back on the editor. */
function returnTo(extra){try{sessionStorage.setItem('lt:return',JSON.stringify(Object.assign({tab:'you',mk:'overview',at:'sed'},extra||{})));}catch(e){}}
let SCROLLTO=null;                      /* an element id the next render that draws it scrolls to */
function spick(){if(!SPICK)SPICK={shop:SORDER.slice(),picks:Object.assign({},CFG.store_picks||{})};return SPICK;}
function viewStores(){
  const P=spick(), used=consumedSet(targetOrder()), live=liveItems();
  /* the same resolution the Mac runs, so the warning names exactly what a save would do */
  const at=k=>{const o=I[k].offers||{},p=P.picks[k];if(p&&o[p]&&P.shop.includes(p))return p;return P.shop.find(s=>o[s])||null;};
  const left=IORDER.filter(k=>used.has(k)&&!at(k));
  const carried=sk=>live.filter(k=>(I[k].offers||{})[sk]).length;
  let h=
    '<p class="t-note" style="margin:var(--s2) 0 var(--s1)">A store that is off drops out of the lists and the run countdown, and its pack sizes go with it.</p>';
  h+='<div class="rows">';
  SCAT.forEach(sk=>{const st=STORES[sk],on=P.shop.includes(sk);
    h+='<div class="row"><input class="tick" type="checkbox" id="st-'+esc(sk)+'"'+(on?' checked':'')+' data-fk="store:'+esc(sk)+'" onchange="act.storeToggle(\''+esc(sk)+'\')">'+
      '<label class="row__body" for="st-'+esc(sk)+'"><span class="row__title">'+esc(st.name)+' '+storeMark(st)+'</span><span class="row__meta">'+esc(String(st.cadence||'').replace(/^\w/,c=>c.toUpperCase()))+(st.cadence?' · ':'')+
      'carries '+carried(sk)+' of the '+live.length+' the rotation uses · list opens at '+(st.threshold||0)+' meals of supply</span></label>'+
      '<button class="btn btn--sm" type="button" data-fk="sedit:'+esc(sk)+'" onclick="act.storeEdit(\''+esc(sk)+'\')">Change</button></div>';});
  h+='</div>';
  /* the shipped stores are kinds (Warehouse club, Grocery store); here they take the name of the
     store they are, and their kind, line and cadence can change too */
  if(SEDIT.key&&STORES[SEDIT.key]){
    h+='<p class="t-note" style="margin-top:var(--s4);margin-bottom:var(--s2)">Change '+esc(STORES[SEDIT.key].name)+'. The name is yours to give it: Costco, Kroger, the corner shop.</p><div class="formgrid">'+
      '<div class="field wide"><span>Name</span><input data-fk="sename" value="'+esc(SEDIT.name)+'" oninput="act.sedit(\'name\',this.value)"></div>'+
      '<div class="field wide"><span>Kind of store</span><select data-fk="sekind" onchange="act.sedit(\'kind\',this.value)">'+
        [['grocery','Grocery store'],['warehouse','Warehouse club'],['market','Market or other']].map(([v,l])=>'<option value="'+v+'"'+(SEDIT.kind===v?' selected':'')+'>'+l+'</option>').join('')+'</select></div>'+
      '<div class="field"><span>List opens at, meals of supply</span><input type="number" inputmode="numeric" min="1" data-fk="sethr" value="'+esc(SEDIT.threshold)+'" oninput="act.sedit(\'threshold\',this.value)"></div>'+
      '<div class="field"><span>How often</span><input data-fk="secad" value="'+esc(SEDIT.cadence)+'" oninput="act.sedit(\'cadence\',this.value)"></div></div>'+
      '<div class="btnrow" style="margin-top:var(--s3)"><button class="btn btn--ink" type="button" data-fk="sesave" onclick="act.storeSave()">Save changes</button>'+
      '<button class="btn" type="button" data-fk="secancel" onclick="act.storeEdit(\'\')">Cancel</button></div>'+
      (SEDIT.msg?'<p class="t-note" style="margin-top:var(--s3)">'+esc(SEDIT.msg)+'</p>':'');
  }
  const choices=live.filter(k=>Object.keys(I[k].offers||{}).filter(s=>P.shop.includes(s)).length>1);
  if(choices.length){
    h+='<p class="t-note" style="margin-top:var(--s4);margin-bottom:var(--s2)">More than one store carries these. Where do you buy them?</p><div class="formgrid">';
    choices.forEach(k=>{const cur=at(k);
      h+='<div class="field"><span>'+esc(I[k].name)+'</span><select data-fk="pick:'+esc(k)+'" onchange="act.storePick(\''+esc(k)+'\',this.value)">'+
        Object.keys(I[k].offers).filter(s=>P.shop.includes(s)).map(s=>'<option value="'+esc(s)+'"'+(s===cur?' selected':'')+'>'+esc(STORES[s].name)+' — '+I[k].offers[s].pack+' '+esc(I[k].unit)+'</option>').join('')+
        '</select></div>';});
    h+='</div>';
  } else h+='<p class="t-note" style="margin-top:var(--s3)">Each item is carried by one store today. When a row in store_items.csv offers it at a second store, you choose where here.</p>';
  if(left.length)h+='<div class="callout warn">This leaves '+left.length+' item'+(left.length===1?'':'s')+' the rotation uses with no store: '+esc(left.map(k=>I[k].name).join(', '))+'.</div>';
  SCAT.filter(sk=>carried(sk)===0&&SCAT.length>1).forEach(sk=>{
    h+='<div class="btnrow" style="margin-top:var(--s3)"><button class="btn" type="button" data-fk="rmstore:'+esc(sk)+'" onclick="act.removeStore(\''+esc(sk)+'\')">Remove '+esc(STORES[sk].name)+'</button></div>';});
  h+='<div class="btnrow" style="margin-top:var(--s4)"><button class="btn btn--ink" type="button" data-fk="storesave" onclick="act.saveStores()">Save stores</button></div>'+
    (SMSG?'<p class="t-note" style="margin-top:var(--s3)">'+esc(SMSG)+'</p>':'');
  return fold('stores','clay','Stores',P.shop.length+' of '+SCAT.length+' in play',h,false);
}

/* ---- STORE EDITOR: what each store carries, and a new store ------------------------------ */
function viewStoreEditor(){
  const live=liveItems();
  const k=SED.item&&I[SED.item]?SED.item:'';
  /* first, what each store in play actually carries, by name: the answer to "where are the rest
     of the items?" that a count alone ("carries 34 of 40") kept raising (his report, 2026-09-09).
     The six a warehouse club does not carry are the produce and bread only the grocery does, and
     now they can be read rather than inferred. */
  const P=spick();
  let h='';
  P.shop.forEach(sk=>{const st=STORES[sk], has=live.filter(k=>(I[k].offers||{})[sk]);
    h+='<p class="t-note" style="margin:var(--s2) 0 0"><b>'+esc(st.name)+'</b> carries '+has.length+' of the '+live.length+' items the rotation uses'+(has.length?': '+esc(has.map(k=>I[k].name).join(', ')):'')+'.</p>';});
  h+='<p class="t-note" style="margin:var(--s3) 0 var(--s3)">Pick an item to see where it is carried. Change a pack size or a buy note, give it another store, or take a store away. Rows are saved '+WHERE+' and the lists rebuild.</p>'+
    '<div class="formgrid"><div class="field wide"><span>Item</span><select data-fk="seditem" onchange="act.edItem(this.value)">'+
      '<option value=""'+(k?'':' selected')+'>Choose an item</option>'+
      live.map(x=>'<option value="'+esc(x)+'"'+(x===k?' selected':'')+'>'+esc(I[x].name)+' · '+(I[x].store?esc(STORES[I[x].store].name):'no store in play')+'</option>').join('')+
      '</select></div></div>';
  if(k){
    const it=I[k], offers=it.offers||{};
    h+='<div class="rows" style="margin-top:var(--s2)">';
    Object.keys(offers).forEach(sk=>{const o=offers[sk], st=STORES[sk];
      h+='<div class="row"><span class="row__body"><span class="row__title">'+esc(st?st.name:sk)+'</span>'+
        '<span class="row__meta">'+o.pack+' '+esc(it.unit)+' per pack'+(o.buy?' · '+esc(o.buy):'')+(it.store===sk?' · buying here':st&&!st.shop?' · store is off':'')+'</span></span>'+
        '<span class="step2"><button class="btn btn--sm" type="button" data-fk="edrow:'+esc(sk)+'" onclick="act.edRow(\''+esc(sk)+'\')">Change</button>'+
        '<button class="btn btn--sm" type="button" data-fk="rmrow:'+esc(sk)+'" onclick="act.removeRow(\''+esc(sk)+'\',\''+esc(k)+'\')">Remove</button></span></div>';});
    h+='</div>';
    h+='<p class="t-note" style="margin-top:var(--s4);margin-bottom:var(--s2)">'+(SED.store&&offers[SED.store]?'Change the '+esc(STORES[SED.store].name)+' row':'Add a store for '+esc(it.name))+'</p>'+
      '<div class="formgrid">'+
      '<div class="field"><span>Store</span><select data-fk="sedstore" onchange="act.sed(\'store\',this.value)"><option value=""'+(SED.store?'':' selected')+'>Choose</option>'+
        SCAT.map(sk=>'<option value="'+esc(sk)+'"'+(sk===SED.store?' selected':'')+'>'+esc(STORES[sk].name)+(offers[sk]?' · carries it':'')+'</option>').join('')+'</select></div>'+
      '<div class="field"><span>Pack, '+esc(it.unit)+'</span><input type="number" inputmode="decimal" min="0" step="any" data-fk="sedpack" value="'+esc(SED.pack)+'" oninput="act.sed(\'pack\',this.value)"></div>'+
      '<div class="field wide"><span>Buy note</span><input data-fk="sedbuy" value="'+esc(SED.buy)+'" oninput="act.sed(\'buy\',this.value)" placeholder="e.g. 2 × 5 lb — freeze"></div>'+
      '<div class="field"><span>&nbsp;</span><button class="btn btn--ink" type="button" data-fk="sedsave" onclick="act.saveRow()">Save row</button></div></div>';
  }
  if(SED.msg)h+='<p class="t-note" style="margin-top:var(--s3)">'+esc(SED.msg)+'</p>';
  const sed=h;
  h=
    '<p class="t-note" style="margin:var(--s2) 0 var(--s3)">A new store joins the stores in play. Then give it items above.</p>'+
    '<div class="formgrid">'+
    '<div class="field wide"><span>Name</span><input data-fk="snname" value="'+esc(SNEW.name)+'" oninput="act.snew(\'name\',this.value)" placeholder="e.g. Aldi"></div>'+
    '<div class="field wide"><span>Kind of store</span><select data-fk="snkind" onchange="act.snew(\'kind\',this.value)">'+
      [['grocery','Grocery store'],['warehouse','Warehouse club'],['market','Market or other']].map(([v,l])=>'<option value="'+v+'"'+(SNEW.kind===v?' selected':'')+'>'+l+'</option>').join('')+'</select></div>'+
    '<div class="field"><span>List opens at, meals of supply</span><input type="number" inputmode="numeric" min="1" data-fk="snthr" value="'+esc(SNEW.threshold)+'" oninput="act.snew(\'threshold\',this.value)" placeholder="21"></div>'+
    '<div class="field"><span>How often</span><input data-fk="sncad" value="'+esc(SNEW.cadence)+'" oninput="act.snew(\'cadence\',this.value)" placeholder="e.g. weekly"></div></div>'+
    '<div class="rows"><div class="row"><input class="tick" type="checkbox" id="sncd"'+(SNEW.countdown?' checked':'')+' data-fk="sncd" onchange="act.snew(\'countdown\',this.checked)">'+
    '<label class="row__body" for="sncd"><span class="row__title">The run countdown follows this store</span><span class="row__meta">One store sets the pace: the one whose packs run out first. Costco today.</span></label></div></div>'+
    '<div class="btnrow" style="margin-top:var(--s2)"><button class="btn btn--ink" type="button" data-fk="snadd" onclick="act.addStore()">Add store</button></div>'+
    (SNEW.msg?'<p class="t-note" style="margin-top:var(--s3)">'+esc(SNEW.msg)+'</p>':'');
  return fold('sed','clay','What each store carries',live.length+' items',sed,false)+fold('newstore','clay','Add a store','',h,false);
}

/* ---- YOUR DATA: on the client-side build, everything Plateside knows is on this device ------ */
function viewDevice(L){
  const d=L.device||{};
  return '<section class="card" data-family="frost"><span class="t-label">Your data</span>'+
    '<p class="t-body" style="margin:var(--s2) 0 var(--s3)">Everything Plateside knows is on this device: '+(d.reports||0)+' lab report'+(d.reports===1?'':'s')+', '+(d.results||0)+' stored result'+(d.results===1?'':'s')+'. Nothing is sent anywhere.</p>'+
    '<p class="t-body" style="margin-bottom:var(--s3);color:var(--ink)">'+esc(PRIVACY)+'</p>'+
    '<p class="t-note" style="margin-bottom:var(--s3)">A backup is one file with all of it. Keep one after every lab report: a phone can clear a web app\'s storage it has not opened for a while, and the lab results are the part that cannot be typed back in. The app asks for one after each report for that reason.</p>'+
    (!standalone()?'<p class="t-note" style="margin-bottom:var(--s3)">'+esc(INSTALL)+'</p>':'')+
    '<div class="btnrow"><button class="btn btn--ink" type="button" data-fk="bkup" onclick="act.backup()">Back up</button></div>'+
    '<p class="t-note" style="margin:var(--s4) 0 var(--s2)">Restore replaces everything here with what a backup holds, then reloads.</p>'+
    '<div class="filepick"><input type="file" id="rst" data-fk="rst" accept=".plate,.bin,application/octet-stream">'+
    '<button class="btn" type="button" data-fk="rstbtn" onclick="act.restore(\'rst\')">Restore from a backup</button></div>'+
    (MSG?'<p class="t-note" style="margin-top:var(--s3)">'+esc(MSG)+'</p>':'')+
    '<p class="t-note" style="margin-top:var(--s3)">Build '+esc(d.build||'')+' · pdf.js '+esc(d.pdfjs||'')+'</p></section>';
}

/* ---- YOU: the person's own settings, from the round control in the masthead. Food first:
   the target, how you eat, who eats, the kitchen, when you eat and the stores; then your data,
   the lens and the tier, the health history, and the story last, as the reference. It was the
   last chip of Markers, off the right edge of a row that did not look scrollable, with the
   backup and the lens form ahead of every food setting a stranger came for. ----------------- */
function viewProfile(){
  if(!HIST){want('hist','/api/history',v=>{HIST=v;});}
  if(!LAN){want('lan','/api/lan',v=>{LAN=v;});}
  if(!HIST)return '<div class="stack"><section class="card a-hero">'+loading()+'</section></div>';
  if(HIST.error)return '<div class="stack"><section class="card a-hero">'+errBox(HIST.error)+'</section></div>';
  const h0=HIST,tiers=['low','borderline','intermediate','high','very_high'],pr=h0.profile||{};
  let data='';
  if(LAN&&!LAN.error&&LAN.local)data+=viewDevice(LAN);
  else if(LAN&&!LAN.error){
    data+='<section class="card" data-family="frost"><span class="t-label">Pair your phone</span>'+(LAN.lan
      ?'<p class="t-body" style="margin:var(--s2) 0 var(--s3)">On the same Wi-Fi, open this on the phone once, then Share, Add to Home Screen. The icon keeps the code, so it works on its own afterwards.</p>'+
       '<div class="code">'+esc(LAN.url)+'</div>'+
       '<p class="t-note" style="margin-top:var(--s3)">If the name form does not load on your network, this one uses the address instead. It can change when the router reassigns it.</p>'+
       '<div class="code" style="margin-top:var(--s2)">'+esc(LAN.url_ip)+'</div>'+
       '<p class="t-note" style="margin-top:var(--s3)">The code on its own, for a phone that says “not paired”: <b>'+esc((LAN.url.split('token=')[1]||''))+'</b></p>'
      :'<p class="t-body" style="margin-top:var(--s2)">This server is only answering this Mac. Start it with “Plateside (phone reachable)” to reach it from a phone.</p>')+
      '<p class="t-body" style="margin-top:var(--s4);color:var(--ink)">'+esc(PRIVACY)+'</p><p class="t-note" style="margin-top:var(--s1)">'+esc(PRIVACY_TEST)+'</p>'+
      '<p class="t-note" style="margin-top:var(--s4)">Or take everything with you: a backup is one file with every report, result, row and log, and Plateside on any other device restores from it.</p>'+
      '<div class="btnrow" style="margin-top:var(--s2)"><button class="btn" type="button" data-fk="bkup" onclick="act.backup()">Back up</button></div></section>';
  }
  const tier=tiers.includes(pr.risk_tier)?pr.risk_tier:'intermediate';
  let lens='<section class="card" id="lens" data-family="plum"><span class="t-label">Lens and risk tier</span><div class="formgrid" style="margin-top:var(--s3)">'+
    '<div class="field"><span>Which targets judge you</span><select id="lensSel" data-fk="lens">'+
      '<option value=""'+(!pr.guideline_lens?' selected':'')+'>Not chosen: conventional</option>'+
      '<option value="conventional"'+(pr.guideline_lens==='conventional'?' selected':'')+'>Conventional guidelines</option>'+
      '<option value="functional"'+(pr.guideline_lens==='functional'?' selected':'')+'>Functional, optimal ranges</option></select></div>'+
    '<div class="field"><span>Risk tier</span><select id="tierSel" data-fk="tier" onchange="act.tierWord(this.value)">'+tiers.map(t=>'<option value="'+t+'"'+(t===tier?' selected':'')+'>'+TIERWORD[t]+'</option>').join('')+'</select></div>'+
    /* the band the chosen tier means, in one line that follows the select before Save */
    '<p class="t-note wide" id="tierline" style="margin:0">'+esc(tierLine(tier))+'</p>'+
    '<div class="field"><span>Routine draw cadence, months</span><input type="number" id="cadIn" data-fk="cad" value="'+esc(pr.draw_cadence_months||'')+'" min="1" max="60"></div>'+
    '<div class="field"><span>&nbsp;</span><button class="btn btn--ink" type="button" data-fk="profsave" onclick="act.saveProfile()">Save</button></div></div>'+
    '<p class="t-note" style="margin-top:var(--s3)">The lens decides which set of targets judges your numbers; the tier sets three cholesterol targets and nothing else. Neither changes dinner on its own.'+(LOCAL?'':' Files live in '+esc(h0.config_dir)+'.')+'</p>'+
    /* how anyone would know theirs, and what each setting changes: five short facts, one tap away */
    '<div class="exp'+(OPEN==='lenshow'?' open':'')+'" style="margin-top:var(--s3)">'+
      '<button class="row" type="button" data-fk="lenshow" onclick="act.open(\'lenshow\')" aria-expanded="'+(OPEN==='lenshow')+'">'+
        '<span class="row__body"><span class="row__title">Your tier and lens, explained</span><span class="row__meta">how to know yours, and what each one changes</span></span><span class="chev"></span></button>'+
      '<div class="exp-b"><div><dl class="facts" style="margin-top:var(--s1);padding-bottom:var(--s3)">'+
        '<dt>The tier</dt><dd>The band your ten-year heart risk falls in, as the PREVENT calculator or your clinician puts it. '+tiers.map(t=>'<b>'+TIERWORD[t]+'</b>: '+TIERBAND[t]+'.').join(' ')+'</dd>'+
        '<dt>Knowing yours</dt><dd>Plateside cannot compute it: PREVENT needs your blood pressure and whether you smoke, have diabetes or take a statin or a blood-pressure pill, none of which the app asks. Your clinician can, in a minute, from the same blood work; so can the calculator at professional.heart.org. Until then the guideline default, intermediate, stands.</dd>'+
        '<dt>What it changes</dt><dd>Three targets: LDL, non-HDL and ApoB. A higher tier asks for lower lines. Nothing else in the app reads it.</dd>'+
        '<dt>The lens</dt><dd>Conventional judges every number against the major guidelines\' targets; functional against the tighter optimal ranges from functional and longevity medicine. Both are always shown on every marker. The lens picks which one counts as outside target, and outside target is what the food rules read, so a stricter lens can move more nights of the rotation'+esc(reportLine('lens'))+'.</dd>'+
        '<dt>Your history</dt><dd>A fact added below changes the draw plan, so what to test next and how soon, and the panels it sits beside. It changes dinner only when you mark it as one of five conditions: '+esc(HCOND.map(([id,w])=>w+' ('+HLEVER[id]+')').join('; '))+'. Only the tier and the lens change which targets judge you.</dd>'+
        '<dt>Why it matters</dt><dd>These two settings decide what outside target means for you, and that is the one thing the food rules read. Set them once, with your clinician if you can. The wrong tier judges your cholesterol against the wrong line.</dd>'+
      '</dl></div></div></div>';
  lens+='</section>';
  let top=viewTargetCard(pr);
  let main=viewRegimen();
  main+=viewWhoEats();
  main+=viewKitchenCard();
  main+=viewOccasionsCard();
  main+=viewStores();
  main+=viewStoreEditor();
  let guide='<section class="card" id="guidecard"><div class="split"><span class="t-label">The guide</span><span class="mono" style="color:var(--ink-3)">'+(GUIDE.filter(s=>S.seen.includes(s.key)).length)+' of '+GUIDE.length+' steps seen</span></div>'+
    '<p class="t-note" style="margin:var(--s2) 0 var(--s3)">The light that walks you through the loop: shop and Bought it, cook and Ate it all, add a report, weigh in, and what moved. Run it again any time; Next moves on, and × ends it.</p>'+
    '<div class="btnrow"><button class="btn btn--ink" type="button" data-fk="guideagain" onclick="act.guideAgain()">Show me around again</button></div></section>';
  let aside=viewAppearance()+guide+data+lens;
  aside+='<section class="card" data-family="plum"><div class="split"><span class="t-label">Health history</span><span class="mono" style="color:var(--ink-3)">'+(h0.items||[]).length+' facts</span></div>'+
    '<p class="t-note" style="margin:var(--s2) 0 var(--s1)">One line per fact. The planner shows these beside the panels they touch and never draws a clinical conclusion from them. A fact marked as a condition pulls one lever the food rules already have, and the row says which.</p><div class="rows">';
  (h0.items||[]).forEach((x,i)=>{
    const lever=x.condition?(x.condition==='kidney'&&x.protein_limit_g?'a kidney condition: nothing moves here; your limit on file, '+fmt(x.protein_limit_g)+' g a day, shown beside the day\'s protein on Tonight and beside your protein target under Markers':esc(condWord(x.condition))+': '+esc(HLEVER[x.condition]||'')):'';
    aside+='<div class="row"><span class="row__body"><span class="row__title">'+esc(x.item)+'</span><span class="row__meta">'+esc(x.category)+' · '+esc(x.status)+(x.date?' · '+esc(x.date):'')+
    ((x.affects||[]).length?' · touches '+esc(x.affects.join(', ')):'')+(x.interval_months?' · every '+x.interval_months+' mo':'')+(x.last_done?', last '+esc(x.last_done):'')+
    (lever?' · '+lever:'')+'</span>'+
    (x.detail?'<span class="row__note">'+esc(x.detail)+'</span>':'')+'</span>'+
    (HDEL===i?'<span class="btnrow"><button class="btn btn--sm" type="button" data-fk="histdelno" onclick="act.cancelRemoveHist()">Cancel</button>'+
      '<button class="btn btn--sm btn--ink" type="button" data-fk="histdelyes" onclick="act.removeHist('+i+')">Remove it</button></span>'
     :'<span class="btnrow"><button class="btn btn--sm" type="button" data-fk="histedit:'+i+'" onclick="act.editHist('+i+')">Edit</button>'+
      '<button class="btn btn--sm" type="button" data-fk="histdel:'+i+'" onclick="act.askRemoveHist('+i+')">Remove</button></span>')+
    '</div>';});
  aside+='</div></section>';
  const hEd=HEDIT!=null?(h0.items||[])[HEDIT]:null;
  const hSel=(id,v)=>(hEd&&hEd[id]===v)?' selected':'';
  aside+='<section class="card" id="hist-form"><span class="t-label">'+(hEd?'Edit a fact':'Add a fact')+'</span><div class="formgrid" style="margin-top:var(--s3)">'+
    '<div class="field wide"><span>Item · required</span><input id="hItem" data-fk="hitem" required placeholder="e.g. Imaging: echocardiogram finding" value="'+esc(hEd?hEd.item:'')+'"></div>'+
    '<div class="field"><span>Category</span><select id="hCat" data-fk="hcat"><option'+hSel('category','diagnosis')+'>diagnosis</option><option'+hSel('category','imaging')+'>imaging</option><option'+hSel('category','therapy')+'>therapy</option><option'+hSel('category','monitoring')+'>monitoring</option><option'+hSel('category','note')+'>note</option></select></div>'+
    '<div class="field"><span>Status</span><select id="hStatus" data-fk="hstatus"><option'+hSel('status','active')+'>active</option><option'+hSel('status','resolved')+'>resolved</option><option'+hSel('status','superseded')+'>superseded</option><option'+hSel('status','confirm')+'>confirm</option></select></div>'+
    '<div class="field"><span>Date, free text</span><input id="hDate" data-fk="hdate" placeholder="2026-02 or ~2024" value="'+esc(hEd?hEd.date:'')+'"></div>'+
    '<div class="field"><span>Touches, pipe separated</span><input id="hAff" data-fk="haff" placeholder="Lipid panel|ApoB" value="'+esc(hEd?(hEd.affects||[]).join('|'):'')+'"></div>'+
    '<div class="field"><span>Repeat every, months</span><input id="hInt" data-fk="hint" type="number" min="1" value="'+esc(hEd&&hEd.interval_months?hEd.interval_months:'')+'"></div>'+
    '<div class="field"><span>Last done</span><input id="hLast" data-fk="hlast" placeholder="2026-02-01" value="'+esc(hEd?hEd.last_done:'')+'"></div>'+
    '<div class="field wide"><span>Detail</span><input id="hDetail" data-fk="hdetail" value="'+esc(hEd?hEd.detail:'')+'"></div>'+
    '<div class="field wide"><span>Marks it as</span><select id="hCond" data-fk="hcond"><option value=""'+((!hEd||!hEd.condition)?' selected':'')+'>nothing the food rules read</option>'+HCOND.map(([id,w])=>'<option value="'+id+'"'+hSel('condition',id)+'>'+esc(w)+' · '+esc(HLEVER[id])+'</option>').join('')+'</select></div>'+
    '<div class="field wide"><span>Kidney protein limit, if your doctor gave you one, g per day (kidney only)</span><input id="hLimit" data-fk="hlimit" type="number" min="1" placeholder="e.g. 60" value="'+esc(hEd&&hEd.protein_limit_g?fmt(hEd.protein_limit_g):'')+'"></div>'+
    '<div class="field"><span>&nbsp;</span><div class="btnrow">'+
    '<button class="btn btn--ink" type="button" data-fk="hadd" onclick="act.addHist()">'+(hEd?'Save':'Add')+'</button>'+
    (hEd?'<button class="btn" type="button" data-fk="hcancel" onclick="act.cancelHistEdit()">Cancel</button>':'')+
    '</div></div></div>'+
    (HMSG?'<p class="t-note" id="hist-msg" style="margin-top:var(--s3)">'+esc(HMSG)+'</p>':'')+'</section>';
  aside+=storyCard();
  /* Restart the rotation, last on the account tab beside Your data / Back up / Restore. It clears
     the meal side back to an empty kitchen at meal 1 (the honest start, the same place a fresh setup
     lands: the first shopping list) and keeps the profile and the lab history untouched (it was
     called "Start over" and read as a full wipe; it never was one, his report 2026-09-09). Two-tap,
     mirroring the history row's Remove, so a stray tap cannot clear a rotation; the note says plainly
     what goes and what stays. A true erase-everything is deliberately not a one-tap button here: lab
     results cost real money and have no undo, and the profile is editable above without a reset. */
  aside+=RSTASK
    ?'<div class="btnrow" style="margin-top:var(--s2)"><button class="btn" style="flex:1" type="button" data-fk="resetno" onclick="act.resetCancel()">Cancel</button>'
      +'<button class="btn btn--ink" style="flex:1" type="button" data-fk="resetyes" onclick="act.reset()">Restart it</button></div>'
      +'<p class="t-note" style="margin-top:var(--s2)">This clears your kitchen and starts the rotation over at meal 1. Your profile and lab results stay.</p>'
    :'<button class="btn" type="button" style="width:100%" data-fk="reset" onclick="act.resetAsk()">Restart the rotation</button>';
  return '<div class="stack stack--top"><div class="pile a-hero">'+top+'</div><div class="pile a-main">'+main+'</div><div class="pile a-aside">'+aside+'</div></div>';
}

/* ==========================================================================
   THE GUIDE — a light on the real control, not a screen of its own. After
   setup the app walks a person through their first minutes on the real
   screens: the page dims with a hole around the one control to touch next,
   one line sits beside it, the light waits for the real action and then
   moves. Skip is always one tap. The steps are the daily loop read from the
   state, never a script: shop and Bought it while the kitchen is empty; cook
   and Ate it all before the first log; add a report while none is on file;
   weigh in once one is; and after a second draw, what moved. Each is once
   ever, in S.seen, like the one-time notes. On only for a home set up through
   the interview from now on (S.guide), so an installed copy never sees it.
   The story card stays as the reference. Decision 6 of Phase 7, his words:
   "im not looking for it to be a written guide."
   ========================================================================== */
/* GUIDE-START — the choosing is pure: a view of the state in, one step out, so tests can lift
   this block by its markers and run it in node against invented homes. */
const GUIDE=[
  {key:'guide_shop',due:v=>v.empty,done:v=>!v.empty,hops:[
    {when:v=>v.tab!=='kitchen',sel:'[data-fk="tab:kitchen"]',line:'Start on Kitchen. Your first shopping list is there.'},
    {when:v=>true,sel:'[data-fk^="restock:"],[data-fk^="trip-bought:"]',line:'This is what to buy. Shop it, then tap Bought it here and the stock starts counting down.'}]},
  {key:'guide_log',due:v=>!v.empty&&v.cursor===0,done:v=>v.cursor>0,hops:[
    {when:v=>v.tab!=='tonight',sel:'[data-fk="tab:tonight"]',line:'Tonight shows the one plate to cook.'},
    {when:v=>true,sel:'[data-fk="eat"]',line:'Cook this. Once you have eaten, tap Ate it all: the stock moves and the next plate reads in.'}]},
  {key:'guide_report',due:v=>v.cursor>0&&v.draws===0&&!v.declined,done:v=>v.draws>0,hops:[
    {when:v=>v.tab==='tonight',sel:'[data-fk="now:report"],[data-fk="addreport"]',line:'Got a lab report? Add it here, and a night or two of dinner changes.',stays:'Got a lab report? Add it here. The numbers are charted, and dinner stays, as your plan asks.'},
    {when:v=>v.tab!=='markers',sel:'[data-fk="tab:markers"]',line:'Your lab reports live under Markers.'},
    {when:v=>v.mk!=='reports',sel:'[data-fk="mkadd"]',line:'Tap Add a report.'},
    {when:v=>true,sel:'[data-fk="uplbtn"],[data-fk="typebtn"]',line:'Pick your lab\'s PDF, or type the numbers from paper. No report yet? Next skips it for now.'}]},
  {key:'guide_weigh',due:v=>v.draws>0&&v.weighed!==true,done:v=>v.weighed===true,later:'Once a report is on file, weigh in and the plate corrects itself.',hops:[
    {when:v=>v.tab!=='markers',sel:'[data-fk="tab:markers"]',line:'Weigh in under Markers. After three weigh-ins the plate corrects itself.'},
    {when:v=>v.mk!=='body',sel:'[data-fk="mkv:body"]',line:'Body holds the scale.'},
    {when:v=>true,sel:'[data-fk="weigh"]',line:'Type your weight and tap Log a weigh-in. After three, the plate corrects itself.'}]},
  {key:'guide_moved',due:v=>v.draws>=2&&v.moved!==false,done:v=>false,arrive:true,can:v=>v.draws>=2,later:'After a second draw, Markers says what moved.',hops:[
    {when:v=>v.tab!=='markers',sel:'[data-fk="tab:markers"]',line:'A second draw is on file. Markers says what moved.'},
    {when:v=>v.mk!=='overview',sel:'[data-fk="mkv:overview"]',line:'All markers shows what moved since your last draw.'},
    {when:v=>true,sel:'#since',line:'What moved between the two draws, and what dinner did about it.',stays:'What moved between the two draws. Dinner stays, as your plan asks.'}]}
];
/* the first step not yet seen: {done:key} when the state already did it, else the hop to light;
   {done:key, later:line} when a tour reaches a step whose screen cannot exist yet, so the
   closing panel can say when it will */
function guidePlan(v){
  if(!v||!v.on)return null;
  for(const s of GUIDE){
    if(v.seen.includes(s.key))continue;
    /* a tour (Show me around again, under You) walks every step whatever the state has done */
    if(!v.tour){
      if(s.done(v))return {done:s.key};
      if(!s.due(v))continue;
    } else if(s.can&&!s.can(v))return {done:s.key,later:s.later};
    const i=s.hops.findIndex(h=>h.when(v)), h=s.hops[i];
    return {key:s.key,sel:h.sel,line:(v.stays&&h.stays)||h.line,last:i===s.hops.length-1,arrive:!!s.arrive,n:GUIDE.indexOf(s),of:GUIDE.length};
  }
  return null;
}
/* GUIDE-END */
let GTARGET=null, GKEY=null, GRAF=null, GPLAN=null, GFORCE=false, GSHOWN=false, GCLOSING=false, GLATER=[];
function guideView(){
  const live=liveItems();
  return {on:!!S.guide,tour:!!S.tour,seen:S.seen,tab:tab,mk:MKVIEW,cursor:S.cursor,stays:planStays(),
    empty:live.length>0&&live.every(k=>(S.inv[k]||0)===0),
    draws:(LABS&&LABS.draws)||0,declined:S.seen.includes('report_nudge'),
    weighed:(BODY&&!BODY.error&&BODY.weigh)?(BODY.weigh.entries||0)>0:null,
    moved:(tab==='markers'&&MKVIEW==='overview'&&MK&&MK!=='none')?!!document.getElementById('since'):null};
}
/* after every render: the step for this state, its control on this screen, or nothing */
function guideSync(){
  const g=document.getElementById('guide'); if(!g)return;
  if(!S.init||!S.guide){g.hidden=true;GTARGET=null;GKEY=null;return;}
  let advanced=false;
  for(let guard=0;guard<8;guard++){
    const p=guidePlan(guideView());
    if(!p){
      if(S.tour){S.tour=false;persist();}                                  /* a tour ends when nothing is left to show */
      /* ...and it ends with a word, once: the loop is done, or done for now, and where to find
         this again. Only when a step was just put behind or was lit this session, so a quiet
         boot with nothing due never pops it. The steps a screen cannot show yet say when. */
      if(S.guide&&!S.seen.includes('guide_close')&&(advanced||GSHOWN)){
        const laters=[...new Set(GLATER.concat(GUIDE.filter(s=>s.later&&!S.seen.includes(s.key)).map(s=>s.later)))];
        guideClose(g,laters);return;}
      break;}
    if(p.done){S.seen.push(p.done);if(p.later)GLATER.push(p.later);persist();advanced=true;continue;}
    const el=document.querySelector(p.sel);
    /* nothing to light here: a step whose control is gone is behind you, unless the screen is
       still loading, when the control is only not here yet (Markers paints "Loading…" first) */
    if(!el){const loading=[...document.querySelectorAll('#app .t-body')].some(x=>x.textContent==='Loading…');
      if(p.last&&!loading){S.seen.push(p.key);persist();advanced=true;continue;}break;}
    if(p.last&&p.arrive&&!S.seen.includes(p.key)){S.seen.push(p.key);persist();}   /* shown once: the light stays for this render */
    const moved=GFORCE||(GKEY!==null&&GKEY!==p.key+p.sel), wasHidden=g.hidden;
    GFORCE=false;GTARGET=el;GKEY=p.key+p.sel;GPLAN=p;GSHOWN=true;
    if(GCLOSING){GCLOSING=false;g.classList.remove('closing');document.querySelector('.g-skip').textContent='Next';}
    const line=document.getElementById('gline');
    if(line.textContent!==p.line){line.textContent=p.line;line.classList.remove('swap');void line.offsetWidth;line.classList.add('swap');}
    document.getElementById('gsteps').innerHTML=GUIDE.map((s,i)=>'<i class="'+(i<p.n?'done':i===p.n?'now':'')+'"></i>').join('');
    g.hidden=false;
    /* the control comes to the person before the light lands on it: when the light moves to a
       control off screen, the page scrolls it to the middle first, and the hole follows the
       scroll. Only when it moves: a redraw while the person has scrolled away leaves them be. */
    const r=el.getBoundingClientRect(), pad=8, off=r.bottom<pad||r.top>window.innerHeight-(pad+140)||(r.width===0&&r.height===0);
    if((moved||wasHidden)&&off&&!(r.width===0&&r.height===0)&&el.scrollIntoView)el.scrollIntoView({block:'center',behavior:RM.matches?'auto':'smooth'});
    guidePlace(moved&&!wasHidden);
    return;
  }
  g.hidden=true;GTARGET=null;GKEY=null;GPLAN=null;
}
/* the closing panel: no hole and no dim, the step bar full, one line, and Done where Skip was */
function guideClose(g,laters){
  GCLOSING=true;GTARGET=null;GKEY='close';GPLAN=null;
  const txt='That is the loop.'+(laters.length?' '+laters.join(' '):'')+' Find it again under You, The guide.';
  const line=document.getElementById('gline');
  if(line.textContent!==txt){line.textContent=txt;line.classList.remove('swap');void line.offsetWidth;line.classList.add('swap');}
  document.getElementById('gsteps').innerHTML=GUIDE.map(()=>'<i class="done"></i>').join('');
  document.querySelector('.g-skip').textContent='Done';
  const path=document.getElementById('gpath'), dot=document.getElementById('gdot');
  if(path)path.setAttribute('d','');if(dot)dot.setAttribute('r','0');
  g.classList.add('closing');g.hidden=false;
}
/* the light lands again after something else moved the page (the log moment scrolls to the top) */
function guideRefresh(){GKEY=null;GFORCE=true;guideSync();}
/* the hole sits around the control; off screen, the layer dims evenly and the line still reads */
function guidePlace(glide){
  const hole=document.getElementById('ghole'); if(!hole||!GTARGET)return;
  const r=GTARGET.getBoundingClientRect(), pad=8, off=r.bottom<0||r.top>window.innerHeight||(r.width===0&&r.height===0);
  hole.classList.toggle('glide',!!glide);
  hole.style.left=(off?window.innerWidth/2:r.left-pad)+'px';
  hole.style.top=(off?(r.bottom<0?-60:window.innerHeight+60):r.top-pad)+'px';
  hole.style.width=(off?0:r.width+2*pad)+'px';
  hole.style.height=(off?0:r.height+2*pad)+'px';
  /* the pointer: from the panel's top edge to the nearest edge of the hole */
  const path=document.getElementById('gpath'), dot=document.getElementById('gdot'), panel=document.querySelector('.g-panel');
  if(!path||!dot||!panel)return;
  if(off){path.setAttribute('d','');dot.setAttribute('r','0');return;}
  const pr=panel.getBoundingClientRect(), hx=r.left+r.width/2, above=r.bottom+pad<pr.top;
  const x0=Math.max(pr.left+28,Math.min(pr.right-28,hx)), y0=above?pr.top:pr.bottom;
  const x1=hx, y1=above?r.bottom+pad+2:r.top-pad-2;
  if(Math.abs(y1-y0)<28){path.setAttribute('d','');dot.setAttribute('r','0');return;}
  const cy=(y0+y1)/2;
  path.setAttribute('d','M'+x0.toFixed(1)+' '+y0.toFixed(1)+' C '+x0.toFixed(1)+' '+cy.toFixed(1)+', '+x1.toFixed(1)+' '+cy.toFixed(1)+', '+x1.toFixed(1)+' '+y1.toFixed(1));
  dot.setAttribute('cx',x1.toFixed(1));dot.setAttribute('cy',y1.toFixed(1));dot.setAttribute('r','4');
}
['scroll','resize'].forEach(ev=>window.addEventListener(ev,()=>{if(GTARGET&&!GRAF)GRAF=requestAnimationFrame(()=>{GRAF=null;guidePlace(false);});},{passive:true}));
/* the light waits for the real action, and the action is the tap: a control the step's last hop
   names, tapped, puts the step behind the person whatever the state can tell. A tour on a
   stocked home cannot see "Bought it" in the stock; the tap it can see. */
document.addEventListener('click',e=>{
  const p=GPLAN; if(!p||!p.last||!e.target||!e.target.closest)return;
  if(e.target.closest(p.sel)&&!S.seen.includes(p.key)){S.seen.push(p.key);persist();}
},true);

/* the risk tier's five bands, the guideline's own words said plainly: the tier is a setting the
   app asks for, so the card says what each band means and who can tell a person theirs. Never
   a verdict on the person: the band is the calculator's, the number is the lab's. */
const TIERWORD={low:'Low',borderline:'Borderline',intermediate:'Intermediate',high:'High',very_high:'Very high'};
const TIERBAND={low:'a ten-year risk under 3 percent',borderline:'3 to 5 percent',intermediate:'5 to 10 percent, and the guideline default when nobody has computed it',
  high:'10 percent or more, a calcium score of 100 or more, a family cholesterol disorder, or diabetes with other risk factors',very_high:'a heart attack, stroke, stent or bypass already on record'};
const tierLine=t=>TIERWORD[t]+': '+TIERBAND[t]+'.';
/* the shipped files, in the words a person would use, for the one line that says a build refreshed them */
const SEEDWORD={stores:'the stores',store_items:'what the stores carry',equipment:'the kitchens',cooking:'the cooking times',meals:'the meals',kits:'the flavour kits',
  cold_slots:'the cold options',items:'the items',regimens:'the plans',occasions:'the occasions',rotations:'the rotations',diet:'the plan defaults',diet_rules:'the food rules',
  flavor_pantry:'the flavour pantry',targets:'the researched targets',targets_functional:'the functional targets',target_tiers:'the tier targets',policy:'the draw policy',
  explain:'the explanations',markers:'the marker list',aliases:'the lab names',derived:'the calculated markers',exposure:'the exposure windows',ignore:'the ignore list'};
/* Appearance, under You. The app follows the phone's own setting unless a choice is made here,
   and the control that owns that stored choice is never removed, only moved: it stood in the
   masthead as a toggle until Phase 8. Light is the identity the design is drawn for; a phone set
   to light gets light. */
function viewAppearance(){
  const c=window.plateThemeChoice?window.plateThemeChoice():'auto';
  const opt=(v,l,ic)=>'<button type="button" role="radio" data-fk="theme:'+v+'" aria-checked="'+(c===v)+'" onclick="act.theme(\''+v+'\')">'+(ic?icon(ic):'')+l+'</button>';
  return '<section class="card" id="appearance"><div class="split"><span class="t-label">Appearance</span><span class="mono" style="color:var(--ink-3)">this device</span></div>'+
    '<div class="seg" role="radiogroup" aria-label="Appearance" style="margin-top:var(--s3)">'+opt('auto','Match my phone','')+opt('light','Light','sun')+opt('dark','Dark','moon')+'</div>'+
    '<p class="t-note" style="margin-top:var(--s3)">Matches your phone\'s own light or dark setting unless you choose one here. The choice stays on this device.</p>'+
    '<span class="t-label" style="display:block;margin-top:var(--s4)">Sound</span>'+
    '<div class="seg" role="radiogroup" aria-label="Sound" style="margin-top:var(--s2)">'+
      '<button type="button" role="radio" data-fk="sound:on" aria-checked="'+soundOn()+'" onclick="act.sound(true)">On</button>'+
      '<button type="button" role="radio" data-fk="sound:off" aria-checked="'+(!soundOn())+'" onclick="act.sound(false)">Off</button></div>'+
    '<p class="t-note" style="margin-top:var(--s3)">A chime when a meal is logged, a longer one when a cycle closes, two notes when a shop lands in stock. Nothing else makes a sound.</p></section>';
}
/* One masthead on every screen: the brand, the meal and cycle count once the app is set up,
   and one round control, You. The theme choice lives under You (viewAppearance), so the
   control that owns the stored choice is never removed, only moved. */
function mastHTML(full){
  /* the cycle ring: one arc that fills a meal at a time and, on the log that closes a cycle,
     fills shut before the next render empties it for the new one */
  const frac=(S.cursor%N)/N, to=(frac===0&&ENTER==='log'&&RINGF!=null&&RINGF>0)?1:frac;
  const ring=full?ringSVG('cring',RINGF,to,18,3,'ring--cycle'):'';
  if(full)RINGF=to;
  return '<div class="mast-r"><span class="brand">PLATESIDE</span>'+
    (full?'<span class="folio">'+ring+'MEAL '+(S.cursor+1)+' · CYCLE '+(Math.floor(S.cursor/N)+1)+'</span>':'<span></span>')+
    '<span class="mast-ctl">'+
    (full?'<button class="tog" type="button" data-fk="you" onclick="act.you()" aria-label="You: your target, how you eat, your kitchen, your stores and your data"'+(tab==='you'?' aria-current="true"':'')+'>'+icon('you')+'</button>':'')+
    '</span></div>';
}

/* ---- the one render -------------------------------------------------------- */
function render(){
  if(PRESSED){PRESSED.classList.remove('pressed');PRESSED=null;}
  if(!S.init&&!S.setup){
    document.getElementById('app').innerHTML=viewFirstRun();
    document.getElementById('nav').innerHTML='';
    document.getElementById('mast').innerHTML=mastHTML(false);
    PAINTED=null;ENTER=null;JUST=null;guideSync();frSync();
    return;
  }
  if(!S.init){
    /* Straight from the interview to the first list: the stock question that stood here asked
       a stranger to choose between a loud button they should not press and the one they
       should. An empty kitchen is the honest start; "My kitchen is stocked" is a quiet button
       on the first list's card for the person who already owns a pack of everything. */
    if(S.kitchen_start==='stocked')act.begin(true);else act.begin(false,S.kitchen_start);
    return;
  }

  const F=forecast(), D=diff(F,runIn(F).d);
  let h='';
  if(tab==='tonight')h=viewTonight(F);
  else if(tab==='rotation')h=viewRotation(F);
  else if(tab==='kitchen')h=viewKitchen(F);
  else if(tab==='you')h=viewProfile();
  else h=viewMarkers();

  const cur=document.activeElement&&document.activeElement.closest?document.activeElement.closest('[data-fk]'):null;
  const fkey=cur?cur.getAttribute('data-fk'):null;
  document.getElementById('app').innerHTML=h;
  document.getElementById('mast').innerHTML=mastHTML(true);
  document.getElementById('nav').innerHTML=VIEWS.map(([k,label])=>
    '<button type="button" data-fk="tab:'+k+'" onclick="act.tab(\''+k+'\')"'+
    (tab===k?' aria-current="page"':'')+'>'+gl(k)+label+'</button>').join('');
  if(fkey){const n=document.querySelector('[data-fk="'+fkey+'"]');if(n)n.focus({preventScroll:true});}
  /* a view that is still fetching will redraw taller; the scroll waits for the last redraw */
  if(SCROLLTO&&!Object.keys(LOADING).some(k=>LOADING[k])){const el=document.getElementById(SCROLLTO);if(el){SCROLLTO=null;el.scrollIntoView({block:'start'});window.scrollBy(0,-90);}}

  if(tab==='markers'&&MKVIEW==='trend')wireChart(document.getElementById('app'));
  fillRings();
  /* a shop landed: the cover rolls to its new count as an odometer (a count past the horizon is a word, and stays) */
  if(tab==='kitchen'&&ENTER==='bump'&&PAINTED&&PAINTED.run!=null){const el=document.getElementById('krun'),now=runIn(F).d;
    if(el&&PAINTED.run!==now&&now<H&&PAINTED.run<H)roll(el,PAINTED.run,now,900);}
  document.body.dataset.tenure=S.cursor<N?'new':S.cursor<3*N?'learning':'settled';
  PAINTED={cursor:S.cursor,pending:Object.assign({},S.pending),L:Object.assign({},F.L),run:runIn(F).d};
  ENTER=null;JUST=null;
  guideSync();
}
/* the pull toward the next log, in meals — never a date, never a streak */
function nextGoal(F){
  const live=SWAPS.filter(s=>S.order.includes(s.from)&&S.pending[s.key]!=null);
  if(live.length){const s=live[0],f=F.flips[s.key];
    if(S.pending[s.key]<=0)return 'Slot '+(S.order.indexOf(s.from)+1)+' becomes '+s.to_name+' at the next log.';
    if(f!=null&&f<=12)return 'About '+f+' meal'+(f===1?'':'s')+' until slot '+(S.order.indexOf(s.from)+1)+' becomes '+s.to_name+'.';}
  const left=N-(S.cursor%N);
  if(left<=5)return left+' meal'+(left===1?'':'s')+' to close cycle '+(Math.floor(S.cursor/N)+1)+'.';
  return 'Meal '+((S.cursor%N)+1)+' of '+N+' in cycle '+(Math.floor(S.cursor/N)+1)+'.';
}

/* Press feedback is delegated from the document, so it survives every redraw — and it is the
   only thing that gives the one daily button any feel on iOS, where :active never fires. */
document.addEventListener('pointerdown',e=>{
  const t=e.target.closest&&e.target.closest('.btn,.pick,.step2 button,button.card,.tint,.seg button,.row,.strip button,.tile,.mast .tog');
  if(!t)return;
  PRESSED=t;t.classList.add('pressed');
  if(t.classList.contains('btn-primary'))document.body.classList.add('arming');
},{passive:true});
['pointerup','pointercancel','pointerleave','blur'].forEach(ev=>document.addEventListener(ev,()=>{
  if(PRESSED){PRESSED.classList.remove('pressed');PRESSED=null;}
  document.body.classList.remove('arming');
},{passive:true}));

function loadState(v){
  if(!v)return false;
  try{const s=JSON.parse(v);S={inv:{...EMPTY,...(s.inv||{})},cursor:s.cursor||0,checked:s.checked||[],
    order:normOrder(s.order),off:s.off||{},flav:s.flav||[],init:s.init||false,
    pending:(s.pending&&typeof s.pending==='object')?s.pending:{},applied:Array.isArray(s.applied)?s.applied:[],
    gate0:(s.gate0&&typeof s.gate0==='object')?s.gate0:{},seen:Array.isArray(s.seen)?s.seen:[],guide:!!s.guide,tour:!!s.tour,
    tally:(s.tally&&typeof s.tally==='object')?s.tally:null,
    reset_at:s.reset_at||0,setup:!!s.setup||!!s.init,last:(s.last&&typeof s.last==='object'&&Array.isArray(s.last.order))?s.last:null,
    extras:Array.isArray(s.extras)?s.extras:[]};return true;}catch(e){return false;}
}
/* The other device logged a meal or changed stock: take its copy and redraw. */
document.addEventListener('lt:remote',e=>{
  const wasCursor=S.cursor;
  if(!loadState(e.detail.value))return;
  partial=false;planB=false;FLIPSRC='remote';PAINTED=null;
  if(S.init){const before=JSON.stringify([S.order,S.pending,S.applied,S.gate0]);adoptPlan();
    if(JSON.stringify([S.order,S.pending,S.applied,S.gate0])!==before)persist();}
  render();
  say(S.cursor>wasCursor?'Meal logged on your other device.':'Updated from your other device.');
});
/* A swap landed on this device and the plate was sized again for the rotation it now holds
   (plate.store_state, said by the storage shim on the save's own reply): every scaled quantity
   follows at one reload, the way every other resize already reloads -- after the log's ledger
   has finished, when one is running (ledgerHide). */
document.addEventListener('lt:resized',e=>{
  const p=e.detail;if(!p||p.plate===PLATE)return;
  RESIZED=p;if(!LG.on)afterResize();
});

(async()=>{
  const v=await store.get('plate:v8');
  loadState(v);
  if(S.init){const before=JSON.stringify([S.order,S.pending,S.applied,S.gate0]);adoptPlan();if(JSON.stringify([S.order,S.pending,S.applied,S.gate0])!==before)persist();}
  /* back to where a save left off: the page was fetched again, so the catalog is fresh */
  let back=null;try{back=JSON.parse(sessionStorage.getItem('lt:return')||'null');sessionStorage.removeItem('lt:return');}catch(e){}
  if(back&&S.init){tab=back.tab||tab;MKVIEW=back.mk||MKVIEW;if(back.item&&I[back.item])SED.item=back.item;if(back.store&&STORES[back.store])SED.store=back.store;}
  render();
  /* what a save said before it fetched the page again, said here where it can be read: the
     reload came 350 ms after the words, a tenth of the time they stay up (flash) */
  let fl=null;try{fl=sessionStorage.getItem('lt:flash');sessionStorage.removeItem('lt:flash');}catch(e){}
  if(fl)say(fl);
  /* a home that logged meals before the passport existed reads its stamps from the meal log:
     once when the state has no passport, and again while it is empty with meals logged, so a
     read that failed (no signal, the Mac asleep) is not the passport's last word */
  if(S.init&&(S.tally===null||(S.cursor>0&&!Object.keys(S.tally||{}).length))){
    if(S.tally===null)S.tally={};
    api('/api/plate/tally').then(t=>{const got=(t&&t.tally&&typeof t.tally==='object')?t.tally:{};
      if(Object.keys(got).length){S.tally=got;persist();render();}}).catch(e=>{console.warn('passport: '+(e&&e.message||e));});}
  /* the Profile view draws once its data arrives, so the render that draws the editor scrolls */
  if(back&&S.init){SCROLLTO=back.at||null;if((tab==='markers'||tab==='you')&&MK===null)loadMarkers();}
  /* the device caught a seeded file up with this build: say which, in food words, once; and
     when the catalog could not be brought up to date without breaking the home, say that once
     per build and leave the home as it was */
  const L0=window.PLATE_LOCAL;
  if(L0&&S.init){
    const parts=[];
    if(Array.isArray(L0.refreshed)&&L0.refreshed.length)parts.push('refreshed '+list([...new Set(L0.refreshed.map(n=>SEEDWORD[n]||n))]));
    if(Array.isArray(L0.added)&&L0.added.length)parts.push('added the packs for '+L0.added.length+' new item'+(L0.added.length===1?'':'s')+' to what your stores carry');
    if(parts.length)say('This build '+parts.join(', and ')+'.');
    else if(L0.kept&&!L0.keptBefore)say('This build could not bring the catalog on this device up to date, so it stays as it was: '+L0.kept);
  }
})();

