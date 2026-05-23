import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VcsRoot } from "@/api/client.js";
import {
  ProjectInfoPanel,
  buildProjectInfoPushTarget,
  buildProjectInfoPushTargetWithMode,
  describeProjectInfoRoot,
  formatProjectInfoRootLabel,
  projectInfoRootOptions,
} from "./ProjectInfoPanel.js";

import { vi } from "vitest";

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
  useWorktrees: vi.fn(() => ({ data: [] })),
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
    expect(
      buildProjectInfoPushTarget("demo-project", "modules/child"),
    ).toEqual({
      project: "demo-project",
      root: "modules/child",
    });
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
});
