import { useEffect } from "react";
import { getBrowserShortcutSuppression } from "@/lib/browser-shortcut-guard.js";

export function useBrowserShortcutGuard() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const suppression = getBrowserShortcutSuppression(event);
      if (suppression === "none") return;

      event.preventDefault();
      if (suppression === "prevent-default") return;

      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
}
