import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TraditionalTerminalAgentGroupRow } from "@/components/molecules/traditional-terminal-agent-group-row.js";
import "@/index.css";

describe("Selection Contrast and Adaptive System Typography (Browser)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // Reset root variable to default
    document.documentElement.style.setProperty("--app-font-size", "14px");
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.documentElement.style.removeProperty("--app-font-size");
  });

  describe("Selection Contrast", () => {
    it("renders .workbench-selection with contrasting background, text, and inset marker", async () => {
      await act(async () => {
        root.render(
          <div data-testid="container" className="p-4 bg-[var(--color-surface)]">
            <div data-testid="unselected" className="px-3 py-1.5 text-xs text-[var(--color-text-muted)]">
              Unselected Item
            </div>
            <div data-testid="selected" className="workbench-selection px-3 py-1.5 text-xs">
              Selected Item
            </div>
          </div>,
        );
      });

      const selectedEl = container.querySelector('[data-testid="selected"]') as HTMLElement;
      const unselectedEl = container.querySelector('[data-testid="unselected"]') as HTMLElement;

      expect(selectedEl).not.toBeNull();
      expect(unselectedEl).not.toBeNull();

      const selectedStyles = window.getComputedStyle(selectedEl);
      const unselectedStyles = window.getComputedStyle(unselectedEl);

      // Selected background must be different from unselected
      expect(selectedStyles.backgroundColor).not.toBe(unselectedStyles.backgroundColor);

      // Selected text must be crisp light/white
      expect(selectedStyles.color).toContain("rgb(255, 255, 255)");

      // Inset indicator marker (box-shadow) must be active
      expect(selectedStyles.boxShadow).toContain("3px 0px 0px 0px inset");
    });

    it("applies workbench-selection to active TraditionalTerminalAgentGroupRow", async () => {
      const activeGroup = {
        key: "proj:Working",
        label: "Working" as const,
        projectKey: "proj",
        projectLabel: "Demo Project",
        profileId: "default",
        profileLabel: "Default",
        harnessLabels: ["OMP"],
        sourceLabels: ["loopback"],
        coverageHints: [],
        rows: [{ sessionId: "sess-1", terminalTitle: "Term 1" }],
      };

      await act(async () => {
        root.render(
          <div>
            <TraditionalTerminalAgentGroupRow
              group={activeGroup}
              activeSessionId="sess-1"
              onSelectAgent={() => {}}
            />
          </div>,
        );
      });

      const button = container.querySelector("button") as HTMLButtonElement;
      expect(button).not.toBeNull();
      expect(button.classList.contains("workbench-selection")).toBe(true);
      expect(button.getAttribute("aria-current")).toBe("true");

      const computed = window.getComputedStyle(button);
      expect(computed.color).toContain("rgb(255, 255, 255)");
      expect(computed.boxShadow).toContain("3px 0px 0px 0px inset");
    });

    it("renders distinct focus outline on focused .workbench-selection without erasing left marker", async () => {
      await act(async () => {
        root.render(
          <div>
            <button
              type="button"
              data-testid="selected-button"
              className="workbench-selection px-3 py-1.5 text-xs focus-visible:outline-none"
            >
              Focused Selection
            </button>
          </div>,
        );
      });

      const button = container.querySelector('[data-testid="selected-button"]') as HTMLButtonElement;
      button.focus();

      const computed = window.getComputedStyle(button);
      // Box-shadow inset marker remains intact
      expect(computed.boxShadow).toContain("3px 0px 0px 0px inset");
      // Focus-visible outline is active
      expect(computed.outlineStyle).not.toBe("none");
      expect(computed.outlineWidth).toBe("2px");
    });
  });

  describe("Adaptive Typography Scale", () => {
    it("computes font sizes accurately at default 14px system font size", async () => {
      document.documentElement.style.setProperty("--app-font-size", "14px");

      await act(async () => {
        root.render(
          <div data-testid="scale-container">
            <span data-testid="t-2xs" className="text-2xs">2xs text</span>
            <span data-testid="t-xs" className="text-xs">xs text</span>
            <span data-testid="t-sm" className="text-sm">sm text</span>
            <span data-testid="t-base" className="text-base">base text</span>
            <span data-testid="t-lg" className="text-lg">lg text</span>
          </div>,
        );
      });

      const el2xs = container.querySelector('[data-testid="t-2xs"]') as HTMLElement;
      const elXs = container.querySelector('[data-testid="t-xs"]') as HTMLElement;
      const elSm = container.querySelector('[data-testid="t-sm"]') as HTMLElement;
      const elBase = container.querySelector('[data-testid="t-base"]') as HTMLElement;
      const elLg = container.querySelector('[data-testid="t-lg"]') as HTMLElement;

      const px2xs = parseFloat(window.getComputedStyle(el2xs).fontSize);
      const pxXs = parseFloat(window.getComputedStyle(elXs).fontSize);
      const pxSm = parseFloat(window.getComputedStyle(elSm).fontSize);
      const pxBase = parseFloat(window.getComputedStyle(elBase).fontSize);
      const pxLg = parseFloat(window.getComputedStyle(elLg).fontSize);

      // 14 * 0.714 = 9.996px (~10px)
      expect(px2xs).toBeGreaterThanOrEqual(9.9);
      expect(px2xs).toBeLessThanOrEqual(10.1);

      // 14 * 0.857 = 11.998px (~12px)
      expect(pxXs).toBeGreaterThanOrEqual(11.9);
      expect(pxXs).toBeLessThanOrEqual(12.1);

      // 14px
      expect(pxSm).toBeGreaterThanOrEqual(13.9);
      expect(pxSm).toBeLessThanOrEqual(14.1);
      // 14 * 1.143 = 16.002px (~16px)
      expect(pxBase).toBeGreaterThanOrEqual(15.9);
      expect(pxBase).toBeLessThanOrEqual(16.1);

      // 14 * 1.286 = 18.004px (~18px)
      expect(pxLg).toBeGreaterThanOrEqual(17.9);
      expect(pxLg).toBeLessThanOrEqual(18.1);
    });

    it("scales typography live when --app-font-size changes to 20px", async () => {
      document.documentElement.style.setProperty("--app-font-size", "20px");

      await act(async () => {
        root.render(
          <div data-testid="scale-container">
            <span data-testid="t-xs" className="text-xs">xs text</span>
            <span data-testid="t-sm" className="text-sm">sm text</span>
          </div>,
        );
      });

      const elXs = container.querySelector('[data-testid="t-xs"]') as HTMLElement;
      const elSm = container.querySelector('[data-testid="t-sm"]') as HTMLElement;

      const pxXs = parseFloat(window.getComputedStyle(elXs).fontSize);
      const pxSm = parseFloat(window.getComputedStyle(elSm).fontSize);

      // At 20px: text-xs is 20 * 0.857 = 17.14px
      expect(pxXs).toBeGreaterThanOrEqual(17.0);
      expect(pxXs).toBeLessThanOrEqual(17.3);

      // At 20px: text-sm is exactly 20px
      expect(pxSm).toBeGreaterThanOrEqual(19.9);
      expect(pxSm).toBeLessThanOrEqual(20.1);
    });

    it("scales typography at lower boundary (10px) and upper boundary (32px)", async () => {
      // 10px
      document.documentElement.style.setProperty("--app-font-size", "10px");

      await act(async () => {
        root.render(
          <div>
            <span data-testid="t-sm-10" className="text-sm">sm 10</span>
          </div>,
        );
      });
      const el10 = container.querySelector('[data-testid="t-sm-10"]') as HTMLElement;
      const px10 = parseFloat(window.getComputedStyle(el10).fontSize);
      expect(px10).toBeGreaterThanOrEqual(9.9);
      expect(px10).toBeLessThanOrEqual(10.1);
      // 32px
      document.documentElement.style.setProperty("--app-font-size", "32px");

      await act(async () => {
        root.render(
          <div>
            <span data-testid="t-sm-32" className="text-sm">sm 32</span>
          </div>,
        );
      });
      const el32 = container.querySelector('[data-testid="t-sm-32"]') as HTMLElement;
      const px32 = parseFloat(window.getComputedStyle(el32).fontSize);
      expect(px32).toBeGreaterThanOrEqual(31.9);
      expect(px32).toBeLessThanOrEqual(32.1);
    });

    it("updates computed font size live on the same mounted element when --app-font-size changes", async () => {
      document.documentElement.style.setProperty("--app-font-size", "14px");
      await act(async () => {
        root.render(
          <div data-testid="live-container">
            <span data-testid="live-text" className="text-sm">Live text</span>
          </div>,
        );
      });

      const el = container.querySelector('[data-testid="live-text"]') as HTMLElement;
      const pxInitial = parseFloat(window.getComputedStyle(el).fontSize);
      expect(pxInitial).toBeGreaterThanOrEqual(13.9);
      expect(pxInitial).toBeLessThanOrEqual(14.1);

      // Change CSS variable on documentElement without rerendering or unmounting React
      document.documentElement.style.setProperty("--app-font-size", "24px");
      const pxAfter24 = parseFloat(window.getComputedStyle(el).fontSize);
      expect(pxAfter24).toBeGreaterThanOrEqual(23.9);
      expect(pxAfter24).toBeLessThanOrEqual(24.1);

      // And scale back to 16px
      document.documentElement.style.setProperty("--app-font-size", "16px");
      const pxAfter16 = parseFloat(window.getComputedStyle(el).fontSize);
      expect(pxAfter16).toBeGreaterThanOrEqual(15.9);
      expect(pxAfter16).toBeLessThanOrEqual(16.1);
    });
  });
});
