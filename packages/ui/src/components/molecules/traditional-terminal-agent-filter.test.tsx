// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraditionalAgentStatusLabel } from "@/lib/traditional-terminal-agents.js";
import {
  TraditionalTerminalAgentFilter,
  type TraditionalTerminalAgentFilterProps,
} from "./traditional-terminal-agent-filter.js";

const DEFAULT_COUNTS: Readonly<Record<"all" | TraditionalAgentStatusLabel, number>> = {
  all: 6,
  "Needs attention": 1,
  Working: 2,
  Idle: 1,
  Unknown: 1,
  Unavailable: 1,
  "Platform unqualified": 0,
  Unsupported: 0,
};

const ZERO_COUNTS: Readonly<Record<"all" | TraditionalAgentStatusLabel, number>> = {
  all: 0,
  "Needs attention": 0,
  Working: 0,
  Idle: 0,
  Unknown: 0,
  Unavailable: 0,
  "Platform unqualified": 0,
  Unsupported: 0,
};

const EXPECTED_OPTIONS = [
  { value: "all", label: "All statuses", count: 6 },
  { value: "Needs attention", label: "Needs attention", count: 1 },
  { value: "Working", label: "Working", count: 2 },
  { value: "Idle", label: "Idle", count: 1 },
  { value: "Unknown", label: "Unknown", count: 1 },
  { value: "Unavailable", label: "Unavailable", count: 1 },
  { value: "Platform unqualified", label: "Platform unqualified", count: 0 },
  { value: "Unsupported", label: "Unsupported", count: 0 },
] as const;

function restoreDescriptor(
  target: object,
  prop: string,
  desc: PropertyDescriptor | undefined,
) {
  if (desc) {
    Object.defineProperty(target, prop, desc);
  } else {
    Reflect.deleteProperty(target, prop);
  }
}

describe("TraditionalTerminalAgentFilter", () => {
  let container: HTMLDivElement;
  let root: Root;

  const originalScrollIntoViewDesc = Object.getOwnPropertyDescriptor(
    window.HTMLElement.prototype,
    "scrollIntoView",
  );
  const originalHasPointerCaptureDesc = Object.getOwnPropertyDescriptor(
    window.HTMLElement.prototype,
    "hasPointerCapture",
  );
  const originalSetPointerCaptureDesc = Object.getOwnPropertyDescriptor(
    window.HTMLElement.prototype,
    "setPointerCapture",
  );
  const originalReleasePointerCaptureDesc = Object.getOwnPropertyDescriptor(
    window.HTMLElement.prototype,
    "releasePointerCapture",
  );

  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();

    restoreDescriptor(
      window.HTMLElement.prototype,
      "scrollIntoView",
      originalScrollIntoViewDesc,
    );
    restoreDescriptor(
      window.HTMLElement.prototype,
      "hasPointerCapture",
      originalHasPointerCaptureDesc,
    );
    restoreDescriptor(
      window.HTMLElement.prototype,
      "setPointerCapture",
      originalSetPointerCaptureDesc,
    );
    restoreDescriptor(
      window.HTMLElement.prototype,
      "releasePointerCapture",
      originalReleasePointerCaptureDesc,
    );
  });

  function renderFilter(
    props: Partial<TraditionalTerminalAgentFilterProps> = {},
  ) {
    act(() => {
      root.render(
        <TraditionalTerminalAgentFilter
          value={props.value ?? "all"}
          onValueChange={props.onValueChange ?? vi.fn()}
          counts={props.counts ?? DEFAULT_COUNTS}
          touchOptimized={props.touchOptimized}
          className={props.className}
        />,
      );
    });
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    return { trigger };
  }

  async function openDropdown(trigger: HTMLButtonElement) {
    await act(async () => {
      trigger.click();
    });
    const options = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    return { options };
  }

  describe("Initial render", () => {
    it("renders combobox trigger with accessible name 'Filter agents by status'", () => {
      const { trigger } = renderFilter();
      expect(trigger).not.toBeNull();
      expect(trigger.getAttribute("aria-label")).toBe("Filter agents by status");
    });

    it("renders selected label and count badge for 'all'", () => {
      const { trigger } = renderFilter({ value: "all", counts: DEFAULT_COUNTS });
      expect(trigger.textContent).toContain("All statuses");
      expect(trigger.textContent).toContain("6");
    });

    it("renders selected label and count for each specific status", () => {
      for (const item of EXPECTED_OPTIONS.slice(1)) {
        const { trigger } = renderFilter({
          value: item.value,
          counts: DEFAULT_COUNTS,
        });
        expect(trigger.textContent).toContain(item.label);
        expect(trigger.textContent).toContain(String(item.count));
      }
    });

    it("resolves aria-describedby to live description text with total observed count", () => {
      const { trigger } = renderFilter({
        value: "Working",
        counts: DEFAULT_COUNTS,
      });
      const descId = trigger.getAttribute("aria-describedby");
      expect(descId).toBeTruthy();

      const descEl = document.getElementById(descId!);
      expect(descEl).not.toBeNull();
      expect(descEl?.textContent).toBe("Working: 2 of 6 observed agents.");
    });

    it("uses singular 'agent' in description when total observed count is 1", () => {
      const singleCounts: Record<"all" | TraditionalAgentStatusLabel, number> = {
        ...ZERO_COUNTS,
        all: 1,
        Working: 1,
      };
      const { trigger } = renderFilter({
        value: "Working",
        counts: singleCounts,
      });
      const descId = trigger.getAttribute("aria-describedby");
      const descEl = document.getElementById(descId!);
      expect(descEl?.textContent).toBe("Working: 1 of 1 observed agent.");
    });

    it("marks status and chevron icons with aria-hidden='true'", () => {
      const { trigger } = renderFilter({ value: "Working" });
      const icons = trigger.querySelectorAll("svg");
      expect(icons.length).toBeGreaterThan(0);
      for (const icon of icons) {
        expect(icon.getAttribute("aria-hidden")).toBe("true");
      }
    });
  });

  describe("Portal and options", () => {
    it("opens menu in document portal with exactly eight options in frozen order", async () => {
      const { trigger } = renderFilter();
      const { options } = await openDropdown(trigger);

      expect(options).toHaveLength(8);
      for (let i = 0; i < EXPECTED_OPTIONS.length; i++) {
        const expected = EXPECTED_OPTIONS[i]!;
        const option = options[i]!;
        expect(option.textContent).toContain(expected.label);
        expect(option.textContent).toContain(String(expected.count));
      }
    });

    it("assigns role='option' and contains no nested buttons or tab semantics", async () => {
      const { trigger } = renderFilter();
      const { options } = await openDropdown(trigger);

      for (const option of options) {
        expect(option.getAttribute("role")).toBe("option");
        expect(option.querySelector("button")).toBeNull();
        expect(option.getAttribute("role")).not.toBe("tab");
      }
    });

    it("sets accessible option name conveying status and count badge", async () => {
      const { trigger } = renderFilter();
      const { options } = await openDropdown(trigger);

      expect(options[0]?.getAttribute("aria-label")).toBe("All statuses, 6 agents");
      expect(options[1]?.getAttribute("aria-label")).toBe("Needs attention, 1 agent");
      expect(options[2]?.getAttribute("aria-label")).toBe("Working, 2 agents");
      expect(options[6]?.getAttribute("aria-label")).toBe(
        "Platform unqualified, 0 agents",
      );
    });

    it("renders each option display label clearly within its option text", async () => {
      const { trigger } = renderFilter();
      const { options } = await openDropdown(trigger);

      for (let i = 0; i < EXPECTED_OPTIONS.length; i++) {
        const expected = EXPECTED_OPTIONS[i]!;
        const option = options[i]!;
        expect(option.textContent).toContain(expected.label);
      }
    });
  });

  describe("Controlled selection", () => {
    it("calls onValueChange once with exact value when selecting each non-active option", async () => {
      for (const item of EXPECTED_OPTIONS) {
        const onValueChange = vi.fn();
        // Start from a distinct initial value so Radix fires on selection
        const initialValue = item.value === "all" ? "Working" : "all";
        const { trigger } = renderFilter({
          value: initialValue,
          onValueChange,
        });
        const { options } = await openDropdown(trigger);

        const targetOption = options.find((el) =>
          el.textContent?.includes(item.label),
        );
        expect(targetOption).toBeDefined();

        await act(async () => {
          targetOption?.click();
        });

        expect(onValueChange).toHaveBeenCalledTimes(1);
        expect(onValueChange).toHaveBeenCalledWith(item.value);
      }
    });

    it("does not call onValueChange when re-selecting the currently active value", async () => {
      const onValueChange = vi.fn();
      const { trigger } = renderFilter({
        value: "Working",
        onValueChange,
      });
      const { options } = await openDropdown(trigger);

      const workingOption = options.find((el) =>
        el.textContent?.includes("Working"),
      );
      await act(async () => {
        workingOption?.click();
      });

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it("updates selected label and count when parent updates value prop", async () => {
      function ControlledTestHarness() {
        const [filter, setFilter] = useState<"all" | TraditionalAgentStatusLabel>("all");
        return (
          <TraditionalTerminalAgentFilter
            value={filter}
            onValueChange={setFilter}
            counts={DEFAULT_COUNTS}
          />
        );
      }

      act(() => {
        root.render(<ControlledTestHarness />);
      });

      const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
      expect(trigger.textContent).toContain("All statuses");
      expect(trigger.textContent).toContain("6");

      const { options } = await openDropdown(trigger);
      const workingOption = options.find((el) =>
        el.textContent?.includes("Working"),
      );
      await act(async () => {
        workingOption?.click();
      });

      expect(trigger.textContent).toContain("Working");
      expect(trigger.textContent).toContain("2");
    });

    it("does not update internal selection if parent does not change value", async () => {
      const onValueChange = vi.fn();
      const { trigger } = renderFilter({
        value: "all",
        onValueChange,
      });

      const { options } = await openDropdown(trigger);
      const workingOption = options.find((el) =>
        el.textContent?.includes("Working"),
      );

      await act(async () => {
        workingOption?.click();
      });

      expect(onValueChange).toHaveBeenCalledWith("Working");
      // Trigger stays "All statuses" because parent did not rerender with "Working"
      expect(trigger.textContent).toContain("All statuses");
    });
  });

  describe("Zero-count states", () => {
    it("keeps all eight options enabled when roster has zero counts", async () => {
      const { trigger } = renderFilter({ counts: ZERO_COUNTS });
      const { options } = await openDropdown(trigger);

      expect(options).toHaveLength(8);
      for (const option of options) {
        expect(option.hasAttribute("data-disabled")).toBe(false);
        expect(option.hasAttribute("disabled")).toBe(false);
      }
    });

    it("allows choosing a zero-count status and invokes onValueChange", async () => {
      const onValueChange = vi.fn();
      const { trigger } = renderFilter({
        counts: ZERO_COUNTS,
        onValueChange,
      });
      const { options } = await openDropdown(trigger);

      const unqualOption = options.find((el) =>
        el.textContent?.includes("Platform unqualified"),
      );
      await act(async () => {
        unqualOption?.click();
      });

      expect(onValueChange).toHaveBeenCalledWith("Platform unqualified");
    });

    it("preserves selected status when its count subsequently drops to zero", () => {
      const onValueChange = vi.fn();
      const initialCounts = { ...DEFAULT_COUNTS };
      renderFilter({
        value: "Working",
        counts: initialCounts,
        onValueChange,
      });

      const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
      expect(trigger.textContent).toContain("Working");
      expect(trigger.textContent).toContain("2");

      // Rerender with count dropping to 0
      const updatedCounts = { ...DEFAULT_COUNTS, Working: 0 };
      renderFilter({
        value: "Working",
        counts: updatedCounts,
        onValueChange,
      });

      expect(trigger.textContent).toContain("Working");
      expect(trigger.textContent).toContain("0");
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe("Live props", () => {
    it("updates trigger count badge when counts change while closed", () => {
      renderFilter({ value: "Working", counts: DEFAULT_COUNTS });
      const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
      expect(trigger.textContent).toContain("2");

      const modifiedCounts = { ...DEFAULT_COUNTS, Working: 5 };
      renderFilter({ value: "Working", counts: modifiedCounts });
      expect(trigger.textContent).toContain("5");
      expect(trigger.textContent).not.toContain("2");
    });

    it("updates trigger and open option counts while menu is open without duplicating text", async () => {
      const { trigger } = renderFilter({
        value: "Working",
        counts: DEFAULT_COUNTS,
      });
      const { options } = await openDropdown(trigger);

      const modifiedCounts = { ...DEFAULT_COUNTS, Working: 7, all: 11 };
      renderFilter({ value: "Working", counts: modifiedCounts });

      expect(trigger.textContent).toContain("7");
      const badges = trigger.querySelectorAll('[data-testid="agent-filter-count-badge"]');
      expect(badges).toHaveLength(1);

      // Verify open options updated
      const workingOption = options.find((el) =>
        el.textContent?.includes("Working"),
      );
      expect(workingOption?.textContent).toContain("7");
      expect(workingOption?.getAttribute("aria-label")).toBe("Working, 7 agents");

      const allOption = options.find((el) =>
        el.textContent?.includes("All statuses"),
      );
      expect(allOption?.textContent).toContain("11");
      expect(allOption?.getAttribute("aria-label")).toBe("All statuses, 11 agents");
    });

    it("keeps selected status unchanged when counts change", () => {
      renderFilter({ value: "Idle", counts: DEFAULT_COUNTS });
      const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
      expect(trigger.textContent).toContain("Idle");

      const modifiedCounts = { ...DEFAULT_COUNTS, Idle: 8, Working: 10 };
      renderFilter({ value: "Idle", counts: modifiedCounts });
      expect(trigger.textContent).toContain("Idle");
      expect(trigger.textContent).toContain("8");
    });
  });

  describe("Keyboard navigation", () => {
    it("opens dropdown when trigger receives Enter key", async () => {
      const { trigger } = renderFilter();
      await act(async () => {
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });

      const listbox = document.querySelector('[role="listbox"]');
      expect(listbox).not.toBeNull();
    });

    it("opens dropdown when trigger receives Space key", async () => {
      const { trigger } = renderFilter();
      await act(async () => {
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", bubbles: true }),
        );
      });

      const listbox = document.querySelector('[role="listbox"]');
      expect(listbox).not.toBeNull();
    });

    it("opens dropdown when trigger receives ArrowDown key", async () => {
      const { trigger } = renderFilter();
      await act(async () => {
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
      });

      const listbox = document.querySelector('[role="listbox"]');
      expect(listbox).not.toBeNull();
    });

    it("navigates options via keyboard arrows and commits selection with Enter", async () => {
      const onValueChange = vi.fn();
      const { trigger } = renderFilter({
        value: "all",
        onValueChange,
      });

      await act(async () => {
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
      });

      const listbox = document.querySelector<HTMLElement>('[role="listbox"]');
      expect(listbox).not.toBeNull();

      const options = Array.from(
        document.querySelectorAll<HTMLElement>('[role="option"]'),
      );
      expect(options.length).toBeGreaterThan(1);
      const targetOption = options[2]!; // "Working"

      await act(async () => {
        targetOption.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });

      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith("Working");
    });

    it("supports status typeahead matching plain display labels", async () => {
      const { trigger } = renderFilter({ value: "all" });
      const { options } = await openDropdown(trigger);

      for (const expected of EXPECTED_OPTIONS) {
        const matchingOption = options.find((opt) =>
          opt.textContent?.includes(expected.label),
        );
        expect(matchingOption).toBeDefined();
        // The display label text is present cleanly in option text
        expect(matchingOption?.textContent).toContain(expected.label);
      }
    });

    it("dismisses dropdown on Escape without invoking onValueChange and restores trigger focus", async () => {
      const onValueChange = vi.fn();
      const { trigger } = renderFilter({ onValueChange });
      await openDropdown(trigger);

      expect(document.querySelector('[role="listbox"]')).not.toBeNull();

      await act(async () => {
        const active = document.activeElement ?? document.body;
        active.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });

      expect(document.querySelector('[role="listbox"]')).toBeNull();
      expect(onValueChange).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(trigger);
    });
  });

  describe("Touch and narrow layout styling", () => {
    it("applies default min-h-11 on trigger and options", async () => {
      const { trigger } = renderFilter({ touchOptimized: false });
      expect(trigger.className).toContain("min-h-11");
      expect(trigger.className).not.toContain("min-h-12");

      const { options } = await openDropdown(trigger);
      for (const option of options) {
        expect(option.className).toContain("min-h-11");
        expect(option.className).not.toContain("min-h-12");
      }
    });

    it("applies min-h-12 on trigger and options when touchOptimized is true", async () => {
      const { trigger } = renderFilter({ touchOptimized: true });
      expect(trigger.className).toContain("min-h-12");

      const { options } = await openDropdown(trigger);
      for (const option of options) {
        expect(option.className).toContain("min-h-12");
      }
    });

    it("includes full-width, truncate and shrink styling classes", async () => {
      const { trigger } = renderFilter();
      expect(trigger.className).toContain("w-full");
      expect(trigger.className).toContain("min-w-0");

      const labelSpan = trigger.querySelector(".truncate");
      expect(labelSpan).not.toBeNull();

      const badge = trigger.querySelector('[data-testid="agent-filter-count-badge"]');
      expect(badge?.className).toContain("shrink-0");
      expect(badge?.className).toContain("tabular-nums");

      const { options } = await openDropdown(trigger);
      for (const option of options) {
        expect(option.querySelector(".truncate")).not.toBeNull();
        const optBadge = option.querySelector(
          '[data-testid="agent-filter-count-badge"]',
        );
        expect(optBadge?.className).toContain("shrink-0");
      }
    });
  });

  describe("Lifecycle and isolation", () => {
    it("generates distinct description IDs for multiple component instances", () => {
      const container2 = document.createElement("div");
      document.body.append(container2);
      const root2 = createRoot(container2);

      act(() => {
        root.render(<TraditionalTerminalAgentFilter value="all" onValueChange={vi.fn()} counts={DEFAULT_COUNTS} />);
        root2.render(<TraditionalTerminalAgentFilter value="Working" onValueChange={vi.fn()} counts={DEFAULT_COUNTS} />);
      });

      const trigger1 = container.querySelector('[role="combobox"]');
      const trigger2 = container2.querySelector('[role="combobox"]');

      const descId1 = trigger1?.getAttribute("aria-describedby");
      const descId2 = trigger2?.getAttribute("aria-describedby");

      expect(descId1).toBeTruthy();
      expect(descId2).toBeTruthy();
      expect(descId1).not.toBe(descId2);

      act(() => {
        root2.unmount();
      });
      container2.remove();
    });

    it("removes portal listbox when component is unmounted", async () => {
      const { trigger } = renderFilter();
      await openDropdown(trigger);

      expect(document.querySelector('[role="listbox"]')).not.toBeNull();

      act(() => {
        root.unmount();
      });

      expect(document.querySelector('[role="listbox"]')).toBeNull();
    });

    it("never accesses localStorage or sessionStorage during any operation", async () => {
      const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

      const { trigger } = renderFilter({ value: "all" });
      const { options } = await openDropdown(trigger);

      await act(async () => {
        options[2]?.click();
      });

      renderFilter({ value: "Working", counts: { ...DEFAULT_COUNTS, Working: 3 } });

      act(() => {
        root.unmount();
      });

      expect(getItemSpy).not.toHaveBeenCalled();
      expect(setItemSpy).not.toHaveBeenCalled();
    });

    it("does not fire onValueChange on mount or on counts-only rerender", () => {
      const onValueChange = vi.fn();
      renderFilter({ value: "Working", onValueChange, counts: DEFAULT_COUNTS });
      expect(onValueChange).not.toHaveBeenCalled();

      renderFilter({
        value: "Working",
        onValueChange,
        counts: { ...DEFAULT_COUNTS, Working: 10 },
      });
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });
});
