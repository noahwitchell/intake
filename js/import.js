// Intake import rules: ingredient lines, portion matching, nutrition-facts text, recipe pages.
// Classic script (like core.js) so the app and node tests both load it. Exposes globalThis.Import.
// Nothing here touches the network: the app pastes text in, these functions read it.
(function () {
  'use strict';
  const C = globalThis.Core;

  // ---------- amounts ----------
  const FRAC = { '½': .5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': .25, '¾': .75, '⅛': .125, '⅜': .375, '⅝': .625, '⅞': .875, '⅕': .2, '⅖': .4, '⅙': 1 / 6, '⅚': 5 / 6 };
  const FRAC_LEAD = new RegExp('^\\s*([' + Object.keys(FRAC).join('') + '])');

  // Volumes in teaspoons, masses in grams.
  const VOL = { cup: 48, tbsp: 3, tsp: 1, floz: 6, ml: 0.202884, l: 202.884, pinch: 1 / 16, dash: 1 / 8 };
  const MASS = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592, mg: 0.001 };
  const UNIT_WORDS = [
    ['floz', /^(fl\.?\s*oz\.?|fluid\s+ounces?)\b/i],
    ['cup', /^(cups?|c\.)(?=\s|$)/i],
    ['tbsp', /^(tablespoons?|tbsps?\.?|tbls?\.?|tbs\.?)(?=\s|$)/i],
    ['tbsp', /^T(?=\s|$)/],
    ['tsp', /^(teaspoons?|tsps?\.?)(?=\s|$)/i],
    ['tsp', /^t(?=\s|$)/],
    ['oz', /^(ounces?|oz\.?)(?=\s|$)/i],
    ['lb', /^(pounds?|lbs?\.?)(?=\s|$)/i],
    ['kg', /^(kilograms?|kilos?|kgs?)(?=\s|$)/i],
    ['g', /^(grams?|gr?)(?=\s|$)/i],
    ['ml', /^(milliliters?|millilitres?|mls?)(?=\s|$)/i],
    ['l', /^(liters?|litres?|l)(?=\s|$)/i],
    ['pinch', /^pinch(es)?(?=\s|$)/i],
    ['dash', /^dash(es)?(?=\s|$)/i],
  ];
  // Count words: kept as words so they can be matched to a food's own portions ("1 large", "1 clove").
  const COUNT = /^(cloves?|slices?|cans?|sticks?|pieces?|heads?|bunch(es)?|sprigs?|stalks?|packages?|pkgs?|jars?|bottles?|links?|fillets?|breasts?|thighs?|leaves|leaf|extra[\s-]large|large|medium|small|whole|each|scoops?|handfuls?)(?=\s|$|,)/i;

  const kindOf = u => (u in VOL ? 'vol' : u in MASS ? 'mass' : u ? 'count' : '');
  const singular = w => { w = w.toLowerCase().replace(/[\s-]+/g, ' '); return w === 'leaves' ? 'leaf' : w.replace(/(ch|sh)es$/, '$1').replace(/s$/, ''); };

  // "1 1/2", "1½", "½", "1.5", "1-2" (takes the low end), "1 to 2".
  function readQty(s) {
    s = s.replace(/(\d)([½⅓⅔¼¾⅛⅜⅝⅞⅕⅖⅙⅚])/g, '$1 $2');
    let total = null, m;
    const take = re => { const r = s.match(re); if (r) s = s.slice(r[0].length); return r; };
    for (;;) {
      if ((m = take(/^\s*(\d+)\s*\/\s*(\d+)/))) total = (total || 0) + (+m[1] / +m[2]);
      else if ((m = take(/^\s*(\d+(?:\.\d+)?|\.\d+)/))) { if (total != null && total % 1 === 0 && +m[1] >= 1) break; total = (total || 0) + +m[1]; }
      else if ((m = take(FRAC_LEAD))) total = (total || 0) + FRAC[m[1]];
      else break;
    }
    if (total != null) take(/^\s*(?:-|–|to)\s*(?:\d+(?:\.\d+)?(?:\s*\/\s*\d+)?|[½⅓⅔¼¾⅛⅜⅝⅞])/i);
    return { qty: total, rest: s };
  }

  const PREP = /\b(freshly|fresh|finely|roughly|coarsely|thinly|chopped|diced|minced|sliced|grated|shredded|peeled|seeded|cored|trimmed|halved|quartered|cubed|crushed|softened|melted|beaten|divided|packed|lightly|firmly|sifted|rinsed|drained|cooked|uncooked|room temperature|at room temperature|to taste|as needed|optional|plus more|for serving|for garnish|about|approximately|heaping|level|good quality|of)\b/gi;
  function cleanName(s) {
    let n = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
    n = n.split(/,|;|\s+-\s+|\bor\b/i)[0];
    n = n.replace(PREP, ' ').replace(/[*†]/g, ' ').replace(/\s+/g, ' ').trim();
    return n.replace(/^(a|an|the)\s+/i, '');
  }

  // One recipe line -> { raw, qty, unit, kind, size, name } (unit null when there is none).
  function parseIngredient(line) {
    const raw = String(line || '').replace(/^[\s•·\-–*▢☐□◻✓✔]+/, '').replace(/\s+/g, ' ').trim();
    let { qty, rest } = readQty(raw);
    rest = rest.trim();
    let unit = null, size = '';
    // "1 (14 oz) can tomatoes": the package weight is the useful number.
    const pk = rest.match(/^\(\s*(\d+(?:\.\d+)?)\s*-?\s*(oz|ounces?|g|grams?|lbs?|pounds?|ml)\.?\s*\)\s*/i);
    if (pk) {
      const u = UNIT_WORDS.find(([, re]) => re.test(pk[2]));
      if (u) { qty = (qty || 1) * +pk[1]; unit = u[0]; rest = rest.slice(pk[0].length).replace(COUNT, '').trim(); }
    }
    if (!unit) {
      for (const [u, re] of UNIT_WORDS) {
        const m = rest.match(re);
        if (m && (qty != null || u === 'pinch' || u === 'dash')) { unit = u; rest = rest.slice(m[0].length).trim(); break; }
      }
    }
    if (!unit) {
      const m = rest.match(COUNT);
      if (m) { size = singular(m[1]); rest = rest.slice(m[0].length).trim(); }
    }
    rest = rest.replace(/^of\s+/i, '');
    return { raw, qty, unit: unit || (size ? size : null), tiny: unit === 'pinch' || unit === 'dash', kind: unit ? kindOf(unit) : size ? 'count' : '', name: cleanName(rest) || cleanName(raw) };
  }

  // First number in a portion label: "1 cup, sliced (150 g)" -> 1, "0.5 cup" -> 0.5, "serving (30 g)" -> 1.
  function labelNum(label) {
    const { qty } = readQty(String(label));
    return qty > 0 ? qty : 1;
  }
  function labelVol(label) {
    const s = String(label).toLowerCase().replace(/\([^)]*\)/g, '');
    if (/\bfl\.?\s*oz\b/.test(s)) return VOL.floz;
    if (/\bcups?\b/.test(s)) return VOL.cup;
    if (/\b(tbsp|tablespoons?)\b/.test(s)) return VOL.tbsp;
    if (/\b(tsp|teaspoons?)\b/.test(s)) return VOL.tsp;
    if (/\bml\b/.test(s)) return VOL.ml;
    return null;
  }
  const isGram = p => p.label === 'g', isOz = p => p.label === 'oz';

  // Turn a parsed amount into a portion of this food: { pi, qty, sure }.
  // sure = false means the amount was a guess and the ingredient should be checked.
  function pickPortion(food, ing) {
    const P = food.portions || [];
    const q = ing.qty > 0 ? ing.qty : 1;
    const gi = P.findIndex(isGram);
    if (ing.kind === 'mass') {
      if (gi >= 0) return { pi: gi, qty: C.round(q * MASS[ing.unit], 1), sure: true };
      return { pi: 0, qty: 1, sure: false };
    }
    if (ing.kind === 'vol') {
      const tsp = q * VOL[ing.unit];
      const words = String(ing.raw || '').toLowerCase().match(/[a-z]{4,}/g) || [];
      const vols = P.map((p, i) => ({ i, v: labelVol(p.label), hit: words.some(w => p.label.toLowerCase().includes(w)) })).filter(x => x.v);
      const best = vols.find(x => x.hit) || vols[0];
      if (best) return { pi: best.i, qty: C.round(tsp / (best.v * labelNum(P[best.i].label)), 3), sure: true };
      // No volume portion: water-like guess, 1 ml ≈ 1 g.
      if (gi >= 0) return { pi: gi, qty: C.round(tsp * 4.929, 1), sure: false };
      return { pi: 0, qty: 1, sure: false };
    }
    // Counts: "2 eggs", "1 large onion", "3 cloves garlic".
    const word = ing.kind === 'count' ? ing.unit : '';
    const named = P.findIndex(p => !isGram(p) && !isOz(p) && word && new RegExp('^[\\d./\\s]*' + word.replace(/\s/g, '[\\s-]') + 's?\\b', 'i').test(p.label));
    if (named >= 0) return { pi: named, qty: C.round(q / labelNum(P[named].label), 3), sure: true };
    const natural = ['medium', 'whole', 'large', 'each', 'piece', 'fruit', 'egg', 'serving'];
    for (const w of natural) {
      const i = P.findIndex(p => !isGram(p) && !isOz(p) && new RegExp('^[\\d./\\s]*' + w + '\\b', 'i').test(p.label));
      if (i >= 0) return { pi: i, qty: C.round(q / labelNum(P[i].label), 3), sure: !word || ing.kind !== 'count' ? true : false };
    }
    const first = P.findIndex(p => !isGram(p) && !isOz(p));
    if (first >= 0) return { pi: first, qty: C.round(q / labelNum(P[first].label), 3), sure: false };
    return { pi: Math.max(0, gi), qty: gi >= 0 ? 100 : 1, sure: false };
  }

  // ---------- choosing among search hits ----------
  // USDA's first hit is often a variant (egg white for "eggs", ghee for "butter"). Prefer hits that
  // start with and contain the ingredient's words, are short, and are the plain everyday form.
  const GOOD = /^(whole|raw|plain|granulated|salted|unsalted|regular|all|purpose|table|large|fresh|uncooked|dry)$/;
  const BAD = /^(imitation|substitutes?|ghee|clarified|yolks?|babyfood|baby|infant|toddler|alcohol|whiskey|vodka|beverage|drink|flavored|sweetened|fat|free|reduced|lowfat|nonfat|lite|light|diet|mix|prepared|restaurant|fast|foods?)$/;
  const wordsOf = s => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 1).map(w => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, m => (m === 'es' && !/(ss|sh|ch|x)es$/.test(w) ? 'e' : '')));
  function rankFoods(query, foods) {
    const q = wordsOf(query);
    const score = (f, i) => {
      const d = wordsOf(f.name);
      let sc = -0.05 * i;
      if (q.includes(d[0])) sc += 3;
      for (const w of q) sc += d.includes(w) ? 4 / q.length : -3;
      sc -= 0.3 * Math.max(0, d.length - q.length);
      let good = 0;
      for (const w of d) {
        if (q.includes(w)) continue;
        if (GOOD.test(w)) good++;
        if (BAD.test(w)) sc -= 3;
      }
      return sc + Math.min(2, good);
    };
    return foods.map((f, i) => ({ f, s: score(f, i) })).sort((a, b) => b.s - a.s).map(x => x.f);
  }

  // ---------- pasted recipe text ----------
  const HEAD_ING = /^\s*(ingredients?)\s*:?\s*$/i;
  const HEAD_END = /^\s*(instructions?|directions?|method|steps?|preparation|how to make( it)?|notes?|nutrition( facts| information)?|equipment)\s*:?\s*$/i;
  const SERVES = /\b(?:serves|servings?|yield|yields|makes)\s*:?\s*(?:about\s*)?(\d+)/i;

  // Text copied off a recipe page -> { name, servings, lines }.
  function parseRecipeText(text) {
    const all = String(text || '').replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
    const sv = String(text || '').match(SERVES);
    let lines = all, name = '';
    const start = all.findIndex(l => HEAD_ING.test(l));
    if (start >= 0) {
      const before = all.slice(0, start).filter(l => !SERVES.test(l) && l.length < 80);
      name = before.length ? before[0] : '';
      const end = all.findIndex((l, i) => i > start && HEAD_END.test(l));
      lines = all.slice(start + 1, end > 0 ? end : undefined);
    }
    lines = lines.filter(l => {
      if (SERVES.test(l) && !/^\s*[\d½¼¾⅓⅔]/.test(l)) return false;
      if (/:$/.test(l) || /^for the\b/i.test(l)) return false;          // "For the sauce:"
      if (/^(\d+\s*)?(minutes?|hours?|prep|cook|total|calories)\b/i.test(l)) return false;
      if (l.length > 120) return false;
      if (start < 0) { const p = parseIngredient(l); return p.qty != null || p.unit != null; }
      return true;
    });
    return { name, servings: sv ? +sv[1] : null, lines };
  }

  // ---------- nutrition facts text ----------
  // Order matters: longer labels are read first and blanked out so "Fat" doesn't catch "Saturated Fat".
  const NLAB = [
    ['satfat', 'saturated\\s*fat|sat\\.?\\s*fat'],
    ['transfat', 'trans\\s*fat'],
    ['fat', 'total\\s*fat|fat'],
    ['chol', 'cholesterol'],
    ['sodium', 'sodium'],
    ['potassium', 'potassium'],
    ['fiber', 'dietary\\s*fib(?:er|re)|fib(?:er|re)'],
    ['sugar', 'total\\s*sugars?|sugars?'],
    ['carbs', 'total\\s*carbohydrates?|total\\s*carbs?|carbohydrates?|carbs?'],
    ['protein', 'proteins?'],
    ['calcium', 'calcium'],
    ['iron', 'iron'],
    ['vitA', 'vitamin\\s*a'],
    ['vitC', 'vitamin\\s*c'],
    ['vitD', 'vitamin\\s*d'],
    ['kcal', 'calories|energy|kcal|cal\\.?'],
  ];
  const TARGET = Object.fromEntries(C.NUTRIENTS.map(n => [n.k, n.unit]));
  function convert(k, v, u) {
    u = (u || '').toLowerCase().replace('mcg', 'µg').replace('ug', 'µg');
    const t = TARGET[k];
    if (k === 'kcal') return u === 'kj' ? v / 4.184 : v;
    if (!u) return v;
    if (u === 'iu') return k === 'vitD' ? v / 40 : k === 'vitA' ? v * 0.3 : null;
    const toMg = { g: 1000, mg: 1, 'µg': 0.001 }[u];
    if (toMg == null) return v;
    if (t === 'g') return v * toMg / 1000;
    if (t === 'mg') return v * toMg;
    if (t === 'µg') return v * toMg * 1000;
    return v;
  }
  const NUM = '(<\\s*)?(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)';
  const UNITS = '(mg|mcg|µg|ug|g|kcal|kj|cal|iu|%)?';
  const toNum = t => parseFloat(/,\d{3}(\D|$)/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.'));

  // Nutrition panel text (label, restaurant page, PDF) -> { n, serving, servingG, name } or null.
  function parseNutrition(text) {
    let s = ' ' + String(text || '').replace(/\r/g, '') + ' ';
    const blank = (m, i) => { s = s.slice(0, i) + ' '.repeat(m.length) + s.slice(i + m.length); };
    // Lines that would be misread.
    for (const re of [/calories\s*from\s*fat\s*:?\s*\d+/gi, /(includes?\s*)?\d+(\.\d+)?\s*g\s*(of\s*)?added\s*sugars?|added\s*sugars?\s*:?\s*\d+(\.\d+)?\s*g?/gi, /\d+(\.\d+)?\s*(%|percent)\s*(daily\s*value|dv)[^\n]*/gi, /%\s*daily\s*value\*?/gi, /\b\d[\d,]*\s*calories\s*a\s*day[^\n]*/gi, /\bpolyunsaturated\s*fat[^\n]*|\bmonounsaturated\s*fat[^\n]*/gi])
      s = s.replace(re, m => ' '.repeat(m.length));
    let serving = '', servingG = null;
    const sm = s.match(/serving\s*size\s*:?\s*([^\n]{1,60})/i);
    if (sm) {
      serving = sm[1].trim().replace(/\s{2,}.*$/, '');
      const g = serving.match(/(\d+(?:\.\d+)?)\s*g\b/i);
      if (g) servingG = +g[1];
      serving = serving.replace(/\(?\s*\d+(?:\.\d+)?\s*g\s*\)?/i, '').trim();
      blank(sm[0], sm.index);
    }
    // Two layouts: "Protein 30g" (label first) and "25g Protein" (number first, menu boards).
    // Number-first when the last label in the text has no number after it.
    const anyLab = NLAB.map(x => x[1]).join('|');
    const labs = [...s.matchAll(new RegExp('(?:^|[^a-z])(' + anyLab + ')(?![a-z])', 'gi'))];
    const last = labs[labs.length - 1];
    const numFirst = last && !new RegExp('^\\s*[:\\-–]?\\s*' + NUM).test(s.slice(last.index + last[0].length));
    const n = {};
    for (const [k, lab] of NLAB) {
      const after = new RegExp('(?:^|[^a-z])(' + lab + ')(?![a-z])\\s*[:\\-–]?\\s*' + NUM + '\\s*' + UNITS, 'i');
      const before = new RegExp('(?:^|[^\\d.,])' + NUM + '[ \\t]*' + UNITS + '[ \\t]*(' + lab + ')(?![a-z])', 'i');
      let v = null, u = '';
      const m = numFirst ? null : s.match(after);
      if (m && m[4] !== '%') { v = toNum(m[3]); u = m[4]; blank(m[0], m.index); }
      else {
        const b = s.match(before);
        if (b && b[3] !== '%') { v = toNum(b[2]); u = b[3]; blank(b[0], b.index); }
      }
      if (v != null && isFinite(v)) { const c = convert(k, v, u); if (c != null) n[k] = C.round(c, 2); }
    }
    if (n.kcal == null) return null;
    return { n, serving, servingG };
  }

  // ---------- recipe pages (schema.org JSON-LD, which most recipe sites publish) ----------
  const typeIs = (o, t) => o && (o['@type'] === t || (Array.isArray(o['@type']) && o['@type'].includes(t)));
  function walk(o, out) {
    if (!o || typeof o !== 'object') return out;
    if (Array.isArray(o)) { o.forEach(x => walk(x, out)); return out; }
    out.push(o);
    if (o['@graph']) walk(o['@graph'], out);
    if (o.mainEntity) walk(o.mainEntity, out);
    if (o.hasMenuSection) walk(o.hasMenuSection, out);
    if (o.hasMenuItem) walk(o.hasMenuItem, out);
    return out;
  }
  const textOf = v => (Array.isArray(v) ? v.map(textOf).join(' ') : v && typeof v === 'object' ? (v.text || v.name || '') : String(v ?? ''));
  const decode = s => String(s).replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim();

  function nutritionFromLD(nu) {
    if (!nu || typeof nu !== 'object') return null;
    const f = { calories: 'Calories', fatContent: 'Total Fat', saturatedFatContent: 'Saturated Fat', transFatContent: 'Trans Fat', cholesterolContent: 'Cholesterol', sodiumContent: 'Sodium', carbohydrateContent: 'Total Carbohydrate', fiberContent: 'Dietary Fiber', sugarContent: 'Total Sugars', proteinContent: 'Protein' };
    let txt = nu.servingSize ? `Serving size ${textOf(nu.servingSize)}\n` : '';
    for (const [key, label] of Object.entries(f)) if (nu[key] != null) txt += `${label} ${textOf(nu[key])}\n`;
    return parseNutrition(txt);
  }

  // Parsed JSON-LD blocks -> { kind: 'recipe', name, servings, lines, site } or { kind: 'nutrition', name, ... } or null.
  function fromLD(blocks, title) {
    const nodes = walk(blocks, []);
    const rec = nodes.find(o => typeIs(o, 'Recipe') && o.recipeIngredient);
    if (rec) {
      const y = textOf(rec.recipeYield).match(/\d+/);
      return {
        kind: 'recipe',
        name: decode(textOf(rec.name) || title || ''),
        servings: y ? +y[0] : null,
        lines: [].concat(rec.recipeIngredient || rec.ingredients || []).map(x => decode(textOf(x))).filter(Boolean),
        site: nutritionFromLD(rec.nutrition),
      };
    }
    const item = nodes.find(o => o.nutrition && (typeIs(o, 'MenuItem') || typeIs(o, 'Product') || typeIs(o, 'Recipe')));
    const nu = item ? item.nutrition : (nodes.find(o => typeIs(o, 'NutritionInformation')) || null);
    const p = nutritionFromLD(nu);
    if (p) return { kind: 'nutrition', name: decode(textOf(item && item.name) || title || ''), ...p };
    return null;
  }

  // What the Share-menu shortcut copies: {"intake":1,"url","title","ld":[...],"text"}.
  function readShared(str) {
    const t = String(str || '').trim();
    if (!t.startsWith('{') || !t.includes('"intake"')) return null;
    try { const o = JSON.parse(t); return o && o.intake ? o : null; } catch { return null; }
  }
  const isLink = s => /^https?:\/\/\S+$/i.test(String(s || '').trim());

  globalThis.Import = { rankFoods, parseIngredient, cleanName, pickPortion, labelNum, parseRecipeText, parseNutrition, fromLD, readShared, isLink, VOL, MASS };
})();
