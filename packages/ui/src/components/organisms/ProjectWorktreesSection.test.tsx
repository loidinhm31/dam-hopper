// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Worktree } from "@/api/client.js";
import {
  createProjectTargetSnapshot,
  useProjectTargetStore,
} from "@/stores/project-target.js";
import { editorFileTabKey, useEditorStore, type Tab } from "@/stores/editor.js";
import { ProjectWorktreesSection } from "./ProjectWorktreesSection.js";

const mutationMocks = vi.hoisted(() => ({
  add: { isPending: false, mutate: vi.fn() },
  remove: {
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => undefined),
  },
}));

const worktreeMocks = vi.hoisted(() => ({
  refetch: vi.fn(),
}));

const terminalMocks = vi.hoisted(() => ({
  sessions: [] as Array<{
    id: string;
    project: string;
    command: string;
    cwd: string;
    type: "terminal";
    alive: boolean;
    startedAt: number;
  }>,
}));

const worktree: Worktree = {
  path: "/tmp/demo-feature",
  repositoryPath: "/tmp/demo",
  branch: "feature/demo",
  commitHash: "abc123",
  isMain: false,
  isLocked: false,
  isDetached: false,
  isBare: false,
  isPrunable: false,
  isAvailable: true,
};

function makeTab(project: string, path: string): Tab {
  const target = { project } as const;
  return {
    key: editorFileTabKey(target, path),
    project,
    target,
    targetKey: "root",
    targetAvailable: true,
    path,
    name: path.split("/").pop() ?? path,
    mtime: 1,
    size: 1,
    tier: "normal",
    content: "",
    savedContent: "",
    dirty: false,
    loading: false,
    saving: false,
    conflicted: false,
  };
}

vi.mock("@/api/queries.js", () => ({
  useWorktrees: vi.fn(() => ({
    data: [worktree],
    dataUpdatedAt: 1,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isError: false,
    refetch: worktreeMocks.refetch,
  })),
  useTerminalSessions: vi.fn(() => ({ data: terminalMocks.sessions })),
  useAddWorktree: vi.fn(() => mutationMocks.add),
  useRemoveWorktree: vi.fn(() => mutationMocks.remove),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderSection(targetPath: string | null = null) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(ProjectWorktreesSection, {
        projectName: "demo-project",
        projectRoot: "/tmp/demo",
        target: createProjectTargetSnapshot("demo-project", targetPath),
        isVisible: true,
      }),
    );
  });
  return { container, root };
}

describe("ProjectWorktreesSection mutation feedback", () => {
  beforeEach(() => {
    mutationMocks.add.mutate.mockClear();
    mutationMocks.remove.mutate.mockClear();
    mutationMocks.remove.mutateAsync.mockClear();
    worktreeMocks.refetch.mockReset();
    worktreeMocks.refetch.mockResolvedValue({
      data: [worktree],
      isError: false,
    });
    useProjectTargetStore.getState().resetTarget("demo-project");
    useEditorStore.setState({ tabs: [] });
    terminalMocks.sessions = [];
  });

  it("shows a visible error when removing a worktree fails", async () => {
    const { container, root } = renderSection();

    try {
      mutationMocks.remove.mutateAsync.mockRejectedValueOnce(
        new Error("remove failed"),
      );
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label^="Remove worktree"]',
          )
          ?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "remove failed",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("falls back to Project root when removal loses the target", async () => {
    useProjectTargetStore
      .getState()
      .selectTarget("demo-project", worktree.path);
    const { container, root } = renderSection(worktree.path);
    worktreeMocks.refetch.mockClear();
    worktreeMocks.refetch
      .mockResolvedValueOnce({ data: [worktree], isError: false })
      .mockResolvedValueOnce({ data: [], isError: false });

    try {
      mutationMocks.remove.mutateAsync.mockRejectedValueOnce({
        code: "WORKSPACE_TARGET_UNAVAILABLE",
        message: "target disappeared",
      });
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label^="Remove worktree"]',
          )
          ?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(mutationMocks.remove.mutateAsync).toHaveBeenCalled();
      expect(useProjectTargetStore.getState().activeTargetByProject).toEqual(
        {},
      );
      expect(
        useProjectTargetStore.getState().unavailableTargetsByProject[
          "demo-project"
        ],
      ).toEqual([worktree.path]);
      expect(worktreeMocks.refetch).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("fails closed when fresh worktree discovery fails", async () => {
    const { container, root } = renderSection();
    worktreeMocks.refetch.mockResolvedValueOnce({
      data: undefined,
      isError: true,
    });

    try {
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label^="Remove worktree"]',
          )
          ?.click();
      });

      expect(mutationMocks.remove.mutateAsync).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "discovery failed",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("shows every unavailable target and keeps reconnect on the project root", async () => {
    useProjectTargetStore.setState({
      unavailableTargetByProject: { "demo-project": "/tmp/second" },
      unavailableTargetsByProject: {
        "demo-project": ["/tmp/first", "/tmp/second"],
      },
    });
    const recoveredWorktrees = [
      worktree,
      { ...worktree, path: "/tmp/first", branch: "feature/first" },
      { ...worktree, path: "/tmp/second", branch: "feature/second" },
    ];
    worktreeMocks.refetch.mockResolvedValue({
      data: recoveredWorktrees,
      isError: false,
    });
    const { container, root } = renderSection();

    try {
      expect(container.textContent).toContain("/tmp/first");
      expect(container.textContent).toContain("/tmp/second");
      expect(container.textContent).toContain(
        "Using Project root for new operations.",
      );
      expect(
        container.querySelector(
          'button[aria-label="Reconnect unavailable worktrees"]',
        ),
      ).not.toBeNull();

      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Reconnect unavailable worktrees"]',
          )
          ?.click(),
      );

      expect(useProjectTargetStore.getState().activeTargetByProject).toEqual(
        {},
      );
      expect(
        useProjectTargetStore.getState().unavailableTargetsByProject,
      ).toEqual({});
      expect(
        container.querySelector<HTMLInputElement>('input[value="root"]')
          ?.checked,
      ).toBe(true);
      expect(container.textContent).not.toContain(
        "Using Project root for new operations.",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("keeps unavailable targets when reconnect discovery fails", async () => {
    useProjectTargetStore.setState({
      unavailableTargetByProject: { "demo-project": "/tmp/missing" },
      unavailableTargetsByProject: { "demo-project": ["/tmp/missing"] },
    });
    const { container, root } = renderSection();
    worktreeMocks.refetch.mockReset();
    worktreeMocks.refetch.mockResolvedValueOnce({
      data: undefined,
      isError: true,
    });

    try {
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Reconnect unavailable worktrees"]',
          )
          ?.click(),
      );

      expect(
        useProjectTargetStore.getState().unavailableTargetsByProject[
          "demo-project"
        ],
      ).toEqual(["/tmp/missing"]);
      expect(container.textContent).toContain(
        "Using Project root for new operations.",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("blocks removal when the exact target has unsaved editor work", async () => {
    const target = {
      project: "demo-project",
      worktreePath: worktree.path,
    } as const;
    const dirtyTab = {
      ...makeTab("demo-project", "src/dirty.ts"),
      key: editorFileTabKey(target, "src/dirty.ts"),
      target,
      targetKey: "worktree:/tmp/demo-feature",
      dirty: true,
    };
    useEditorStore.setState({ tabs: [dirtyTab] });
    const { container, root } = renderSection();

    try {
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label^="Remove worktree"]',
          )
          ?.click();
      });

      expect(mutationMocks.remove.mutateAsync).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "1 dirty editor tab",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("blocks removal when the exact target has a live terminal", async () => {
    terminalMocks.sessions = [
      {
        id: "terminal:demo-project:1",
        project: "demo-project",
        command: "pnpm dev",
        cwd: "/tmp/demo-feature/src",
        type: "terminal",
        alive: true,
        startedAt: 1,
      },
    ];
    const { container, root } = renderSection();

    try {
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label^="Remove worktree"]',
          )
          ?.click();
      });

      expect(mutationMocks.remove.mutateAsync).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "1 live terminal session",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("shows a visible error when adding a worktree fails", async () => {
    const { container, root } = renderSection();

    try {
      await act(async () => {
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent?.includes("Add Worktree"))
          ?.click();
      });
      const pathInput =
        container.querySelector<HTMLInputElement>("#worktree-path");
      const branchInput =
        container.querySelector<HTMLInputElement>("#worktree-branch");
      expect(pathInput).not.toBeNull();
      expect(branchInput).not.toBeNull();

      await act(async () => {
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!;
        setValue.call(pathInput!, "/tmp/new-feature");
        pathInput!.dispatchEvent(new Event("input", { bubbles: true }));
        setValue.call(branchInput!, "feature/new");
        branchInput!.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () =>
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent === "Add")
          ?.click(),
      );

      expect(mutationMocks.add.mutate).toHaveBeenCalledTimes(1);
      const options = mutationMocks.add.mutate.mock.calls[0]?.[1] as {
        onError: (error: unknown) => void;
      };
      await act(async () => options.onError(new Error("add failed")));

      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "add failed",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
