// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_DEBUG_EXTENSION_EVENT,
  BROWSER_DEBUG_EXTENSION_MARKER,
  BROWSER_DEBUG_EXTENSION_VERSION,
  markBrowserExtensionPresence,
} from "./extension-presence.js";

afterEach(() => {
  document.documentElement.removeAttribute(BROWSER_DEBUG_EXTENSION_MARKER);
});

describe("browser extension presence", () => {
  it("marks the current document and announces its version", () => {
    const listener = vi.fn();
    window.addEventListener(BROWSER_DEBUG_EXTENSION_EVENT, listener);

    expect(markBrowserExtensionPresence()).toBe(true);
    expect(
      document.documentElement.getAttribute(BROWSER_DEBUG_EXTENSION_MARKER),
    ).toBe(BROWSER_DEBUG_EXTENSION_VERSION);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      detail: { version: BROWSER_DEBUG_EXTENSION_VERSION },
    });

    window.removeEventListener(BROWSER_DEBUG_EXTENSION_EVENT, listener);
  });
});
