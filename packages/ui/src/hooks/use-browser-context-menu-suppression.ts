import { useEffect } from "react";
import { eventTargetsContextMenuTrigger } from "@/lib/context-menu-trigger-marker.js";

/**
 * Prevents the browser's native context menu for unconfigured app targets.
 * Marked Radix triggers handle their own event so they can still open menus.
 */
export function useBrowserContextMenuSuppression(): void {
  useEffect(() => {
    const options = { capture: true };
    const suppressNativeContextMenu = (event: MouseEvent) => {
      if (eventTargetsContextMenuTrigger(event)) return;
      event.preventDefault();
    };

    document.addEventListener("contextmenu", suppressNativeContextMenu, options);
    return () =>
      document.removeEventListener(
        "contextmenu",
        suppressNativeContextMenu,
        options,
      );
  }, []);
}
