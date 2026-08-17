import { afterEach, describe, expect, it } from "vitest";
import type { Worktree } from "@/api/client.js";
import {
  createProjectTargetSnapshot,
  isSelectableWorktree,
  markProjectTargetUnavailable,
  useProjectTargetStore,
  worktreeStatusLabel,
} from "./project-target.js";

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    path: "/tmp/demo-worktree",
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

function resetStore() {
  useProjectTargetStore.setState({
    activeTargetByProject: {},
    unavailableTargetByProject: {},
  });
}

describe("project target helpers", () => {
  afterEach(resetStore);

  it("uses the configured project root when no target is selected", () => {
    expect(createProjectTargetSnapshot("demo-project", null)).toEqual({
      project: "demo-project",
      target: { project: "demo-project" },
      targetKey: "root",
      label: "Project root",
      isRoot: true,
      available: true,
    });
  });

  it("derives a stable target key and label from a registered worktree", () => {
    const worktree = makeWorktree({ path: "/tmp/demo worktree" });

    expect(
      createProjectTargetSnapshot("demo-project", worktree.path, worktree),
    ).toMatchObject({
      target: { project: "demo-project", worktreePath: "/tmp/demo worktree" },
      targetKey: "worktree:/tmp/demo worktree",
      label: "feature/demo",
      isRoot: false,
      available: true,
      worktree,
    });
  });

  it("does not claim availability before discovery provides worktree metadata", () => {
    expect(
      createProjectTargetSnapshot("demo-project", "/tmp/unknown-worktree"),
    ).toMatchObject({
      targetKey: "worktree:/tmp/unknown-worktree",
      isRoot: false,
      available: false,
    });
  });

  it("keeps selections isolated per project and resets only the chosen project", () => {
    const store = useProjectTargetStore.getState();
    store.selectTarget("alpha", "/tmp/alpha");
    store.selectTarget("beta", "/tmp/beta");

    expect(useProjectTargetStore.getState().activeTargetByProject).toEqual({
      alpha: "/tmp/alpha",
      beta: "/tmp/beta",
    });

    store.resetTarget("alpha");
    expect(useProjectTargetStore.getState().activeTargetByProject).toEqual({
      beta: "/tmp/beta",
    });
  });

  it("stores no root selection so a fresh session starts at root", () => {
    const store = useProjectTargetStore.getState();
    store.selectTarget("demo-project", "/tmp/demo-worktree");
    store.selectTarget("demo-project", null);

    expect(useProjectTargetStore.getState().activeTargetByProject).toEqual({});
    expect(createProjectTargetSnapshot("demo-project", undefined).isRoot).toBe(
      true,
    );
  });

  it("resets only a matching unavailable target", () => {
    const store = useProjectTargetStore.getState();
    store.selectTarget("demo-project", "/tmp/selected");
    store.markTargetUnavailable("demo-project", "/tmp/other");
    expect(useProjectTargetStore.getState().activeTargetByProject).toEqual({
      "demo-project": "/tmp/selected",
    });

    store.markTargetUnavailable("demo-project", "/tmp/selected");
    expect(useProjectTargetStore.getState().activeTargetByProject).toEqual({});
    expect(useProjectTargetStore.getState().unavailableTargetByProject).toEqual(
      { "demo-project": "/tmp/selected" },
    );

    store.clearUnavailableTarget("demo-project");
    expect(useProjectTargetStore.getState().unavailableTargetByProject).toEqual(
      {},
    );
  });

  it("keeps unavailable identity when selection falls back to the root", () => {
    const store = useProjectTargetStore.getState();
    store.selectTarget("demo-project", "/tmp/selected");
    store.markTargetUnavailable("demo-project", "/tmp/selected");
    store.selectTarget("demo-project", null);

    expect(useProjectTargetStore.getState().activeTargetByProject).toEqual({});
    expect(useProjectTargetStore.getState().unavailableTargetByProject).toEqual(
      { "demo-project": "/tmp/selected" },
    );
  });

  it("records direct target failures without relying on the worktree panel", () => {
    useProjectTargetStore
      .getState()
      .selectTarget("demo-project", "/tmp/selected");

    markProjectTargetUnavailable({
      project: "demo-project",
      worktreePath: "/tmp/selected",
    });

    expect(useProjectTargetStore.getState().activeTargetByProject).toEqual({});
    expect(useProjectTargetStore.getState().unavailableTargetByProject).toEqual(
      { "demo-project": "/tmp/selected" },
    );
  });
});

describe("worktree availability semantics", () => {
  it.each([
    ["available", makeWorktree(), true, "Available"],
    [
      "detached and locked",
      makeWorktree({ isDetached: true, isLocked: true }),
      true,
      "Detached · Locked",
    ],
    [
      "prunable",
      makeWorktree({ isPrunable: true }),
      false,
      "Prunable — unavailable",
    ],
    [
      "bare unavailable",
      makeWorktree({ isBare: true, isAvailable: false }),
      false,
      "Bare — unavailable",
    ],
  ])("marks %s correctly", (_name, worktree, selectable, label) => {
    expect(isSelectableWorktree(worktree)).toBe(selectable);
    expect(worktreeStatusLabel(worktree)).toBe(label);
  });
});
