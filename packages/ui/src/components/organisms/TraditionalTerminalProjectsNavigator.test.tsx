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
import { traditionalTerminalProjectPanelId, traditionalTerminalProjectTabId } from "@/lib/traditional-terminal-projects.js";

type SettingsState = { terminalCommitStatusEnabled: boolean };

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

function makeAgentRow(profileId: string, title: string): RowModel {
  const terminalRef = { profileId, id: "terminal-1" };
  return {
    key: terminalInstanceKey({ ...terminalRef, incarnation: 1 }),
    sessionId: terminalKey(terminalRef),
    terminalRef,
    incarnation: 1,
    groupId: `project-${profileId}`,
    projectLabel: "demo",
    profileLabel: profileId === "server-a" ? "Development" : "Production",
    terminalTitle: title,
    harnessLabel: "OMP",
    statusOwner: { profileId, generation: 2 },
    availability: "ready",
    status: {
      id: terminalRef.id, incarnation: 1, agentKind: "omp",
      agentSessionId: "private-agent-session", reporterEpoch: 1,
      state: "working", source: "lifecycle", attentionRevision: 0,
    },
    presentation: {
      label: "Working", reasonLabel: null, outcomeHint: null,
      sourceLabel: "Lifecycle observation", coverageHint: null,
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
  beforeEach(() => {
    useProjectTargetStore.getState().resetTarget("demo");
    mocks.settings.terminalCommitStatusEnabled = true;
    mocks.useProjectStatus.mockClear();
    mocks.useWorktrees.mockClear();
    mocks.useProjectStatus.mockReturnValue({ data: mocks.status, isLoading: false, isError: false });
    mocks.useWorktrees.mockReturnValue({ data: [mocks.worktree], isLoading: false, isError: false });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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
    const combobox = container.querySelector('[role="combobox"]');
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
    expect(markup).toContain('role="combobox"');
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

  it("retains supplied input order and keyboard focus through status-only updates", () => {
    const first = makeAgentRow("server-a", "First");
    const second = makeAgentRow("server-b", "Second");
    const onSelectAgent = vi.fn();
    renderNavigator({ agentRows: [first, second], onSelectAgent });
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("ul button"));
    buttons[1]!.focus();
    renderNavigator({ agentRows: [
      { ...first, presentation: { ...first.presentation, label: "Needs attention", reasonLabel: "Approval" } },
      { ...second, presentation: { ...second.presentation, label: "Idle", outcomeHint: "Done (turn ended)" } },
    ], onSelectAgent });
    expect(Array.from(container.querySelectorAll("ul button"))).toEqual(buttons);
    expect(buttons[0]!.getAttribute("aria-label")).toContain("First");
    expect(buttons[0]!.getAttribute("aria-label")).toContain("Needs attention");
    expect(buttons[1]!.getAttribute("aria-label")).toContain("Second");
    expect(buttons[1]!.getAttribute("aria-label")).toContain("Idle");
    expect(document.activeElement).toBe(buttons[1]);
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
    const comboboxes = container.querySelectorAll('[role="combobox"]');
    expect(comboboxes).toHaveLength(1);
    expect(comboboxes[0]!.getAttribute("aria-label")).toContain("Worktree for demo");
  });

  it("interacting with worktree selector does not invoke onSelectGroup", () => {
    const onSelectGroup = vi.fn();
    renderNavigator({ groups: [group], onSelectGroup });
    const combobox = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
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
    const comboboxes = container.querySelectorAll('[role="combobox"]');
    expect(comboboxes).toHaveLength(0);
  });

  it("omits worktree selector for non-Git projects with statusError", () => {
    mocks.useProjectStatus.mockReturnValue({
      data: { ...mocks.status, statusError: "Not a git repository" },
      isLoading: false,
      isError: false,
      isSuccess: true,
    });
    renderNavigator({ groups: [group] });
    const comboboxes = container.querySelectorAll('[role="combobox"]');
    expect(comboboxes).toHaveLength(0);
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
    const comboboxes = container.querySelectorAll('[role="combobox"]');
    expect(comboboxes).toHaveLength(1);
    expect(comboboxes[0]!.getAttribute("aria-label")).toContain(
      "Worktree for demo",
    );
  });
});
