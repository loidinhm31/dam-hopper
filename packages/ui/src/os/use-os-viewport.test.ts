// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useOsViewport, type OsViewportState } from "./use-os-viewport.js";
import { useWindowStore } from "./window-store.js";
// @ts-expect-error test environment flag for React act
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function ViewportConsumer({
  onState,
}: {
  onState: (state: OsViewportState) => void;
}) {
  const state = useOsViewport();
  onState(state);
  return createElement(
    "div",
    { "data-testid": "viewport-info" },
    `${state.width}x${state.height}`,
  );
}

describe("useOsViewport", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  function setWindowDimensions(width: number, height: number) {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: width,
    });
    Object.defineProperty(window, "innerHeight", {
      writable: true,
      configurable: true,
      value: height,
    });
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useWindowStore.setState({
      viewport: undefined,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    setWindowDimensions(originalInnerWidth, originalInnerHeight);
    useWindowStore.setState({
      viewport: undefined,
    });
  });

  it("identifies standard desktop tier (1440x900)", () => {
    setWindowDimensions(1440, 900);
    let capturedState!: OsViewportState;

    act(() => {
      root.render(createElement(ViewportConsumer, { onState: (s) => (capturedState = s) }));
    });

    expect(capturedState.isStandard).toBe(true);
    expect(capturedState.isCompact).toBe(false);
    expect(capturedState.isNarrowHeight).toBe(false);
    expect(capturedState.isUnsupported).toBe(false);
    expect(capturedState.width).toBe(1440);
    expect(capturedState.height).toBe(900);
  });

  it("supports 1024x640 tier as compact and narrow-height but supported", () => {
    setWindowDimensions(1024, 640);
    let capturedState!: OsViewportState;

    act(() => {
      root.render(createElement(ViewportConsumer, { onState: (s) => (capturedState = s) }));
    });

    expect(capturedState.isStandard).toBe(false);
    expect(capturedState.isCompact).toBe(true);
    expect(capturedState.isNarrowHeight).toBe(true);
    expect(capturedState.isUnsupported).toBe(false);
  });

  it("preserves support at 1024x640 even when canvas viewport is smaller from reserved chrome", () => {
    setWindowDimensions(1024, 640);
    // Canvas ResizeObserver reports smaller work area due to dock gutter and topbar
    useWindowStore.setState({
      viewport: { width: 940, height: 580 },
    });

    let capturedState!: OsViewportState;

    act(() => {
      root.render(createElement(ViewportConsumer, { onState: (s) => (capturedState = s) }));
    });

    // Canvas geometry is reported for window placement
    expect(capturedState.width).toBe(940);
    expect(capturedState.height).toBe(580);
    // But support tier is based on browser window and remains supported!
    expect(capturedState.isUnsupported).toBe(false);
    expect(capturedState.isCompact).toBe(true);
    expect(capturedState.isNarrowHeight).toBe(true);
  });

  it("marks viewport unsupported when width is below 1024", () => {
    setWindowDimensions(1023, 768);
    let capturedState!: OsViewportState;

    act(() => {
      root.render(createElement(ViewportConsumer, { onState: (s) => (capturedState = s) }));
    });

    expect(capturedState.isUnsupported).toBe(true);
  });

  it("marks viewport unsupported when height is below 640", () => {
    setWindowDimensions(1280, 639);
    let capturedState!: OsViewportState;

    act(() => {
      root.render(createElement(ViewportConsumer, { onState: (s) => (capturedState = s) }));
    });

    expect(capturedState.isUnsupported).toBe(true);
  });

  it("updates support tiers dynamically on window resize event", () => {
    setWindowDimensions(1440, 900);
    let capturedState!: OsViewportState;

    act(() => {
      root.render(createElement(ViewportConsumer, { onState: (s) => (capturedState = s) }));
    });
    expect(capturedState.isStandard).toBe(true);

    act(() => {
      setWindowDimensions(1024, 640);
      window.dispatchEvent(new Event("resize"));
    });

    expect(capturedState.isStandard).toBe(false);
    expect(capturedState.isCompact).toBe(true);
    expect(capturedState.isNarrowHeight).toBe(true);
    expect(capturedState.isUnsupported).toBe(false);

    act(() => {
      setWindowDimensions(800, 600);
      window.dispatchEvent(new Event("resize"));
    });

    expect(capturedState.isUnsupported).toBe(true);
  });

  it("cleans up resize listener on unmount", () => {
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    act(() => {
      root.render(createElement(ViewportConsumer, { onState: () => {} }));
    });

    act(() => {
      root.unmount();
    });

    expect(removeEventListenerSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    removeEventListenerSpy.mockRestore();
  });
});
