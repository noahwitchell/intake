import { load, save, backupBlob, readBackup } from './store.js';
import { searchUSDA, usdaDetail, searchBranded, checkKey, byBarcode } from './api.js';
import { scan } from './scanner.js';

const C = globalThis.Core, I = globalThis.Import;
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app'), sheetEl = $('#sheet'), sheetBody = $('.sheet-body');

let S = load();
const ui = { tab: 'today', day: C.dateKey(), range: 90 };
const commit = () => { if (!save(S)) toast('Could not save. Phone storage may be full.'); };

// ---------- formatting ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const N = Object.fromEntries(C.NUTRIENTS.map(n => [n.k, n]));
const commas = v => Math.round(v).toLocaleString('en-US');
function amt(v, unit) {
  if (v == null) return '–';
  if (unit === 'g') return (v < 10 && v > 0 ? C.round(v, 1) : Math.round(v)) + ' g';
  if (unit === 'kcal') return commas(v);
  return Math.round(v) + ' ' + unit;
}
const qtyText = q => String(C.round(q, 2));
function dayLabel(k) {
  const t = C.dateKey();
  if (k === t) return 'Today';
  if (k === C.addDays(t, -1)) return 'Yesterday';
  if (k === C.addDays(t, 1)) return 'Tomorrow';
  return C.parseKey(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
const shortDate = k => C.parseKey(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const wUnit = () => S.settings.wUnit;
const wFmt = kg => C.round(C.fromKg(kg, wUnit()), 1).toFixed(1);
function defaultMeal() {
  const h = new Date().getHours();
  return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snacks';
}
const srcName = { usda: 'USDA', off: 'Open Food Facts', custom: 'My food', recipe: 'Recipe' };
const foodSub = f => f.src === 'recipe' ? `Recipe · makes ${C.round(f.servings, 2)} serving${f.servings === 1 ? '' : 's'}` : [f.brand, srcName[f.src]].filter(Boolean).join(' · ');
const lookupMsg = e => (e.name === 'AbortError' ? null : e.code === 'limit' ? (S.settings.usdaKey ? 'USDA hourly limit reached. Try again in a little while.' : 'USDA’s shared key is used up. Add your own free key in Settings.') : e.code === 'key' ? 'USDA key not accepted. Check it in Settings.' : e.message);

let toastT = 0;
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- main screens ----------
function render() {
  const body = ui.tab === 'today' ? viewToday() : ui.tab === 'weight' ? viewWeight() : viewSettings();
  app.innerHTML = `<main class="screen" id="screen">${body}</main>
  <nav class="tabs">
    ${[['today', 'Food'], ['weight', 'Weight'], ['settings', 'Settings']].map(([k, l]) =>
      `<button class="tab${ui.tab === k ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}
  </nav>`;
}

function bar(v, goal, cls) {
  const p = goal ? Math.min(100, (v / goal) * 100) : 0;
  return `<div class="bar ${cls}"><i style="width:${p}%"></i></div>`;
}

function viewToday() {
  const entries = S.days[ui.day] || [];
  const t = C.dayTotals(entries);
  const goal = S.settings.kcal || 0, eaten = t.kcal || 0, left = goal - eaten;
  // Shares come from the macros themselves so the three always add up to 100%.
  const macroKcal = (t.protein || 0) * 4 + (t.carbs || 0) * 4 + (t.fat || 0) * 9;
  const macro = (k, cls) => {
    const g = S.settings[k], v = t[k] || 0;
    const cal = k === 'fat' ? v * 9 : v * 4;
    const share = macroKcal > 0 ? Math.round((cal / macroKcal) * 100) : 0;
    return `<div class="macro ${cls}">
      <div class="m-top"><span>${N[k].label}</span><b>${amt(v, 'g')}</b></div>
      ${bar(v, g || (goal * (k === 'protein' ? .25 : k === 'carbs' ? .5 : .25)) / (k === 'fat' ? 9 : 4), cls)}
      <div class="m-sub">${g ? `of ${g} g` : `${share}% of calories`}</div>
    </div>`;
  };
  return `
  <header class="daynav">
    <button class="nav-btn" data-act="day-prev" aria-label="Previous day">‹</button>
    <button class="day-title" data-act="day-today">${esc(dayLabel(ui.day))}</button>
    <button class="nav-btn" data-act="day-next" aria-label="Next day">›</button>
  </header>
  <section class="card summary" data-act="breakdown">
    <div class="kcal-row">
      <div><div class="big">${commas(Math.abs(left))}</div><div class="cap">${left >= 0 ? 'calories left' : 'calories over'}</div></div>
      <div class="kcal-side"><b>${commas(eaten)}</b> eaten<br><span>of ${commas(goal)}</span></div>
    </div>
    ${bar(eaten, goal, 'kcal' + (left < 0 ? ' over' : ''))}
    <div class="macros">${macro('protein', 'p')}${macro('carbs', 'c')}${macro('fat', 'f')}</div>
    <div class="more-link">Full breakdown ›</div>
  </section>
  ${C.MEALS.map(m => {
    const list = entries.filter(e => e.meal === m.k);
    const mk = C.mealTotals(entries, m.k).kcal || 0;
    return `<section class="card meal">
      <div class="meal-h"><h2>${m.label}</h2><span class="meal-k">${list.length ? commas(mk) : ''}</span></div>
      <ul class="entries">${list.map(e => `
        <li><button class="entry" data-entry="${e.id}">
          <span class="e-name">${esc(e.name)}<small>${esc(portionText(e))}</small></span>
          <span class="e-k">${commas(e.n.kcal || 0)}</span>
        </button></li>`).join('')}
      </ul>
      <button class="add-row" data-add="${m.k}"><span class="plus">+</span> Add food</button>
    </section>`;
  }).join('')}
  <div class="spacer"></div>`;
}
const portionText = e => (e.portion === 'g' || e.portion === 'oz' ? `${qtyText(e.qty)} ${e.portion}` : e.qty === 1 ? e.portion : `${qtyText(e.qty)} × ${e.portion}`) + (e.brand ? ` · ${e.brand}` : '');

function viewWeight() {
  const W = S.weights, u = wUnit();
  const tr = C.trend(W);
  const last = tr[tr.length - 1];
  let change = '';
  if (last) {
    const from = C.addDays(last.date, -30);
    const base = tr.find(x => x.date >= from);
    if (base && base !== last) {
      const d = C.fromKg(last.trend - base.trend, u);
      const days = C.daysBetween(base.date, last.date);
      change = `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(C.round(d, 1)).toFixed(1)} ${u} trend over ${days} day${days === 1 ? '' : 's'}`;
    }
  }
  return `
  <header class="page-h"><h1>Weight</h1></header>
  <section class="card wsum">
    ${last ? `<div class="kcal-row">
      <div><div class="big">${wFmt(last.kg)}<span class="unit"> ${u}</span></div><div class="cap">${esc(dayLabel(last.date))}</div></div>
      <div class="kcal-side"><b>${wFmt(last.trend)}</b> trend<br><span>${esc(change || 'Log a few more to see a trend')}</span></div>
    </div>` : `<p class="empty">No weigh-ins yet. Log one whenever you like; the trend line smooths out day-to-day swings.</p>`}
    <div class="seg" role="tablist">${[[30, '1M'], [90, '3M'], [365, '1Y'], [0, 'All']].map(([d, l]) =>
      `<button class="${ui.range === d ? 'on' : ''}" data-range="${d}">${l}</button>`).join('')}</div>
    ${chart(tr)}
    <button class="btn primary wide" data-act="weigh">Log weight</button>
  </section>
  ${W.length ? `<section class="card"><ul class="wlist">${[...W].reverse().slice(0, 60).map(w =>
    `<li><button class="wrow" data-weight="${w.id}"><span>${esc(dayLabel(w.date) === 'Today' || dayLabel(w.date) === 'Yesterday' ? dayLabel(w.date) : C.parseKey(w.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(w.date.slice(0, 4) === C.dateKey().slice(0, 4) ? {} : { year: 'numeric' }) }))}</span><b>${wFmt(w.kg)} ${u}</b></button></li>`).join('')}</ul></section>` : ''}
  <div class="spacer"></div>`;
}

function chart(tr) {
  const Wd = 340, H = 170, L = 34, R = 8, T = 10, B = 22;
  const today = C.dateKey();
  const pts = ui.range ? tr.filter(x => x.date >= C.addDays(today, -ui.range)) : tr;
  if (pts.length < 2) return `<div class="chart empty-chart">${pts.length ? 'One weigh-in so far' : ''}</div>`;
  const u = wUnit();
  const start = ui.range ? C.addDays(today, -ui.range) : pts[0].date, end = ui.range ? today : pts[pts.length - 1].date;
  const span = Math.max(1, C.daysBetween(start, end));
  const vals = pts.flatMap(p => [C.fromKg(p.kg, u), C.fromKg(p.trend, u)]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(1, (hi - lo) * 0.15); lo -= pad; hi += pad;
  const x = d => L + (C.daysBetween(start, d) / span) * (Wd - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = pts.map(p => `${x(p.date).toFixed(1)},${y(C.fromKg(p.trend, u)).toFixed(1)}`).join(' ');
  const dots = pts.map(p => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(C.fromKg(p.kg, u)).toFixed(1)}" r="2.6"/>`).join('');
  const grid = [hi - pad, (hi + lo) / 2, lo + pad].map(v => `<line x1="${L}" x2="${Wd - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Weight chart">
    <g class="grid">${grid}</g>
    <g class="dots">${dots}</g>
    <polyline class="trend" points="${line}"/>
    <text class="axis" x="${L}" y="${H - 5}">${esc(shortDate(start))}</text>
    <text class="axis" x="${Wd - R}" y="${H - 5}" text-anchor="end">${esc(shortDate(end))}</text>
  </svg>`;
}

function viewSettings() {
  const s = S.settings;
  const nFoods = Object.keys(S.foods).length, nDays = Object.keys(S.days).filter(k => S.days[k].length).length;
  const goal = (k, label, ph) => `<label class="row"><span>${label}</span><input class="field num" inputmode="numeric" data-set="${k}" value="${s[k] ?? ''}" placeholder="${ph}"></label>`;
  return `
  <header class="page-h"><h1>Settings</h1></header>
  <section class="card form">
    <h2>Daily goals</h2>
    ${goal('kcal', 'Calories', '2000')}
    ${goal('protein', 'Protein (g)', 'none')}
    ${goal('carbs', 'Carbs (g)', 'none')}
    ${goal('fat', 'Fat (g)', 'none')}
    <p class="note">Leave a macro blank and its bar shows its share of your calories instead.</p>
  </section>
  <section class="card form">
    <h2>Weight unit</h2>
    <div class="seg">${['lb', 'kg'].map(u => `<button class="${s.wUnit === u ? 'on' : ''}" data-unit="${u}">${u}</button>`).join('')}</div>
  </section>
  <section class="card form">
    <h2>USDA key</h2>
    <input class="field" data-set="usdaKey" value="${esc(s.usdaKey)}" placeholder="Paste your free key" autocomplete="off" autocapitalize="off" spellcheck="false">
    <p class="note" id="key-status">${s.usdaKey ? '' : 'Food search runs on USDA’s database, which needs a free personal key (1,000 searches an hour). '}Get one at <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noopener">fdc.nal.usda.gov/api-key-signup</a>: fill in your name and email, and the key arrives by email right away. Paste it here. Barcode scans work without it.</p>
  </section>
  <section class="card form">
    <h2>Copy pages from Safari</h2>
    <p class="note">Recipe and restaurant sites don’t let apps read their pages, so Intake reads what you copy. The Copy to Intake shortcut copies a whole page in one tap from Safari’s Share menu, including the recipe data most recipe sites hide in the page.</p>
    <p class="note">1. Open <a href="shortcut/Copy-to-Intake.shortcut" target="_blank" rel="noopener">the shortcut</a> and tap Add Shortcut.<br>2. On a recipe or nutrition page in Safari, tap Share › Copy to Intake. Allow it when it asks.<br>3. Back here: + › Paste a recipe or nutrition facts › Paste › Read it.</p>
    <p class="note">If Shortcuts says scripts aren’t allowed: iPhone Settings › Apps › Shortcuts › Advanced › Allow Running Scripts.</p>
  </section>
  <section class="card form">
    <h2>Backup</h2>
    <p class="note">${nDays} day${nDays === 1 ? '' : 's'} logged, ${nFoods} saved food${nFoods === 1 ? '' : 's'}, ${S.weights.length} weigh-in${S.weights.length === 1 ? '' : 's'}. Everything stays on this phone, so save a backup now and then (to Files or Dropbox).</p>
    <div class="btns">
      <button class="btn" data-act="export">Save a backup</button>
      <label class="btn">Restore…<input type="file" accept="application/json,.json" id="restore" hidden></label>
    </div>
    <div id="restore-confirm"></div>
  </section>
  <p class="about">Intake keeps your log on this device only. Looking up a food sends just the words you type, or the barcode number, to USDA FoodData Central or Open Food Facts. Pasted recipes and nutrition facts are read on the phone; only the ingredient names are looked up.</p>
  <div class="spacer"></div>`;
}

// ---------- sheets ----------
let sheetCleanup = null;
function openSheet(html, mount) {
  if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
  sheetBody.innerHTML = html;
  sheetEl.classList.remove('hidden');
  requestAnimationFrame(() => sheetEl.classList.add('open'));
  if (mount) sheetCleanup = mount(sheetBody) || null;
}
function closeSheet() {
  if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
  sheetEl.classList.remove('open');
  sheetEl.classList.add('hidden');
  sheetBody.innerHTML = '';
}
sheetEl.addEventListener('click', e => { if (e.target === sheetEl) closeSheet(); });
const sheetHead = (title, back) => `<div class="sh-head">
  ${back ? `<button class="sh-back" data-back="${back}">‹ Back</button>` : '<span></span>'}
  <h2>${esc(title)}</h2>
  <button class="sh-x" data-act="close" aria-label="Close">✕</button></div>`;

// --- add food: search your foods, USDA and Open Food Facts ---
const search = { q: '', meal: 'breakfast', usda: null, off: null, usdaErr: '', offErr: '', loading: false, ctl: null, results: new Map() };
// pick = null when logging food; { replace, ing } while choosing a recipe ingredient
// (replace = index of the line being matched, ing = that line parsed, for the starting amount).
let pick = null;

function openAdd(meal) {
  search.meal = meal || defaultMeal();
  const title = pick ? (pick.replace != null ? 'Pick the food' : 'Add ingredient') : 'Add to ' + C.MEALS.find(m => m.k === search.meal).label;
  openSheet(`${sheetHead(title, pick ? 'recipe' : null)}
    ${pick && pick.ing ? `<p class="sub">For “${esc(pick.ing.raw)}”</p>` : ''}
    <form class="searchbar" id="sform">
      <input class="field" id="q" type="search" placeholder="Search foods" value="${esc(search.q)}" autocomplete="off" enterkeyhint="search">
      <button type="button" class="scan-btn" data-act="scan" aria-label="Scan a barcode">${scanIcon}</button>
    </form>
    <div class="results" id="results"></div>
    ${pick ? '<button class="btn wide ghost" data-act="custom">Enter a food by hand</button>' : `<div class="btns">
      <button class="btn ghost" data-act="custom">Enter by hand</button>
      <button class="btn ghost" data-act="new-recipe">New recipe</button>
    </div>
    <button class="btn wide ghost" data-act="import">Paste a recipe or nutrition facts</button>`}`, body => {
    const q = $('#q', body);
    let deb = 0;
    q.addEventListener('input', () => {
      search.q = q.value;
      clearTimeout(deb);
      if (search.ctl) search.ctl.abort();
      search.usda = search.off = null; search.usdaErr = search.offErr = '';
      paintResults();
    });
    $('#sform', body).addEventListener('submit', e => { e.preventDefault(); clearTimeout(deb); q.blur(); runOnline(); });
    paintResults();
    if (!search.q) setTimeout(() => q.focus(), 250);
    else if (pick && search.usda == null && search.q.trim().length >= 2) runOnline();
    return () => clearTimeout(deb);
  });
}

async function runOnline() {
  const q = search.q.trim();
  if (q.length < 2) return;
  if (search.ctl) search.ctl.abort();
  const ctl = search.ctl = new AbortController();
  search.loading = true; search.usda = search.off = null; search.usdaErr = search.offErr = '';
  paintResults();
  const fail = lookupMsg;
  await Promise.all([
    searchUSDA(S, q, ctl.signal).then(r => { search.usda = r; }, e => { search.usdaErr = fail(e); search.usda = []; }).finally(() => ctl === search.ctl && paintResults()),
    searchBranded(S, q, ctl.signal).then(r => { search.off = r; }, e => { search.offErr = fail(e); search.off = []; }).finally(() => ctl === search.ctl && paintResults()),
  ]);
  if (ctl === search.ctl) { search.loading = false; paintResults(); }
}

function resultRow(f) {
  search.results.set(f.id, f);
  const p = f.portions[0];
  const kcal = (f.n.kcal || 0) * p.mult;
  return `<li><button class="food" data-food="${esc(f.id)}">
    <span class="e-name">${esc(f.name)}<small>${esc(foodSub(f))}</small></span>
    <span class="e-k">${commas(kcal)}<small>${esc(p.label === 'g' ? '100 g' : f.src === 'usda' && f.kind !== 'Branded' ? '100 g' : p.label)}</small></span>
  </button></li>`;
}

function paintResults() {
  const el = $('#results');
  if (!el) return;
  search.results.clear();
  const mine = C.searchMine(S, search.q).filter(f => !pick || f.src !== 'recipe');
  const q = search.q.trim();
  const section = (title, list, state) => `<h3 class="res-h">${title}</h3>${state ? `<p class="res-note">${esc(state)}</p>` : ''}${list && list.length ? `<ul class="list">${list.map(resultRow).join('')}</ul>` : ''}`;
  let html = '';
  if (!q) html += mine.length ? section('Recent', mine) : `<p class="res-note">Search for a food, or scan a barcode. Anything you log is saved here for next time.${S.settings.usdaKey ? '' : ' Online search needs your free USDA key (Settings).'}</p>`;
  else {
    if (mine.length) html += section('My foods', mine);
    const online = (list, err) => (err ? err : list == null ? (search.loading ? 'Searching…' : '') : list.length ? '' : 'Nothing found');
    // USDA generic results are per 100 g, so they show the 100 g figure.
    if (search.usda == null && search.off == null && !search.loading) html += `<button class="btn wide online" data-act="online">Search online for “${esc(q)}”</button>`;
    else if (search.usdaErr && search.usdaErr === search.offErr) {
      html += `<p class="res-note">${esc(search.usdaErr)}</p>`;
    } else {
      html += section('Basic foods', search.usda, online(search.usda, search.usdaErr));
      html += section('Packaged foods', search.off, online(search.off, search.offErr));
    }
    if (/Settings/.test(search.usdaErr + search.offErr)) html += '<button class="btn wide" data-act="go-key">Add my USDA key</button>';
  }
  el.innerHTML = html;
}

// --- amount picker ---
async function openFood(f, { meal, back = 'add', note = '' } = {}) {
  meal = meal || search.meal;
  let food = S.foods[f.id] || f;
  let pi = food.lastPortion != null && food.portions[food.lastPortion] ? food.lastPortion : 0;
  let qty = food.lastQty || 1;
  const forRecipe = !!pick, ing = pick && pick.ing;
  // An ingredient line ("1 ½ cups flour") sets the starting amount.
  const fromLine = () => { if (ing) { const r = I.pickPortion(food, ing); pi = r.pi; qty = r.qty; } };
  if (forRecipe) { pi = 0; qty = 1; fromLine(); }
  const draw = () => `${sheetHead(food.name, back)}
    ${note ? `<p class="flash">${esc(note)}</p>` : ''}
    <p class="sub">${esc(foodSub(food))}${food.barcode ? ` · ${esc(food.barcode)}` : ''}</p>
    <div class="amount">
      <input class="field num" id="qty" inputmode="decimal" value="${qtyText(qty)}" aria-label="Amount">
      <select class="field" id="portion" aria-label="Portion">${food.portions.map((p, i) => `<option value="${i}"${i === pi ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
    </div>
    <div id="preview"></div>
    ${forRecipe ? '' : `<div class="seg meals">${C.MEALS.map(m => `<button class="${m.k === meal ? 'on' : ''}" data-meal="${m.k}">${m.label}</button>`).join('')}</div>`}
    <button class="btn primary wide" id="add-go">${forRecipe ? 'Add to recipe' : `Add to ${esc(ui.day === C.dateKey() ? 'today' : dayLabel(ui.day))}`}</button>
    ${food.src === 'custom' ? '<button class="btn wide ghost" id="edit-food">Edit this food</button>' : ''}
    ${food.src === 'recipe' && !forRecipe ? '<button class="btn wide ghost" id="edit-recipe">Edit recipe</button>' : ''}`;
  const mount = body => {
    const qEl = $('#qty', body), pEl = $('#portion', body);
    const upd = () => {
      qty = C.num(qEl.value) || 0; pi = +pEl.value;
      $('#preview', body).innerHTML = preview(C.scaleN(food.n, qty * food.portions[pi].mult));
      $('#add-go', body).disabled = !(qty > 0);
    };
    qEl.addEventListener('input', upd);
    pEl.addEventListener('change', upd);
    qEl.addEventListener('focus', () => qEl.select());
    body.addEventListener('click', e => {
      const m = e.target.closest('[data-meal]');
      if (m) { meal = m.dataset.meal; body.querySelectorAll('[data-meal]').forEach(b => b.classList.toggle('on', b === m)); }
    });
    $('#add-go', body).addEventListener('click', () => {
      if (!(qty > 0)) return;
      if (forRecipe) return addIngredient(food, qty, pi);
      const saved = { ...food, uses: (food.uses || 0) + 1, last: new Date().toISOString(), lastQty: qty, lastPortion: pi };
      S.foods[food.id] = saved;
      (S.days[ui.day] ||= []).push(C.makeEntry(saved, qty, pi, meal));
      commit(); closeSheet(); ui.tab = 'today'; render();
      toast(`Added ${food.name}`);
    });
    const ed = $('#edit-food', body);
    if (ed) ed.addEventListener('click', () => openCustom({ food, meal }));
    const er = $('#edit-recipe', body);
    if (er) er.addEventListener('click', () => editRecipe(food));
    upd();
  };
  openSheet(draw(), mount);
  // USDA search hits lack household portions; fetch the full record once.
  if (food.src === 'usda' && !food.full && food.kind !== 'Branded') {
    try {
      const d = await usdaDetail(S, food.fdcId);
      if (d && C.usable(d) && $('#portion')) {
        food = { ...food, ...d, full: true, n: Object.keys(d.n).length >= Object.keys(food.n).length ? d.n : food.n };
        if (S.foods[food.id]) { S.foods[food.id] = { ...S.foods[food.id], portions: food.portions, full: true }; commit(); }
        const keepQty = $('#qty').value;
        pi = 0; qty = C.num(keepQty) || 1;
        if (forRecipe) fromLine();
        // Prefer a household measure (cup, medium) over grams when one exists.
        openSheet(draw(), mount);
      }
    } catch { /* keep the per-100 g portions */ }
  }
}

function preview(n) {
  const row = k => `<div class="pv ${k}"><b>${amt(n[k], N[k].unit)}</b><span>${k === 'kcal' ? 'kcal' : N[k].label}</span></div>`;
  const extra = ['fiber', 'sugar', 'sodium', 'satfat'].filter(k => n[k] != null).map(k => `<span>${N[k].label} ${amt(n[k], N[k].unit)}</span>`).join('');
  return `<div class="pv-row">${row('kcal')}${row('protein')}${row('carbs')}${row('fat')}</div>${extra ? `<div class="pv-extra">${extra}</div>` : ''}`;
}

// --- a logged entry ---
function openEntry(id) {
  const list = S.days[ui.day] || [];
  const e = list.find(x => x.id === id);
  if (!e) return;
  const food = S.foods[e.foodId];
  const portions = food ? food.portions : [{ label: e.portion, mult: e.mult }];
  let pi = Math.max(0, portions.findIndex(p => p.label === e.portion));
  let qty = e.qty, meal = e.meal;
  openSheet(`${sheetHead(e.name)}
    <p class="sub">${esc(e.brand)}</p>
    <div class="amount">
      <input class="field num" id="qty" inputmode="decimal" value="${qtyText(qty)}" aria-label="Amount">
      <select class="field" id="portion" aria-label="Portion">${portions.map((p, i) => `<option value="${i}"${i === pi ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
    </div>
    <div id="preview"></div>
    <div class="seg meals">${C.MEALS.map(m => `<button class="${m.k === meal ? 'on' : ''}" data-meal="${m.k}">${m.label}</button>`).join('')}</div>
    <button class="btn primary wide" id="save">Save</button>
    <div class="btns">
      <button class="btn" id="again">Log again</button>
      <button class="btn danger hold" data-hold="remove-entry">Hold to remove</button>
    </div>`, body => {
    const qEl = $('#qty', body), pEl = $('#portion', body);
    const cur = () => C.reweigh(e, qty, portions[pi]);
    const upd = () => { qty = C.num(qEl.value) || 0; pi = +pEl.value; $('#preview', body).innerHTML = preview(qty > 0 ? cur().n : {}); $('#save', body).disabled = !(qty > 0); };
    qEl.addEventListener('input', upd); pEl.addEventListener('change', upd);
    qEl.addEventListener('focus', () => qEl.select());
    body.addEventListener('click', ev => {
      const m = ev.target.closest('[data-meal]');
      if (m) { meal = m.dataset.meal; body.querySelectorAll('[data-meal]').forEach(b => b.classList.toggle('on', b === m)); }
    });
    $('#save', body).addEventListener('click', () => {
      const i = list.findIndex(x => x.id === id);
      if (i >= 0 && qty > 0) { list[i] = { ...cur(), meal }; commit(); }
      closeSheet(); render();
    });
    $('#again', body).addEventListener('click', () => {
      list.push({ ...cur(), id: C.uid(), meal });
      commit(); closeSheet(); render(); toast(`Logged ${e.name} again`);
    });
    holdActions['remove-entry'] = () => {
      S.days[ui.day] = list.filter(x => x.id !== id);
      if (!S.days[ui.day].length) delete S.days[ui.day];
      commit(); closeSheet(); render(); toast('Removed');
    };
    upd();
  });
}

// --- type a food in from its label ---
const CUSTOM_MORE = ['satfat', 'transfat', 'fiber', 'sugar', 'chol', 'sodium', 'potassium', 'calcium', 'iron', 'vitA', 'vitC', 'vitD'];
function openCustom({ food = null, prefill = null, barcode = '', meal, note = '' } = {}) {
  const f = food || prefill || {};
  const v = k => (f.n && f.n[k] != null ? C.round(f.n[k], 2) : '');
  const nf = (k, req) => `<label class="nf"><span>${N[k].label}${N[k].unit === 'kcal' ? '' : ` (${N[k].unit})`}${req ? ' *' : ''}</span><input class="field num" inputmode="decimal" data-n="${k}" value="${v(k)}"></label>`;
  openSheet(`${sheetHead(food ? 'Edit food' : prefill ? 'Check and save' : 'Enter a food', food ? null : 'add')}
    ${note ? `<p class="flash">${esc(note)}</p>` : ''}
    <div class="form">
      <input class="field" id="c-name" placeholder="Name *" value="${esc(f.name || '')}" autocomplete="off">
      <input class="field" id="c-brand" placeholder="Brand (optional)" value="${esc(f.brand || '')}" autocomplete="off">
      <div class="two">
        <input class="field" id="c-serv" placeholder="Serving, e.g. 1 cup" value="${esc(f.serving || '')}" autocomplete="off">
        <input class="field num" id="c-g" inputmode="decimal" placeholder="Grams (optional)" value="${f.servingG || ''}">
      </div>
      <p class="note">Values for one serving, as printed on the label.</p>
      <div class="ngrid">${nf('kcal', true)}${nf('protein')}${nf('carbs')}${nf('fat')}</div>
      <details${CUSTOM_MORE.some(k => v(k) !== '') ? ' open' : ''}><summary>More nutrients</summary><div class="ngrid">${CUSTOM_MORE.map(k => nf(k)).join('')}</div></details>
      <input class="field" id="c-code" placeholder="Barcode (optional)" inputmode="numeric" value="${esc(f.barcode || barcode)}" autocomplete="off">
    </div>
    <button class="btn primary wide" id="c-save">${food ? 'Save' : 'Save and continue'}</button>
    ${food ? '<button class="btn danger hold wide" data-hold="forget-food">Hold to forget this food</button>' : ''}`, body => {
    const go = $('#c-save', body);
    const check = () => { go.disabled = !($('#c-name', body).value.trim() && C.num($('[data-n=kcal]', body).value) != null); };
    body.addEventListener('input', check); check();
    go.addEventListener('click', () => {
      const n = {};
      body.querySelectorAll('[data-n]').forEach(i => { if (i.value.trim() !== '') n[i.dataset.n] = i.value; });
      const nf2 = C.customFood({ id: food && food.id, name: $('#c-name', body).value, brand: $('#c-brand', body).value, barcode: $('#c-code', body).value, serving: $('#c-serv', body).value, servingG: $('#c-g', body).value, n });
      const old = S.foods[nf2.id] || {};
      S.foods[nf2.id] = { ...nf2, uses: old.uses || 0, last: old.last || new Date().toISOString() };
      commit();
      openFood(S.foods[nf2.id], { meal, back: null });
    });
    if (food) holdActions['forget-food'] = () => { delete S.foods[food.id]; commit(); closeSheet(); render(); toast('Forgotten. Past log entries stay.'); };
  });
}

// ---------- recipes ----------
// The recipe being built lives in S.draft (saved), so switching to Safari and back keeps it.
const blankDraft = () => ({ id: null, name: '', servings: null, items: [], site: null });
function newRecipe() {
  if (!S.draft || S.draft.id) { S.draft = blankDraft(); commit(); }
  openRecipe();
}
function editRecipe(food) {
  if (!S.draft || S.draft.id !== food.id) {
    S.draft = { id: food.id, name: food.name, servings: food.servings, items: (food.items || []).map(i => ({ ...i })), site: food.site || null };
    commit();
  }
  openRecipe();
}
// A line from a pasted recipe, not yet matched to a food.
function rawItem(raw) {
  const p = I.parseIngredient(raw);
  return { id: C.uid(), foodId: null, raw, name: raw, n: {}, skip: p.tiny || (p.qty == null && p.unit == null) };
}

const match = { ctl: null, busy: 0, err: '' };
function openRecipe() {
  pick = null;
  const d = S.draft;
  if (!d) return closeSheet();
  openSheet(`${sheetHead(d.id ? 'Edit recipe' : 'New recipe')}
    <div class="form">
      <input class="field" id="r-name" placeholder="Recipe name *" value="${esc(d.name)}" autocomplete="off">
      <label class="row"><span>Servings it makes</span><input class="field num" id="r-serv" inputmode="decimal" value="${d.servings ?? ''}" placeholder="1"></label>
    </div>
    <h3 class="res-h">Per serving</h3>
    <div id="r-pv"></div>
    <p class="res-note" id="r-note"></p>
    <h3 class="res-h">Ingredients</h3>
    <ul class="entries r-items" id="r-items"></ul>
    <button class="add-row r-add" data-act="r-add"><span class="plus">+</span> Add ingredient</button>
    <button class="btn primary wide" id="r-save">Save recipe</button>
    <button class="btn danger hold wide" data-hold="r-drop">${d.id ? 'Hold to delete this recipe' : 'Hold to discard'}</button>`, body => {
    $('#r-name', body).addEventListener('input', e => { d.name = e.target.value; commit(); paintRecipe(); });
    $('#r-serv', body).addEventListener('input', e => { d.servings = C.num(e.target.value) > 0 ? C.num(e.target.value) : null; commit(); paintRecipe(); });
    $('#r-save', body).addEventListener('click', saveRecipe);
    holdActions['r-drop'] = () => {
      if (match.ctl) match.ctl.abort();
      if (d.id) delete S.foods[d.id];
      S.draft = null; commit(); closeSheet(); render(); toast(d.id ? 'Recipe deleted. Past log entries stay.' : 'Discarded');
    };
    paintRecipe();
  });
}

function paintRecipe() {
  const d = S.draft, list = $('#r-items');
  if (!d || !list) return;
  const sv = d.servings || 1;
  $('#r-pv').innerHTML = preview(C.scaleN(C.recipeTotal(d.items), 1 / sv));
  const open = d.items.filter(i => !i.foodId && !i.skip && !i.matching).length;
  const check = d.items.filter(i => i.foodId && i.check).length;
  const notes = [];
  if (match.busy) notes.push(`Finding foods for ${match.busy} line${match.busy === 1 ? '' : 's'}…`);
  if (match.err) notes.push(match.err);
  if (open) notes.push(`${open} line${open === 1 ? '' : 's'} still need${open === 1 ? 's' : ''} a food. Tap to pick one.`);
  if (check) notes.push(`${check} amount${check === 1 ? ' was a guess' : 's were guesses'}. Worth a look.`);
  if (d.site && d.site.kcal != null) notes.push(`The recipe page says ${commas(d.site.kcal)} kcal a serving.`);
  if (!d.items.length) notes.push('Add each ingredient with the amount the whole recipe uses.');
  $('#r-note').textContent = notes.join(' ');
  list.innerHTML = d.items.map((it, i) => {
    if (it.foodId) return `<li><button class="entry" data-item="${i}">
      <span class="e-name">${esc(it.name)}<small${it.check ? ' class="warn"' : ''}>${esc(portionText(it))}${it.check ? ` · check: “${esc(it.raw)}”` : ''}</small></span>
      <span class="e-k">${commas(it.n.kcal || 0)}</span></button></li>`;
    return `<li><button class="entry todo" data-item="${i}">
      <span class="e-name">${esc(it.raw)}<small${it.skip ? '' : ' class="warn"'}>${it.matching ? 'Finding a match…' : it.skip ? 'Not counted (no amount). Tap to add it.' : 'Tap to pick the food'}</small></span>
      <span class="e-k">–</span></button></li>`;
  }).join('');
  $('#r-save').disabled = !(d.name.trim() && d.items.some(i => i.foodId));
}

function saveRecipe() {
  const d = S.draft;
  if (!d || !d.name.trim()) return;
  if (match.ctl) match.ctl.abort();
  const f = C.recipeFood(d);
  const old = S.foods[f.id] || {};
  S.foods[f.id] = { ...f, uses: old.uses || 0, last: old.last || new Date().toISOString(), lastQty: old.lastQty, lastPortion: old.lastPortion };
  S.draft = null; commit(); render();
  openFood(S.foods[f.id], { back: null, note: 'Recipe saved. Log a serving now, or find it under My foods any time.' });
}

// Chosen in the ingredient search: add it, or fill in the line being matched.
function addIngredient(food, qty, pi) {
  const d = S.draft;
  if (!d) return closeSheet();
  if (!S.foods[food.id]) S.foods[food.id] = { ...food, uses: 0 };
  const it = { ...C.makeEntry(food, qty, pi, null) };
  if (pick && pick.replace != null && d.items[pick.replace]) {
    const was = d.items[pick.replace];
    d.items[pick.replace] = { ...it, id: was.id, raw: was.raw };
  } else d.items.push(it);
  commit(); openRecipe();
}

function openItem(idx) {
  const d = S.draft, it = d && d.items[+idx];
  if (!it) return;
  if (!it.foodId) {
    // Unmatched line: search for it straight away.
    pick = { replace: +idx, ing: I.parseIngredient(it.raw) };
    search.q = pick.ing.name || it.raw; search.usda = search.off = null; search.usdaErr = search.offErr = '';
    return openAdd(search.meal);
  }
  const food = S.foods[it.foodId];
  const portions = food ? food.portions : [{ label: it.portion, mult: it.mult }];
  let pi = Math.max(0, portions.findIndex(p => p.label === it.portion)), qty = it.qty;
  openSheet(`${sheetHead(it.name, 'recipe')}
    ${it.raw ? `<p class="sub">From “${esc(it.raw)}”</p>` : ''}
    <div class="amount">
      <input class="field num" id="qty" inputmode="decimal" value="${qtyText(qty)}" aria-label="Amount">
      <select class="field" id="portion" aria-label="Portion">${portions.map((p, i) => `<option value="${i}"${i === pi ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
    </div>
    <div id="preview"></div>
    <button class="btn primary wide" id="save">Save</button>
    <div class="btns">
      <button class="btn" id="swap">Pick a different food</button>
      <button class="btn danger hold" data-hold="r-remove">Hold to remove</button>
    </div>`, body => {
    const qEl = $('#qty', body), pEl = $('#portion', body);
    const cur = () => C.reweigh(it, qty, portions[pi]);
    const upd = () => { qty = C.num(qEl.value) || 0; pi = +pEl.value; $('#preview', body).innerHTML = preview(qty > 0 ? cur().n : {}); $('#save', body).disabled = !(qty > 0); };
    qEl.addEventListener('input', upd); pEl.addEventListener('change', upd);
    qEl.addEventListener('focus', () => qEl.select());
    $('#save', body).addEventListener('click', () => { d.items[+idx] = { ...cur(), check: false }; commit(); openRecipe(); });
    $('#swap', body).addEventListener('click', () => {
      pick = { replace: +idx, ing: it.raw ? I.parseIngredient(it.raw) : null };
      search.q = pick.ing ? pick.ing.name : it.name; search.usda = search.off = null; search.usdaErr = search.offErr = '';
      openAdd(search.meal);
    });
    holdActions['r-remove'] = () => { d.items.splice(+idx, 1); commit(); openRecipe(); };
    upd();
  });
}

// Match pasted lines to foods: your own foods first, then USDA's first hit, then an amount from the line.
async function findFood(ing, signal) {
  const words = ing.name.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (!words.length) return null;
  const mine = Object.values(S.foods).filter(f => f.src !== 'recipe' && C.usable(f) && words.every(w => new RegExp('\\b' + w.replace(/[^a-z0-9]/g, '') + '(e?s)?\\b').test(`${f.name} ${f.brand}`.toLowerCase())))
    .sort((a, b) => (b.uses || 0) - (a.uses || 0))[0];
  if (mine) return mine;
  const list = await searchUSDA(S, ing.name, signal);
  let f = I.rankFoods(ing.name, list)[0];
  if (!f) return null;
  if (f.kind !== 'Branded') {
    try {
      const det = await usdaDetail(S, f.fdcId, signal);
      if (det && C.usable(det)) f = { ...f, ...det, full: true, n: Object.keys(det.n).length >= Object.keys(f.n).length ? det.n : f.n };
    } catch (e) { if (e.name === 'AbortError') throw e; }
  }
  return f;
}
async function matchDraft() {
  const d = S.draft;
  if (!d) return;
  if (match.ctl) match.ctl.abort();
  const ctl = match.ctl = new AbortController();
  match.err = '';
  const todo = d.items.filter(i => !i.foodId && !i.skip);
  todo.forEach(i => { i.matching = true; });
  match.busy = todo.length; paintRecipe();
  let next = 0, stop = false;
  const worker = async () => {
    while (!stop && next < todo.length) {
      const it = todo[next++];
      const ing = I.parseIngredient(it.raw);
      try {
        const f = await findFood(ing, ctl.signal);
        if (S.draft !== d || ctl.signal.aborted) return;
        if (f) {
          if (!S.foods[f.id]) S.foods[f.id] = { ...f, uses: 0 };
          const r = I.pickPortion(f, ing);
          const i = d.items.indexOf(it);
          if (i >= 0) d.items[i] = { ...C.makeEntry(f, r.qty, r.pi, null), id: it.id, raw: it.raw, check: !r.sure };
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (e.code === 'limit' || e.code === 'key' || e.code === 'offline') { stop = true; match.err = lookupMsg(e); }
      }
      it.matching = false; match.busy = Math.max(0, match.busy - 1);
      commit(); paintRecipe();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (match.ctl === ctl) {
    d.items.forEach(i => { delete i.matching; });
    match.busy = 0; commit(); paintRecipe();
  }
}

// ---------- import: pasted recipe or nutrition facts ----------
const imp = { mode: 'recipe' };
const IMP_HELP = {
  recipe: 'Copy the ingredient list from a recipe page (the whole page is fine) and paste it here. Each line gets matched to a food, and you check the matches before saving.',
  nutrition: 'Copy the nutrition facts for one item from a restaurant’s site, PDF or menu and paste them here. The numbers fill in a food you check before saving.',
};
function openImport() {
  pick = null;
  openSheet(`${sheetHead('Paste and import', 'add')}
    <div class="seg">${[['recipe', 'Recipe'], ['nutrition', 'Nutrition facts']].map(([k, l]) => `<button class="${imp.mode === k ? 'on' : ''}" data-imp="${k}">${l}</button>`).join('')}</div>
    <textarea class="field area" id="imp-text" placeholder="Paste here" autocomplete="off" spellcheck="false"></textarea>
    <div class="btns">
      <button class="btn" data-act="paste">Paste</button>
      <button class="btn primary" id="imp-go">Read it</button>
    </div>
    <p class="flash" id="imp-msg" hidden></p>
    <p class="note" id="imp-help">${IMP_HELP[imp.mode]}</p>
    <p class="note">In Safari, the Copy to Intake shortcut in the Share menu copies a whole recipe or menu page in one tap. Set it up in Settings.</p>`, body => {
    const ta = $('#imp-text', body), go = $('#imp-go', body);
    const check = () => { go.disabled = !ta.value.trim(); };
    ta.addEventListener('input', check); check();
    body.addEventListener('click', e => {
      const b = e.target.closest('[data-imp]');
      if (!b) return;
      imp.mode = b.dataset.imp;
      body.querySelectorAll('[data-imp]').forEach(x => x.classList.toggle('on', x === b));
      $('#imp-help', body).textContent = IMP_HELP[imp.mode];
    });
    go.addEventListener('click', () => readImport(ta.value));
  });
}
async function pasteInto() {
  const ta = $('#imp-text');
  if (!ta) return;
  try {
    ta.value = await navigator.clipboard.readText();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  } catch { impMsg('Couldn’t read the clipboard. Press and hold in the box and choose Paste.'); }
}
function impMsg(t) { const m = $('#imp-msg'); if (m) { m.textContent = t; m.hidden = !t; } }

function readImport(text) {
  if (I.isLink(text)) return impMsg('Intake can’t open links itself: most recipe and restaurant sites block apps from reading their pages. Open the link in Safari, then copy the text (or use the Copy to Intake shortcut) and paste it here.');
  const shared = I.readShared(text);
  const title = shared ? String(shared.title || '').split(/\s[|–-]\s/)[0].trim() : '';
  let res = shared && shared.ld ? I.fromLD(shared.ld, title) : null;
  const body = shared ? (shared.selection || shared.text || '') : text;
  if (!res && imp.mode === 'recipe') {
    const r = I.parseRecipeText(body);
    if (r.lines.length) res = { kind: 'recipe', name: r.name || title, servings: r.servings, lines: r.lines };
  }
  if (!res) {
    const p = I.parseNutrition(body);
    // A short first line that isn't part of the panel is usually the item's name.
    const first = String(body).trim().split('\n')[0].trim();
    const guess = first.length < 60 && !/\d|nutrition|serving|amount per/i.test(first) ? first : '';
    if (p && (imp.mode === 'nutrition' || shared)) res = { kind: 'nutrition', name: title || guess, ...p };
  }
  if (!res) return impMsg(imp.mode === 'recipe'
    ? 'Couldn’t find ingredient lines in that. Copy just the ingredient list (one per line, with amounts) and try again.'
    : 'Couldn’t find calories in that. Copy the nutrition facts for a single item, including the Calories line.');
  if (res.kind === 'recipe') {
    S.draft = { id: null, name: res.name || '', servings: res.servings || null, items: res.lines.map(rawItem), site: res.site ? res.site.n : null };
    commit(); openRecipe(); matchDraft();
    return;
  }
  openCustom({ prefill: { name: res.name, serving: res.serving, servingG: res.servingG, n: res.n }, meal: search.meal,
    note: 'Read from what you pasted. Check the numbers against the page, add a name, then save.' });
}

// --- barcode ---
const scanIcon = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 8v8M10 8v8M12.5 8v8M15.5 8v8M17 8v8" stroke="currentColor" stroke-width="1.4"/></svg>';
function openScanner(meal) {
  meal = meal || search.meal;
  openSheet(`${sheetHead('Scan a barcode', 'add')}
    <div class="cam"><video id="cam" playsinline muted autoplay></video><div class="aim"></div></div>
    <p class="res-note center" id="cam-status">Starting camera…</p>
    <form class="searchbar" id="code-form">
      <input class="field" id="code" inputmode="numeric" placeholder="Or type the number under the bars" autocomplete="off" enterkeyhint="search">
      <button class="btn" type="submit">Look up</button>
    </form>`, body => {
    const status = $('#cam-status', body);
    const sc = scan($('#cam', body), { onStatus: t => { status.textContent = t; } });
    sc.result.then(code => { if (code) lookupCode(code, meal); }, err => {
      status.textContent = err && err.name === 'NotAllowedError' ? 'Camera access was turned down. You can allow it in Settings › Safari › Camera, or type the number below.' : (err && err.message) || 'Camera unavailable. Type the number below.';
    });
    $('#code-form', body).addEventListener('submit', ev => {
      ev.preventDefault();
      const c = $('#code', body).value.replace(/\D/g, '');
      if (c.length >= 6) { sc.stop(); lookupCode(c, meal); }
    });
    return () => sc.stop();
  });
}

async function lookupCode(code, meal) {
  if (navigator.vibrate) navigator.vibrate(30);
  const mine = C.findBarcode(S, code);
  if (mine) return openFood(mine, { meal });
  openSheet(`${sheetHead('Looking up', 'add')}<p class="res-note center big-note">${esc(code)}<br>Checking Open Food Facts and USDA…</p>`);
  try {
    const f = await byBarcode(S, code);
    if (!sheetEl.classList.contains('open')) return;
    if (f) openFood(f, { meal });
    else openCustom({ barcode: code, meal, note: 'This barcode isn’t in either database yet. Type it in from the label once and the next scan will find it.' });
  } catch (e) {
    openCustom({ barcode: code, meal, note: `Couldn't look it up (${e.message}). You can type it in from the label.` });
  }
}

// --- full nutrient breakdown for the day ---
function openBreakdown() {
  const entries = S.days[ui.day] || [];
  const t = C.dayTotals(entries);
  const kc = (t.protein || 0) * 4 + (t.carbs || 0) * 4 + (t.fat || 0) * 9;
  const share = k => (kc ? Math.round(((t[k] || 0) * (k === 'fat' ? 9 : 4) / kc) * 100) : 0);
  const missing = k => entries.filter(e => e.n[k] == null).length;
  const rows = C.NUTRIENTS.filter(n => n.k !== 'kcal').map(n => {
    const v = t[n.k];
    const pct = n.dv && v != null ? Math.round((v / n.dv) * 100) : null;
    const miss = missing(n.k);
    return `<li class="nrow${n.sub ? ' subrow' : ''}">
      <span class="nl">${n.label}${miss && entries.length ? `<small>${miss} item${miss === 1 ? '' : 's'} without data</small>` : ''}</span>
      <span class="nv">${amt(v ?? 0, n.unit)}</span>
      <span class="nd">${pct != null ? pct + '%' : ''}</span>
      ${n.dv ? `<span class="nbar"><i style="width:${Math.min(100, pct || 0)}%"></i></span>` : ''}
    </li>`;
  }).join('');
  openSheet(`${sheetHead(dayLabel(ui.day))}
    <div class="split">
      <div class="split-bar"><i class="p" style="width:${share('protein')}%"></i><i class="c" style="width:${share('carbs')}%"></i><i class="f" style="width:${share('fat')}%"></i></div>
      <div class="split-key"><span class="p">Protein ${share('protein')}%</span><span class="c">Carbs ${share('carbs')}%</span><span class="f">Fat ${share('fat')}%</span></div>
    </div>
    <div class="n-head"><span>${commas(t.kcal || 0)} kcal</span><span>% daily value</span></div>
    <ul class="nlist">${rows}</ul>
    <p class="note">Daily values are the FDA's label references for a 2,000-calorie diet.</p>`);
}

// --- weight entry ---
function openWeigh(id) {
  const w = id ? S.weights.find(x => x.id === id) : null;
  const prev = S.weights[S.weights.length - 1];
  openSheet(`${sheetHead(w ? 'Edit weigh-in' : 'Log weight')}
    <div class="form">
      <div class="two">
        <input class="field" id="w-date" type="date" value="${w ? w.date : C.dateKey()}" max="${C.dateKey()}">
        <input class="field num" id="w-val" inputmode="decimal" placeholder="${prev ? wFmt(prev.kg) : '0.0'}" value="${w ? wFmt(w.kg) : ''}" aria-label="Weight in ${wUnit()}">
      </div>
      <p class="note">${wUnit()}. One weigh-in per day; logging the same day again replaces it.</p>
    </div>
    <button class="btn primary wide" id="w-save">Save</button>
    ${w ? '<button class="btn danger hold wide" data-hold="remove-weight">Hold to remove</button>' : ''}`, body => {
    const val = $('#w-val', body), go = $('#w-save', body);
    const check = () => { go.disabled = !(C.num(val.value) > 0 && $('#w-date', body).value); };
    body.addEventListener('input', check); check();
    if (!w) setTimeout(() => val.focus(), 250);
    go.addEventListener('click', () => {
      const date = $('#w-date', body).value, kg = C.toKg(C.num(val.value), wUnit());
      S.weights = S.weights.filter(x => x.date !== date && (!w || x.id !== w.id));
      S.weights.push({ id: w ? w.id : C.uid(), date, kg });
      S.weights.sort((a, b) => a.date.localeCompare(b.date));
      commit(); closeSheet(); render();
    });
    if (w) holdActions['remove-weight'] = () => { S.weights = S.weights.filter(x => x.id !== w.id); commit(); closeSheet(); render(); };
  });
}

// ---------- events ----------
const holdActions = {};
document.addEventListener('click', e => {
  const t = e.target;
  const tab = t.closest('[data-tab]');
  if (tab) { ui.tab = tab.dataset.tab; render(); $('#screen').scrollTop = 0; return; }
  const act = t.closest('[data-act]');
  const a = act && act.dataset.act;
  if (a === 'close') return closeSheet();
  if (a === 'day-prev') { ui.day = C.addDays(ui.day, -1); return render(); }
  if (a === 'day-next') { ui.day = C.addDays(ui.day, 1); return render(); }
  if (a === 'day-today') { ui.day = C.dateKey(); return render(); }
  if (a === 'breakdown') return openBreakdown();
  if (a === 'scan') return openScanner();
  if (a === 'online') return runOnline();
  if (a === 'go-key') { closeSheet(); ui.tab = 'settings'; render(); const k = $('[data-set=usdaKey]'); if (k) { k.scrollIntoView({ block: 'center' }); k.focus(); } return; }
  if (a === 'custom') return openCustom({ meal: search.meal });
  if (a === 'new-recipe') return newRecipe();
  if (a === 'import') return openImport();
  if (a === 'r-add') { pick = {}; search.q = ''; search.usda = search.off = null; return openAdd(search.meal); }
  if (a === 'paste') return pasteInto();
  if (a === 'weigh') return openWeigh();
  if (a === 'export') return exportBackup();
  const back = t.closest('[data-back]');
  if (back) return back.dataset.back === 'recipe' ? openRecipe() : openAdd(search.meal);
  const add = t.closest('[data-add]');
  if (add) { pick = null; search.q = ''; search.usda = search.off = null; return openAdd(add.dataset.add); }
  const item = t.closest('[data-item]');
  if (item) return openItem(item.dataset.item);
  const food = t.closest('[data-food]');
  if (food) { const f = search.results.get(food.dataset.food); if (f) openFood(f); return; }
  const entry = t.closest('[data-entry]');
  if (entry) return openEntry(entry.dataset.entry);
  const r = t.closest('[data-range]');
  if (r) { ui.range = +r.dataset.range; return render(); }
  const wr = t.closest('[data-weight]');
  if (wr) return openWeigh(wr.dataset.weight);
  const un = t.closest('[data-unit]');
  if (un) { S.settings.wUnit = un.dataset.unit; commit(); return render(); }
});

// Check a pasted USDA key once you leave the field.
document.addEventListener('change', async e => {
  if (!e.target.dataset || e.target.dataset.set !== 'usdaKey') return;
  const k = e.target.value.trim(), st = $('#key-status');
  if (!k || !st) return;
  st.textContent = 'Checking key…';
  const r = await checkKey(k);
  st.textContent = r === 'ok' ? 'Key works. Food search is ready.' : r === 'limit' ? 'Key accepted, but its hourly limit is used up. It resets within the hour.' : r === 'offline' ? 'Couldn’t reach USDA to check the key. It’s saved; try a search later.' : 'USDA didn’t accept that key. Check it was pasted in full.';
});

// Settings fields save as you type.
document.addEventListener('input', e => {
  const k = e.target.dataset && e.target.dataset.set;
  if (!k) return;
  const v = e.target.value.trim();
  S.settings[k] = k === 'usdaKey' ? v : (C.num(v) > 0 ? Math.round(C.num(v)) : (k === 'kcal' ? S.settings.kcal : null));
  commit();
});

// Hold-to-confirm for anything that removes data.
let holdTimer = 0, holdBtn = null;
const endHold = () => { clearTimeout(holdTimer); if (holdBtn) holdBtn.classList.remove('holding'); holdBtn = null; };
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-hold]');
  if (!b) return;
  holdBtn = b; b.classList.add('holding');
  holdTimer = setTimeout(() => { const fn = holdActions[b.dataset.hold]; endHold(); if (navigator.vibrate) navigator.vibrate(40); if (fn) fn(); }, 800);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => document.addEventListener(ev, endHold, true));
document.addEventListener('contextmenu', e => { if (e.target.closest('[data-hold]')) e.preventDefault(); });

// ---------- backup ----------
async function exportBackup() {
  const blob = backupBlob(S);
  const name = `intake-backup-${C.dateKey()}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Intake backup' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
document.addEventListener('change', async e => {
  if (e.target.id !== 'restore' || !e.target.files[0]) return;
  const box = $('#restore-confirm');
  try {
    const next = readBackup(await e.target.files[0].text());
    const days = Object.keys(next.days).length, foods = Object.keys(next.foods).length;
    box.innerHTML = `<p class="note">This backup has ${days} days, ${foods} foods and ${next.weights.length} weigh-ins. Restoring replaces everything on this phone.</p><button class="btn danger hold wide" data-hold="restore">Hold to restore</button>`;
    holdActions.restore = () => { S = next; commit(); render(); toast('Backup restored'); };
  } catch (err) { box.innerHTML = `<p class="note">That file isn't an Intake backup.</p>`; }
  e.target.value = '';
});

// Day rolls over while the app sits open.
let lastToday = C.dateKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const t = C.dateKey();
  if (t !== lastToday) { if (ui.day === lastToday) ui.day = t; lastToday = t; render(); }
});

render();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
