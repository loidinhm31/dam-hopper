import { useEffect, useState } from "react";
import {
  BROWSER_DEBUG_EXTENSION_EVENT,
  BROWSER_DEBUG_EXTENSION_MARKER,
  BROWSER_DEBUG_EXTENSION_VERSION,
} from "@dam-hopper/browser-bridge";

export type BrowserExtensionPresence = "checking" | "detected" | "missing";

function hasExtensionMarker() {
  return (
    document.documentElement?.getAttribute(BROWSER_DEBUG_EXTENSION_MARKER) ===
    BROWSER_DEBUG_EXTENSION_VERSION
  );
}

/** The marker is onboarding telemetry only; bridge messages remain authoritative. */
export function useBrowserExtensionPresence(): BrowserExtensionPresence {
  const [presence, setPresence] =
    useState<BrowserExtensionPresence>("checking");

  useEffect(() => {
    const readMarker = () =>
      setPresence(hasExtensionMarker() ? "detected" : "missing");
    const onExtensionReady = (event: Event) => {
      const detail = (event as CustomEvent<{ version?: unknown }>).detail;
      if (detail?.version === BROWSER_DEBUG_EXTENSION_VERSION)
        setPresence("detected");
    };

    window.addEventListener(BROWSER_DEBUG_EXTENSION_EVENT, onExtensionReady);
    document.addEventListener("DOMContentLoaded", readMarker, { once: true });
    readMarker();
    return () => {
      window.removeEventListener(
        BROWSER_DEBUG_EXTENSION_EVENT,
        onExtensionReady,
      );
      document.removeEventListener("DOMContentLoaded", readMarker);
    };
  }, []);

  return presence;
}
