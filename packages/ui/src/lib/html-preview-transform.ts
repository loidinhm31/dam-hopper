/**
 * html-preview-transform.ts
 *
 * Prepares HTML content for isolated rendering in sandboxed iframes.
 *
 * Injects non-invasive shims:
 * 1. In-memory `localStorage` and `sessionStorage` mock when access throws
 *    SecurityError (due to sandboxed opaque 'null' origin without allow-same-origin).
 * 2. In-frame visual `window.alert()` dialog because modern browsers (Chromium, Safari)
 *    suppress native alert() modals in cross-origin / sandboxed iframes.
 */

export const HTML_PREVIEW_SHIM = `<script data-dam-hopper-preview-shim="true">
(function() {
  if (window.__damHopperPreviewShimInstalled) return;
  window.__damHopperPreviewShimInstalled = true;

  // 1. In-memory Storage shim for sandboxed iframe without allow-same-origin
  function createStorage() {
    var store = {};
    return {
      getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function(k, v) { store[k] = String(v); },
      removeItem: function(k) { delete store[k]; },
      clear: function() { store = {}; },
      key: function(i) { return Object.keys(store)[i] || null; },
      get length() { return Object.keys(store).length; }
    };
  }

  try {
    window.localStorage;
  } catch (_) {
    try {
      var memStorage = createStorage();
      Object.defineProperty(window, 'localStorage', { value: memStorage, configurable: true, enumerable: true });
    } catch (e) {}
  }

  try {
    window.sessionStorage;
  } catch (_) {
    try {
      var memSession = createStorage();
      Object.defineProperty(window, 'sessionStorage', { value: memSession, configurable: true, enumerable: true });
    } catch (e) {}
  }

  // 2. Visual alert modal for sandboxed iframes where native alert() is suppressed
  window.alert = function(msg) {
    try {
      var existing = document.getElementById('__dh_preview_alert');
      if (existing) existing.remove();
      var dialog = document.createElement('div');
      dialog.id = '__dh_preview_alert';
      dialog.setAttribute('style', 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#181825;color:#cdd6f4;padding:12px 18px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.4);font-family:system-ui,-apple-system,sans-serif;font-size:13px;max-width:min(90vw,420px);display:flex;flex-direction:column;gap:10px;border:1px solid #313244;');
      var text = document.createElement('div');
      text.style.whiteSpace = 'pre-wrap';
      text.style.wordBreak = 'break-word';
      text.textContent = String(msg !== undefined ? msg : '');
      var btn = document.createElement('button');
      btn.textContent = 'OK';
      btn.setAttribute('style', 'align-self:flex-end;padding:4px 14px;background:#89b4fa;color:#11111b;border:none;border-radius:4px;cursor:pointer;font-weight:600;font-size:12px;');
      btn.onclick = function() { dialog.remove(); };
      dialog.appendChild(text);
      dialog.appendChild(btn);
      (document.body || document.documentElement).appendChild(dialog);
      btn.focus();
    } catch (err) {
      console.log('Alert:', msg);
    }
  };
})();
</script>`;

/**
 * Transforms raw HTML content for preview rendering by injecting safe runtime shims.
 */
export function prepareHtmlPreviewContent(html: string): string {
  if (!html) return html;

  // Insert inside <head> if present
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/(<head\b[^>]*>)/i, `$1\n${HTML_PREVIEW_SHIM}`);
  }

  // Otherwise insert inside <html> if present
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/(<html\b[^>]*>)/i, `$1\n${HTML_PREVIEW_SHIM}`);
  }

  // Fallback: prepend
  return `${HTML_PREVIEW_SHIM}\n${html}`;
}
