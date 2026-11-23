// Everything lives in this phone's localStorage. If it ever fails to read, the raw text is set aside
// under intake.rescue instead of being overwritten.
const C = globalThis.Core;
const KEY = 'intake.v1', RESCUE = 'intake.rescue';

export function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { return C.emptyState(); }
  if (!raw) return C.emptyState();
  try { return C.normalize(JSON.parse(raw)); }
  catch {
    try { if (!localStorage.getItem(RESCUE)) localStorage.setItem(RESCUE, raw); } catch { /* full */ }
    return C.emptyState();
  }
}

export function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; }
  catch { return false; }
}

export function backupBlob(s) {
  return new Blob([JSON.stringify({ app: 'intake', saved: new Date().toISOString(), state: s }, null, 1)], { type: 'application/json' });
}

export function readBackup(text) {
  const d = JSON.parse(text);
  const st = d && (d.app === 'intake' || d.app === 'plate') ? d.state : d;
  if (!st || typeof st !== 'object' || !('foods' in st || 'days' in st)) throw new Error('Not an Intake backup');
  return C.normalize(st);
}
