// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Worktree } from "@/api/client.js";
import {
  recoveredTargetPaths,
  useWorktreeTargetReconciliation,
  type UseWorktreeTargetReconciliationOptions,
  type UseWorktreeTargetReconciliationResult,
} from "./use-worktree-target-reconciliation.js";
import { useProjectTargetStore } from "@/stores/project-target.js";
import { useEditorStore } from "@/stores/editor.js";

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    path: "/repos/demo/wt-1",
    repositoryPath: "/repos/demo/.git",
    branch: "feature/wt-1",
    commitHash: "1111111",
    isMain: false,
    isLocked: false,
    isDetached: false,
    isBare: false,
    isPrunable: false,
    isAvailable: true,
    ...overrides,
  };
}

function renderReconciliationHook(initialOptions: UseWorktreeTargetReconciliationOptions) {
  let latestResult!: UseWorktreeTargetReconciliationResult;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  function TestComponent({ options }: { options: UseWorktreeTargetReconciliationOptions }) {
    latestResult = useWorktreeTargetReconciliation(options);
    return null;
  }

  act(() => {
    root.render(<TestComponent options={initialOptions} />);
  });

  return {
    get result() {
      return latestResult;
    },
    rerender(nextOptions: UseWorktreeTargetReconciliationOptions) {
      act(() => {
        root.render(<TestComponent options={nextOptions} />);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("recoveredTargetPaths", () => {
  it("filters unavailable paths to those that exist and are selectable", () => {
    const worktrees = [
      makeWorktree({ path: "/repos/demo/wt-1", isAvailable: true }),
      makeWorktree({ path: "/repos/demo/wt-2", isAvailable: false }),
      makeWorktree({ path: "/repos/demo/wt-3", isPrunable: true }),
    ];
    const recovered = recoveredTargetPaths(
      "demo",
      ["/repos/demo/wt-1", "/repos/demo/wt-2", "/repos/demo/wt-3", "/repos/demo/wt-4"],
      worktrees,
    );
    expect(recovered).toEqual(["/repos/demo/wt-1"]);
  });

  it("handles empty unavailable paths or undefined worktrees", () => {
    expect(recoveredTargetPaths("demo", [], [makeWorktree()])).toEqual([]);
    expect(recoveredTargetPaths("demo", ["/path"], undefined)).toEqual([]);
  });
});

describe("useWorktreeTargetReconciliation", () => {
  const projectScope = "demo";
  const wt1 = makeWorktree({ path: "/repos/demo/wt-1" });
  const wt2 = makeWorktree({ path: "/repos/demo/wt-2" });
  let cleanupFns: Array<() => void> = [];

  beforeEach(() => {
    useProjectTargetStore.getState().resetTarget(projectScope);
    useEditorStore.setState({ tabs: [] });
    cleanupFns = [];
  });

  afterEach(() => {
    for (const fn of cleanupFns) fn();
    useProjectTargetStore.getState().resetTarget(projectScope);
  });

  it("does not mark available target as unavailable", () => {
    const harness = renderReconciliationHook({
      projectName: "demo",
      projectScope: "demo",
      worktrees: [wt1, wt2],
      selectedPath: wt1.path,
      dataUpdatedAt: 100,
      isFetched: true,
      isFetching: false,
      isError: false,
    });
    cleanupFns.push(() => harness.unmount());

    expect(harness.result.isCurrentTargetUnavailable).toBe(false);
    expect(harness.result.unavailableTargetPaths).toEqual([]);
    expect(harness.result.fallbackNotice).toBeNull();
    expect(harness.result.selectedWorktree).toEqual(wt1);
  });

  it("marks missing target as unavailable upon successful fresh discovery", () => {
    const harness = renderReconciliationHook({
      projectName: "demo",
      projectScope: "demo",
      worktrees: [wt2], // wt1 is missing
      selectedPath: wt1.path,
      dataUpdatedAt: 100,
      isFetched: true,
      isFetching: false,
      isError: false,
    });
    cleanupFns.push(() => harness.unmount());

    expect(harness.result.isCurrentTargetUnavailable).toBe(true);
    expect(harness.result.unavailableTargetPaths).toContain(wt1.path);
    expect(harness.result.fallbackNotice).toContain("is unavailable");
    expect(useProjectTargetStore.getState().unavailableTargetsByProject["demo"]).toContain(wt1.path);
  });

  it("does not mark target unavailable when discovery has an error or is fetching", () => {
    const h1 = renderReconciliationHook({
      projectName: "demo",
      projectScope: "demo",
      worktrees: [],
      selectedPath: wt1.path,
      dataUpdatedAt: 100,
      isFetched: false,
      isFetching: true,
      isError: false,
    });
    cleanupFns.push(() => h1.unmount());

    expect(useProjectTargetStore.getState().unavailableTargetsByProject["demo"]).toBeUndefined();

    const h2 = renderReconciliationHook({
      projectName: "demo",
      projectScope: "demo",
      worktrees: [],
      selectedPath: wt1.path,
      dataUpdatedAt: 100,
      isFetched: true,
      isFetching: false,
      isError: true,
    });
    cleanupFns.push(() => h2.unmount());

    expect(useProjectTargetStore.getState().unavailableTargetsByProject["demo"]).toBeUndefined();
  });

  it("recovers unavailable target when it returns on a newer dataUpdatedAt", () => {
    act(() => {
      useProjectTargetStore.getState().markTargetUnavailable(projectScope, wt1.path);
    });

    const harness = renderReconciliationHook({
      projectName: "demo",
      projectScope: "demo",
      worktrees: [],
      selectedPath: null,
      dataUpdatedAt: 100,
      isFetched: true,
      isFetching: false,
      isError: false,
    });
    cleanupFns.push(() => harness.unmount());

    expect(useProjectTargetStore.getState().unavailableTargetsByProject["demo"]).toContain(wt1.path);

    // Later discovery succeeds with wt1 present and newer dataUpdatedAt
    harness.rerender({
      projectName: "demo",
      projectScope: "demo",
      worktrees: [wt1],
      selectedPath: null,
      dataUpdatedAt: 200,
      isFetched: true,
      isFetching: false,
      isError: false,
    });

    expect(useProjectTargetStore.getState().unavailableTargetsByProject["demo"]).toBeUndefined();
  });

  it("formats fallbackNotice correctly for single and multiple unavailable targets", () => {
    act(() => {
      useProjectTargetStore.getState().markTargetUnavailable("demo", "/path/one");
    });

    const harness = renderReconciliationHook({
      projectName: "demo",
      projectScope: "demo",
      worktrees: [],
      selectedPath: null,
      dataUpdatedAt: 100,
      isFetched: true,
      isFetching: false,
      isError: false,
    });
    cleanupFns.push(() => harness.unmount());

    expect(harness.result.fallbackNotice).toBe(
      "Worktree /path/one is unavailable. Using Project root for new operations.",
    );

    act(() => {
      useProjectTargetStore.getState().markTargetUnavailable("demo", "/path/two");
    });
    harness.rerender({
      projectName: "demo",
      projectScope: "demo",
      worktrees: [],
      selectedPath: null,
      dataUpdatedAt: 100,
      isFetched: true,
      isFetching: false,
      isError: false,
    });

    expect(harness.result.fallbackNotice).toBe(
      "2 worktrees are unavailable. Using Project root for new operations.",
    );
  });

  it("isolates unavailable targets by profile-qualified scope", () => {
    const profileScope = { profileId: "profile-a", project: "demo" };
    const harness = renderReconciliationHook({
      projectName: "demo",
      projectScope: profileScope,
      worktrees: [],
      selectedPath: wt1.path,
      dataUpdatedAt: 100,
      isFetched: true,
      isFetching: false,
      isError: false,
    });
    cleanupFns.push(() => harness.unmount());

    expect(harness.result.isCurrentTargetUnavailable).toBe(true);
    expect(useProjectTargetStore.getState().unavailableTargetsByProject["demo"]).toBeUndefined();
    expect(useProjectTargetStore.getState().unavailableTargetsByProject['["profile-a","demo"]']).toContain(wt1.path);
  });
});
