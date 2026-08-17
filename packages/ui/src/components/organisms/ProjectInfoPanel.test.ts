// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VcsRoot, Worktree } from "@/api/client.js";
import { useProjectTargetStore } from "@/stores/project-target.js";
import {
  ProjectInfoPanel,
  buildProjectInfoPushTarget,
  buildProjectInfoPushTargetWithMode,
  describeProjectInfoRoot,
  formatProjectInfoRootLabel,
  projectInfoRootOptions,
} from "./ProjectInfoPanel.js";

import { vi } from "vitest";

const worktreeQueryMock = vi.hoisted(() => {
  const refetch = vi.fn();
  let data: unknown[] = [];
  let isFetching = false;
  return {
    refetch,
    reset: () => {
      data = [];
      isFetching = false;
      refetch.mockClear();
    },
    setData: (next: unknown[]) => {
      data = next;
    },
    setFetching: (next: boolean) => {
      isFetching = next;
    },
    useWorktrees: vi.fn(() => ({
      data,
      isLoading: false,
      isFetching,
      isFetched: true,
      isError: false,
      refetch,
    })),
  };
});

function makeWorktree(path: string): Worktree {
  return {
    path,
    repositoryPath: "/tmp/demo/.git",
    branch: "feature/demo",
    commitHash: "abc123",
    isMain: false,
    isLocked: false,
    isDetached: false,
    isBare: false,
    isPrunable: false,
    isAvailable: true,
  };
}

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/api/queries.js", () => ({
  useProject: vi.fn(() => ({
    data: {
      name: "demo-project",
      type: "custom",
      status: {
        branch: "main",
        isClean: true,
      },
    },
    isLoading: false,
  })),
  useWorktrees: worktreeQueryMock.useWorktrees,
  useBranches: vi.fn(() => ({ data: [] })),
  useGitRoots: vi.fn(() => ({
    data: [
      {
        rootId: ".",
        path: ".",
        absolutePath: "/tmp/demo",
        kind: "primary",
        warnings: [],
      },
      {
        rootId: "modules/child",
        path: "modules/child",
        absolutePath: "/tmp/demo/modules/child",
        kind: "submodule",
        mappingState: "unmapped",
        warnings: [],
      },
    ],
  })),
  useGitFetch: vi.fn(() => ({ isPending: false, mutateAsync: vi.fn() })),
  useGitPull: vi.fn(() => ({ isPending: false, mutateAsync: vi.fn() })),
  useGitPush: vi.fn(() => ({ isPending: false, mutateAsync: vi.fn() })),
  useAddWorktree: vi.fn(() => ({ isPending: false, mutate: vi.fn() })),
  useRemoveWorktree: vi.fn(() => ({ isPending: false, mutate: vi.fn() })),
}));

vi.mock("@/hooks/use-git-with-ssh-retry.js", () => ({
  useGitWithSshRetry: vi.fn(() => ({
    passphraseDialogProps: {
      open: false,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      loading: false,
      error: undefined,
      availableKeys: [],
    },
    executeWithRetry: vi.fn(),
  })),
}));

describe("ProjectInfoPanel git helpers", () => {
  it("builds a default project-root push payload without an explicit root", () => {
    expect(buildProjectInfoPushTarget("demo-project", ".")).toEqual({
      project: "demo-project",
    });
  });

  it("builds a child-root push payload when a nested root is selected", () => {
    expect(buildProjectInfoPushTarget("demo-project", "modules/child")).toEqual(
      {
        project: "demo-project",
        root: "modules/child",
      },
    );
  });

  it("builds a force-push payload when the UI requests destructive push", () => {
    expect(
      buildProjectInfoPushTargetWithMode("demo-project", "modules/child", true),
    ).toEqual({
      project: "demo-project",
      root: "modules/child",
      force: true,
    });
  });

  it("provides a fallback project root option when the server reports none", () => {
    expect(projectInfoRootOptions([])).toEqual([
      {
        rootId: ".",
        path: ".",
        absolutePath: "",
        kind: "primary",
        warnings: [],
      },
    ]);
  });

  it("formats and describes VCS root labels for the selector", () => {
    const childRoot: VcsRoot = {
      rootId: "modules/child",
      path: "modules/child",
      absolutePath: "/tmp/demo/modules/child",
      kind: "submodule",
      mappingState: "unmapped",
      warnings: [],
    };

    expect(formatProjectInfoRootLabel(projectInfoRootOptions([])[0])).toBe(
      "Project root",
    );
    expect(formatProjectInfoRootLabel(childRoot)).toBe("modules/child");
    expect(describeProjectInfoRoot(childRoot)).toBe("Unmapped");
  });

  it("renders the VCS root selector when multiple roots exist", () => {
    const markup = renderToStaticMarkup(
      createElement(ProjectInfoPanel, { projectName: "demo-project" }),
    );

    expect(markup).toContain("VCS Root");
    expect(markup).toContain("Project root");
    expect(markup).toContain("modules/child");
  });

  it("refetches worktrees whenever the section is reopened", async () => {
    worktreeQueryMock.reset();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(ProjectInfoPanel, { projectName: "demo-project" }),
        );
      });

      const toggle = () =>
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Worktrees"),
        );

      await act(async () => toggle()?.click());
      await act(async () => toggle()?.click());
      await act(async () => toggle()?.click());

      expect(worktreeQueryMock.refetch).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("does not duplicate an in-flight fetch when the section opens", async () => {
    worktreeQueryMock.reset();
    worktreeQueryMock.setFetching(true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(ProjectInfoPanel, { projectName: "demo-project" }),
        );
      });
      await act(async () =>
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent?.includes("Worktrees"))
          ?.click(),
      );

      expect(worktreeQueryMock.refetch).not.toHaveBeenCalled();
    } finally {
      worktreeQueryMock.reset();
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("falls back to root for a missing target and clears the notice after recovery", async () => {
    const selectedPath = "/tmp/demo-feature";
    worktreeQueryMock.reset();
    useProjectTargetStore.getState().selectTarget("demo-project", selectedPath);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(ProjectInfoPanel, { projectName: "demo-project" }),
        );
      });
      await act(async () =>
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent?.includes("Worktrees"))
          ?.click(),
      );

      expect(container.textContent).toContain(
        "Using Project root for new operations.",
      );

      worktreeQueryMock.setData([makeWorktree(selectedPath)]);
      await act(async () => {
        root.render(
          createElement(ProjectInfoPanel, { projectName: "demo-project" }),
        );
      });

      expect(container.textContent).not.toContain(
        "Using Project root for new operations.",
      );
    } finally {
      useProjectTargetStore.getState().resetTarget("demo-project");
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
