export const BROWSER_DEBUG_EXTENSION_MARKER = "data-dam-hopper-browser-debug";
export const BROWSER_DEBUG_EXTENSION_VERSION = "1";
export const BROWSER_DEBUG_EXTENSION_EVENT =
  "dam-hopper:browser-extension-ready";

/** Marks the current document without exposing any extension capability. */
export function markBrowserExtensionPresence(): boolean {
  const root = document.documentElement;
  if (!root) return false;

  root.setAttribute(
    BROWSER_DEBUG_EXTENSION_MARKER,
    BROWSER_DEBUG_EXTENSION_VERSION,
  );
  window.dispatchEvent(
    new CustomEvent(BROWSER_DEBUG_EXTENSION_EVENT, {
      detail: { version: BROWSER_DEBUG_EXTENSION_VERSION },
    }),
  );
  return true;
}
