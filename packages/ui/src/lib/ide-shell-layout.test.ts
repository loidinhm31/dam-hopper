import { describe, expect, it } from "vitest";
import { resolveBottomPanelLayout } from "./ide-shell-layout.js";

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
