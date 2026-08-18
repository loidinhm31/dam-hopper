import { afterEach, describe, expect, it } from "vitest";
import type { Worktree } from "@/api/client.js";
import {
  createProjectTargetSnapshot,
  isSelectableWorktree,
  markProjectTargetUnavailable,
  normalizeWorktreePath,
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
    unavailableTargetsByProject: {},
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

  it("normalizes aliases while keeping UNC and POSIX namespaces distinct", () => {
    expect(normalizeWorktreePath("/tmp/demo/./feature/../feature")).toBe(
      "/tmp/demo/feature",
    );
    expect(normalizeWorktreePath(String.raw`\\server\share\feature`)).toBe(
      "//server/share/feature",
    );
    expect(normalizeWorktreePath("/server/share/feature")).toBe(
      "/server/share/feature",
    );
    expect(
      normalizeWorktreePath(String.raw`C:\Worktrees\Feature`) ===
        normalizeWorktreePath("c:/worktrees/feature"),
    ).toBe(true);
    expect(
      normalizeWorktreePath(String.raw`\\?\UNC\server\share\feature`),
    ).toBe("//server/share/feature");
    expect(
      normalizeWorktreePath(String.raw`\\?\C:\Worktrees\Feature`),
    ).toBe("c:/worktrees/feature");
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
    expect(
      useProjectTargetStore.getState().unavailableTargetsByProject,
    ).toEqual({ "demo-project": ["/tmp/other", "/tmp/selected"] });

    store.clearUnavailableTarget("demo-project");
    expect(useProjectTargetStore.getState().unavailableTargetByProject).toEqual(
      {},
    );
    expect(
      useProjectTargetStore.getState().unavailableTargetsByProject,
    ).toEqual({});
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

  it("reconciles unavailable aliases by normalized target identity", () => {
    const store = useProjectTargetStore.getState();
    store.markTargetUnavailable("demo-project", "/tmp/demo/feature/../feature");
    store.markTargetUnavailable("demo-project", "/tmp/demo/./feature");

    expect(
      useProjectTargetStore.getState().unavailableTargetsByProject,
    ).toEqual({ "demo-project": ["/tmp/demo/feature/../feature"] });

    store.clearUnavailableTarget("demo-project", "/tmp/demo/feature");
    expect(
      useProjectTargetStore.getState().unavailableTargetsByProject,
    ).toEqual({});
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

  it("retains multiple unavailable targets for orphan reconciliation", () => {
    const store = useProjectTargetStore.getState();
    store.markTargetUnavailable("demo-project", "/tmp/first");
    store.markTargetUnavailable("demo-project", "/tmp/second");

    expect(
      useProjectTargetStore.getState().unavailableTargetsByProject,
    ).toEqual({ "demo-project": ["/tmp/first", "/tmp/second"] });

    store.clearUnavailableTarget("demo-project", "/tmp/first");
    expect(
      useProjectTargetStore.getState().unavailableTargetsByProject,
    ).toEqual({ "demo-project": ["/tmp/second"] });
    expect(useProjectTargetStore.getState().unavailableTargetByProject).toEqual(
      { "demo-project": "/tmp/second" },
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
