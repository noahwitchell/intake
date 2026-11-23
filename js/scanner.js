// Camera barcode reader. Uses the browser's own BarcodeDetector where it exists (Android Chrome);
// iPhone Safari has none, so the bundled ZXing reader (vendor/, runs on the phone) takes over.
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
let Detector = null;

async function getDetector() {
  if (Detector) return Detector;
  if ('BarcodeDetector' in window) {
    try {
      const have = await window.BarcodeDetector.getSupportedFormats();
      if (FORMATS.some(f => have.includes(f))) return (Detector = new window.BarcodeDetector({ formats: FORMATS.filter(f => have.includes(f)) }));
    } catch { /* fall through to ZXing */ }
  }
  await new Promise((ok, bad) => {
    if (window.BarcodeDetectionAPI) return ok();
    const s = document.createElement('script');
    s.src = 'vendor/barcode-detector.js';
    s.onload = ok; s.onerror = () => bad(new Error('Scanner failed to load'));
    document.head.appendChild(s);
  });
  const api = window.BarcodeDetectionAPI;
  const wasm = new URL('vendor/zxing_reader.wasm', location.href).href;
  api.setZXingModuleOverrides({ locateFile: (p, prefix) => (p.endsWith('.wasm') ? wasm : prefix + p) });
  return (Detector = new api.BarcodeDetector({ formats: FORMATS }));
}

// Starts the camera in `video`; resolves with a code once the same one is read twice in a row.
export function scan(video, { onStatus } = {}) {
  let stream = null, stopped = false, last = '', timer = 0;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    if (stream) stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  };
  const result = (async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser has no camera access');
    onStatus && onStatus('Starting camera…');
    const [det, st] = await Promise.all([
      getDetector(),
      navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }),
    ]);
    stream = st;
    if (stopped) { stop(); return null; }
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();
    onStatus && onStatus('Point at the barcode');
    return await new Promise((ok, bad) => {
      const tick = async () => {
        if (stopped) return ok(null);
        try {
          if (video.readyState >= 2) {
            const hits = await det.detect(video);
            const code = hits && hits[0] && hits[0].rawValue;
            if (code && /^\d{6,14}$/.test(code)) {
              if (code === last) { stop(); return ok(code); }
              last = code;
            }
          }
        } catch (e) { /* a bad frame; keep going */ }
        timer = setTimeout(tick, 120);
      };
      tick();
    });
  })();
  result.catch(stop);
  return { result, stop };
}
