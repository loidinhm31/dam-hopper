/** Generate a cryptographically random bridge nonce/request identifier. */
export function createBrowserDebugId(): string | null {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) return null;
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

import type { BrowserDebugHostViewport } from "./browser-debug-host.js";

export type BrowserDebugViewportFrame = BrowserDebugHostViewport;

export function clipBrowserDebugViewportFrame(
  frame: BrowserDebugViewportFrame,
  viewportWidth: number,
  viewportHeight: number,
): BrowserDebugViewportFrame | null {
  const left = Math.max(0, frame.left);
  const top = Math.max(0, frame.top);
  const right = Math.min(viewportWidth, frame.left + frame.width);
  const bottom = Math.min(viewportHeight, frame.top + frame.height);
  if (right <= left || bottom <= top) return null;
  return {
    top,
    left,
    width: right - left,
    height: bottom - top,
  };
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
  return clipBrowserDebugViewportFrame(
    { top, left, width, height },
    window.innerWidth,
    window.innerHeight,
  );
}
