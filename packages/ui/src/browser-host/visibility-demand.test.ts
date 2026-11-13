// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isDocumentVisible,
  setDocumentVisibilityForTests,
  subscribeDocumentVisibility,
} from "./visibility-demand.js";

describe("visibility-demand", () => {
  afterEach(() => {
    setDocumentVisibilityForTests(null);
    vi.restoreAllMocks();
  });

  it("reflects document.visibilityState and notifies subscribers on visibilitychange", () => {
    const spy = vi.fn();
    const unsub = subscribeDocumentVisibility(spy);

    expect(isDocumentVisible()).toBe(true);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(isDocumentVisible()).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);

    // Window blur alone must NOT change document visibility or fire visibility subscribers
    window.dispatchEvent(new Event("blur"));
    expect(spy).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(isDocumentVisible()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);

    unsub();
  });
});
