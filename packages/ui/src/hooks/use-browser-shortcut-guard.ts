import { useEffect } from "react";
import { shouldSuppressBrowserShortcut } from "@/lib/browser-shortcut-guard.js";

export function useBrowserShortcutGuard() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !shouldSuppressBrowserShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
}
