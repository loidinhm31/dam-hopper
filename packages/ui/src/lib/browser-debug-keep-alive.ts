/** Generate a cryptographically random bridge nonce/request identifier. */
export function createBrowserDebugId(): string | null {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) return null;
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface BrowserDebugViewportFrame {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Resolve an overlay frame without moving the iframe DOM node. Chromium can
 * reload an iframe document when it is physically reparented, so one stable
 * host is positioned over the active viewport instead.
 */
export function getBrowserDebugViewportFrame(
  viewport: Element | null,
): BrowserDebugViewportFrame | null {
  if (!viewport) return null;
  const { top, left, width, height } = viewport.getBoundingClientRect();
  return { top, left, width, height };
}
