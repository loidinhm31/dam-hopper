import { describe, expect, it, vi } from "vitest";
import {
  acceptBrowserDebugHostEventGeneration,
  applyBrowserDebugHostEvent,
  type BrowserDebugHostEvent,
} from "./browser-debug-host.js";

function sink() {
  return {
    setBridgeStatus: vi.fn(),
    setBridgeCapabilities: vi.fn(),
    setSelection: vi.fn(),
    setPickerActive: vi.fn(),
    syncCurrentUrl: vi.fn(),
    appendConsoleEntry: vi.fn(),
    setError: vi.fn(),
  };
}

describe("browser debug host events", () => {
  it("maps normalized ready, navigation, console, and selection events", () => {
    const browser = sink();
    const selection = {
      version: 1 as const,
      tag: "button",
      role: "button",
      accessibleName: "Save",
      text: "Save",
      attributes: { "data-testid": "save" },
      locator: "button[data-testid=save]",
      bounds: { x: 1, y: 2, width: 80, height: 32 },
    };

    const events: BrowserDebugHostEvent[] = [
      {
        type: "ready",
        generation: 2,
        capabilities: ["picker", "navigation", "console"],
      },
      { type: "navigation", generation: 2, url: "http://localhost:3000/next" },
      {
        type: "console",
        generation: 2,
        level: "warn",
        message: "Slow response",
      },
      { type: "selection", generation: 2, selection },
    ];

    events.forEach((event) => applyBrowserDebugHostEvent(browser, event));

    expect(browser.setBridgeStatus).toHaveBeenCalledWith("ready");
    expect(browser.setBridgeCapabilities).toHaveBeenCalledWith([
      "picker",
      "navigation",
      "console",
    ]);
    expect(browser.syncCurrentUrl).toHaveBeenCalledWith(
      "http://localhost:3000/next",
    );
    expect(browser.appendConsoleEntry).toHaveBeenCalledWith({
      level: "warn",
      message: "Slow response",
    });
    expect(browser.setSelection).toHaveBeenCalledWith(selection);
    expect(browser.setPickerActive).toHaveBeenCalledWith(false);
  });

  it("preserves host failure status and actionable message", () => {
    const browser = sink();
    applyBrowserDebugHostEvent(browser, {
      type: "status",
      generation: 4,
      status: "unsupported",
      message: "Target bridge unavailable",
    });

    expect(browser.setBridgeStatus).toHaveBeenCalledWith("unsupported");
    expect(browser.setError).toHaveBeenCalledWith("Target bridge unavailable");
  });

  it("accepts only events from the active generation", () => {
    const currentGeneration = 4;
    const staleSelection: BrowserDebugHostEvent = {
      type: "selection",
      generation: 3,
      selection: {
        version: 1,
        tag: "button",
        role: "button",
        accessibleName: "Old",
        text: "Old",
        attributes: {},
        locator: "button",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
      },
    };

    expect(
      acceptBrowserDebugHostEventGeneration(currentGeneration, staleSelection),
    ).toEqual({ accepted: false, generation: currentGeneration });
    expect(
      acceptBrowserDebugHostEventGeneration(currentGeneration, {
        type: "status",
        status: "loading",
        generation: 5,
      }),
    ).toEqual({ accepted: true, generation: 5 });
    expect(
      acceptBrowserDebugHostEventGeneration(5, {
        type: "ready",
        capabilities: ["picker"],
        generation: 4,
      }),
    ).toEqual({ accepted: false, generation: 5 });
    expect(
      acceptBrowserDebugHostEventGeneration(null, {
        type: "ready",
        capabilities: ["picker"],
        generation: 2,
      }),
    ).toEqual({ accepted: true, generation: 2 });
  });
});
