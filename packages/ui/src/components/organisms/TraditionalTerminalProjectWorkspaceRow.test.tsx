// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectTargetStore } from "@/stores/project-target.js";
import type { GitStatus, Worktree } from "@/api/client.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import { TraditionalTerminalProjectWorkspaceRow } from "./TraditionalTerminalProjectWorkspaceRow.js";

const mocks = vi.hoisted(() => {
  const status: GitStatus = {
    projectName: "demo",
    branch: "main",
    isClean: true,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    hasStash: false,
    lastCommit: {
      hash: "1234567890abcdef",
      message: "Test commit message",
      date: "2026-11-06T00:00:00.000Z",
    },
  };
  const worktree: Worktree = {
    path: "/workspace/demo",
    repositoryPath: "/workspace/demo/.git",
    branch: "main",
    commitHash: "1234567890abcdef",
    isMain: true,
    isLocked: false,
    isDetached: false,
    isBare: false,
    isPrunable: false,
    isAvailable: true,
  };
  return {
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
  };
});

vi.mock("@/api/queries.js", () => ({
  useProjectStatus: mocks.useProjectStatus,
  useWorktrees: mocks.useWorktrees,
}));

vi.mock("@/components/organisms/TraditionalProjectWorkspaceTree.js", () => ({
  TraditionalProjectWorkspaceTree: ({ regionId }: { regionId: string }) => (
    <div data-testid="mock-workspace-tree" id={regionId}>
      Tree Content
    </div>
  ),
}));

describe("TraditionalTerminalProjectWorkspaceRow", () => {
  let container: HTMLDivElement;
  let root: Root;

  const baseGroup: TraditionalTerminalProjectGroup = {
    id: "project:demo",
    projectName: "demo",
    label: "demo",
    terminalTabs: [{ sessionId: "demo:1", label: "demo:1" }],
    mountedSessions: [{ sessionId: "demo:1", project: "demo", command: "bash" }],
  };

  const zeroTerminalGroup: TraditionalTerminalProjectGroup = {
    id: "project:zero",
    projectName: "zero",
    label: "zero",
    terminalTabs: [],
    mountedSessions: [],
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders sibling controls with NO interactive descendants inside role='tab'", async () => {
    await act(async () => {
      root.render(
        <TraditionalTerminalProjectWorkspaceRow
          group={baseGroup}
          index={0}
          isActive={true}
          activeGroupId={baseGroup.id}
          onSelectGroup={vi.fn()}
          onKeyDown={vi.fn()}
          setButtonRef={vi.fn()}
          showCommitStatus={true}
          onToggleDisclosure={vi.fn()}
          onNewTerminalInGroup={vi.fn()}
          onCloseWorkspace={vi.fn()}
        />,
      );
    });

    const tab = container.querySelector<HTMLButtonElement>('[role="tab"]')!;
    expect(tab).not.toBeNull();
    // Verify no interactive elements (button, a, input, select, textarea) are nested inside the tab
    const interactiveInsideTab = tab.querySelectorAll("button, a, input, select, textarea, [tabindex='0']");
    expect(interactiveInsideTab.length).toBe(0);

    // Verify tab and new-terminal buttons are direct siblings in header
    const header = tab.parentElement!;
    const newTerminalBtn = header.querySelector('button[aria-label="New terminal in demo"]')!;

    expect(newTerminalBtn).not.toBeNull();
    expect(tab.parentElement).toBe(header);
    expect(newTerminalBtn.parentElement).toBe(header);
  });

  it("does not render disclosure chevron button on project row", async () => {
    await act(async () => {
      root.render(
        <TraditionalTerminalProjectWorkspaceRow
          group={baseGroup}
          index={0}
          isActive={false}
          activeGroupId="other"
          onSelectGroup={vi.fn()}
          onKeyDown={vi.fn()}
          setButtonRef={vi.fn()}
          showCommitStatus={true}
        />,
      );
    });
    expect(container.querySelector('button[aria-label*="files"]')).toBeNull();
  });

  it("renders [×] button only for zero-terminal groups when onCloseWorkspace is provided", async () => {
    const onCloseWorkspace = vi.fn();

    // Group with 1 terminal: no close button
    await act(async () => {
      root.render(
        <TraditionalTerminalProjectWorkspaceRow
          group={baseGroup}
          index={0}
          isActive={false}
          activeGroupId={null}
          onSelectGroup={vi.fn()}
          onKeyDown={vi.fn()}
          setButtonRef={vi.fn()}
          showCommitStatus={true}
          onCloseWorkspace={onCloseWorkspace}
        />,
      );
    });
    expect(container.querySelector('button[aria-label^="Close"]')).toBeNull();

    // Zero-terminal group: close button rendered
    await act(async () => {
      root.render(
        <TraditionalTerminalProjectWorkspaceRow
          group={zeroTerminalGroup}
          index={0}
          isActive={false}
          activeGroupId={null}
          onSelectGroup={vi.fn()}
          onKeyDown={vi.fn()}
          setButtonRef={vi.fn()}
          showCommitStatus={true}
          onCloseWorkspace={onCloseWorkspace}
        />,
      );
    });

    const closeBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close zero workspace"]',
    )!;
    expect(closeBtn).not.toBeNull();

    act(() => closeBtn.click());
    expect(onCloseWorkspace).toHaveBeenCalledWith(zeroTerminalGroup.id);
  });

  it("displays muted ○ indicator and 0 terminal count for zero-terminal groups", async () => {
    await act(async () => {
      root.render(
        <TraditionalTerminalProjectWorkspaceRow
          group={zeroTerminalGroup}
          index={0}
          isActive={false}
          activeGroupId={null}
          onSelectGroup={vi.fn()}
          onKeyDown={vi.fn()}
          setButtonRef={vi.fn()}
          showCommitStatus={true}
        />,
      );
    });

    const tab = container.querySelector('[role="tab"]')!;
    expect(tab.textContent).toContain("○");
    expect(tab.textContent).toContain("0");
  });

  it("renders compact worktree bar with 7-char commit chip when active or disclosed", async () => {
    await act(async () => {
      root.render(
        <TraditionalTerminalProjectWorkspaceRow
          group={baseGroup}
          index={0}
          isActive={true}
          activeGroupId={baseGroup.id}
          onSelectGroup={vi.fn()}
          onKeyDown={vi.fn()}
          setButtonRef={vi.fn()}
          showCommitStatus={true}
        />,
      );
    });

    // TraditionalTerminalWorktreeSelect combobox
    expect(container.querySelector('[role="combobox"]')).not.toBeNull();
    // 7-char commit chip from 1234567890abcdef -> 1234567
    const chip = container.querySelector('[aria-label^="Commit 1234567"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("1234567");
  });

  it("does not mount inline TraditionalProjectWorkspaceTree (relocated to right sidebar)", async () => {
    await act(async () => {
      root.render(
        <TraditionalTerminalProjectWorkspaceRow
          group={baseGroup}
          index={0}
          isActive={false}
          activeGroupId={null}
          onSelectGroup={vi.fn()}
          onKeyDown={vi.fn()}
          setButtonRef={vi.fn()}
          showCommitStatus={true}
          isDisclosed={true}
        />,
      );
    });
    expect(container.querySelector('[data-testid="mock-workspace-tree"]')).toBeNull();
  });

  it("fails closed: hides commit chip when selected worktree is missing or worktree query fails", async () => {
    // Select non-existent worktree path
    useProjectTargetStore.getState().selectTarget("demo", "/workspace/demo/missing-wt");

    await act(async () => {
      root.render(
        <TraditionalTerminalProjectWorkspaceRow
          group={baseGroup}
          index={0}
          isActive={true}
          activeGroupId={baseGroup.id}
          onSelectGroup={vi.fn()}
          onKeyDown={vi.fn()}
          setButtonRef={vi.fn()}
          showCommitStatus={true}
        />,
      );
    });

    // Worktree select stays available for recovery
    expect(container.querySelector('[role="combobox"]')).not.toBeNull();
    // Commit chip is NOT rendered because worktree is not matched
    expect(container.querySelector('[aria-label^="Commit"]')).toBeNull();

    useProjectTargetStore.getState().resetTarget("demo");

    // Worktrees query returns error
    mocks.useWorktrees.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    await act(async () => {
      root.render(
        <TraditionalTerminalProjectWorkspaceRow
          group={baseGroup}
          index={0}
          isActive={true}
          activeGroupId={baseGroup.id}
          onSelectGroup={vi.fn()}
          onKeyDown={vi.fn()}
          setButtonRef={vi.fn()}
          showCommitStatus={true}
        />,
      );
    });

    expect(container.querySelector('[aria-label^="Commit"]')).toBeNull();
  });

  it("preserves worktree selector for recovery even when selected target has statusError", async () => {
    mocks.useProjectStatus.mockImplementation((targetInput: unknown) => {
      if (
        targetInput &&
        typeof targetInput === "object" &&
        "worktreePath" in targetInput &&
        typeof targetInput.worktreePath === "string" &&
        targetInput.worktreePath.length > 0
      ) {
        return {
          data: { ...mocks.status, statusError: "Target worktree missing" },
          isLoading: false,
          isError: false,
        };
      }
      return {
        data: mocks.status, // base project git status is valid
        isLoading: false,
        isError: false,
      };
    });

    useProjectTargetStore.getState().selectTarget("demo", "/workspace/demo/error-wt");
    mocks.useWorktrees.mockReturnValue({
      data: [{ ...mocks.worktree, path: "/workspace/demo/error-wt" }],
      isLoading: false,
      isError: false,
    });

    await act(async () => {
      root.render(
        <TraditionalTerminalProjectWorkspaceRow
          group={baseGroup}
          index={0}
          isActive={true}
          activeGroupId={baseGroup.id}
          onSelectGroup={vi.fn()}
          onKeyDown={vi.fn()}
          setButtonRef={vi.fn()}
          showCommitStatus={true}
        />,
      );
    });

    // Worktree selector is still rendered so user can recover
    expect(container.querySelector('[role="combobox"]')).not.toBeNull();
    // Commit chip is not rendered due to statusError
    expect(container.querySelector('[aria-label^="Commit"]')).toBeNull();

    useProjectTargetStore.getState().resetTarget("demo");
    mocks.useProjectStatus.mockImplementation(() => ({
      data: mocks.status,
      isLoading: false,
      isError: false,
    }));
  });

});
