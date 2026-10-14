// @vitest-environment jsdom

import { act, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectTargetStore } from "@/stores/project-target.js";
import type { GitStatus, Worktree } from "@/api/client.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import { terminalInstanceKey, terminalKey } from "@/api/ownership.js";
import type { TraditionalTerminalAgentRow as RowModel } from "@/lib/traditional-terminal-agents.js";
import {
  TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
  type TraditionalAgentStatusFilter,
} from "@/lib/traditional-terminal-agent-filter.js";
import type { TraditionalAgentStatusLabel } from "@/lib/traditional-terminal-agents.js";
import { traditionalTerminalProjectPanelId, traditionalTerminalProjectTabId } from "@/lib/traditional-terminal-projects.js";

type SettingsState = { terminalCommitStatusEnabled: boolean };

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

const mocks = vi.hoisted(() => {
  const settings: SettingsState = { terminalCommitStatusEnabled: true };
  const status: GitStatus = {
    projectName: "demo",
    branch: "feature/demo",
    isClean: true,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    hasStash: false,
    lastCommit: {
      hash: "1234567890abcdef",
      message: "Ship the demo terminal workflow",
      date: "2026-07-26T12:30:00.000Z",
    },
  };
  const worktree: Worktree = {
    path: "/workspace/demo",
    repositoryPath: "/workspace/demo/.git",
    branch: "feature/demo",
    commitHash: "1234567890abcdef",
    isMain: true,
    isLocked: false,
    isDetached: false,
    isBare: false,
    isPrunable: false,
    isAvailable: true,
  };
  return {
    settings,
    status,
    worktree,
    useProjectStatus: vi.fn(() => ({
      data: status,
      isLoading: false,
      isError: false,
      isSuccess: true,
    })),
    useWorktrees: vi.fn(() => ({
      data: [worktree],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })),
    useSettingsStore: vi.fn((selector: (state: SettingsState) => unknown) =>
      selector(settings),
    ),
  };
});

vi.mock("@/api/queries.js", () => ({
  useProjectStatus: mocks.useProjectStatus,
  useWorktrees: mocks.useWorktrees,
}));

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: mocks.useSettingsStore,
}));

import { TraditionalTerminalProjectsNavigator } from "./TraditionalTerminalProjectsNavigator.js";

const group: TraditionalTerminalProjectGroup = {
  id: "project:demo",
  projectName: "demo",
  label: "demo",
  terminalTabs: [{ sessionId: "demo:1", label: "demo:1" }],
  mountedSessions: [{ sessionId: "demo:1", project: "demo", command: "bash" }],
};

function makeAgentRow(
  profileId: string,
  title: string,
  {
    id = "terminal-1",
    groupId = `project-${profileId}`,
    label = "Working" as TraditionalAgentStatusLabel,
    reasonLabel = null as "Approval" | "Question" | "Error" | null,
    outcomeHint = null as "Done (turn ended)" | null,
    harnessLabel = "OMP" as "OMP" | "Codex" | "Claude",
    availability = "ready" as "ready" | "unavailable" | "platform-unqualified" | null,
    state = "working" as "working" | "idle" | "blocked" | "unknown",
  } = {},
): RowModel {
  const terminalRef = { profileId, id };
  return {
    key: terminalInstanceKey({ ...terminalRef, incarnation: 1 }),
    sessionId: terminalKey(terminalRef),
    terminalRef,
    incarnation: 1,
    groupId,
    projectLabel: "demo",
    profileLabel: profileId === "server-a" ? "Development" : "Production",
    terminalTitle: title,
    harnessLabel,
    statusOwner: { profileId, generation: 2 },
    availability,
    status: {
      id: terminalRef.id,
      incarnation: 1,
      agentKind:
        harnessLabel === "Claude"
          ? "claude"
          : harnessLabel === "Codex"
            ? "codex"
            : "omp",
      agentSessionId: "private-agent-session",
      reporterEpoch: 1,
      state,
      source: "lifecycle",
      attentionRevision: 0,
    },
    presentation: {
      label,
      reasonLabel,
      outcomeHint,
      sourceLabel: "Lifecycle observation",
      coverageHint: null,
    },
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname}{location.search}</output>;
}

describe("TraditionalTerminalProjectsNavigator", () => {
  let container: HTMLDivElement;
  let root: Root;

  function renderNavigator(props: Partial<ComponentProps<typeof TraditionalTerminalProjectsNavigator>> = {}) {
    act(() => root.render(
      <MemoryRouter initialEntries={["/terminals"]}>
        <TraditionalTerminalProjectsNavigator groups={[group]} activeGroupId={group.id} onSelectGroup={vi.fn()} {...props} />
        <LocationProbe />
      </MemoryRouter>,
    ));
  }

  function getFilterTrigger(): HTMLButtonElement {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[role="combobox"][aria-label="Filter agents by status"]',
    );
    if (!trigger) throw new Error("Filter trigger not found");
    return trigger;
  }

  async function openFilterDropdown() {
    const trigger = getFilterTrigger();
    if (trigger.getAttribute("aria-expanded") !== "true") {
      await act(async () => {
        trigger.click();
      });
    }
    const options = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    return { trigger, options };
  }

  async function selectFilterOption(
    filter: TraditionalAgentStatusFilter | "All statuses",
  ) {
    const targetLabel = filter === "all" ? "All statuses" : filter;
    const { options } = await openFilterDropdown();
    const targetOption = options.find((el) => {
      const ariaLabel = el.getAttribute("aria-label") ?? "";
      const text = el.textContent ?? "";
      return ariaLabel.startsWith(targetLabel) || text.includes(targetLabel);
    });
    if (!targetOption) {
      throw new Error(`Filter option "${filter}" not found in dropdown`);
    }
    await act(async () => {
      targetOption.click();
    });
  }

  function getAgentButtons(): HTMLButtonElement[] {
    const list = container.querySelector(
      'ul[aria-label="Observed agents in open terminals"]',
    );
    if (!list) return [];
    return Array.from(list.querySelectorAll<HTMLButtonElement>("button"));
  }

  beforeEach(() => {
    useProjectTargetStore.getState().resetTarget("demo");
    mocks.settings.terminalCommitStatusEnabled = true;
    mocks.useSettingsStore.mockImplementation(
      (selector: (state: SettingsState) => unknown) => selector(mocks.settings),
    );
    mocks.useProjectStatus.mockClear();
    mocks.useWorktrees.mockClear();
    mocks.useProjectStatus.mockReturnValue({
      data: mocks.status,
      isLoading: false,
      isError: false,
      isSuccess: true,
    });
    mocks.useWorktrees.mockReturnValue({
      data: [mocks.worktree],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    try {
      window.localStorage.removeItem(
        TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
      );
      window.localStorage.removeItem("unrelated-user-pref");
    } catch {
      // ignore
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    for (const portal of Array.from(
      document.body.querySelectorAll("[data-radix-popper-content-wrapper]"),
    )) {
      portal.remove();
    }
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
    try {
      window.localStorage.removeItem(
        TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
      );
      window.localStorage.removeItem("unrelated-user-pref");
    } catch {
      // ignore
    }
  });

  it("shows project Git metadata and the selected-project terminal action", () => {
    const onNewTerminal = vi.fn();
    renderNavigator({ onNewTerminal, width: 300 });
    const metadata = container.querySelector('[role="status"]');
    expect(metadata?.getAttribute("aria-label")).toContain("Branch feature/demo");
    expect(metadata?.textContent).toContain("/workspace/demo");
    expect(metadata?.textContent).toContain("Ship the demo terminal workflow");
    const newTerminal = container.querySelector<HTMLButtonElement>('[aria-label="New terminal in selected project"]')!;
    act(() => newTerminal.click());
    expect(onNewTerminal).toHaveBeenCalledOnce();
  });

  it("shows the selected worktree matching exact path, or root main worktree", () => {
    mocks.useWorktrees.mockReturnValue({
      data: [
        { ...mocks.worktree, path: "/workspace/main", branch: "main", isMain: true },
        { ...mocks.worktree, path: "/workspace/feature", branch: "feature", isMain: false },
      ],
      isLoading: false,
      isError: false,
    });
    useProjectTargetStore.getState().selectTarget("demo", "/workspace/feature");
    renderNavigator({ groups: [group], activeGroupId: group.id });
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("/workspace/feature");
    expect(status?.textContent).not.toContain("/workspace/main");
    const combobox = container.querySelector(
      '[role="combobox"][aria-label^="Worktree for"]',
    );
    expect(combobox?.getAttribute("aria-label")).toContain("feature");
  });

  it("hides metadata for unavailable worktrees", () => {
    mocks.useWorktrees.mockReturnValue({
      data: [{ ...mocks.worktree, isAvailable: false }],
      isLoading: false,
      isError: false,
    });
    const markup = renderToStaticMarkup(
      <TraditionalTerminalProjectsNavigator
        groups={[group]}
        activeGroupId={group.id}
        onSelectGroup={() => {}}
      />,
    );

    expect(markup).not.toContain("feature/demo");
    expect(markup).not.toContain("/workspace/demo");
  });

  it("does not query status or render commit metadata when preference is disabled, but keeps worktree selector", () => {
    mocks.settings.terminalCommitStatusEnabled = false;
    const markup = renderToStaticMarkup(
      <TraditionalTerminalProjectsNavigator
        groups={[group]}
        activeGroupId={group.id}
        onSelectGroup={() => {}}
      />,
    );

    expect(markup).not.toContain("Ship the demo terminal workflow");
    // Worktree dropdown remains present
    const doc = new DOMParser().parseFromString(markup, "text/html");
    const worktreeCombobox = doc.querySelector(
      '[role="combobox"][aria-label^="Worktree for"]',
    );
    expect(worktreeCombobox).not.toBeNull();
    expect(worktreeCombobox?.getAttribute("aria-label")).toContain(
      "Worktree for demo",
    );
  });

  it("queries project status and worktrees scoped to the group profile", () => {
    const qualifiedGroup: TraditionalTerminalProjectGroup = {
      ...group,
      id: '["profile-2","demo"]',
      profileId: "profile-2",
      projectRef: { profileId: "profile-2", project: "demo" },
    };

    renderToStaticMarkup(
      <TraditionalTerminalProjectsNavigator
        groups={[qualifiedGroup]}
        activeGroupId={qualifiedGroup.id}
        onSelectGroup={() => {}}
      />,
    );

    expect(mocks.useProjectStatus).toHaveBeenCalledWith(
      { profileId: "profile-2", project: "demo" },
      true,
    );
    expect(mocks.useWorktrees).toHaveBeenCalledWith({
      profileId: "profile-2",
      project: "demo",
    });
  });

  it("keeps Projects first with complete terminal counts and profile context, separate from observed agents", () => {
    const agent = makeAgentRow("server-a", "Agent terminal");
    const completeGroup: TraditionalTerminalProjectGroup = {
      ...group, profileId: "server-a", profileName: "Development",
      terminalTabs: [
        { sessionId: agent.sessionId, label: "Agent terminal" },
        { sessionId: "shell", label: "Plain shell" },
        { sessionId: "unobserved", label: "Unobserved terminal" },
      ],
    };
    const freeGroup: TraditionalTerminalProjectGroup = {
      id: "free-terminals", label: "Free terminals", projectName: null,
      terminalTabs: [{ sessionId: "free-shell", label: "Free shell" }], mountedSessions: [],
    };
    renderNavigator({ groups: [completeGroup, freeGroup], agentRows: [agent], onSelectAgent: vi.fn() });
    const headings = Array.from(container.querySelectorAll("h2")).map((heading) => heading.textContent?.trim());
    expect(headings).toEqual(["projects", "agents"]);
    const projects = container.querySelector('[role="tablist"][aria-label="Open terminal projects"]')!;
    const tabs = projects.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]!.textContent).toContain("demo");
    expect(tabs[0]!.textContent).toContain("3");
    expect(tabs[0]!.querySelector('[aria-label="Server profile: Development"]')).not.toBeNull();
    expect(tabs[1]!.textContent).toContain("Free terminals");
    expect(tabs[1]!.textContent).toContain("1");
    const agents = container.querySelector('ul[aria-label="Observed agents in open terminals"]')!;
    expect(agents.querySelectorAll("button")).toHaveLength(1);
    expect(agents.querySelector('[role="tab"]')).toBeNull();
    expect(projects.contains(agents)).toBe(false);
  });

  it("preserves project roving selection, panel relationships and Arrow/Home/End wrapping", () => {
    const groups: TraditionalTerminalProjectGroup[] = [
      group,
      { ...group, id: "project:other", projectName: "other", label: "other" },
      { ...group, id: "free-terminals", projectName: null, label: "Free terminals" },
    ];
    const selected = vi.fn();
    function ControlledNavigator() {
      const [activeGroupId, setActiveGroupId] = useState(group.id);
      return <TraditionalTerminalProjectsNavigator groups={groups} activeGroupId={activeGroupId}
        onSelectGroup={(id) => { selected(id); setActiveGroupId(id); }} />;
    }
    act(() => root.render(<MemoryRouter><ControlledNavigator /></MemoryRouter>));
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[0]!.id).toBe(traditionalTerminalProjectTabId(group.id));
    expect(tabs[0]!.getAttribute("aria-controls")).toBe(traditionalTerminalProjectPanelId(group.id));
    expect(tabs[1]!.hasAttribute("aria-controls")).toBe(false);
    tabs[0]!.focus();
    for (const [key, targetIndex] of [["ArrowDown", 1], ["ArrowDown", 2], ["ArrowDown", 0], ["ArrowUp", 2], ["Home", 0], ["End", 2]] as const) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      act(() => document.activeElement!.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(tabs[targetIndex]);
      expect(tabs[targetIndex]!.getAttribute("aria-selected")).toBe("true");
      expect(tabs[targetIndex]!.getAttribute("aria-controls")).toBe(traditionalTerminalProjectPanelId(groups[targetIndex]!.id));
      expect(tabs.map((tab) => tab.tabIndex)).toEqual(tabs.map((_, index) => index === targetIndex ? 0 : -1));
      expect(selected).toHaveBeenLastCalledWith(groups[targetIndex]!.id);
    }
    expect(selected).toHaveBeenCalledTimes(6);
  });

  it("selects the exact agent session without project-tab semantics or project selection", () => {
    const first = makeAgentRow("server-a", "Same title");
    const second = makeAgentRow("server-b", "Same title");
    const onSelectAgent = vi.fn();
    const onSelectGroup = vi.fn();
    renderNavigator({ agentRows: [first, second], activeSessionId: second.sessionId, onSelectAgent, onSelectGroup });
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("ul button"));
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, 0]);
    expect(buttons[0]!.hasAttribute("aria-current")).toBe(false);
    expect(buttons[1]!.getAttribute("aria-current")).toBe("true");
    expect(buttons[1]!.hasAttribute("aria-selected")).toBe(false);
    expect(buttons[1]!.hasAttribute("aria-controls")).toBe(false);
    buttons[1]!.focus();
    const arrow = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    act(() => buttons[1]!.dispatchEvent(arrow));
    expect(arrow.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(buttons[1]);
    expect(onSelectAgent).not.toHaveBeenCalled();
    act(() => buttons[1]!.click());
    expect(onSelectAgent).toHaveBeenCalledExactlyOnceWith(second.sessionId);
    expect(onSelectGroup).not.toHaveBeenCalled();
  });

  it("collapses same-project same-status agents into one counted item and splits it on a status change without remounting the unchanged item", () => {
    const first = makeAgentRow("server-a", "First", { id: "t-1", groupId: "project-a" });
    const second = makeAgentRow("server-a", "Second", { id: "t-2", groupId: "project-a" });
    const third = makeAgentRow("server-a", "Third", { id: "t-3", groupId: "project-a" });
    const onSelectAgent = vi.fn();
    renderNavigator({ agentRows: [first, second, third], onSelectAgent });
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>("ul button"));
    expect(items).toHaveLength(1);
    expect(items[0]!.querySelector('[data-testid="agent-count-badge"]')!.textContent).toBe("3");
    items[0]!.focus();
    renderNavigator({ agentRows: [
      first,
      { ...second, presentation: { ...second.presentation, label: "Needs attention", reasonLabel: "Approval" } },
      third,
    ], onSelectAgent });
    const split = Array.from(container.querySelectorAll<HTMLButtonElement>("ul button"));
    expect(split.map((button) => button.getAttribute("aria-label"))).toEqual([
      "OMP: Second; Project: demo; Server profile: Development; Needs attention: Approval",
      "OMP: 2 agents; Project: demo; Server profile: Development; Working",
    ]);
    expect(split.map((button) => button.querySelector('[data-testid="agent-count-badge"]')!.textContent)).toEqual(["1", "2"]);
    expect(split[1]).toBe(items[0]);
    expect(document.activeElement).toBe(items[0]);
    act(() => split[1]!.click());
    expect(onSelectAgent).toHaveBeenCalledExactlyOnceWith(first.sessionId);
  });

  it("explains the empty observation roster and navigates to the supplied Settings target", () => {
    const href = "/agent-store?tab=settings&profileId=server%2Ftwo%3F";
    renderNavigator({ groups: [], activeGroupId: null, agentSettingsHref: href });
    const empty = container.querySelector("fieldset")!;
    expect(empty.textContent).toContain("No observed agents in open terminals");
    for (const harness of ["OMP", "Codex", "Claude"]) expect(empty.textContent).toContain(harness);
    expect(empty.textContent).toContain("report status");
    expect(empty.querySelector("button")).toBeNull();
    const settings = container.querySelector<HTMLAnchorElement>("a")!;
    expect(settings.textContent).toBe("Agent Settings");
    expect(settings.getAttribute("href")).toBe(href);
    act(() => settings.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(container.querySelector('[aria-label="Current location"]')!.textContent).toBe(href);
  });

  it("supports additive empty props without inventing a Settings target and disables absent selection", () => {
    renderNavigator();
    expect(container.querySelector("h2")!.textContent?.trim()).toBe("projects");
    expect(container.querySelectorAll("h2")[1]!.textContent?.trim()).toBe("agents");
    expect(container.querySelector("a")).toBeNull();
    const agent = makeAgentRow("server-a", "Observed terminal");
    const onSelectGroup = vi.fn();
    renderNavigator({ agentRows: [agent], onSelectGroup });
    const button = container.querySelector<HTMLButtonElement>("ul button")!;
    expect(button.matches(":disabled")).toBe(true);
    act(() => button.click());
    expect(onSelectGroup).not.toHaveBeenCalled();
    const onSelectAgent = vi.fn();
    renderNavigator({ agentRows: [agent], onSelectGroup, onSelectAgent });
    expect(button.matches(":disabled")).toBe(false);
    act(() => button.click());
    expect(onSelectAgent).toHaveBeenCalledExactlyOnceWith(agent.sessionId);
  });
  it("renders a worktree selector for configured project rows but not for free-terminal groups", () => {
    const freeGroup: TraditionalTerminalProjectGroup = {
      id: "free-terminals",
      label: "Free terminals",
      projectName: null,
      terminalTabs: [{ sessionId: "free-shell", label: "Free shell" }],
      mountedSessions: [],
    };
    renderNavigator({ groups: [group, freeGroup] });
    const comboboxes = container.querySelectorAll(
      '[role="combobox"][aria-label^="Worktree for"]',
    );
    expect(comboboxes).toHaveLength(1);
    expect(comboboxes[0]!.getAttribute("aria-label")).toContain("Worktree for demo");
    expect(
      container.querySelector('[role="combobox"][aria-label="Filter agents by status"]'),
    ).not.toBeNull();
  });

  it("interacting with worktree selector does not invoke onSelectGroup", () => {
    const onSelectGroup = vi.fn();
    renderNavigator({ groups: [group], onSelectGroup });
    const combobox = container.querySelector<HTMLButtonElement>(
      '[role="combobox"][aria-label^="Worktree for"]',
    )!;
    expect(combobox).not.toBeNull();
    act(() => combobox.click());
    expect(onSelectGroup).not.toHaveBeenCalled();
  });

  it("omits worktree selector before Git capability is established (loading / unknown)", () => {
    mocks.useProjectStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isSuccess: false,
    });
    renderNavigator({ groups: [group] });
    const comboboxes = container.querySelectorAll(
      '[role="combobox"][aria-label^="Worktree for"]',
    );
    expect(comboboxes).toHaveLength(0);
    expect(
      container.querySelector('[role="combobox"][aria-label="Filter agents by status"]'),
    ).not.toBeNull();
  });

  it("omits worktree selector for non-Git projects with statusError", () => {
    mocks.useProjectStatus.mockReturnValue({
      data: { ...mocks.status, statusError: "Not a git repository" },
      isLoading: false,
      isError: false,
      isSuccess: true,
    });
    renderNavigator({ groups: [group] });
    const comboboxes = container.querySelectorAll(
      '[role="combobox"][aria-label^="Worktree for"]',
    );
    expect(comboboxes).toHaveLength(0);
    expect(
      container.querySelector('[role="combobox"][aria-label="Filter agents by status"]'),
    ).not.toBeNull();
  });

  it("renders worktree selector when commit status is disabled but project is a valid Git repo", () => {
    mocks.useSettingsStore.mockImplementation(
      (selector: (state: SettingsState) => unknown) =>
        selector({ ...mocks.settings, terminalCommitStatusEnabled: false }),
    );
    mocks.useProjectStatus.mockReturnValue({
      data: mocks.status,
      isLoading: false,
      isError: false,
      isSuccess: true,
    });
    renderNavigator({ groups: [group] });
    const comboboxes = container.querySelectorAll(
      '[role="combobox"][aria-label^="Worktree for"]',
    );
    expect(comboboxes).toHaveLength(1);
    expect(comboboxes[0]!.getAttribute("aria-label")).toContain(
      "Worktree for demo",
    );
    expect(
      container.querySelector('[role="combobox"][aria-label="Filter agents by status"]'),
    ).not.toBeNull();
  });

  describe("Agent status filter integration", () => {
    it("renders 'All statuses' default filter outside activation fieldset, with correct placement and touch prop", () => {
      const agent1 = makeAgentRow("server-a", "First", { id: "t-1" });
      const agent2 = makeAgentRow("server-a", "Second", {
        id: "t-2",
        label: "Idle",
      });
      renderNavigator({ agentRows: [agent1, agent2], touchOptimized: true });

      const trigger = getFilterTrigger();
      expect(trigger.textContent).toContain("All statuses");
      expect(trigger.textContent).toContain("2");
      expect(trigger.className).toContain("min-h-12");

      // Located within agents section, below agents heading and outside fieldset
      const agentsSection = container.querySelectorAll("section")[1]!;
      expect(agentsSection.contains(trigger)).toBe(true);
      const agentsHeading = agentsSection.querySelector("h2")!;
      expect(agentsHeading.textContent?.trim()).toBe("agents");
      const fieldset = agentsSection.querySelector("fieldset")!;
      expect(fieldset.contains(trigger)).toBe(false);

      // Projects section unaffected
      const projectsSection = container.querySelectorAll("section")[0]!;
      expect(projectsSection.contains(trigger)).toBe(false);
    });

    const storedStatusCases: readonly (readonly [TraditionalAgentStatusFilter, string])[] = [
      ["Needs attention", "Needs attention"],
      ["Working", "Working"],
      ["Idle", "Idle"],
      ["Unknown", "Unknown"],
      ["Unavailable", "Unavailable"],
      ["Platform unqualified", "Platform unqualified"],
      ["Unsupported", "Unsupported"],
      ["all", "All statuses"],
    ];

    it.each(storedStatusCases)(
      "restores stored filter '%s' on fresh mount and immediately filters rows",
      (targetStatus, expectedLabel) => {
        const labels: readonly TraditionalAgentStatusLabel[] = [
          "Needs attention",
          "Working",
          "Idle",
          "Unknown",
          "Unavailable",
          "Platform unqualified",
          "Unsupported",
        ];
        const agentRoster = labels.map((statusLabel, idx) =>
          makeAgentRow("server-a", `Agent ${idx}`, {
            id: `t-${idx}`,
            groupId: `project-${idx}`,
            label: statusLabel,
          }),
        );

        window.localStorage.setItem(
          TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
          targetStatus,
        );
        renderNavigator({ agentRows: agentRoster });
        const trigger = getFilterTrigger();
        expect(trigger.textContent).toContain(expectedLabel);
        const buttons = getAgentButtons();
        if (targetStatus === "all") {
          expect(buttons).toHaveLength(7);
        } else {
          expect(buttons).toHaveLength(1);
          expect(buttons[0]!.getAttribute("aria-label")).toContain(targetStatus);
        }
      },
    );

    it("filters to matching rows when selecting each status without affecting projects, routes or worktrees", async () => {
      const working = makeAgentRow("server-a", "Working Agent", {
        id: "t-1",
        label: "Working",
      });
      const idle = makeAgentRow("server-a", "Idle Agent", {
        id: "t-2",
        groupId: "project-2",
        label: "Idle",
      });
      const attention = makeAgentRow("server-a", "Attention Agent", {
        id: "t-3",
        groupId: "project-3",
        label: "Needs attention",
      });
      const onSelectGroup = vi.fn();
      const settingsHref = "/agent-store?tab=settings";

      renderNavigator({
        agentRows: [working, idle, attention],
        onSelectGroup,
        agentSettingsHref: settingsHref,
      });

      expect(getAgentButtons()).toHaveLength(3);

      await selectFilterOption("Working");
      let buttons = getAgentButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0]!.getAttribute("aria-label")).toContain("Working");

      // Multi-select: toggle Idle as well -> shows both Working and Idle
      await selectFilterOption("Idle");
      buttons = getAgentButtons();
      expect(buttons).toHaveLength(2);

      // Deselect Working -> only Idle remains
      await selectFilterOption("Working");
      buttons = getAgentButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0]!.getAttribute("aria-label")).toContain("Idle");

      await selectFilterOption("all");
      expect(getAgentButtons()).toHaveLength(3);

      expect(onSelectGroup).not.toHaveBeenCalled();
      const settingsLink = container.querySelector<HTMLAnchorElement>("a")!;
      expect(settingsLink.getAttribute("href")).toBe(settingsHref);
      const locationOutput = container.querySelector(
        '[aria-label="Current location"]',
      );
      expect(locationOutput?.textContent).toBe("/terminals");
      const worktreeCombobox = container.querySelector(
        '[role="combobox"][aria-label^="Worktree for"]',
      );
      expect(worktreeCombobox).not.toBeNull();
    });

    it("aggregates counts accurately across profiles, projects, and multiple agents in groups", async () => {
      const serverA_working1 = makeAgentRow("server-a", "W1", {
        id: "t-1",
        groupId: "proj-1",
        label: "Working",
        harnessLabel: "OMP",
      });
      const serverA_working2 = makeAgentRow("server-a", "W2", {
        id: "t-2",
        groupId: "proj-1",
        label: "Working",
        harnessLabel: "OMP",
      });
      const serverB_working = makeAgentRow("server-b", "W3", {
        id: "t-3",
        groupId: "proj-2",
        label: "Working",
        harnessLabel: "Codex",
      });
      const serverC_idle = makeAgentRow("server-c", "I1", {
        id: "t-4",
        groupId: "proj-3",
        label: "Idle",
        harnessLabel: "Claude",
      });

      renderNavigator({
        agentRows: [
          serverA_working1,
          serverA_working2,
          serverB_working,
          serverC_idle,
        ],
      });

      const trigger = getFilterTrigger();
      expect(
        trigger.querySelector('[data-testid="agent-filter-count-badge"]')!
          .textContent,
      ).toBe("4");

      const { options } = await openFilterDropdown();
      const allOption = options.find((el) =>
        el.textContent?.includes("All statuses"),
      );
      const workingOption = options.find((el) =>
        el.textContent?.includes("Working"),
      );
      const idleOption = options.find((el) =>
        el.textContent?.includes("Idle"),
      );
      const attentionOption = options.find((el) =>
        el.textContent?.includes("Needs attention"),
      );

      expect(allOption?.getAttribute("aria-label")).toBe(
        "All statuses, 4 agents",
      );
      expect(workingOption?.getAttribute("aria-label")).toBe(
        "Working, 3 agents",
      );
      expect(idleOption?.getAttribute("aria-label")).toBe("Idle, 1 agent");
      expect(attentionOption?.getAttribute("aria-label")).toBe(
        "Needs attention, 0 agents",
      );

      await act(async () => {
        workingOption?.click();
      });

      expect(trigger.textContent).toContain("Working");
      expect(
        trigger.querySelector('[data-testid="agent-filter-count-badge"]')!
          .textContent,
      ).toBe("3");
    });

    it("handles attention reasons as separate groups, retains Done hint in Idle, and overrides raw wire state", async () => {
      const approval = makeAgentRow("server-a", "Appr", {
        id: "t-1",
        label: "Needs attention",
        reasonLabel: "Approval",
      });
      const question = makeAgentRow("server-a", "Quest", {
        id: "t-2",
        label: "Needs attention",
        reasonLabel: "Question",
      });
      const error = makeAgentRow("server-a", "Err", {
        id: "t-3",
        label: "Needs attention",
        reasonLabel: "Error",
      });
      const doneAgent = makeAgentRow("server-a", "Done", {
        id: "t-4",
        label: "Idle",
        outcomeHint: "Done (turn ended)",
      });
      const wireWorkingBlocked = makeAgentRow(
        "server-a",
        "Wire working blocked",
        {
          id: "t-5",
          label: "Needs attention",
          reasonLabel: "Approval",
          state: "working",
        },
      );

      renderNavigator({
        agentRows: [
          approval,
          question,
          error,
          doneAgent,
          wireWorkingBlocked,
        ],
      });

      await selectFilterOption("Needs attention");
      const attentionButtons = getAgentButtons();
      expect(attentionButtons).toHaveLength(3);
      expect(attentionButtons[0]!.getAttribute("aria-label")).toContain(
        "Approval",
      );
      expect(attentionButtons[1]!.getAttribute("aria-label")).toContain("Error");
      expect(attentionButtons[2]!.getAttribute("aria-label")).toContain(
        "Question",
      );

      await selectFilterOption("all");
      await selectFilterOption("Idle");
      const idleButtons = getAgentButtons();
      expect(idleButtons).toHaveLength(1);
      expect(idleButtons[0]!.getAttribute("aria-label")).toContain("Idle");
      expect(idleButtons[0]!.textContent).toContain("Done (turn ended)");
      await selectFilterOption("all");
      await selectFilterOption("Working");
      expect(getAgentButtons()).toHaveLength(0);
      expect(container.textContent).toContain(
        "No observed agents match Working.",
      );
    });

    it("distinguishes zero observations from filtered unmatched empty states and allows recovery", async () => {
      window.localStorage.setItem(
        TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
        "Working",
      );
      renderNavigator({ agentRows: [] });
      const fieldset = container.querySelector("fieldset")!;
      expect(fieldset.textContent).toContain(
        "No observed agents in open terminals. OMP, Codex and Claude appear after supported integrations report status.",
      );
      expect(fieldset.textContent).not.toContain(
        "No observed agents match Working.",
      );

      const idle1 = makeAgentRow("server-a", "I1", {
        id: "t-1",
        label: "Idle",
      });
      const idle2 = makeAgentRow("server-a", "I2", {
        id: "t-2",
        label: "Idle",
      });
      renderNavigator({ agentRows: [idle1, idle2] });

      expect(fieldset.textContent).toContain(
        "No observed agents match Working.",
      );
      expect(fieldset.textContent).not.toContain(
        "No observed agents in open terminals. OMP, Codex and Claude appear after supported integrations report status.",
      );

      await selectFilterOption("all");
      expect(getAgentButtons()).toHaveLength(1);
      expect(
        getAgentButtons()[0]!.querySelector(
          '[data-testid="agent-count-badge"]',
        )!.textContent,
      ).toBe("2");
    });

    it("retains selected filter across dynamic observation changes and roster emptying", async () => {
      const working = makeAgentRow("server-a", "W1", {
        id: "t-1",
        label: "Working",
      });
      const idle = makeAgentRow("server-a", "I1", {
        id: "t-2",
        label: "Idle",
      });

      renderNavigator({ agentRows: [working, idle] });
      await selectFilterOption("Working");
      expect(getFilterTrigger().textContent).toContain("Working");
      expect(getAgentButtons()).toHaveLength(1);

      const workingNowIdle = {
        ...working,
        presentation: { ...working.presentation, label: "Idle" as const },
      };
      renderNavigator({ agentRows: [workingNowIdle, idle] });
      expect(getFilterTrigger().textContent).toContain("Working");
      expect(
        getFilterTrigger().querySelector(
          '[data-testid="agent-filter-count-badge"]',
        )!.textContent,
      ).toBe("0");
      expect(container.textContent).toContain(
        "No observed agents match Working.",
      );

      renderNavigator({ agentRows: [] });
      expect(getFilterTrigger().textContent).toContain("Working");
      expect(container.textContent).toContain(
        "No observed agents in open terminals.",
      );

      const newWorking = makeAgentRow("server-a", "New Working", {
        id: "t-new",
        label: "Working",
      });
      renderNavigator({ agentRows: [newWorking] });
      expect(getFilterTrigger().textContent).toContain("Working");
      expect(getAgentButtons()).toHaveLength(1);
      expect(getAgentButtons()[0]!.getAttribute("aria-label")).toContain(
        "New Working",
      );
    });

    it("preserves active session identity when hidden by filter and restores aria-current on unfiltering", async () => {
      const working = makeAgentRow("server-a", "W1", {
        id: "t-1",
        label: "Working",
      });
      const idle = makeAgentRow("server-a", "I1", {
        id: "t-2",
        groupId: "proj-2",
        label: "Idle",
      });
      const onSelectAgent = vi.fn();
      const onSelectGroup = vi.fn();

      renderNavigator({
        agentRows: [working, idle],
        activeSessionId: idle.sessionId,
        onSelectAgent,
        onSelectGroup,
      });

      let buttons = getAgentButtons();
      expect(buttons).toHaveLength(2);
      expect(buttons[1]!.getAttribute("aria-current")).toBe("true");

      await selectFilterOption("Working");
      buttons = getAgentButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0]!.getAttribute("aria-label")).toContain("W1");
      expect(buttons[0]!.hasAttribute("aria-current")).toBe(false);
      expect(onSelectAgent).not.toHaveBeenCalled();
      expect(onSelectGroup).not.toHaveBeenCalled();

      const workingProfileB = makeAgentRow("server-b", "W1-B", {
        id: "t-1",
        label: "Working",
      });
      renderNavigator({
        agentRows: [working, idle, workingProfileB],
        activeSessionId: idle.sessionId,
        onSelectAgent,
        onSelectGroup,
      });
      // Working is already active from previous step
      expect(getAgentButtons()).toHaveLength(2);

      await selectFilterOption("all");
      buttons = getAgentButtons();
      expect(buttons).toHaveLength(3);
      const idleButton = buttons.find((btn) =>
        btn.getAttribute("aria-label")?.includes("I1"),
      );
      expect(idleButton?.getAttribute("aria-current")).toBe("true");
    });

    it("cycles only within matching members of a grouped row under controlled selection", async () => {
      const w1 = makeAgentRow("server-a", "W1", {
        id: "t-1",
        groupId: "proj-1",
        label: "Working",
      });
      const w2 = makeAgentRow("server-a", "W2", {
        id: "t-2",
        groupId: "proj-1",
        label: "Working",
      });
      const w3 = makeAgentRow("server-a", "W3", {
        id: "t-3",
        groupId: "proj-1",
        label: "Working",
      });
      const idle = makeAgentRow("server-a", "I1", {
        id: "t-4",
        groupId: "proj-1",
        label: "Idle",
      });

      const selectedSessions: string[] = [];
      function CyclingHarness() {
        const [activeSessionId, setActiveSessionId] = useState<string | null>(
          w1.sessionId,
        );
        return (
          <MemoryRouter>
            <TraditionalTerminalProjectsNavigator
              groups={[group]}
              activeGroupId={group.id}
              onSelectGroup={vi.fn()}
              agentRows={[w1, w2, w3, idle]}
              activeSessionId={activeSessionId}
              onSelectAgent={(sessionId) => {
                selectedSessions.push(sessionId);
                setActiveSessionId(sessionId);
              }}
            />
          </MemoryRouter>
        );
      }

      act(() => {
        root.render(<CyclingHarness />);
      });

      await selectFilterOption("Working");
      const buttons = getAgentButtons();
      expect(buttons).toHaveLength(1);
      expect(
        buttons[0]!.querySelector('[data-testid="agent-count-badge"]')!
          .textContent,
      ).toBe("3");

      // First click: w1 is active -> selects w2
      act(() => {
        buttons[0]!.click();
      });
      expect(selectedSessions).toEqual([w2.sessionId]);
      expect(buttons[0]!.getAttribute("aria-current")).toBe("true");

      // Second click: w2 is active -> selects w3
      act(() => {
        buttons[0]!.click();
      });
      expect(selectedSessions).toEqual([w2.sessionId, w3.sessionId]);
      expect(buttons[0]!.getAttribute("aria-current")).toBe("true");

      // Third click: w3 is active -> wraps and selects w1
      act(() => {
        buttons[0]!.click();
      });
      expect(selectedSessions).toEqual([
        w2.sessionId,
        w3.sessionId,
        w1.sessionId,
      ]);
      expect(buttons[0]!.getAttribute("aria-current")).toBe("true");

      // Filtered-out idle agent was never selected in the cycle
      expect(selectedSessions).not.toContain(idle.sessionId);
    });

    it("maintains DOM element identity for unchanged agent group row during status changes", () => {
      const stableAgent = makeAgentRow("server-a", "Stable", {
        id: "t-1",
        groupId: "proj-1",
        label: "Working",
      });
      const dynamicAgent = makeAgentRow("server-a", "Dynamic", {
        id: "t-2",
        groupId: "proj-2",
        label: "Working",
      });

      renderNavigator({ agentRows: [stableAgent, dynamicAgent] });
      const initialButtons = getAgentButtons();
      expect(initialButtons).toHaveLength(2);
      const stableButton = initialButtons[0]!;

      const updatedDynamic = {
        ...dynamicAgent,
        presentation: { ...dynamicAgent.presentation, label: "Idle" as const },
      };
      renderNavigator({ agentRows: [stableAgent, updatedDynamic] });

      const updatedButtons = getAgentButtons();
      expect(updatedButtons).toHaveLength(2);
      expect(updatedButtons[0]).toBe(stableButton);
    });

    it("keeps filter combobox enabled when onSelectAgent is omitted", async () => {
      const agent = makeAgentRow("server-a", "Agent", {
        id: "t-1",
        label: "Working",
      });
      renderNavigator({ agentRows: [agent], onSelectAgent: undefined });

      const fieldset = container.querySelector("fieldset")!;
      expect(fieldset.matches(":disabled")).toBe(true);
      const agentButton = getAgentButtons()[0]!;
      expect(agentButton.matches(":disabled")).toBe(true);

      const filterTrigger = getFilterTrigger();
      expect(filterTrigger.matches(":disabled")).toBe(false);

      await selectFilterOption("Idle");
      expect(filterTrigger.textContent).toContain("Idle");
      expect(container.textContent).toContain("No observed agents match Idle.");
    });

    it("persists selection to storage immediately and restores it across fresh root remounts", async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
      const agent = makeAgentRow("server-a", "Agent", {
        id: "t-1",
        label: "Working",
      });

      renderNavigator({ agentRows: [agent] });
      expect(setItemSpy).not.toHaveBeenCalled();

      await selectFilterOption("Working");
      expect(setItemSpy).toHaveBeenCalledWith(
        TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
        "Working",
      );
      expect(
        window.localStorage.getItem(
          TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
        ),
      ).toBe("Working");

      // Unmount root and mount fresh root reassigned to suite variables
      act(() => {
        root.unmount();
      });
      container.remove();
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      renderNavigator({ agentRows: [agent] });

      const newTrigger = getFilterTrigger();
      expect(newTrigger.textContent).toContain("Working");
      expect(getAgentButtons()).toHaveLength(1);

      // Switching back to all persists all
      await selectFilterOption("all");
      expect(setItemSpy).toHaveBeenCalledWith(
        TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
        "all",
      );
      expect(
        window.localStorage.getItem(
          TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
        ),
      ).toBe("all");
    });

    it("handles invalid stored values, storage getter/setter errors gracefully without modifying unrelated keys", async () => {
      window.localStorage.setItem("unrelated-user-pref", "keep-me");
      window.localStorage.setItem(
        TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY,
        "totally-bogus-status",
      );

      const agent = makeAgentRow("server-a", "Agent", {
        id: "t-1",
        label: "Working",
      });
      renderNavigator({ agentRows: [agent] });

      // Invalid value gracefully defaults to all
      expect(getFilterTrigger().textContent).toContain("All statuses");

      // Storage setter error: UI still updates in memory
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

      await selectFilterOption("Working");
      expect(getFilterTrigger().textContent).toContain("Working");
      expect(getAgentButtons()).toHaveLength(1);

      // Unrelated key is preserved
      expect(window.localStorage.getItem("unrelated-user-pref")).toBe("keep-me");

      // Storage getter throws (e.g. SecurityError in iframe / private browsing)
      const originalDesc = Object.getOwnPropertyDescriptor(
        window,
        "localStorage",
      );
      try {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          get() {
            throw new Error("SecurityError: localStorage access is denied");
          },
        });
        act(() => {
          root.unmount();
        });
        container.remove();
        container = document.createElement("div");
        document.body.append(container);
        root = createRoot(container);
        renderNavigator({ agentRows: [agent] });
        expect(getFilterTrigger().textContent).toContain("All statuses");
        await selectFilterOption("Working");
        expect(getFilterTrigger().textContent).toContain("Working");
        expect(getAgentButtons()).toHaveLength(1);
      } finally {
        if (originalDesc) {
          Object.defineProperty(window, "localStorage", originalDesc);
        }
      }
    });

    it("filters across multiple selected statuses, shows combined agent roster, and sums count badge", async () => {
      const working = makeAgentRow("server-a", "Working", {
        id: "t-1",
        label: "Working",
      });
      const idle = makeAgentRow("server-a", "Idle", {
        id: "t-2",
        label: "Idle",
      });
      const attention = makeAgentRow("server-a", "Attention", {
        id: "t-3",
        label: "Needs attention",
      });

      renderNavigator({ agentRows: [working, idle, attention] });
      expect(getAgentButtons()).toHaveLength(3);

      // Select Working
      await selectFilterOption("Working");
      expect(getAgentButtons()).toHaveLength(1);
      let trigger = getFilterTrigger();
      expect(trigger.textContent).toContain("Working");
      expect(trigger.querySelector('[data-testid="agent-filter-count-badge"]')!.textContent).toBe("1");

      // Select Idle -> now Working + Idle combined
      await selectFilterOption("Idle");
      expect(getAgentButtons()).toHaveLength(2);
      trigger = getFilterTrigger();
      expect(trigger.textContent).toContain("Working, Idle");
      expect(trigger.querySelector('[data-testid="agent-filter-count-badge"]')!.textContent).toBe("2");
      const agentNames = getAgentButtons().map((b) => b.textContent);
      expect(agentNames.some((t) => t?.includes("Working"))).toBe(true);
      expect(agentNames.some((t) => t?.includes("Idle"))).toBe(true);
      expect(agentNames.some((t) => t?.includes("Attention"))).toBe(false);
    });

    it("displays comma-separated labels in empty roster message when multiple statuses match zero agents", async () => {
      const attention = makeAgentRow("server-a", "Attention", {
        id: "t-1",
        label: "Needs attention",
      });
      renderNavigator({ agentRows: [attention] });

      // Multi-select Working and Idle (neither matches the attention agent)
      await selectFilterOption("Working");
      await selectFilterOption("Idle");

      expect(getAgentButtons()).toHaveLength(0);
      expect(container.textContent).toContain("No observed agents match Working, Idle.");
    });

    it("persists multi-status JSON array to storage on user selection and restores combined filter across fresh remounts", async () => {
      const working = makeAgentRow("server-a", "W", { id: "t-1", label: "Working" });
      const idle = makeAgentRow("server-a", "I", { id: "t-2", label: "Idle" });
      const attention = makeAgentRow("server-a", "A", { id: "t-3", label: "Needs attention" });

      renderNavigator({ agentRows: [working, idle, attention] });

      // User selects Working -> scalar string stored
      await selectFilterOption("Working");
      expect(
        window.localStorage.getItem(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY),
      ).toBe("Working");

      // User selects Idle -> combined JSON array stored
      await selectFilterOption("Idle");
      expect(
        window.localStorage.getItem(TRADITIONAL_TERMINAL_AGENT_FILTER_STORAGE_KEY),
      ).toBe(JSON.stringify(["Working", "Idle"]));
      expect(getAgentButtons()).toHaveLength(2);

      // Fresh remount
      act(() => root.unmount());
      root = createRoot(container);
      renderNavigator({ agentRows: [working, idle, attention] });

      const trigger = getFilterTrigger();
      expect(trigger.textContent).toContain("Working");
      expect(trigger.textContent).toContain("Idle");
      expect(
        trigger.querySelector('[data-testid="agent-filter-count-badge"]')!
          .textContent,
      ).toBe("2");
      expect(getAgentButtons()).toHaveLength(2);
    });
  });
});
