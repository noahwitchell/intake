// Food lookups. Only the search words or the barcode number leave the phone.
const C = globalThis.Core;
const USDA = 'https://api.nal.usda.gov/fdc/v1';
const OFF_FIELDS = 'code,product_name,generic_name,brands,serving_size,serving_quantity,nutriments';
// Repeated params: USDA's gateway rejects the comma list once "(FNDDS)" is in it.
const GENERIC = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'].map(t => 'dataType=' + encodeURIComponent(t).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('&');

export class LookupError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

// Gives up after 10 s so a slow server can't leave a lookup spinning.
async function getJSON(url, signal) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort('timeout'), 10000);
  const onAbort = () => ctl.abort();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  let r;
  try { r = await fetch(url, { signal: ctl.signal }); }
  catch (e) {
    if (signal && signal.aborted) throw e;
    if (ctl.signal.reason === 'timeout') throw new LookupError('Took too long, try again', 'timeout');
    throw navigator.onLine === false ? new LookupError('No connection', 'offline') : new LookupError('The food database didn’t answer. Try again in a moment.', 'down');
  } finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); }
  if (r.status === 429) throw new LookupError('Hourly limit reached', 'limit');
  if (r.status === 503) throw new LookupError('Busy right now, try again in a minute', 'busy');
  if (r.status === 403) throw new LookupError('Key not accepted', 'key');
  if (r.status === 404) return null;
  if (!r.ok) throw new LookupError('Lookup failed (' + r.status + ')', 'http');
  return r.json();
}

const key = s => encodeURIComponent((s.settings.usdaKey || '').trim() || 'DEMO_KEY');

// Plain foods (banana, chicken breast, rice): USDA's generic and survey data.
export async function searchUSDA(s, q, signal) {
  const base = `${USDA}/foods/search?api_key=${key(s)}&pageSize=20&query=${encodeURIComponent(q)}`;
  let d;
  try { d = await getJSON(`${base}&${GENERIC}`, signal); }
  catch (e) {
    // If USDA ever rejects the three-type request, fall back to the two core types (known good).
    if (e.code !== 'http') throw e;
    d = await getJSON(`${base}&dataType=Foundation,SR%20Legacy`, signal);
  }
  return (d && d.foods || []).map(C.fromUSDA).filter(C.usable);
}

// Full record, for household portions ("1 cup", "1 medium") that search results leave out.
export async function usdaDetail(s, fdcId, signal) {
  const d = await getJSON(`${USDA}/food/${fdcId}?api_key=${key(s)}`, signal);
  return d ? C.fromUSDA(d) : null;
}

// Packaged foods by name: USDA's branded list (about 400,000 US products). Open Food Facts'
// name search turns browsers away whenever it's busy, so it is used for barcodes only.
export async function searchBranded(s, q, signal) {
  const url = `${USDA}/foods/search?api_key=${key(s)}&pageSize=20&dataType=Branded&query=${encodeURIComponent(q)}`;
  const d = await getJSON(url, signal);
  return (d && d.foods || []).map(C.fromUSDA).filter(C.usable);
}

// True if USDA accepts this key.
export async function checkKey(k) {
  try {
    const r = await fetch(`${USDA}/foods/search?api_key=${encodeURIComponent(k)}&pageSize=1&query=apple`);
    return r.ok ? 'ok' : r.status === 429 ? 'limit' : 'bad';
  } catch { return 'offline'; }
}

// Barcode: Open Food Facts first, then USDA's branded foods (which list UPCs too).
export async function byBarcode(s, code, signal) {
  const errs = [];
  try {
    const d = await getJSON(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`, signal);
    if (d && d.status === 1 && d.product) {
      const f = C.fromOFF({ code, ...d.product });
      if (C.usable(f)) return f;
    }
  } catch (e) { if (e.name === 'AbortError') throw e; errs.push(e); }
  try {
    const d = await getJSON(`${USDA}/foods/search?api_key=${key(s)}&pageSize=5&dataType=Branded&query=${encodeURIComponent(code)}`, signal);
    const hit = (d && d.foods || []).find(f => C.normBarcode(f.gtinUpc) === C.normBarcode(code));
    if (hit) { const f = C.fromUSDA(hit); if (C.usable(f)) return f; }
  } catch (e) { if (e.name === 'AbortError') throw e; errs.push(e); }
  if (errs.length === 2) throw errs[0];
  return null;
}
