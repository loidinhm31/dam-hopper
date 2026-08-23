import { APP_ZOOM_CHANGE_EVENT } from "./app-zoom.js";
import { fitAllTerminals } from "./terminal-fit-scheduler.js";
import { terminalRegistry } from "./terminal-registry.js";

interface AppZoomEventTarget {
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
}

export function invalidateTerminalsForAppZoom(): void {
  const terminals = [...terminalRegistry.values()];
  for (const entry of terminals) {
    entry.invalidateSuggestionGeometry?.();
  }
  fitAllTerminals(terminals, { focus: false, refresh: true });
}

export function subscribeToTerminalAppZoomChanges(
  target?: AppZoomEventTarget,
): () => void {
  const eventTarget =
    target ??
    (typeof window === "undefined" ? undefined : (window as AppZoomEventTarget));
  if (!eventTarget) return () => {};

  const handleChange: EventListener = () => {
    invalidateTerminalsForAppZoom();
  };
  eventTarget.addEventListener(APP_ZOOM_CHANGE_EVENT, handleChange);
  return () =>
    eventTarget.removeEventListener(APP_ZOOM_CHANGE_EVENT, handleChange);
}
