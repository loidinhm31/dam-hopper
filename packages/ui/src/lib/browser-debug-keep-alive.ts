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
import { getAppZoomFactor } from "./app-zoom.js";

export type BrowserDebugViewportFrame = BrowserDebugHostViewport;
export type BrowserDebugViewportClip = BrowserDebugHostViewport;

export interface BrowserDebugViewportGeometry {
  /** The complete emulated viewport rectangle used for layout and hosting. */
  frame: BrowserDebugViewportFrame;
  /** The portion currently visible inside the browser viewport and stage. */
  visibleFrame: BrowserDebugViewportFrame | null;
}

export function clipBrowserDebugViewportFrame(
  frame: BrowserDebugViewportFrame,
  viewportWidth: number,
  viewportHeight: number,
  clip?: BrowserDebugViewportClip | null,
): BrowserDebugViewportFrame | null {
  const clipLeft = Math.max(0, clip?.left ?? 0);
  const clipTop = Math.max(0, clip?.top ?? 0);
  const clipRight = Math.min(
    viewportWidth,
    clip ? clip.left + clip.width : viewportWidth,
  );
  const clipBottom = Math.min(
    viewportHeight,
    clip ? clip.top + clip.height : viewportHeight,
  );
  const left = Math.max(clipLeft, frame.left);
  const top = Math.max(clipTop, frame.top);
  const right = Math.min(clipRight, frame.left + frame.width);
  const bottom = Math.min(clipBottom, frame.top + frame.height);
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
  clipElement?: Element | null,
): BrowserDebugViewportFrame | null {
  return (
    getBrowserDebugViewportGeometry(viewport, clipElement)?.visibleFrame ?? null
  );
}

/**
 * Resolve both the requested viewport and its visible intersection. Native
 * child WebViews need the complete frame to preserve responsive layout; the
 * visible frame is only a rendering/visibility concern for DOM hosts.
 */
export function getBrowserDebugViewportGeometry(
  viewport: Element | null,
  clipElement?: Element | null,
): BrowserDebugViewportGeometry | null {
  if (!viewport) return null;
  const zoom = getAppZoomFactor();
  const rect = viewport.getBoundingClientRect();
  const clipRect = clipElement?.getBoundingClientRect();
  const frame = {
    top: rect.top / zoom,
    left: rect.left / zoom,
    width: rect.width / zoom,
    height: rect.height / zoom,
  };
  const logicalClipRect = clipRect
    ? {
        top: clipRect.top / zoom,
        left: clipRect.left / zoom,
        width: clipRect.width / zoom,
        height: clipRect.height / zoom,
      }
    : undefined;
  return {
    frame,
    visibleFrame: clipBrowserDebugViewportFrame(
      frame,
      window.innerWidth / zoom,
      window.innerHeight / zoom,
      logicalClipRect,
    ),
  };
}
