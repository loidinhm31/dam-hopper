import { describe, expect, it } from "vitest";
import {
  resolveBottomPanelLayout,
  resolveMaximizeToggle,
  resolveTopToolToggle,
} from "./ide-shell-layout.js";

describe("resolveBottomPanelLayout", () => {
  describe("default (non-maximized)", () => {
    const layout = resolveBottomPanelLayout({
      bottomMaximized: false,
      bottomHeight: 300,
    });

    it("keeps the top area visible (no hidden class)", () => {
      expect(layout.topAreaClassName).not.toContain(" hidden");
      expect(layout.topAreaClassName).toContain("flex-1");
    });

    it("uses a fixed-size bottom outer container (shrink-0, not flex-1)", () => {
      expect(layout.bottomOuterClassName).toContain("shrink-0");
      expect(layout.bottomOuterClassName).not.toContain("flex-1");
    });

    it("shows the vertical resize handle", () => {
      expect(layout.showResizeHandle).toBe(true);
    });

    it("applies the persisted bottom height as an inline style", () => {
      expect(layout.innerStyle).toEqual({ height: 300 });
    });

    it("does not stretch the inner height div (no flex-1)", () => {
      expect(layout.innerClassName).not.toContain("flex-1");
      expect(layout.innerClassName).toContain("border-t");
    });
  });

  describe("maximized", () => {
    const layout = resolveBottomPanelLayout({
      bottomMaximized: true,
      bottomHeight: 300,
    });

    it("hides the top area", () => {
      expect(layout.topAreaClassName).toContain(" hidden");
    });

    it("stretches the bottom outer container to fill (flex-1, not shrink-0)", () => {
      expect(layout.bottomOuterClassName).toContain("flex-1");
      expect(layout.bottomOuterClassName).not.toContain("shrink-0");
    });

    it("hides the vertical resize handle", () => {
      expect(layout.showResizeHandle).toBe(false);
    });

    it("drops the fixed height style so the inner div can flex", () => {
      expect(layout.innerStyle).toBeUndefined();
    });

    it("stretches the inner height div (flex-1)", () => {
      expect(layout.innerClassName).toContain("flex-1");
    });
  });

  describe("restore (toggle back from maximized)", () => {
    it("returns the exact non-maximized layout contract when toggled back", () => {
      const restored = resolveBottomPanelLayout({
        bottomMaximized: false,
        bottomHeight: 300,
      });

      expect(restored.topAreaClassName).not.toContain(" hidden");
      expect(restored.bottomOuterClassName).toContain("shrink-0");
      expect(restored.showResizeHandle).toBe(true);
      expect(restored.innerStyle).toEqual({ height: 300 });
      expect(restored.innerClassName).not.toContain("flex-1");
    });

    it("is a pure function — same input yields identical output", () => {
      const a = resolveBottomPanelLayout({
        bottomMaximized: false,
        bottomHeight: 300,
      });
      const b = resolveBottomPanelLayout({
        bottomMaximized: false,
        bottomHeight: 300,
      });
      expect(a).toEqual(b);
    });
  });

  describe("reset on close", () => {
    it("clears maximize when the bottom tool is closed (false -> default layout)", () => {
      // Closing the maximized bottom tool resets bottomMaximized to false,
      // which must yield the non-maximized layout contract.
      const afterClose = resolveBottomPanelLayout({
        bottomMaximized: false,
        bottomHeight: 300,
      });

      expect(afterClose.topAreaClassName).not.toContain(" hidden");
      expect(afterClose.bottomOuterClassName).toContain("shrink-0");
      expect(afterClose.showResizeHandle).toBe(true);
      expect(afterClose.innerStyle).toEqual({ height: 300 });
    });
  });

  it("honors the persisted bottom height in the non-maximized inner style", () => {
    const layout = resolveBottomPanelLayout({
      bottomMaximized: false,
      bottomHeight: 450,
    });
    expect(layout.innerStyle).toEqual({ height: 450 });
  });

  it("ignores the bottom height while maximized", () => {
    const layout = resolveBottomPanelLayout({
      bottomMaximized: true,
      bottomHeight: 450,
    });
    expect(layout.innerStyle).toBeUndefined();
  });
});

describe("resolveMaximizeToggle", () => {
  it("clears top active tools when entering maximize", () => {
    const outcome = resolveMaximizeToggle({ bottomMaximized: false });
    expect(outcome.nextBottomMaximized).toBe(true);
    expect(outcome.clearTopActive).toBe(true);
  });

  it("leaves top tool selection untouched when leaving maximize", () => {
    const outcome = resolveMaximizeToggle({ bottomMaximized: true });
    expect(outcome.nextBottomMaximized).toBe(false);
    expect(outcome.clearTopActive).toBe(false);
  });
});

describe("resolveTopToolToggle", () => {
  it("activates an inactive top tool and reverts maximize when maximized", () => {
    const outcome = resolveTopToolToggle({
      currentActiveId: null,
      clickedId: "explorer",
      bottomMaximized: true,
    });
    expect(outcome.nextActiveId).toBe("explorer");
    expect(outcome.revertMaximize).toBe(true);
  });

  it("activates an inactive top tool without reverting when not maximized", () => {
    const outcome = resolveTopToolToggle({
      currentActiveId: null,
      clickedId: "explorer",
      bottomMaximized: false,
    });
    expect(outcome.nextActiveId).toBe("explorer");
    expect(outcome.revertMaximize).toBe(false);
  });

  it("deactivates an already-active top tool without touching maximize", () => {
    const outcome = resolveTopToolToggle({
      currentActiveId: "explorer",
      clickedId: "explorer",
      bottomMaximized: true,
    });
    expect(outcome.nextActiveId).toBeNull();
    expect(outcome.revertMaximize).toBe(false);
  });

  it("switches to a different top tool and reverts maximize", () => {
    const outcome = resolveTopToolToggle({
      currentActiveId: "search",
      clickedId: "explorer",
      bottomMaximized: true,
    });
    expect(outcome.nextActiveId).toBe("explorer");
    expect(outcome.revertMaximize).toBe(true);
  });
});
