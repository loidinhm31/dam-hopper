import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Worktree } from "@/api/client.js";
import { createProjectTargetSnapshot } from "@/stores/project-target.js";
import { ProjectTargetSelector } from "./ProjectTargetSelector.js";

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
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
    ...overrides,
  };
}

function renderSelector(worktrees: Worktree[]) {
  return renderToStaticMarkup(
    createElement(ProjectTargetSelector, {
      projectRoot: "/tmp/demo",
      target: createProjectTargetSnapshot("demo-project", null),
      worktrees,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isError: false,
      fallbackNotice: null,
      removePendingPath: null,
      onSelect: vi.fn(),
      onRefresh: vi.fn(),
      onRemove: vi.fn(),
    }),
  );
}

describe("ProjectTargetSelector", () => {
  it("renders root first and excludes the duplicate main worktree", () => {
    const markup = renderSelector([
      makeWorktree({ path: "/tmp/demo", isMain: true, branch: "main" }),
      makeWorktree(),
    ]);

    expect(markup.indexOf("Project root")).toBeLessThan(
      markup.indexOf("feature/demo"),
    );
    expect(markup).toContain('value="root"');
    expect(markup).toContain('value="/tmp/demo-feature"');
    expect(markup).not.toContain('value="/tmp/demo"');
    expect(markup).toContain('aria-label="Refresh worktrees"');
  });

  it("keeps unavailable worktrees informative but disabled", () => {
    const markup = renderSelector([
      makeWorktree({ isAvailable: false, isBare: true }),
      makeWorktree({ path: "/tmp/prunable", isPrunable: true }),
    ]);

    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).toContain("Bare — unavailable");
    expect(markup).toContain("Prunable — unavailable");
    expect(markup).toContain("aria-describedby=");
  });

  it("renders loading, error, and fallback status as live feedback", () => {
    const markup = renderToStaticMarkup(
      createElement(ProjectTargetSelector, {
        projectRoot: "/tmp/demo",
        target: createProjectTargetSnapshot("demo-project", "/tmp/missing"),
        worktrees: [],
        isLoading: true,
        isFetching: true,
        isFetched: true,
        isError: true,
        fallbackNotice:
          "Worktree feature/demo is unavailable. Using Project root for new operations.",
        removePendingPath: null,
        onSelect: vi.fn(),
        onRefresh: vi.fn(),
        onRemove: vi.fn(),
      }),
    );

    expect(markup).toContain("Discovering worktrees");
    expect(markup).toContain("Worktree discovery failed");
    expect(markup).toContain("Using Project root for new operations");
    expect(markup).toContain('role="status"');
  });

  it("lists every unavailable target in the accessible fallback status", () => {
    const markup = renderToStaticMarkup(
      createElement(ProjectTargetSelector, {
        projectRoot: "/tmp/demo",
        target: createProjectTargetSnapshot("demo-project", null),
        worktrees: [],
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isError: false,
        fallbackNotice:
          "2 worktrees are unavailable. Using Project root for new operations.",
        fallbackTargetPaths: ["/tmp/first", "/tmp/second"],
        removePendingPath: null,
        onSelect: vi.fn(),
        onRefresh: vi.fn(),
        onRemove: vi.fn(),
      }),
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Unavailable worktree paths"');
    expect(markup).toContain("/tmp/first");
    expect(markup).toContain("/tmp/second");
    expect(markup).toContain("Using Project root for new operations");
  });

  it("disables a stale row while its unavailable target is being refreshed", () => {
    const markup = renderToStaticMarkup(
      createElement(ProjectTargetSelector, {
        projectRoot: "/tmp/demo",
        target: createProjectTargetSnapshot("demo-project", null),
        worktrees: [makeWorktree()],
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isError: false,
        fallbackNotice: "The selected worktree is unavailable.",
        fallbackTargetPaths: ["/tmp/demo-feature"],
        removePendingPath: null,
        onSelect: vi.fn(),
        onRefresh: vi.fn(),
        onRemove: vi.fn(),
      }),
    );

    expect(markup).toContain('value="/tmp/demo-feature"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("Unavailable until worktree refresh");
  });
});
