import { installBrowserBridge } from "@dam-hopper/browser-bridge";

const BROWSER_DEBUG_LOG_PREFIX = "[DamHopper Browser Debug]";

// The top-level DamHopper page does not need a content-script bridge. Framed
// pages do: the extension can inspect their DOM without target-app changes.
if (window.parent !== window) {
  console.info(`${BROWSER_DEBUG_LOG_PREFIX} content-script-loaded`, {
    frame: true,
    origin: window.location.origin,
    path: window.location.pathname,
  });
  installBrowserBridge();
} else {
  console.info(`${BROWSER_DEBUG_LOG_PREFIX} content-script-skipped`, {
    frame: false,
    origin: window.location.origin,
    reason: "top-level DamHopper page",
  });
}
