// Prefer native QR detection. Safari and partial implementations use local jsQR.
let softwarePromise;
async function softwareDecoder() {
  if (!softwarePromise) {
    softwarePromise = import('./vendor/jsQR.js?v=1.4.0')
      .then(() => {
        if (typeof globalThis.jsQR !== 'function') throw new Error('QR decoder unavailable');
        return globalThis.jsQR;
      })
      .catch(error => { softwarePromise = null; throw error; });
  }
  const decode = await softwarePromise;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Camera frame access unavailable');
  return {
    kind: 'jsqr',
    async detect(frame) {
      const width = frame.videoWidth || frame.width;
      const height = frame.videoHeight || frame.height;
      if (!width || !height) return [];
      const scale = Math.min(1, 960 / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.drawImage(frame, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const result = decode(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
      return result?.data ? [{ rawValue: result.data }] : [];
    },
  };
}

export async function createQrDecoder() {
  const Native = globalThis.BarcodeDetector;
  if (typeof Native === 'function') {
    try {
      const formats = typeof Native.getSupportedFormats === 'function'
        ? await Native.getSupportedFormats() : ['qr_code'];
      if (formats.includes('qr_code')) {
        const native = new Native({ formats: ['qr_code'] });
        let fallback;
        return {
          kind: 'native',
          async detect(frame) {
            if (fallback) return fallback.detect(frame);
            try { return await native.detect(frame); }
            catch (_) {
              fallback = await softwareDecoder();
              this.kind = fallback.kind;
              return fallback.detect(frame);
            }
          },
        };
      }
    } catch (_) { /* Partial native support: use the software decoder. */ }
  }
  return softwareDecoder();
}
