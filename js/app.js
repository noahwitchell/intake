import { load, save, backupBlob, readBackup } from './store.js';
import { searchUSDA, usdaDetail, searchOFF, byBarcode } from './api.js';
import { scan } from './scanner.js';

const C = globalThis.Core;
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
const srcName = { usda: 'USDA', off: 'Open Food Facts', custom: 'My food' };
const foodSub = f => [f.brand, srcName[f.src]].filter(Boolean).join(' · ');

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
    <p class="note">Food search works without one, but USDA's shared demo key only allows a few searches an hour. A free personal key allows 1,000. Get one at <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noopener">fdc.nal.usda.gov/api-key-signup</a>; it's emailed to you right away.</p>
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
  <p class="about">Intake keeps your log on this device only. Looking up a food sends just the words you type, or the barcode number, to USDA FoodData Central or Open Food Facts.</p>
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

function openAdd(meal) {
  search.meal = meal || defaultMeal();
  openSheet(`${sheetHead('Add to ' + C.MEALS.find(m => m.k === search.meal).label)}
    <form class="searchbar" id="sform">
      <input class="field" id="q" type="search" placeholder="Search foods" value="${esc(search.q)}" autocomplete="off" enterkeyhint="search">
      <button type="button" class="scan-btn" data-act="scan" aria-label="Scan a barcode">${scanIcon}</button>
    </form>
    <div class="results" id="results"></div>
    <button class="btn wide ghost" data-act="custom">Enter a food by hand</button>`, body => {
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
  const fail = e => (e.name === 'AbortError' ? null : e.code === 'limit' ? 'USDA limit reached. Add your free key in Settings.' : e.code === 'key' ? 'USDA key not accepted. Check it in Settings.' : e.message);
  await Promise.all([
    searchUSDA(S, q, ctl.signal).then(r => { search.usda = r; }, e => { search.usdaErr = fail(e); search.usda = []; }).finally(() => ctl === search.ctl && paintResults()),
    searchOFF(q, ctl.signal).then(r => { search.off = r; }, e => { search.offErr = fail(e); search.off = []; }).finally(() => ctl === search.ctl && paintResults()),
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
  const mine = C.searchMine(S, search.q);
  const q = search.q.trim();
  const section = (title, list, state) => `<h3 class="res-h">${title}</h3>${state ? `<p class="res-note">${esc(state)}</p>` : ''}${list && list.length ? `<ul class="list">${list.map(resultRow).join('')}</ul>` : ''}`;
  let html = '';
  if (!q) html += mine.length ? section('Recent', mine) : '<p class="res-note">Search for a food, or scan a barcode. Anything you log is saved here for next time.</p>';
  else {
    if (mine.length) html += section('My foods', mine);
    const online = (list, err) => (err ? err : list == null ? (search.loading ? 'Searching…' : '') : list.length ? '' : 'Nothing found');
    // USDA generic results are per 100 g, so they show the 100 g figure.
    if (search.usda == null && search.off == null && !search.loading) html += `<button class="btn wide online" data-act="online">Search USDA and Open Food Facts for “${esc(q)}”</button>`;
    else {
      html += section('Basic foods · USDA', search.usda, online(search.usda, search.usdaErr));
      html += section('Packaged · Open Food Facts', search.off, online(search.off, search.offErr));
    }
  }
  el.innerHTML = html;
}

// --- amount picker ---
async function openFood(f, { meal, back = 'add', note = '' } = {}) {
  meal = meal || search.meal;
  let food = S.foods[f.id] || f;
  let pi = food.lastPortion != null && food.portions[food.lastPortion] ? food.lastPortion : 0;
  let qty = food.lastQty || 1;
  const draw = () => `${sheetHead(food.name, back)}
    ${note ? `<p class="flash">${esc(note)}</p>` : ''}
    <p class="sub">${esc(foodSub(food))}${food.barcode ? ` · ${esc(food.barcode)}` : ''}</p>
    <div class="amount">
      <input class="field num" id="qty" inputmode="decimal" value="${qtyText(qty)}" aria-label="Amount">
      <select class="field" id="portion" aria-label="Portion">${food.portions.map((p, i) => `<option value="${i}"${i === pi ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
    </div>
    <div id="preview"></div>
    <div class="seg meals">${C.MEALS.map(m => `<button class="${m.k === meal ? 'on' : ''}" data-meal="${m.k}">${m.label}</button>`).join('')}</div>
    <button class="btn primary wide" id="add-go">Add to ${esc(ui.day === C.dateKey() ? 'today' : dayLabel(ui.day))}</button>
    ${food.src === 'custom' ? '<button class="btn wide ghost" id="edit-food">Edit this food</button>' : ''}`;
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
      const saved = { ...food, uses: (food.uses || 0) + 1, last: new Date().toISOString(), lastQty: qty, lastPortion: pi };
      S.foods[food.id] = saved;
      (S.days[ui.day] ||= []).push(C.makeEntry(saved, qty, pi, meal));
      commit(); closeSheet(); ui.tab = 'today'; render();
      toast(`Added ${food.name}`);
    });
    const ed = $('#edit-food', body);
    if (ed) ed.addEventListener('click', () => openCustom({ food, meal }));
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
function openCustom({ food = null, barcode = '', meal, note = '' } = {}) {
  const f = food || {};
  const v = k => (f.n && f.n[k] != null ? C.round(f.n[k], 2) : '');
  const nf = (k, req) => `<label class="nf"><span>${N[k].label}${N[k].unit === 'kcal' ? '' : ` (${N[k].unit})`}${req ? ' *' : ''}</span><input class="field num" inputmode="decimal" data-n="${k}" value="${v(k)}"></label>`;
  openSheet(`${sheetHead(food ? 'Edit food' : 'Enter a food', food ? null : 'add')}
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
  if (a === 'custom') return openCustom({ meal: search.meal });
  if (a === 'weigh') return openWeigh();
  if (a === 'export') return exportBackup();
  const back = t.closest('[data-back]');
  if (back) return openAdd(search.meal);
  const add = t.closest('[data-add]');
  if (add) { search.q = ''; search.usda = search.off = null; return openAdd(add.dataset.add); }
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
