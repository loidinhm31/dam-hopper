/**
 * Shared Document Visibility Demand Predicate & Subscription.
 *
 * Effective Browser demand requires `document.visibilityState === "visible"`
 * alongside OS window/tab/privacy/owner gates. Window `blur` alone is NOT
 * treated as document occlusion or demand loss.
 */

const listeners = new Set<() => void>();
let domListenerAttached = false;
let visibilityOverrideForTests: boolean | null = null;

function handleDocumentVisibilityChange(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Ignore subscriber error to keep remaining listeners synchronous
    }
  });
}

function ensureDomListener(): void {
  if (
    domListenerAttached ||
    typeof document === "undefined" ||
    typeof document.addEventListener !== "function"
  ) {
    return;
  }
  domListenerAttached = true;
  document.addEventListener("visibilitychange", handleDocumentVisibilityChange);
}

/**
 * Returns true when the host browser document is visible (`document.visibilityState === "visible"`).
 * Defaults to true in non-DOM test environments unless overridden.
 */
export function isDocumentVisible(): boolean {
  if (visibilityOverrideForTests !== null) {
    return visibilityOverrideForTests;
  }
  if (typeof document === "undefined" || typeof document.visibilityState !== "string") {
    return true;
  }
  return document.visibilityState === "visible";
}

/**
 * Subscribes to synchronous `visibilitychange` notifications.
 */
export function subscribeDocumentVisibility(listener: () => void): () => void {
  ensureDomListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (
      listeners.size === 0 &&
      domListenerAttached &&
      typeof document !== "undefined" &&
      typeof document.removeEventListener === "function"
    ) {
      domListenerAttached = false;
      document.removeEventListener("visibilitychange", handleDocumentVisibilityChange);
    }
  };
}

/**
 * Test helper to deterministically override or reset document visibility state
 * and notify all active subscribers synchronously.
 */
export function setDocumentVisibilityForTests(visible: boolean | null): void {
  visibilityOverrideForTests = visible;
  handleDocumentVisibilityChange();
}
