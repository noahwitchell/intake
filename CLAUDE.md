# Intake — notes for Claude

- Owner: Noah. Minimal private calorie + weight log. Phone first (installed PWA), same setup as
  ~/Claude/Cadence and ~/Claude/EveryDay: no build step, no deps. Dev server `intake` (port 5192).
- Keep it simple: food log, macros + nutrient breakdown, weight trend. No water, streaks, badges or nags.
- Rules live in `js/core.js` (classic script, globalThis.Core). Run `node --test tests/core.test.mjs` after changes.
  Fixtures in tests/fixtures are real USDA / Open Food Facts responses.
- Data: localStorage `intake.v1` = { foods, days: {'YYYY-MM-DD': [entry]}, weights: [{date, kg}], settings }.
  Foods store nutrients per base unit (100 g for USDA/OFF, 1 serving for typed-in foods) and portions as
  multiples of that base. Entries keep their own scaled nutrients so history survives edits to the food.
  Never change the shape without a migration in `Core.normalize`.
- Lookups (js/api.js): USDA FoodData Central for all name search (generic + Branded), needs the user's free key in Settings;
  DEMO_KEY runs out fast. Open Food Facts = barcodes only: its name search 503s without CORS headers when busy
  (browser sees "Failed to fetch"). Online search runs only when Search is pressed. Only the query or barcode leaves the phone.
- Recipes: a food with src 'recipe', base unit = 1 serving, items = entry-shaped ingredients (foodId null = line
  not matched yet). The one being built is S.draft (saved, so leaving for Safari keeps it). Core.recipeFood builds it.
- Import (js/import.js, classic script, globalThis.Import, tested): parses pasted ingredient lines, nutrition-facts
  text (label and "25g Protein" menu layouts) and schema.org JSON-LD. Intake never fetches other sites: big recipe
  and restaurant sites 403 non-browser requests and public CORS proxies are dead (tested 2026-11). Pages come in by
  paste, or via the signed Share-menu shortcut (shortcut/Copy-to-Intake.shortcut, rebuilt by tools/build_shortcut.py),
  which copies {"intake":1,title,ld,selection,text}. Matching ranks USDA hits with Import.rankFoods (first hit is
  often a variant: egg white, ghee).
- Barcodes (js/scanner.js): native BarcodeDetector if present, else vendored barcode-detector 3.2.3 +
  zxing-wasm 3.1.6 reader in vendor/ (wasm served locally, never from a CDN).
- Removing data = hold to confirm. Controls keep their size and place.
- Dark only. Fonts Fraunces (display) + Figtree (text) in fonts/.
- Verify at phone size (390×844). Bump CACHE in sw.js when shipping.
