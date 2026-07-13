export function randomToken(length = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  for (let i = 0; i < length; i++) out += chars[arr[i] % chars.length];
  return out;
}

export function formatMoney(cents) {
  const n = (cents || 0) / 100;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function dollarsToCents(str) {
  const n = parseFloat(str);
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function docNumber(seq) {
  return String(seq).padStart(4, '0');
}

// Builds an absolute URL for another page in this app, correctly handling
// being served from a subpath (e.g. 40thfloor.com/invoicing/) as well as
// the app's own root domain. Do not use window.location.origin alone for
// this — it never includes the subpath.
export function appUrl(path) {
  const base = window.location.pathname.replace(/[^/]*$/, '');
  return window.location.origin + base + path;
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

export function isAndroid() {
  return /Android/.test(navigator.userAgent);
}

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Reads an image file, center-crops it to a square, and downsizes it to a
// small JPEG data URL — small enough to store directly on the business's
// Firestore profile doc (well under the 1MB document limit) for use as a
// logo, without needing Firebase Storage set up.
export function resizeImageToDataUrl(file, maxSize = 400, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
