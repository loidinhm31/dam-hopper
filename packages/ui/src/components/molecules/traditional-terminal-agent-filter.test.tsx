// @vitest-environment jsdom

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraditionalAgentStatusLabel } from "@/lib/traditional-terminal-agents.js";
import {
  TraditionalTerminalAgentFilter,
  type TraditionalAgentStatusSelection,
  type TraditionalTerminalAgentFilterProps,
  type TraditionalTerminalAgentStatusCounts,
} from "./traditional-terminal-agent-filter.js";

if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  class MockPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(
      type: string,
      params: MouseEventInit & { pointerId?: number; pointerType?: string } = {},
    ) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "";
    }
  }
  // @ts-expect-error polyfill for jsdom
  window.PointerEvent = MockPointerEvent;
  // @ts-expect-error polyfill for jsdom
  globalThis.PointerEvent = MockPointerEvent;
}

const DEFAULT_COUNTS: TraditionalTerminalAgentStatusCounts = {
  all: 6,
  "Needs attention": 1,
  Working: 2,
  Idle: 1,
  Unknown: 1,
  Unavailable: 1,
  "Platform unqualified": 0,
  Unsupported: 0,
};

const ZERO_COUNTS: TraditionalTerminalAgentStatusCounts = {
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
      expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
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

    it("renders comma-separated labels and sum badge when multiple statuses are selected", () => {
      const { trigger } = renderFilter({
        value: ["Working", "Idle"],
        counts: DEFAULT_COUNTS,
      });
      expect(trigger.textContent).toContain("Working, Idle");
      // Working count (2) + Idle count (1) = 3
      const badge = trigger.querySelector('[data-testid="agent-filter-count-badge"]');
      expect(badge?.textContent).toBe("3");
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
      const singleCounts: TraditionalTerminalAgentStatusCounts = {
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

    it("renders status icon for single status and only chevron for all or multi", () => {
      // Single status has 2 SVGs: status icon + chevron
      const { trigger: workingTrigger } = renderFilter({ value: "Working" });
      const workingSvgs = workingTrigger.querySelectorAll("svg");
      expect(workingSvgs).toHaveLength(2);
      for (const svg of workingSvgs) {
        expect(svg.getAttribute("aria-hidden")).toBe("true");
      }

      // "all" has 1 SVG: chevron
      const { trigger: allTrigger } = renderFilter({ value: "all" });
      const allSvgs = allTrigger.querySelectorAll("svg");
      expect(allSvgs).toHaveLength(1);
      expect(allSvgs[0]?.getAttribute("aria-hidden")).toBe("true");

      // Multiple statuses has 1 SVG: chevron
      const { trigger: multiTrigger } = renderFilter({ value: ["Working", "Idle"] });
      const multiSvgs = multiTrigger.querySelectorAll("svg");
      expect(multiSvgs).toHaveLength(1);
      expect(multiSvgs[0]?.getAttribute("aria-hidden")).toBe("true");
    });
  });

  describe("Portal / listbox and options", () => {
    it("opens menu with exactly eight options in frozen canonical order", async () => {
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

    it("has role='listbox' with aria-multiselectable='true'", async () => {
      const { trigger } = renderFilter();
      await openDropdown(trigger);

      const listbox = document.querySelector('[role="listbox"]');
      expect(listbox).not.toBeNull();
      expect(listbox?.getAttribute("aria-multiselectable")).toBe("true");
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

    it("shows check indicator only on 'All statuses' when selection is 'all'", async () => {
      const { trigger } = renderFilter({ value: "all" });
      const { options } = await openDropdown(trigger);

      expect(options[0]?.getAttribute("aria-selected")).toBe("true");
      expect(options[0]?.querySelector("svg")).not.toBeNull();

      for (let i = 1; i < options.length; i++) {
        expect(options[i]?.getAttribute("aria-selected")).toBe("false");
      }
    });

    it("shows check indicators on active statuses when multiple statuses are selected", async () => {
      const { trigger } = renderFilter({ value: ["Working", "Idle"] });
      const { options } = await openDropdown(trigger);

      expect(options[0]?.getAttribute("aria-selected")).toBe("false");
      // Working is index 2, Idle is index 3
      expect(options[2]?.getAttribute("aria-selected")).toBe("true");
      expect(options[3]?.getAttribute("aria-selected")).toBe("true");
      // Others are false
      expect(options[1]?.getAttribute("aria-selected")).toBe("false");
      expect(options[4]?.getAttribute("aria-selected")).toBe("false");
    });
  });

  describe("Controlled multi-selection interaction", () => {
    it("resets filter to 'all' when clicking 'All statuses'", async () => {
      const onValueChange = vi.fn();
      const { trigger } = renderFilter({
        value: ["Working", "Idle"],
        onValueChange,
      });
      const { options } = await openDropdown(trigger);

      await act(async () => {
        options[0]?.click();
      });

      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith("all");
    });

    it("isolates filter to [status] when clicking a status option while 'all' is active", async () => {
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

      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith(["Working"]);
    });

    it("toggles an unselected status into the selection in canonical order", async () => {
      const onValueChange = vi.fn();
      const { trigger } = renderFilter({
        value: ["Working"],
        onValueChange,
      });
      const { options } = await openDropdown(trigger);

      const idleOption = options.find((el) => el.textContent?.includes("Idle"));
      await act(async () => {
        idleOption?.click();
      });

      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith(["Working", "Idle"]);
    });

    it("toggles an active status out of the selection", async () => {
      const onValueChange = vi.fn();
      const { trigger } = renderFilter({
        value: ["Working", "Idle"],
        onValueChange,
      });
      const { options } = await openDropdown(trigger);

      const workingOption = options.find((el) =>
        el.textContent?.includes("Working"),
      );
      await act(async () => {
        workingOption?.click();
      });

      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith(["Idle"]);
    });

    it("reverts to 'all' when the last active status is deselected", async () => {
      const onValueChange = vi.fn();
      const { trigger } = renderFilter({
        value: ["Working"],
        onValueChange,
      });
      const { options } = await openDropdown(trigger);

      const workingOption = options.find((el) =>
        el.textContent?.includes("Working"),
      );
      await act(async () => {
        workingOption?.click();
      });

      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith("all");
    });

    it("reverts to 'all' when all 7 statuses are selected", async () => {
      const sixStatuses: readonly TraditionalAgentStatusLabel[] = [
        "Needs attention",
        "Working",
        "Idle",
        "Unknown",
        "Unavailable",
        "Platform unqualified",
      ];
      const onValueChange = vi.fn();
      const { trigger } = renderFilter({
        value: sixStatuses,
        onValueChange,
      });
      const { options } = await openDropdown(trigger);

      const unsupportedOption = options.find((el) =>
        el.textContent?.includes("Unsupported"),
      );
      await act(async () => {
        unsupportedOption?.click();
      });

      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith("all");
    });

    it("keeps dropdown open during option toggling", async () => {
      const onValueChange = vi.fn();
      const { trigger } = renderFilter({
        value: "all",
        onValueChange,
      });
      const { options } = await openDropdown(trigger);

      await act(async () => {
        options[2]?.click(); // Working
      });

      expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    });

    it("updates selected label and count when parent updates value prop", async () => {
      function ControlledTestHarness() {
        const [filter, setFilter] = useState<TraditionalAgentStatusSelection>("all");
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

      // Now toggle Idle as well
      const idleOption = options.find((el) => el.textContent?.includes("Idle"));
      await act(async () => {
        idleOption?.click();
      });

      expect(trigger.textContent).toContain("Working, Idle");
      expect(trigger.textContent).toContain("3");
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

      expect(onValueChange).toHaveBeenCalledWith(["Working"]);
      // Trigger stays "All statuses" because parent did not rerender with ["Working"]
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

    it("allows choosing a zero-count status and invokes onValueChange with singleton array", async () => {
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

      expect(onValueChange).toHaveBeenCalledWith(["Platform unqualified"]);
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

      const modifiedCounts: TraditionalTerminalAgentStatusCounts = {
        ...DEFAULT_COUNTS,
        Working: 7,
        all: 11,
      };
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
    it("opens dropdown when trigger receives Enter key with preventDefault", async () => {
      const { trigger } = renderFilter();
      trigger.focus();

      const enterEvent = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        trigger.dispatchEvent(enterEvent);
      });

      expect(enterEvent.defaultPrevented).toBe(true);
      const listbox = document.querySelector('[role="listbox"]');
      expect(listbox).not.toBeNull();
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement).toBe(trigger);
    });

    it("opens dropdown when trigger receives Space key with preventDefault", async () => {
      const { trigger } = renderFilter();
      trigger.focus();

      const spaceEvent = new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        trigger.dispatchEvent(spaceEvent);
      });

      expect(spaceEvent.defaultPrevented).toBe(true);
      const listbox = document.querySelector('[role="listbox"]');
      expect(listbox).not.toBeNull();
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement).toBe(trigger);
    });

    it("opens dropdown when trigger receives ArrowDown key and sets active descendant", async () => {
      const { trigger } = renderFilter();
      trigger.focus();

      const downEvent = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        trigger.dispatchEvent(downEvent);
      });

      expect(downEvent.defaultPrevented).toBe(true);
      const listbox = document.querySelector('[role="listbox"]');
      expect(listbox).not.toBeNull();
      expect(trigger.getAttribute("aria-activedescendant")).toBeTruthy();
      expect(document.activeElement).toBe(trigger);
    });

    it("opens dropdown when trigger receives ArrowUp key and sets active descendant to last option", async () => {
      const { trigger } = renderFilter();
      trigger.focus();

      const upEvent = new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        trigger.dispatchEvent(upEvent);
      });

      expect(upEvent.defaultPrevented).toBe(true);
      const listbox = document.querySelector('[role="listbox"]');
      expect(listbox).not.toBeNull();
      const options = document.querySelectorAll('[role="option"]');
      const lastOption = options[options.length - 1];
      expect(trigger.getAttribute("aria-activedescendant")).toBe(lastOption?.id);
      expect(document.activeElement).toBe(trigger);
    });

    it("navigates options via keyboard arrows with both wrap-around directions", async () => {
      const { trigger } = renderFilter();
      trigger.focus();

      // Open with ArrowDown -> activeIndex 0
      await act(async () => {
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
        );
      });
      const options = document.querySelectorAll('[role="option"]');
      expect(trigger.getAttribute("aria-activedescendant")).toBe(options[0]?.id);

      // Down again -> activeIndex 1
      await act(async () => {
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
        );
      });
      expect(trigger.getAttribute("aria-activedescendant")).toBe(options[1]?.id);

      // Up -> activeIndex 0
      await act(async () => {
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
        );
      });
      expect(trigger.getAttribute("aria-activedescendant")).toBe(options[0]?.id);

      // Up again -> wrap around upward to last option (index 7)
      await act(async () => {
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
        );
      });
      expect(trigger.getAttribute("aria-activedescendant")).toBe(options[7]?.id);

      // Down from index 7 -> wrap around downward to first option (index 0)
      await act(async () => {
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
        );
      });
      expect(trigger.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
      expect(document.activeElement).toBe(trigger);
    });

    it("jumps to first/last option via Home and End keys", async () => {
      const { trigger } = renderFilter();
      await openDropdown(trigger);
      trigger.focus();

      const options = document.querySelectorAll('[role="option"]');

      // Press End -> jump to last
      const endEvent = new KeyboardEvent("keydown", {
        key: "End",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        trigger.dispatchEvent(endEvent);
      });
      expect(endEvent.defaultPrevented).toBe(true);
      expect(trigger.getAttribute("aria-activedescendant")).toBe(options[7]?.id);

      // Press Home -> jump to first
      const homeEvent = new KeyboardEvent("keydown", {
        key: "Home",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        trigger.dispatchEvent(homeEvent);
      });
      expect(homeEvent.defaultPrevented).toBe(true);
      expect(trigger.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
      expect(document.activeElement).toBe(trigger);
    });

    it("toggles active option with Enter key on trigger and retains focus", async () => {
      const onValueChange = vi.fn();
      const { trigger } = renderFilter({
        value: "all",
        onValueChange,
      });
      trigger.focus();

      // Open with ArrowDown -> index 0 (all)
      await act(async () => {
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
        );
      });

      // Move to index 2 (Working)
      await act(async () => {
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
        );
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
        );
      });

      // Press Enter to toggle
      const enterEvent = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        trigger.dispatchEvent(enterEvent);
      });

      expect(enterEvent.defaultPrevented).toBe(true);
      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith(["Working"]);
      // Listbox remains open
      expect(document.querySelector('[role="listbox"]')).not.toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it("toggles active option with Space key on trigger and retains focus", async () => {
      const onValueChange = vi.fn();
      const { trigger } = renderFilter({
        value: ["Working"],
        onValueChange,
      });
      trigger.focus();

      // Open with Enter -> index 0
      await act(async () => {
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      });

      // Move to index 3 (Idle)
      await act(async () => {
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
        );
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
        );
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
        );
      });

      // Press Space to toggle
      const spaceEvent = new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        trigger.dispatchEvent(spaceEvent);
      });

      expect(spaceEvent.defaultPrevented).toBe(true);
      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith(["Working", "Idle"]);
      expect(document.activeElement).toBe(trigger);
    });

    it("dismisses dropdown on Escape, isolates ancestor listeners, and restores trigger focus", async () => {
      const ancestorKeyDownSpy = vi.fn();
      document.body.addEventListener("keydown", ancestorKeyDownSpy);

      const onValueChange = vi.fn();
      const { trigger } = renderFilter({ onValueChange });
      await openDropdown(trigger);

      expect(document.querySelector('[role="listbox"]')).not.toBeNull();

      const escapeEvent = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });

      await act(async () => {
        trigger.dispatchEvent(escapeEvent);
      });

      expect(escapeEvent.defaultPrevented).toBe(true);
      expect(ancestorKeyDownSpy).not.toHaveBeenCalled();
      expect(document.querySelector('[role="listbox"]')).toBeNull();
      expect(onValueChange).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(trigger);

      document.body.removeEventListener("keydown", ancestorKeyDownSpy);
    });
    it("does not intercept Escape or preventDefault when event target and focus are outside widget", async () => {
      const ancestorKeyDownSpy = vi.fn();
      document.body.addEventListener("keydown", ancestorKeyDownSpy);

      const outsideButton = document.createElement("button");
      document.body.appendChild(outsideButton);

      const { trigger } = renderFilter();
      await openDropdown(trigger);
      expect(document.querySelector('[role="listbox"]')).not.toBeNull();

      outsideButton.focus();

      const escapeEvent = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });

      await act(async () => {
        outsideButton.dispatchEvent(escapeEvent);
      });

      expect(escapeEvent.defaultPrevented).toBe(false);
      expect(ancestorKeyDownSpy).toHaveBeenCalled();
      expect(document.querySelector('[role="listbox"]')).toBeNull();
      expect(document.activeElement).toBe(outsideButton);

      document.body.removeEventListener("keydown", ancestorKeyDownSpy);
      outsideButton.remove();
    });

    it("closes dropdown on Tab and Shift+Tab without calling preventDefault", async () => {
      const { trigger } = renderFilter();
      await openDropdown(trigger);
      expect(document.querySelector('[role="listbox"]')).not.toBeNull();

      const tabEvent = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        trigger.dispatchEvent(tabEvent);
      });

      expect(document.querySelector('[role="listbox"]')).toBeNull();
      expect(tabEvent.defaultPrevented).toBe(false);

      // Re-open and test Shift+Tab
      await openDropdown(trigger);
      expect(document.querySelector('[role="listbox"]')).not.toBeNull();

      const shiftTabEvent = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        trigger.dispatchEvent(shiftTabEvent);
      });

      expect(document.querySelector('[role="listbox"]')).toBeNull();
      expect(shiftTabEvent.defaultPrevented).toBe(false);
    });

    it("prevents focus loss on option mousedown", async () => {
      const { trigger } = renderFilter();
      await openDropdown(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const options = document.querySelectorAll<HTMLElement>('[role="option"]');
      const targetOption = options[2]!;

      const mousedownEvent = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        targetOption.dispatchEvent(mousedownEvent);
      });
      expect(mousedownEvent.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(trigger);
    });
    it("adjusts listbox scrollTop when navigating to options outside visible bounds", async () => {
      const { trigger } = renderFilter();
      await openDropdown(trigger);

      const listbox = document.querySelector<HTMLDivElement>('[role="listbox"]')!;
      expect(listbox).not.toBeNull();

      Object.defineProperty(listbox, "clientHeight", { configurable: true, value: 200 });
      let currentScrollTop = 0;
      Object.defineProperty(listbox, "scrollTop", {
        configurable: true,
        get: () => currentScrollTop,
        set: (v: number) => {
          currentScrollTop = v;
        },
      });

      const options = document.querySelectorAll<HTMLElement>('[role="option"]');
      const lastOption = options[7]!;
      Object.defineProperty(lastOption, "offsetTop", { configurable: true, value: 350 });
      Object.defineProperty(lastOption, "offsetHeight", { configurable: true, value: 44 });

      await act(async () => {
        trigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }),
        );
      });

      expect(currentScrollTop).toBe(350 + 44 - 200);
    });

    it("dismisses dropdown on outside pointerdown without refocusing trigger", async () => {
      const { trigger } = renderFilter();
      await openDropdown(trigger);
      expect(document.querySelector('[role="listbox"]')).not.toBeNull();

      const outsideButton = document.createElement("button");
      document.body.append(outsideButton);
      outsideButton.focus();

      await act(async () => {
        document.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true }),
        );
      });

      expect(document.querySelector('[role="listbox"]')).toBeNull();
      // Outside button retains focus, trigger was not forced focused
      expect(document.activeElement).toBe(outsideButton);
      outsideButton.remove();
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
    it("generates distinct description IDs and listbox IDs for multiple component instances", () => {
      const container2 = document.createElement("div");
      document.body.append(container2);
      const root2 = createRoot(container2);

      act(() => {
        root.render(
          <TraditionalTerminalAgentFilter
            value="all"
            onValueChange={vi.fn()}
            counts={DEFAULT_COUNTS}
          />,
        );
        root2.render(
          <TraditionalTerminalAgentFilter
            value="Working"
            onValueChange={vi.fn()}
            counts={DEFAULT_COUNTS}
          />,
        );
      });

      const trigger1 = container.querySelector('[role="combobox"]');
      const trigger2 = container2.querySelector('[role="combobox"]');

      const descId1 = trigger1?.getAttribute("aria-describedby");
      const descId2 = trigger2?.getAttribute("aria-describedby");

      expect(descId1).toBeTruthy();
      expect(descId2).toBeTruthy();
      expect(descId1).not.toBe(descId2);

      const listboxId1 = trigger1?.getAttribute("aria-controls");
      const listboxId2 = trigger2?.getAttribute("aria-controls");

      expect(listboxId1).toBeTruthy();
      expect(listboxId2).toBeTruthy();
      expect(listboxId1).not.toBe(listboxId2);

      act(() => {
        root2.unmount();
      });
      container2.remove();
    });

    it("removes listbox when component is unmounted", async () => {
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
