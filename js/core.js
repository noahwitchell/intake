// Intake rules: nutrients, food parsing (USDA + Open Food Facts), portions, totals, weight trend.
// Classic script so the app, the service worker and node tests can all load it. Exposes globalThis.Core.
(function () {
  'use strict';

  // Every nutrient the app tracks. usda = FoodData Central nutrient number, off = Open Food Facts key
  // (OFF stores everything in grams, so offScale turns it into this unit). dv = FDA daily value.
  const NUTRIENTS = [
    { k: 'kcal', label: 'Calories', unit: 'kcal', usda: ['208', '957', '958'], off: 'energy-kcal', offScale: 1 },
    { k: 'protein', label: 'Protein', unit: 'g', usda: ['203'], off: 'proteins', offScale: 1, dv: 50 },
    { k: 'carbs', label: 'Carbs', unit: 'g', usda: ['205', '205.2'], off: 'carbohydrates', offScale: 1, dv: 275 },
    { k: 'fat', label: 'Fat', unit: 'g', usda: ['204'], off: 'fat', offScale: 1, dv: 78 },
    { k: 'satfat', label: 'Saturated fat', unit: 'g', usda: ['606'], off: 'saturated-fat', offScale: 1, dv: 20, sub: 'fat' },
    { k: 'transfat', label: 'Trans fat', unit: 'g', usda: ['605'], off: 'trans-fat', offScale: 1, sub: 'fat' },
    { k: 'fiber', label: 'Fiber', unit: 'g', usda: ['291'], off: 'fiber', offScale: 1, dv: 28, sub: 'carbs' },
    { k: 'sugar', label: 'Sugar', unit: 'g', usda: ['269', '269.3'], off: 'sugars', offScale: 1, sub: 'carbs' },
    { k: 'chol', label: 'Cholesterol', unit: 'mg', usda: ['601'], off: 'cholesterol', offScale: 1000, dv: 300 },
    { k: 'sodium', label: 'Sodium', unit: 'mg', usda: ['307'], off: 'sodium', offScale: 1000, dv: 2300 },
    { k: 'potassium', label: 'Potassium', unit: 'mg', usda: ['306'], off: 'potassium', offScale: 1000, dv: 4700 },
    { k: 'calcium', label: 'Calcium', unit: 'mg', usda: ['301'], off: 'calcium', offScale: 1000, dv: 1300 },
    { k: 'iron', label: 'Iron', unit: 'mg', usda: ['303'], off: 'iron', offScale: 1000, dv: 18 },
    { k: 'vitA', label: 'Vitamin A', unit: 'µg', usda: ['320'], off: 'vitamin-a', offScale: 1e6, dv: 900 },
    { k: 'vitC', label: 'Vitamin C', unit: 'mg', usda: ['401'], off: 'vitamin-c', offScale: 1000, dv: 90 },
    { k: 'vitD', label: 'Vitamin D', unit: 'µg', usda: ['328'], off: 'vitamin-d', offScale: 1e6, dv: 20 },
  ];
  const KEYS = NUTRIENTS.map(n => n.k);
  const MEALS = [
    { k: 'breakfast', label: 'Breakfast' },
    { k: 'lunch', label: 'Lunch' },
    { k: 'dinner', label: 'Dinner' },
    { k: 'snacks', label: 'Snacks' },
  ];
  const OZ = 28.3495, LB_PER_KG = 2.20462;

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const num = v => (typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null));
  const round = (v, d = 0) => { const p = 10 ** d; return Math.round(v * p) / p; };

  // ---------- state ----------
  function emptyState() {
    return {
      v: 1,
      foods: {},   // id -> food
      days: {},    // 'YYYY-MM-DD' -> [entry]
      weights: [], // { id, date, kg }
      settings: { kcal: 2000, protein: null, carbs: null, fat: null, wUnit: 'lb', usdaKey: '' },
      draft: null, // recipe being built, kept so leaving the app doesn't lose it
    };
  }

  function normalize(s) {
    const e = emptyState();
    if (!s || typeof s !== 'object') return e;
    const out = {
      v: 1,
      foods: s.foods && typeof s.foods === 'object' ? s.foods : {},
      days: s.days && typeof s.days === 'object' ? s.days : {},
      weights: Array.isArray(s.weights) ? s.weights.filter(w => w && w.date && num(w.kg) != null) : [],
      settings: { ...e.settings, ...(s.settings || {}) },
      draft: s.draft && typeof s.draft === 'object' && Array.isArray(s.draft.items) ? s.draft : null, // unsaved recipe
    };
    for (const k of Object.keys(out.days)) if (!Array.isArray(out.days[k])) delete out.days[k];
    out.weights.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }

  // ---------- dates ----------
  const pad = n => String(n).padStart(2, '0');
  const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
  const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5);

  // ---------- nutrients ----------
  function cleanN(n) {
    const out = {};
    for (const k of KEYS) { const v = num(n && n[k]); if (v != null && v >= 0) out[k] = v; }
    return out;
  }
  function scaleN(n, m) {
    const out = {};
    for (const k of KEYS) if (n[k] != null) out[k] = n[k] * m;
    return out;
  }
  function sumN(list) {
    const out = {};
    for (const n of list) for (const k of KEYS) if (n && n[k] != null) out[k] = (out[k] || 0) + n[k];
    return out;
  }

  const fixCase = s => {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (s && s === s.toUpperCase() && /[A-Z]/.test(s)) s = s.toLowerCase().replace(/(^|[\s(\-/&+])([a-z])/g, (m, a, b) => a + b.toUpperCase());
    return s;
  };
  // USDA branded descriptions sometimes repeat themselves ("X, Y, X, Y").
  const dedupe = s => {
    const parts = s.split(', ');
    if (parts.length % 2 === 0) {
      const h = parts.length / 2;
      if (parts.slice(0, h).join(', ') === parts.slice(h).join(', ')) return parts.slice(0, h).join(', ');
    }
    return s;
  };

  // Portions for a food measured per 100 g: the natural one(s) first, then grams and ounces.
  function gramPortions(extra) {
    const list = (extra || []).filter(p => p.g > 0).map(p => ({ label: p.label, mult: p.g / 100 }));
    list.push({ label: 'g', mult: 0.01 }, { label: 'oz', mult: OZ / 100 });
    return list;
  }

  // ---------- USDA FoodData Central ----------
  function usdaNumberMap(list) {
    const m = {};
    for (const x of list || []) {
      const no = x.nutrientNumber || (x.nutrient && x.nutrient.number);
      const v = num(x.value != null ? x.value : x.amount);
      if (no && v != null && m[no] == null) m[no] = v;
    }
    return m;
  }
  function usdaPortionLabel(p) {
    const desc = p.portionDescription && !/not specified/i.test(p.portionDescription) ? p.portionDescription : '';
    if (desc) return desc;
    const amt = num(p.amount) || 1;
    const unit = p.modifier || (p.measureUnit && p.measureUnit.name !== 'undetermined' ? p.measureUnit.name : '') || 'portion';
    return `${round(amt, 2)} ${unit}`.trim();
  }
  // f = a search hit or a /food/{id} detail record. Values are per 100 g.
  function fromUSDA(f) {
    const m = usdaNumberMap(f.foodNutrients);
    const n = {};
    for (const d of NUTRIENTS) for (const no of d.usda) if (n[d.k] == null && m[no] != null) n[d.k] = m[no];
    if (n.kcal == null && m['268'] != null) n.kcal = m['268'] / 4.184;
    const extra = [];
    if (f.dataType === 'Branded' && num(f.servingSize) > 0 && /^(g|grm|ml|mlt|mg)$/i.test(f.servingSizeUnit || 'g')) {
      const g = num(f.servingSize);
      const hh = (f.householdServingFullText || '').trim();
      extra.push({ label: hh && !/^none$/i.test(hh) ? `${hh} (${round(g)} g)` : `serving (${round(g)} g)`, g });
    }
    for (const p of f.foodPortions || []) {
      const g = num(p.gramWeight);
      if (g > 0) extra.push({ label: `${usdaPortionLabel(p)} (${round(g)} g)`, g });
    }
    const portions = extra;
    return {
      id: 'usda:' + f.fdcId,
      name: dedupe(fixCase(f.description)),
      brand: fixCase(f.brandName || f.brandOwner || ''),
      barcode: f.gtinUpc ? String(f.gtinUpc) : '',
      src: 'usda',
      kind: f.dataType || '',
      fdcId: f.fdcId,
      n: cleanN(n),
      portions: gramPortions(portions),
    };
  }

  // ---------- Open Food Facts ----------
  function fromOFF(p) {
    const nu = p.nutriments || {};
    const sq = num(p.serving_quantity);
    const n = {};
    for (const d of NUTRIENTS) {
      let v = num(nu[d.off + '_100g']);
      if (v == null && sq > 0 && num(nu[d.off + '_serving']) != null) v = num(nu[d.off + '_serving']) * 100 / sq;
      if (v != null) n[d.k] = v * d.offScale;
    }
    if (n.kcal == null) {
      const kj = num(nu['energy-kj_100g']) ?? (nu.energy_unit === 'kcal' ? null : num(nu.energy_100g));
      if (kj != null) n.kcal = kj / 4.184;
      else if (nu.energy_unit === 'kcal' && num(nu.energy_100g) != null) n.kcal = num(nu.energy_100g);
    }
    const extra = [];
    if (sq > 0) {
      const lbl = String(p.serving_size || '').trim();
      extra.push({ label: lbl ? (/\d\s*(g|ml)\b/i.test(lbl) ? lbl : `${lbl} (${round(sq)} g)`) : `serving (${round(sq)} g)`, g: sq });
    }
    const brand = String(p.brands || '').split(',')[0];
    return {
      id: 'off:' + p.code,
      name: fixCase(p.product_name || p.generic_name || 'Unnamed product'),
      brand: fixCase(brand),
      barcode: String(p.code || ''),
      src: 'off',
      n: cleanN(n),
      portions: gramPortions(extra),
    };
  }

  // ---------- your own foods ----------
  // Typed in from a label: values are per one serving. servingG (optional) adds g / oz portions.
  function customFood({ id, name, brand, barcode, serving, servingG, n }) {
    const g = num(servingG);
    const portions = [{ label: serving ? String(serving).trim() : 'serving', mult: 1 }];
    if (g > 0) portions.push({ label: 'g', mult: 1 / g }, { label: 'oz', mult: OZ / g });
    return {
      id: id || 'my:' + uid(),
      name: String(name || '').trim() || 'My food',
      brand: String(brand || '').trim(),
      barcode: String(barcode || '').trim(),
      src: 'custom',
      serving: portions[0].label,
      servingG: g > 0 ? g : null,
      n: cleanN(n),
      portions,
    };
  }

  const usable = f => f && f.n && f.n.kcal != null;

  // ---------- recipes ----------
  // A recipe is a food whose base unit is one serving. items are entry-shaped ingredients
  // ({ foodId, name, qty, portion, mult, n }); an item with foodId null is a line still to be matched.
  const recipeTotal = items => sumN((items || []).filter(i => i.foodId).map(i => i.n));
  function recipeFood({ id, name, servings, items, site }) {
    const sv = num(servings) > 0 ? num(servings) : 1;
    const per = scaleN(recipeTotal(items), 1 / sv);
    return {
      id: id || 'rcp:' + uid(),
      name: String(name || '').trim() || 'My recipe',
      brand: '',
      barcode: '',
      src: 'recipe',
      servings: sv,
      items: (items || []).map(i => ({ ...i })),
      site: site || null,
      n: cleanN(per),
      portions: [{ label: 'serving', mult: 1 }, { label: `whole recipe (${round(sv, 2)} servings)`, mult: sv }],
    };
  }

  // ---------- log entries ----------
  function makeEntry(food, qty, portionIdx, meal) {
    const p = food.portions[portionIdx] || food.portions[0];
    const q = num(qty) > 0 ? num(qty) : 1;
    return {
      id: uid(),
      foodId: food.id,
      name: food.name,
      brand: food.brand || '',
      qty: q,
      portion: p.label,
      mult: p.mult,
      meal,
      n: scaleN(food.n, q * p.mult),
    };
  }
  // Change amount on a logged entry (works even if the food was later removed: n scales from itself).
  function reweigh(entry, qty, portion) {
    const q = num(qty) > 0 ? num(qty) : entry.qty;
    const per = scaleN(entry.n, 1 / (entry.qty * entry.mult));
    const mult = portion ? portion.mult : entry.mult;
    return { ...entry, qty: q, portion: portion ? portion.label : entry.portion, mult, n: scaleN(per, q * mult) };
  }

  const dayTotals = entries => sumN((entries || []).map(e => e.n));
  const mealTotals = (entries, meal) => sumN((entries || []).filter(e => e.meal === meal).map(e => e.n));

  // Recents: foods you logged, most recently used first.
  function recentFoods(s, limit = 30) {
    return Object.values(s.foods).filter(usable).sort((a, b) => (b.last || '').localeCompare(a.last || '') || (b.uses || 0) - (a.uses || 0)).slice(0, limit);
  }
  function searchMine(s, q) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return recentFoods(s);
    return Object.values(s.foods).filter(f => {
      const hay = `${f.name} ${f.brand} ${f.barcode}`.toLowerCase();
      return words.every(w => hay.includes(w));
    }).sort((a, b) => (b.uses || 0) - (a.uses || 0)).slice(0, 30);
  }
  const findBarcode = (s, code) => {
    const c = normBarcode(code);
    return Object.values(s.foods).find(f => f.barcode && normBarcode(f.barcode) === c) || null;
  };
  // UPC-A (12) and EAN-13 (13) of the same product differ by leading zeros; USDA pads to 14.
  const normBarcode = c => String(c || '').replace(/\D/g, '').replace(/^0+/, '');

  // ---------- weight ----------
  const toKg = (v, unit) => (unit === 'kg' ? v : v / LB_PER_KG);
  const fromKg = (kg, unit) => (unit === 'kg' ? kg : kg * LB_PER_KG);
  // Smoothed trend: each weigh-in pulls the line 10% per day elapsed, so day-to-day water swings settle out.
  function trend(weights) {
    const out = [];
    let t = null, prev = null;
    for (const w of weights) {
      if (t == null) t = w.kg;
      else {
        const days = Math.max(1, daysBetween(prev, w.date));
        const a = 1 - Math.pow(0.9, days);
        t = t + a * (w.kg - t);
      }
      prev = w.date;
      out.push({ date: w.date, kg: w.kg, trend: t });
    }
    return out;
  }

  globalThis.Core = {
    NUTRIENTS, KEYS, MEALS, OZ, LB_PER_KG,
    uid, num, round, emptyState, normalize,
    dateKey, parseKey, addDays, daysBetween,
    cleanN, scaleN, sumN, fixCase,
    fromUSDA, fromOFF, customFood, usable, recipeFood, recipeTotal,
    makeEntry, reweigh, dayTotals, mealTotals,
    recentFoods, searchMine, findBarcode, normBarcode,
    toKg, fromKg, trend,
  };
})();
