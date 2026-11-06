// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useTraditionalTerminalProjectSelection,
  type UseTraditionalTerminalProjectSelectionResult,
} from "./use-traditional-terminal-project-selection.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";

function makeGroup(
  id: string,
  tabIds: string[] = [],
): TraditionalTerminalProjectGroup<TabEntry> {
  return {
    id,
    label: `Project ${id}`,
    projectName: id,
    profileId: "profile-1",
    terminalTabs: tabIds.map((sessionId) => ({
      sessionId,
      label: sessionId,
      session: {
        id: sessionId,
        command: "bash",
        alive: true,
      },
    })),
    mountedSessions: [],
  };
}

interface HookProps {
  groups: readonly TraditionalTerminalProjectGroup<TabEntry>[];
  activeSessionId: string | null;
  onSelectTab?: (sessionId: string) => void;
}

function renderHookHelper(initialProps: HookProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let latestResult: UseTraditionalTerminalProjectSelectionResult<TabEntry> | undefined;
  function TestComponent(props: { hookProps: HookProps }) {
    latestResult = useTraditionalTerminalProjectSelection(props.hookProps);
    return null;
  }

  act(() => {
    root.render(createElement(TestComponent, { hookProps: initialProps }));
  });

  return {
    get current(): HookResult {
      if (!latestResult) throw new Error("Hook did not render");
      return latestResult;
    },
    rerender(nextProps: HookProps) {
      act(() => {
        root.render(createElement(TestComponent, { hookProps: nextProps }));
      });
    },
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useTraditionalTerminalProjectSelection", () => {
  it("selects the group containing the activeSessionId on mount", () => {
    const groupA = makeGroup("group-a", ["tab-a1", "tab-a2"]);
    const groupB = makeGroup("group-b", ["tab-b1"]);

    const harness = renderHookHelper({
      groups: [groupA, groupB],
      activeSessionId: "tab-b1",
    });

    expect(harness.current.selectedGroup?.id).toBe("group-b");
    expect(harness.current.activeSessionForGroup).toBe("tab-b1");
    harness.cleanup();
  });

  it("selects the first group on mount when activeSessionId is null", () => {
    const groupA = makeGroup("group-a", ["tab-a1"]);
    const groupB = makeGroup("group-b", ["tab-b1"]);

    const harness = renderHookHelper({
      groups: [groupA, groupB],
      activeSessionId: null,
    });

    expect(harness.current.selectedGroup?.id).toBe("group-a");
    harness.cleanup();
  });

  it("keeps explicit zero-terminal workspace selection stable across inventory/group changes", () => {
    const groupA = makeGroup("group-a", ["tab-a1"]);
    const groupZero = makeGroup("group-zero", []);

    const harness = renderHookHelper({
      groups: [groupA, groupZero],
      activeSessionId: "tab-a1",
    });

    expect(harness.current.selectedGroup?.id).toBe("group-a");

    // Explicitly select the zero-terminal group
    act(() => {
      harness.current.handleSelectGroup("group-zero");
    });

    expect(harness.current.selectedGroup?.id).toBe("group-zero");

    // Inventory or other group changes (e.g. tab added to groupA, or groupC added)
    // while activeSessionId is still tab-a1
    const groupAUpdated = makeGroup("group-a", ["tab-a1", "tab-a2"]);
    const groupC = makeGroup("group-c", ["tab-c1"]);

    harness.rerender({
      groups: [groupAUpdated, groupZero, groupC],
      activeSessionId: "tab-a1",
    });

    // Zero-terminal selection must survive!
    expect(harness.current.selectedGroup?.id).toBe("group-zero");
    harness.cleanup();
  });

  it("switches to the new group when activeSessionId changes", () => {
    const groupA = makeGroup("group-a", ["tab-a1"]);
    const groupB = makeGroup("group-b", ["tab-b1"]);

    const harness = renderHookHelper({
      groups: [groupA, groupB],
      activeSessionId: "tab-a1",
    });

    expect(harness.current.selectedGroup?.id).toBe("group-a");

    // activeSessionId changes externally (e.g. click in tab or intent)
    harness.rerender({
      groups: [groupA, groupB],
      activeSessionId: "tab-b1",
    });

    expect(harness.current.selectedGroup?.id).toBe("group-b");
    expect(harness.current.activeSessionForGroup).toBe("tab-b1");
    harness.cleanup();
  });

  it("falls back deterministically when currently selected group is removed", () => {
    const groupA = makeGroup("group-a", ["tab-a1"]);
    const groupB = makeGroup("group-b", ["tab-b1"]);

    const harness = renderHookHelper({
      groups: [groupA, groupB],
      activeSessionId: null,
    });

    act(() => {
      harness.current.handleSelectGroup("group-b");
    });
    expect(harness.current.selectedGroup?.id).toBe("group-b");

    // Group B is removed
    harness.rerender({
      groups: [groupA],
      activeSessionId: null,
    });

    // Falls back to firstGroupId (group-a)
    expect(harness.current.selectedGroup?.id).toBe("group-a");
    harness.cleanup();
  });

  it("remembers per-group session selection across switches", () => {
    const groupA = makeGroup("group-a", ["tab-a1", "tab-a2"]);
    const groupB = makeGroup("group-b", ["tab-b1", "tab-b2"]);
    const onSelectTab = vi.fn();

    const harness = renderHookHelper({
      groups: [groupA, groupB],
      activeSessionId: "tab-a1",
      onSelectTab,
    });

    // In group A, select tab-a2
    act(() => {
      harness.current.handleSelectTab("tab-a2");
    });
    expect(onSelectTab).toHaveBeenCalledWith("tab-a2");

    // Switch to group B, select tab-b2
    act(() => {
      harness.current.handleSelectGroup("group-b");
    });
    expect(harness.current.selectedGroup?.id).toBe("group-b");

    act(() => {
      harness.current.handleSelectTab("tab-b2");
    });
    expect(onSelectTab).toHaveBeenCalledWith("tab-b2");

    // Switch back to group A: should select remembered tab-a2
    act(() => {
      harness.current.handleSelectGroup("group-a");
    });
    expect(harness.current.selectedGroup?.id).toBe("group-a");
    expect(onSelectTab).toHaveBeenLastCalledWith("tab-a2");
    harness.cleanup();
  });
});
