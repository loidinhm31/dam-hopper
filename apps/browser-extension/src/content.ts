import {
  installBrowserBridge,
  markBrowserExtensionPresence,
} from "@dam-hopper/browser-bridge";

declare const __DAM_HOPPER_EXTENSION_PARENT_ORIGINS__: readonly string[];

function markPresenceWhenDocumentIsReady() {
  if (markBrowserExtensionPresence()) return;
  document.addEventListener(
    "DOMContentLoaded",
    markPresenceWhenDocumentIsReady,
    {
      once: true,
    },
  );
}

markPresenceWhenDocumentIsReady();

// The top-level DamHopper page does not need a content-script bridge. Framed
// pages do: the extension can inspect their DOM without target-app changes.
if (window.parent !== window) {
  installBrowserBridge({
    allowedParentOrigins: __DAM_HOPPER_EXTENSION_PARENT_ORIGINS__,
  });
}
