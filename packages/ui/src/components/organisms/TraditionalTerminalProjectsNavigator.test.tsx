// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStatus, Worktree } from "@/api/client.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";

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
    })),
    useWorktrees: vi.fn(() => ({
      data: [worktree],
      isLoading: false,
      isError: false,
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
  hasRunningTerminal: true,
};

describe("TraditionalTerminalProjectsNavigator", () => {
  beforeEach(() => {
    mocks.settings.terminalCommitStatusEnabled = true;
    mocks.useProjectStatus.mockClear();
    mocks.useWorktrees.mockClear();
  });

  it("shows project Git metadata and the selected-project terminal action", () => {
    const onNewTerminal = vi.fn();
    const markup = renderToStaticMarkup(
      <TraditionalTerminalProjectsNavigator
        groups={[group]}
        activeGroupId={group.id}
        onSelectGroup={() => {}}
        onNewTerminal={onNewTerminal}
        width={300}
      />,
    );
    const wrapper = document.createElement("div");
    wrapper.innerHTML = markup;
    const metadata = wrapper.querySelector('[role="status"]');
    expect(metadata?.children[0]?.querySelector("svg")).not.toBeNull();
    expect(metadata?.children[1]?.querySelector("svg")).not.toBeNull();
    expect(metadata?.children[2]?.querySelector("svg")).not.toBeNull();
    expect(metadata?.children[0]?.textContent).toContain("feature/demo");
    expect(metadata?.children[1]?.textContent).toContain("/workspace/demo");
    expect(metadata?.children[2]?.textContent).toContain(
      "Ship the demo terminal workflow",
    );
    expect(metadata?.children[0]?.textContent).not.toContain("branch");
    expect(metadata?.children[1]?.textContent).not.toContain("worktree");
    expect(metadata?.children[2]?.textContent).not.toContain("commit");
    expect(metadata?.children[0]?.className).toContain(
      "text-[var(--color-info)]",
    );
    expect(metadata?.children[1]?.className).toContain(
      "text-[var(--color-text-muted)]",
    );
    expect(metadata?.children[2]?.className).toContain(
      "text-[var(--color-primary)]",
    );
    expect(metadata?.children[2]?.querySelector(".break-words")).not.toBeNull();

    expect(markup).toContain("feature/demo");
    expect(markup).toContain("Ship the demo terminal workflow");
    expect(markup).toContain('aria-label="New terminal in selected project"');
    expect(markup).toContain('style="width:300px"');
    expect(mocks.useProjectStatus).toHaveBeenCalledWith("demo", true);
    expect(mocks.useWorktrees).toHaveBeenCalledWith("demo");
  });

  it("shows the worktree matching the project branch", () => {
    mocks.useWorktrees.mockReturnValue({
      data: [
        { ...mocks.worktree, path: "/workspace/main", branch: "main" },
        { ...mocks.worktree, path: "/workspace/feature" },
      ],
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

    expect(markup).toContain("/workspace/feature");
    expect(markup).not.toContain("/workspace/main");
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

  it("does not query or render metadata when the preference is disabled", () => {
    mocks.settings.terminalCommitStatusEnabled = false;
    const markup = renderToStaticMarkup(
      <TraditionalTerminalProjectsNavigator
        groups={[group]}
        activeGroupId={group.id}
        onSelectGroup={() => {}}
      />,
    );

    expect(markup).not.toContain("feature/demo");
    expect(mocks.useProjectStatus).not.toHaveBeenCalled();
    expect(mocks.useWorktrees).not.toHaveBeenCalled();
  });
});
