import { describe, expect, it, vi } from "vitest";
import {
  clampResolverPanelLayout,
  handleResolverPanelKeyDown,
  INITIAL_RESOLVER_PANEL_LAYOUT,
  RESOLVER_PANEL_MARGIN,
  RESOLVER_PANEL_MIN_HEIGHT,
  RESOLVER_PANEL_MIN_WIDTH,
  type ResolverPanelLayout,
} from "./conflict-resolver-panel-state.js";

describe("conflict-resolver-panel-state", () => {
  const bounds = { width: 1920, height: 1080 };

  it("clamps standard layout within viewport bounds", () => {
    const layout: ResolverPanelLayout = {
      width: 1000,
      height: 700,
      top: 50,
      left: 100,
      isMaximized: false,
    };

    const clamped = clampResolverPanelLayout(layout, bounds);
    expect(clamped.width).toBe(1000);
    expect(clamped.height).toBe(700);
    expect(clamped.top).toBe(50);
    expect(clamped.left).toBe(100);
    expect(clamped.isMaximized).toBe(false);
  });

  it("enforces minimum width and height constraints", () => {
    const layout: ResolverPanelLayout = {
      width: 100,
      height: 50,
      top: 10,
      left: 10,
      isMaximized: false,
    };

    const clamped = clampResolverPanelLayout(layout, bounds);
    expect(clamped.width).toBe(RESOLVER_PANEL_MIN_WIDTH);
    expect(clamped.height).toBe(RESOLVER_PANEL_MIN_HEIGHT);
  });

  it("clamps oversized panels to viewport margins", () => {
    const layout: ResolverPanelLayout = {
      width: 3000,
      height: 2000,
      top: 500,
      left: 500,
      isMaximized: false,
    };

    const clamped = clampResolverPanelLayout(layout, bounds);
    expect(clamped.width).toBe(bounds.width - RESOLVER_PANEL_MARGIN * 2);
    expect(clamped.height).toBe(bounds.height - RESOLVER_PANEL_MARGIN * 2);
    expect(clamped.top).toBe(RESOLVER_PANEL_MARGIN);
    expect(clamped.left).toBe(RESOLVER_PANEL_MARGIN);
  });

  it("expands maximized layout to fill viewport bounds with margin", () => {
    const layout: ResolverPanelLayout = {
      ...INITIAL_RESOLVER_PANEL_LAYOUT,
      isMaximized: true,
    };

    const clamped = clampResolverPanelLayout(layout, bounds);
    expect(clamped.width).toBe(bounds.width - RESOLVER_PANEL_MARGIN * 2);
    expect(clamped.height).toBe(bounds.height - RESOLVER_PANEL_MARGIN * 2);
    expect(clamped.top).toBe(RESOLVER_PANEL_MARGIN);
    expect(clamped.left).toBe(RESOLVER_PANEL_MARGIN);
    expect(clamped.isMaximized).toBe(true);
  });

  it("caps effective minimums on small/phone viewports without overflowing", () => {
    const phoneBounds = { width: 360, height: 640 };
    const layout: ResolverPanelLayout = {
      ...INITIAL_RESOLVER_PANEL_LAYOUT,
      width: 500,
      height: 700,
      left: 50,
      top: 50,
    };

    const clamped = clampResolverPanelLayout(layout, phoneBounds);
    expect(clamped.width).toBe(phoneBounds.width - RESOLVER_PANEL_MARGIN * 2);
    expect(clamped.height).toBe(phoneBounds.height - RESOLVER_PANEL_MARGIN * 2);
    expect(clamped.left).toBe(RESOLVER_PANEL_MARGIN);
    expect(clamped.top).toBe(RESOLVER_PANEL_MARGIN);
    expect(clamped.left! + clamped.width).toBeLessThanOrEqual(phoneBounds.width);
  });

  it("handles keydown events with topmost arbitration", () => {
    const onHide = vi.fn();
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();

    // Topmost Escape triggers onHide and stops propagation
    expect(
      handleResolverPanelKeyDown(
        { key: "Escape", stopPropagation, preventDefault },
        onHide,
        true,
      ),
    ).toBe(true);
    expect(onHide).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();

    // Non-topmost Escape is ignored
    onHide.mockClear();
    expect(
      handleResolverPanelKeyDown(
        { key: "Escape" },
        onHide,
        false,
      ),
    ).toBe(false);
    expect(onHide).not.toHaveBeenCalled();

    // Non-Escape keys are ignored
    expect(
      handleResolverPanelKeyDown(
        { key: "Enter" },
        onHide,
        true,
      ),
    ).toBe(false);
    expect(onHide).not.toHaveBeenCalled();
  });
});
