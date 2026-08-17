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
});
