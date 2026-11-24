import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../js/core.js';

const C = globalThis.Core;
const fx = n => JSON.parse(readFileSync(new URL('./fixtures/' + n, import.meta.url)));
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

test('USDA detail record: per 100 g nutrients and household portions', () => {
  const f = C.fromUSDA(fx('usda-banana-detail.json'));
  assert.equal(f.name, 'Bananas, raw');
  near(f.n.kcal, 89);
  near(f.n.carbs, 22.8, 0.05);
  assert.ok(f.portions.some(p => /medium/.test(p.label)));
  const med = f.portions.find(p => /medium/.test(p.label));
  near(med.mult, 1.18);
  assert.deepEqual(f.portions.slice(-2).map(p => p.label), ['g', 'oz']);
});

test('USDA branded search hit: serving portion, title case, deduped name', () => {
  const f = C.fromUSDA(fx('usda-clif-search.json').foods[0]);
  assert.equal(f.barcode, '722252014214');
  assert.ok(!/CLIF BAR/.test(f.name));
  near(f.n.kcal, 370);
  near(f.n.sodium, 185);
  assert.match(f.portions[0].label, /46 g/);
  near(f.portions[0].mult, 0.46);
});

test('Open Food Facts product: grams turned into mg / µg', () => {
  const f = C.fromOFF({ code: '722252014214', ...fx('off-clif.json').product });
  near(f.n.kcal, 370);
  near(f.n.sodium, 185);
  near(f.n.iron, 3.13);
  near(f.n.potassium, 609);
  assert.equal(f.portions[0].label, '1 BAR (46 g)');
  const e = C.makeEntry(f, 2, 0, 'snacks');
  near(e.n.kcal, 370 * 0.92);
});

test('OFF: kJ only and per-serving only still give calories', () => {
  near(C.fromOFF({ code: '1', nutriments: { 'energy-kj_100g': 418.4 } }).n.kcal, 100);
  const f = C.fromOFF({ code: '2', serving_quantity: 50, nutriments: { 'energy-kcal_serving': 200, proteins_serving: 10 } });
  near(f.n.kcal, 400);
  near(f.n.protein, 20);
});

test('custom food: per serving, grams optional', () => {
  const a = C.customFood({ name: 'Overnight oats', serving: '1 jar', n: { kcal: '350', protein: '20', fat: '' } });
  assert.equal(a.portions.length, 1);
  assert.equal(a.n.fat, undefined);
  const b = C.customFood({ name: 'Granola', serving: '1/2 cup', servingG: 55, n: { kcal: 240 } });
  const g = b.portions.findIndex(p => p.label === 'g');
  near(C.makeEntry(b, 110, g, 'breakfast').n.kcal, 480);
});

test('reweigh scales an entry from its own numbers', () => {
  const f = C.customFood({ name: 'Egg', serving: '1 egg', servingG: 50, n: { kcal: 70, protein: 6 } });
  const e = C.makeEntry(f, 2, 0, 'breakfast');
  const e2 = C.reweigh(e, 3);
  near(e2.n.kcal, 210);
  const e3 = C.reweigh(e, 100, f.portions[1]);
  near(e3.n.protein, 12);
  assert.equal(e3.portion, 'g');
});

test('totals ignore missing nutrients rather than counting zero for them', () => {
  const t = C.dayTotals([{ n: { kcal: 100, protein: 5 } }, { n: { kcal: 50 } }]);
  assert.deepEqual(t, { kcal: 150, protein: 5 });
});

test('barcode matching ignores leading zeros (UPC vs EAN vs GTIN-14)', () => {
  const s = C.emptyState();
  s.foods.x = { id: 'x', barcode: '00722252014214', name: 'Bar', n: { kcal: 1 }, portions: [] };
  assert.equal(C.findBarcode(s, '722252014214').id, 'x');
  assert.equal(C.findBarcode(s, '0722252014214').id, 'x');
  assert.equal(C.findBarcode(s, '123'), null);
});

test('dates and weight trend', () => {
  assert.equal(C.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(C.daysBetween('2026-01-01', '2026-01-08'), 7);
  const t = C.trend([{ date: '2026-01-01', kg: 80 }, { date: '2026-01-02', kg: 82 }, { date: '2026-01-12', kg: 82 }]);
  near(t[1].trend, 80.2);
  assert.ok(t[2].trend > 81 && t[2].trend < 82);
  near(C.fromKg(C.toKg(180.4, 'lb'), 'lb'), 180.4, 1e-9);
});

test('normalize repairs junk and keeps settings defaults', () => {
  const s = C.normalize({ days: { a: 'x', '2026-01-01': [] }, weights: [{ date: '2026-01-02', kg: 80 }, { date: '2026-01-01', kg: 81 }, {}], settings: { kcal: 1800 } });
  assert.equal(s.days.a, undefined);
  assert.equal(s.weights[0].date, '2026-01-01');
  assert.equal(s.weights.length, 2);
  assert.equal(s.settings.kcal, 1800);
  assert.equal(s.settings.wUnit, 'lb');
});

// ---------- recipes + import ----------
await import('../js/import.js');
const I = globalThis.Import;

test('ingredient lines: amounts, units, package sizes, names', () => {
  const p = l => I.parseIngredient(l);
  assert.deepEqual([p('1 ½ cups all-purpose flour, sifted').qty, p('1 ½ cups all-purpose flour, sifted').unit, p('1 ½ cups all-purpose flour, sifted').name], [1.5, 'cup', 'all-purpose flour']);
  assert.equal(p('1 (14 oz) can diced tomatoes').unit, 'oz');
  assert.equal(p('1 (14 oz) can diced tomatoes').qty, 14);
  assert.equal(p('3 cloves garlic, minced').unit, 'clove');
  assert.equal(p('1-2 Tbsp olive oil').qty, 1);
  assert.equal(p('200g chicken breast').unit, 'g');
  assert.equal(p('Salt and pepper to taste').qty, null);
});

test('ingredient amounts land on the food’s own portions', () => {
  const ban = C.fromUSDA(fx('usda-banana-detail.json'));
  const at = l => { const r = I.pickPortion(ban, I.parseIngredient(l)); return [ban.portions[r.pi].label, r.qty, r.sure]; };
  assert.match(at('2 bananas')[0], /^1 medium/); assert.equal(at('2 bananas')[1], 2);
  assert.match(at('1 large banana')[0], /^1 large/);
  assert.deepEqual(at('100 g banana'), ['g', 100, true]);
  assert.match(at('2 tbsp mashed banana')[0], /mashed/); near(at('2 tbsp mashed banana')[1], 0.125);
});

test('recipe food: per-serving nutrients from matched lines only', () => {
  const ban = C.fromUSDA(fx('usda-banana-detail.json'));
  const items = [C.makeEntry(ban, 4, ban.portions.findIndex(p => /medium/.test(p.label)), null), { id: 'x', foodId: null, raw: 'salt', n: {} }];
  const r = C.recipeFood({ name: 'Banana bowl', servings: 2, items });
  assert.equal(r.src, 'recipe');
  near(r.n.kcal, 89 * 1.18 * 4 / 2, 0.1);
  assert.equal(r.portions[1].mult, 2);
  assert.equal(C.normalize({ draft: { items: [] } }).draft.items.length, 0);
  assert.equal(C.normalize({ draft: 'junk' }).draft, null);
});

test('nutrition facts: label layout, menu-board layout, thousands', () => {
  const a = I.parseNutrition('Serving size 1 sandwich (283g)\nCalories 540\nCalories from Fat 230\nTotal Fat 26g 33%\nSaturated Fat 10g 50%\nSodium 1,010mg 44%\nTotal Carbohydrate 45g\nTotal Sugars 9g\nIncludes 7g Added Sugars\nProtein 30g\nVitamin D 0.4mcg 2%');
  assert.deepEqual([a.n.kcal, a.n.fat, a.n.satfat, a.n.sodium, a.n.carbs, a.n.sugar, a.n.protein, a.n.vitD], [540, 26, 10, 1010, 45, 9, 30, 0.4]);
  assert.equal(a.serving, '1 sandwich'); assert.equal(a.servingG, 283);
  const b = I.parseNutrition('590 Cal.  34g Fat  46g Carbs  25g Protein  1050mg Sodium');
  assert.deepEqual([b.n.kcal, b.n.fat, b.n.carbs, b.n.protein, b.n.sodium], [590, 34, 46, 25, 1050]);
  const c = I.parseNutrition('Calories\n1,050\nTotal Fat\n40 g\nSodium\n2,140 mg');
  assert.deepEqual([c.n.kcal, c.n.fat, c.n.sodium], [1050, 40, 2140]);
  assert.equal(I.parseNutrition('no numbers here'), null);
});

test('recipe text and recipe-page JSON-LD', () => {
  const t = I.parseRecipeText('Best Chili\nServes 6\nIngredients\n1 lb ground beef\nFor the topping:\n1 cup shredded cheddar\nSalt to taste\nInstructions\nBrown the beef.');
  assert.equal(t.name, 'Best Chili'); assert.equal(t.servings, 6);
  assert.deepEqual(t.lines, ['1 lb ground beef', '1 cup shredded cheddar', 'Salt to taste']);
  const ld = [{ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, { '@type': ['Recipe'], name: 'Pancakes &amp; Syrup', recipeYield: ['4', '4 servings'], recipeIngredient: ['1 cup flour', '2 eggs'], nutrition: { '@type': 'NutritionInformation', calories: '310 kcal', proteinContent: '9 g', sodiumContent: '480 mg' } }] }];
  const r = I.fromLD(ld, 'x');
  assert.equal(r.kind, 'recipe'); assert.equal(r.name, 'Pancakes & Syrup'); assert.equal(r.servings, 4);
  assert.equal(r.lines.length, 2); assert.equal(r.site.n.kcal, 310); assert.equal(r.site.n.sodium, 480);
  const m = I.fromLD([{ '@type': 'MenuItem', name: 'Burrito', nutrition: { calories: '1,050 calories', fatContent: '40g' } }], '');
  assert.equal(m.kind, 'nutrition'); assert.equal(m.n.kcal, 1050);
  assert.ok(I.readShared('{"intake":1,"text":"x"}')); assert.equal(I.readShared('hello'), null);
});

test('search hits: plain everyday form beats variants', () => {
  const top = (q, names) => I.rankFoods(q, names.map(name => ({ name })))[0].name;
  assert.equal(top('eggs', ['Eggs, Grade A, Large, egg white', 'Eggs, Grade A, Large, egg whole', 'Eggs, Grade A, Large, egg yolk']), 'Eggs, Grade A, Large, egg whole');
  assert.equal(top('butter', ['Butter, Clarified butter (ghee)', 'Fruit butter', 'Butter, tub', 'Butter, stick, salted']), 'Butter, stick, salted');
  assert.equal(top('baking soda', ['Leavening agents, baking soda', 'Whiskey and soda']), 'Leavening agents, baking soda');
  assert.equal(I.parseIngredient('pinch of salt').tiny, true);
});
