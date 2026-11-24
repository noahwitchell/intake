# Intake

A simple, private calorie and weight log for your phone. Log food by meal, see protein, carbs, fat and
other nutrients, scan barcodes, and track your weight trend. Everything stays on the device.

Food lookups use [USDA FoodData Central](https://fdc.nal.usda.gov/) and [Open Food Facts](https://world.openfoodfacts.org/).
Barcode reading uses [barcode-detector](https://github.com/Sec-ant/barcode-detector) and
[zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (MIT, in `vendor/`). Fonts: Fraunces and Figtree (OFL).

Open it in Safari and choose Share › Add to Home Screen.

## Recipes and imports
- **Recipes:** + › New recipe, add ingredients with the amounts the whole recipe uses, set servings. Log it by the serving.
- **Paste a recipe:** copy an ingredient list (or a whole page) and paste. Each line is matched to a food; check, then save.
- **Paste nutrition facts:** copy a restaurant item's nutrition and paste; the numbers fill in a food to check and save.
- **From Safari:** add `shortcut/Copy-to-Intake.shortcut` (link in Settings), then Share › Copy to Intake on any page.
