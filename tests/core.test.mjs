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
