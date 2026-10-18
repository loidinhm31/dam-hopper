// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Worktree } from "@/api/client.js";
import {
  isLegacyResourceKey,
  performFreshStateReset,
} from "@/lib/fresh-state-reset.js";
import {
  PROJECT_TARGET_STORAGE_KEY,
  createProjectTargetSnapshot,
  initProjectTargetStorageSync,
  isSelectableWorktree,
  markProjectTargetUnavailable,
  mergeTargetMapChanges,
  normalizeWorktreePath,
  projectScopeKey,
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
    activeTargetByProject: Object.create(null),
    unavailableTargetByProject: {},
    unavailableTargetsByProject: {},
  });
  try {
    window.localStorage.removeItem(PROJECT_TARGET_STORAGE_KEY);
  } catch {
    // ignore storage access errors in cleanup
  }
}

describe("project target helpers", () => {
  beforeEach(resetStore);
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
    expect(normalizeWorktreePath(String.raw`\\?\C:\Worktrees\Feature`)).toBe(
      "c:/worktrees/feature",
    );
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

  it("stores no root selection so root represents absence", () => {
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

describe("project target store persistence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetStore();
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
  });

  it("persists active selections and restores them across store recreation and rehydration", async () => {
    const store = useProjectTargetStore;
    const qualifiedOwner = { profileId: "server-a", project: "demo" };
    const qualifiedKey = projectScopeKey(qualifiedOwner);

    store.getState().selectTarget("alpha", "/worktrees/feature-alpha");
    store.getState().selectTarget(qualifiedOwner, "/worktrees/feature-demo");

    // Inspect actual serialized envelope in localStorage
    const raw = window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toEqual({
      state: {
        activeTargetByProject: {
          alpha: "/worktrees/feature-alpha",
          [qualifiedKey]: "/worktrees/feature-demo",
        },
      },
      version: 1,
    });
    expect(Object.keys(parsed.state)).toEqual(["activeTargetByProject"]);

    // Exception to ts-no-dynamic-import: test case intentionally exercises module loading boundary and fresh singleton initialization
    vi.resetModules();
    const freshModule = await import("./project-target.js");
    const freshStore = freshModule.useProjectTargetStore;
    expect(
      Object.getPrototypeOf(freshStore.getState().activeTargetByProject),
    ).toBeNull();
    expect(freshStore.getState().activeTargetByProject["alpha"]).toBe(
      "/worktrees/feature-alpha",
    );
    expect(freshStore.getState().activeTargetByProject[qualifiedKey]).toBe(
      "/worktrees/feature-demo",
    );

    // Also test explicit rehydration
    const capturedBytes = window.localStorage.getItem(
      PROJECT_TARGET_STORAGE_KEY,
    )!;
    freshStore.setState({
      activeTargetByProject: Object.create(null),
      unavailableTargetByProject: {},
      unavailableTargetsByProject: {},
    });
    window.localStorage.setItem(PROJECT_TARGET_STORAGE_KEY, capturedBytes);
    await freshStore.persist.rehydrate();
    expect(freshStore.getState().activeTargetByProject["alpha"]).toBe(
      "/worktrees/feature-alpha",
    );
    expect(freshStore.getState().activeTargetByProject[qualifiedKey]).toBe(
      "/worktrees/feature-demo",
    );
  });

  it("preserves root selection and resetTarget as absence across recreation", async () => {
    const store = useProjectTargetStore;
    const ownerA = "proj-a";
    const ownerB = "proj-b";

    store.getState().selectTarget(ownerA, "/worktrees/a");
    store.getState().selectTarget(ownerB, "/worktrees/b");
    store.getState().selectTarget(ownerA, null); // Select root for A

    expect(store.getState().activeTargetByProject[ownerA]).toBeUndefined();
    expect(store.getState().activeTargetByProject[ownerB]).toBe("/worktrees/b");

    // Exception to ts-no-dynamic-import: test case intentionally exercises module loading boundary and fresh singleton initialization
    vi.resetModules();
    let freshModule = await import("./project-target.js");
    expect(
      freshModule.useProjectTargetStore.getState().activeTargetByProject[ownerA],
    ).toBeUndefined();
    expect(
      freshModule.useProjectTargetStore.getState().activeTargetByProject[ownerB],
    ).toBe("/worktrees/b");

    // Select again, then use resetTarget
    freshModule.useProjectTargetStore
      .getState()
      .selectTarget(ownerA, "/worktrees/a2");
    freshModule.useProjectTargetStore.getState().resetTarget(ownerA);

    // Exception to ts-no-dynamic-import: test case intentionally exercises module loading boundary and fresh singleton initialization
    vi.resetModules();
    freshModule = await import("./project-target.js");
    expect(
      freshModule.useProjectTargetStore.getState().activeTargetByProject[ownerA],
    ).toBeUndefined();
    expect(
      freshModule.useProjectTargetStore.getState().activeTargetByProject[ownerB],
    ).toBe("/worktrees/b");
  });

  it("replaces stale live selections when rehydrated with an empty valid map", async () => {
    const store = useProjectTargetStore;
    store.getState().selectTarget("stale-proj", "/worktrees/stale");
    expect(store.getState().activeTargetByProject["stale-proj"]).toBe(
      "/worktrees/stale",
    );

    // Seed storage with empty activeTargetByProject map
    window.localStorage.setItem(
      PROJECT_TARGET_STORAGE_KEY,
      JSON.stringify({ state: { activeTargetByProject: {} }, version: 1 }),
    );

    await store.persist.rehydrate();
    expect(store.getState().activeTargetByProject).toEqual({});
    expect(store.getState().activeTargetByProject["stale-proj"]).toBeUndefined();
  });

  it("replaces live selections with an empty map when rehydrating a supported envelope with missing active map", async () => {
    const store = useProjectTargetStore;
    store.getState().selectTarget("live-proj", "/worktrees/live");
    expect(store.getState().activeTargetByProject["live-proj"]).toBe(
      "/worktrees/live",
    );

    window.localStorage.setItem(
      PROJECT_TARGET_STORAGE_KEY,
      JSON.stringify({ version: 1, state: {} }),
    );
    await store.persist.rehydrate();
    expect(store.getState().activeTargetByProject).toEqual({});
  });

  it("excludes failure maps from persistence and restores with empty failure maps", async () => {
    const store = useProjectTargetStore;
    store.getState().selectTarget("alpha", "/worktrees/alpha");
    store.getState().markTargetUnavailable("beta", "/worktrees/beta");

    expect(store.getState().unavailableTargetByProject["beta"]).toBe(
      "/worktrees/beta",
    );
    expect(store.getState().unavailableTargetsByProject["beta"]).toEqual([
      "/worktrees/beta",
    ]);

    const raw = window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.state).toEqual({
      activeTargetByProject: { alpha: "/worktrees/alpha" },
    });
    expect("unavailableTargetByProject" in parsed.state).toBe(false);
    expect("unavailableTargetsByProject" in parsed.state).toBe(false);

    // Exception to ts-no-dynamic-import: test case intentionally exercises module loading boundary and fresh singleton initialization
    vi.resetModules();
    const freshModule = await import("./project-target.js");
    const freshStore = freshModule.useProjectTargetStore;
    expect(freshStore.getState().activeTargetByProject["alpha"]).toBe(
      "/worktrees/alpha",
    );
    expect(freshStore.getState().unavailableTargetByProject).toEqual({});
    expect(freshStore.getState().unavailableTargetsByProject).toEqual({});
  });

  it("rejects injected failure maps, actions, and unknown fields on rehydration while preserving live failures and action references", async () => {
    const store = useProjectTargetStore;
    store.getState().selectTarget("live-active", "/worktrees/live-active");
    store
      .getState()
      .markTargetUnavailable("live-unavail-1", "/worktrees/fail-1");
    store
      .getState()
      .markTargetUnavailable("live-unavail-1", "/worktrees/fail-2");

    const selectTargetRef = store.getState().selectTarget;
    const resetTargetRef = store.getState().resetTarget;
    const markTargetUnavailableRef = store.getState().markTargetUnavailable;
    const clearUnavailableTargetRef = store.getState().clearUnavailableTarget;

    const injectedPayload = {
      version: 1,
      state: {
        activeTargetByProject: { "restored-proj": "/worktrees/restored" },
        unavailableTargetByProject: {
          "live-unavail-1": "/worktrees/injected-fail",
          "hacked-key": "/worktrees/hacked",
        },
        unavailableTargetsByProject: {
          "live-unavail-1": ["/worktrees/injected-fail"],
          "hacked-key": ["/worktrees/hacked"],
        },
        unknownProperty: "malicious-data",
        selectTarget: "overwritten-select",
        resetTarget: null,
        markTargetUnavailable: 42,
        clearUnavailableTarget: {},
      },
    };

    window.localStorage.setItem(
      PROJECT_TARGET_STORAGE_KEY,
      JSON.stringify(injectedPayload),
    );
    await store.persist.rehydrate();

    const state = store.getState();
    // Valid active map restored
    expect(state.activeTargetByProject["restored-proj"]).toBe(
      "/worktrees/restored",
    );
    // Unknown property ignored
    expect("unknownProperty" in state).toBe(false);
    // Injected failure maps not accepted
    expect(state.unavailableTargetByProject["hacked-key"]).toBeUndefined();
    expect(state.unavailableTargetsByProject["hacked-key"]).toBeUndefined();
    // Live failure maps preserved
    expect(state.unavailableTargetByProject["live-unavail-1"]).toBe(
      "/worktrees/fail-2",
    );
    expect(state.unavailableTargetsByProject["live-unavail-1"]).toEqual([
      "/worktrees/fail-1",
      "/worktrees/fail-2",
    ]);

    // Action references preserved exactly
    expect(state.selectTarget).toBe(selectTargetRef);
    expect(state.resetTarget).toBe(resetTargetRef);
    expect(state.markTargetUnavailable).toBe(markTargetUnavailableRef);
    expect(state.clearUnavailableTarget).toBe(clearUnavailableTargetRef);

    // Call all 4 actions to prove survival
    state.selectTarget("action-test", "/worktrees/action-test");
    expect(store.getState().activeTargetByProject["action-test"]).toBe(
      "/worktrees/action-test",
    );

    state.resetTarget("action-test");
    expect(store.getState().activeTargetByProject["action-test"]).toBeUndefined();

    state.markTargetUnavailable("action-test", "/worktrees/failed-path");
    expect(store.getState().unavailableTargetByProject["action-test"]).toBe(
      "/worktrees/failed-path",
    );

    state.clearUnavailableTarget("action-test");
    expect(
      store.getState().unavailableTargetByProject["action-test"],
    ).toBeUndefined();
  });

  it("removes active target durably when marked unavailable by normalized alias", async () => {
    const store = useProjectTargetStore;
    store.getState().selectTarget("demo", "/tmp/demo/./feature/../feature");

    const rawBefore = window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY);
    expect(
      JSON.parse(rawBefore!).state.activeTargetByProject["demo"],
    ).toBe("/tmp/demo/./feature/../feature");

    // Mark unavailable using normalized alias
    store.getState().markTargetUnavailable("demo", "/tmp/demo/feature");
    expect(store.getState().activeTargetByProject["demo"]).toBeUndefined();

    // Inspect storage: selection was removed durably
    const rawAfter = window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY);
    expect(
      JSON.parse(rawAfter!).state.activeTargetByProject["demo"],
    ).toBeUndefined();

    // Exception to ts-no-dynamic-import: test case intentionally exercises module loading boundary and fresh singleton initialization
    vi.resetModules();
    const freshModule = await import("./project-target.js");
    expect(
      freshModule.useProjectTargetStore.getState().activeTargetByProject["demo"],
    ).toBeUndefined();
  });

  it("does not remove active target when a different worktree path is marked unavailable", async () => {
    const store = useProjectTargetStore;
    store.getState().selectTarget("demo", "/worktrees/chosen");
    store.getState().markTargetUnavailable("demo", "/worktrees/other");

    expect(store.getState().activeTargetByProject["demo"]).toBe(
      "/worktrees/chosen",
    );
    const raw = window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY);
    expect(JSON.parse(raw!).state.activeTargetByProject["demo"]).toBe(
      "/worktrees/chosen",
    );
  });

  it("isolates same-name projects across profiles and keeps bare preference independent without fallback", async () => {
    const store = useProjectTargetStore;
    const ownerA = { profileId: "server-a", project: "demo" };
    const ownerB = { profileId: "server-b", project: "demo" };
    const keyA = projectScopeKey(ownerA);
    const keyB = projectScopeKey(ownerB);

    store.getState().selectTarget(ownerA, "/worktrees/server-a-demo");
    store.getState().selectTarget(ownerB, "/worktrees/server-b-demo");
    store.getState().selectTarget("demo", "/worktrees/bare-demo");

    // Exception to ts-no-dynamic-import: test case intentionally exercises module loading boundary and fresh singleton initialization
    vi.resetModules();
    let freshModule = await import("./project-target.js");
    let freshStore = freshModule.useProjectTargetStore;

    expect(freshStore.getState().activeTargetByProject[keyA]).toBe(
      "/worktrees/server-a-demo",
    );
    expect(freshStore.getState().activeTargetByProject[keyB]).toBe(
      "/worktrees/server-b-demo",
    );
    expect(freshStore.getState().activeTargetByProject["demo"]).toBe(
      "/worktrees/bare-demo",
    );

    // Reset owner A only
    freshStore.getState().resetTarget(ownerA);

    // Exception to ts-no-dynamic-import: test case intentionally exercises module loading boundary and fresh singleton initialization
    vi.resetModules();
    freshModule = await import("./project-target.js");
    freshStore = freshModule.useProjectTargetStore;

    expect(freshStore.getState().activeTargetByProject[keyA]).toBeUndefined();
    expect(freshStore.getState().activeTargetByProject[keyB]).toBe(
      "/worktrees/server-b-demo",
    );
    expect(freshStore.getState().activeTargetByProject["demo"]).toBe(
      "/worktrees/bare-demo",
    );

    // Qualified unselected owner stays root and NEVER falls back to bare "demo"
    const snapshotUnselected = createProjectTargetSnapshot(
      { profileId: "server-c", project: "demo" },
      freshStore.getState().activeTargetByProject[
        projectScopeKey({ profileId: "server-c", project: "demo" })
      ],
    );
    expect(snapshotUnselected.isRoot).toBe(true);
    expect(snapshotUnselected.target.worktreePath).toBeUndefined();

    // Bare caller restores bare target
    const snapshotBare = createProjectTargetSnapshot(
      "demo",
      freshStore.getState().activeTargetByProject["demo"],
    );
    expect(snapshotBare.isRoot).toBe(false);
    expect(snapshotBare.target.worktreePath).toBe("/worktrees/bare-demo");
  });

  it("runs validation on every rehydration with matching version and does not re-merge removed entries", async () => {
    const store = useProjectTargetStore;

    // Seed 1: valid two entries
    window.localStorage.setItem(
      PROJECT_TARGET_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          activeTargetByProject: {
            "proj-1": "/worktrees/1",
            "proj-2": "/worktrees/2",
          },
        },
      }),
    );
    await store.persist.rehydrate();
    expect(store.getState().activeTargetByProject["proj-1"]).toBe(
      "/worktrees/1",
    );
    expect(store.getState().activeTargetByProject["proj-2"]).toBe(
      "/worktrees/2",
    );

    // Seed 2: only proj-1 updated, malformed entries added, proj-2 removed
    window.localStorage.setItem(
      PROJECT_TARGET_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          activeTargetByProject: {
            "proj-1": "/worktrees/1-next",
            "bad-empty": "",
            "bad-whitespace": "   ",
            "bad-type": 999,
            "": "/worktrees/empty-key",
            "   ": "/worktrees/whitespace-key",
          },
        },
      }),
    );
    await store.persist.rehydrate();

    const state = store.getState();
    expect(state.activeTargetByProject["proj-1"]).toBe("/worktrees/1-next");
    // proj-2 was not merged back
    expect(state.activeTargetByProject["proj-2"]).toBeUndefined();
    // malformed entries rejected
    expect(state.activeTargetByProject["bad-empty"]).toBeUndefined();
    expect(state.activeTargetByProject["bad-whitespace"]).toBeUndefined();
    expect(state.activeTargetByProject["bad-type"]).toBeUndefined();
    expect(state.activeTargetByProject[""]).toBeUndefined();
    expect(state.activeTargetByProject["   "]).toBeUndefined();
  });

  it("yields an empty selection map for non-plain-object map shapes starting from nonempty state", async () => {
    const store = useProjectTargetStore;
    const invalidShapes = [
      null,
      "not-a-map",
      12345,
      [["alpha", "/worktrees/alpha"]],
      true,
    ];

    for (const shape of invalidShapes) {
      store.getState().selectTarget("existing", "/worktrees/existing");
      expect(store.getState().activeTargetByProject["existing"]).toBe(
        "/worktrees/existing",
      );

      window.localStorage.setItem(
        PROJECT_TARGET_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          state: { activeTargetByProject: shape },
        }),
      );
      await store.persist.rehydrate();
      expect(store.getState().activeTargetByProject).toEqual({});
    }
  });

  it("retains valid entries in mixed maps while preserving valid bytes (internal and leading/trailing spaces, Windows, UNC) without trimming or alteration", async () => {
    const store = useProjectTargetStore;
    const mixedMap = {
      "valid-key": "/path/with spaces/in/name",
      " unc-key ": String.raw`\\server\share\subpath`,
      "win-key": String.raw`C:\Projects\Worktree`,
      " spaced-key ": " /path with spaces/ ",
      "": "/bad/empty-key",
      "   ": "/bad/whitespace-key",
      "null-val": null,
      "num-val": 42,
      "bool-val": false,
      "obj-val": { path: "/nested" },
      "arr-val": ["/array"],
      "empty-val": "",
      "whitespace-val": "   \t  ",
    };

    window.localStorage.setItem(
      PROJECT_TARGET_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: { activeTargetByProject: mixedMap },
      }),
    );
    await store.persist.rehydrate();

    const active = store.getState().activeTargetByProject;
    expect(active["valid-key"]).toBe("/path/with spaces/in/name");
    expect(active[" unc-key "]).toBe(String.raw`\\server\share\subpath`);
    expect(active["win-key"]).toBe(String.raw`C:\Projects\Worktree`);
    expect(active[" spaced-key "]).toBe(" /path with spaces/ ");

    expect(Object.keys(active).sort()).toEqual([
      " spaced-key ",
      " unc-key ",
      "valid-key",
      "win-key",
    ]);
  });

  it("initializes a fresh store with null-prototype active map on clean storage", async () => {
    window.localStorage.removeItem(PROJECT_TARGET_STORAGE_KEY);
    // Exception to ts-no-dynamic-import: test case intentionally exercises module loading boundary and fresh singleton initialization
    vi.resetModules();
    const freshModule = await import("./project-target.js");
    const freshStore = freshModule.useProjectTargetStore;
    expect(
      Object.getPrototypeOf(freshStore.getState().activeTargetByProject),
    ).toBeNull();
    expect(freshStore.getState().activeTargetByProject).toEqual({});
  });

  it.each(["constructor", "toString", "__proto__"] as const)(
    "enforces null-prototype active map and defends against prototype pollution for special name '%s'",
    async (specialName) => {
      const store = useProjectTargetStore;

      // Invariant check on empty map
      expect(
        Object.getPrototypeOf(store.getState().activeTargetByProject),
      ).toBeNull();
      expect(specialName in store.getState().activeTargetByProject).toBe(false);

      // Absent scope queries return root
      expect(
        createProjectTargetSnapshot(
          specialName,
          store.getState().activeTargetByProject[specialName],
        ).isRoot,
      ).toBe(true);

      // Select action
      store
        .getState()
        .selectTarget(specialName, `/worktrees/custom-${specialName}`);
      expect(
        Object.getPrototypeOf(store.getState().activeTargetByProject),
      ).toBeNull();
      expect(store.getState().activeTargetByProject[specialName]).toBe(
        `/worktrees/custom-${specialName}`,
      );
      expect(
        ({} as Record<string, unknown>)[`custom-${specialName}`],
      ).toBeUndefined();
      expect(
        Object.prototype.hasOwnProperty(`custom-${specialName}`),
      ).toBe(false);

      // markTargetUnavailable records failure and removes active target
      store
        .getState()
        .markTargetUnavailable(
          specialName,
          `/worktrees/custom-${specialName}`,
        );
      expect(
        Object.getPrototypeOf(store.getState().activeTargetByProject),
      ).toBeNull();
      expect(
        store.getState().activeTargetByProject[specialName],
      ).toBeUndefined();
      expect(
        store.getState().unavailableTargetByProject[specialName],
      ).toBe(`/worktrees/custom-${specialName}`);
      expect(
        store.getState().unavailableTargetsByProject[specialName],
      ).toEqual([`/worktrees/custom-${specialName}`]);

      // clearUnavailableTarget
      store.getState().clearUnavailableTarget(specialName);
      expect(
        store.getState().unavailableTargetByProject[specialName],
      ).toBeUndefined();
      expect(
        store.getState().unavailableTargetsByProject[specialName],
      ).toBeUndefined();

      // resetTarget clears selection
      store
        .getState()
        .selectTarget(specialName, `/worktrees/reset-${specialName}`);
      expect(store.getState().activeTargetByProject[specialName]).toBe(
        `/worktrees/reset-${specialName}`,
      );
      store.getState().resetTarget(specialName);
      expect(
        store.getState().activeTargetByProject[specialName],
      ).toBeUndefined();

      // Hydration with JSON payload containing special name
      const jsonWithSpecial = JSON.stringify({
        version: 1,
        state: {
          activeTargetByProject: JSON.parse(
            `{"${specialName}": "/worktrees/hydrated-${specialName}"}`,
          ),
        },
      });
      window.localStorage.setItem(PROJECT_TARGET_STORAGE_KEY, jsonWithSpecial);
      await store.persist.rehydrate();

      const hydrated = store.getState().activeTargetByProject;
      expect(Object.getPrototypeOf(hydrated)).toBeNull();
      expect(hydrated[specialName]).toBe(`/worktrees/hydrated-${specialName}`);

      // Removal returns to root
      store.getState().selectTarget(specialName, null);
      expect(
        store.getState().activeTargetByProject[specialName],
      ).toBeUndefined();
      expect(
        createProjectTargetSnapshot(
          specialName,
          store.getState().activeTargetByProject[specialName],
        ).isRoot,
      ).toBe(true);
    },
  );

  it("direct merge validation rejects symbol keys and malformed alternative map representations", () => {
    const persistOptions = useProjectTargetStore.persist.getOptions();
    expect(typeof persistOptions.merge).toBe("function");
    const mergeFn = persistOptions.merge!;

    const currentState = useProjectTargetStore.getState();
    const sym = Symbol("test-symbol");
    const runtimeInput = {
      activeTargetByProject: {
        [sym]: "/worktrees/symbol-path",
        "valid-string-key": "/worktrees/valid-string",
      },
    };

    const merged = mergeFn(
      runtimeInput,
      currentState,
    ) as typeof currentState;
    expect(
      merged.activeTargetByProject["valid-string-key"],
    ).toBe("/worktrees/valid-string");
    expect(
      (
        merged.activeTargetByProject as Record<
          string | symbol,
          string | undefined
        >
      )[sym],
    ).toBeUndefined();

    // Direct Map-instance rejection
    const mapMerged = mergeFn(
      { activeTargetByProject: new Map([["a", "/a"]]) },
      currentState,
    ) as typeof currentState;
    expect(mapMerged.activeTargetByProject).toEqual({});
  });

  it.each([
    ["absent record", null],
    ["literal null", "null"],
    ["primitive number", "42"],
    ["primitive string", '"plain string"'],
    ["array envelope", '["dam-hopper"]'],
    ["missing state", JSON.stringify({ version: 1 })],
    ["null state", JSON.stringify({ version: 1, state: null })],
    ["string state", JSON.stringify({ version: 1, state: "invalid" })],
    [
      "missing version",
      JSON.stringify({ state: { activeTargetByProject: { a: "/worktrees/a" } } }),
    ],
    [
      "string version",
      JSON.stringify({
        version: "1",
        state: { activeTargetByProject: { a: "/worktrees/a" } },
      }),
    ],
    [
      "old version 0",
      JSON.stringify({
        version: 0,
        state: { activeTargetByProject: { a: "/worktrees/a" } },
      }),
    ],
    [
      "future version 2",
      JSON.stringify({
        version: 2,
        state: { activeTargetByProject: { future: "/worktrees/future" } },
      }),
    ],
  ])(
    "ignores unsupported envelope '%s' on startup without mutating storage",
    async (_label, seededValue) => {
      if (seededValue !== null) {
        window.localStorage.setItem(PROJECT_TARGET_STORAGE_KEY, seededValue);
      } else {
        window.localStorage.removeItem(PROJECT_TARGET_STORAGE_KEY);
      }

      // Install write spies AFTER seeding
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
      const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

      // Exception to ts-no-dynamic-import: test case intentionally exercises module loading boundary and fresh singleton initialization
      vi.resetModules();
      const freshModule = await import("./project-target.js");
      const freshStore = freshModule.useProjectTargetStore;

      // Startup defaults to root
      expect(freshStore.getState().activeTargetByProject).toEqual({});

      // Zero storage writes/deletions occurred
      expect(setItemSpy).not.toHaveBeenCalled();
      expect(removeItemSpy).not.toHaveBeenCalled();

      // Storage byte-for-byte preserved
      expect(window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY)).toBe(
        seededValue,
      );

      // Actions still work
      freshStore.getState().selectTarget("test", "/worktrees/test");
      expect(freshStore.getState().activeTargetByProject["test"]).toBe(
        "/worktrees/test",
      );
    },
  );

  it("preserves live selections when an unsupported envelope is rehydrated explicitly, leaving bytes intact until explicit write", async () => {
    const store = useProjectTargetStore;
    store.getState().selectTarget("live-target", "/worktrees/live");

    const futureEnvelope = JSON.stringify({
      version: 2,
      state: { activeTargetByProject: { future: "/worktrees/future" } },
    });
    window.localStorage.setItem(PROJECT_TARGET_STORAGE_KEY, futureEnvelope);

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

    await store.persist.rehydrate();

    // Live selection remains intact
    expect(store.getState().activeTargetByProject["live-target"]).toBe(
      "/worktrees/live",
    );
    expect(store.getState().activeTargetByProject["future"]).toBeUndefined();

    // No storage writes occurred during rehydration
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(removeItemSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY)).toBe(
      futureEnvelope,
    );

    // Only subsequent explicit state change replaces storage bytes
    store.getState().selectTarget("live-target", "/worktrees/live-v2");
    const updatedRaw = window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY);
    expect(JSON.parse(updatedRaw!).version).toBe(1);
    expect(
      JSON.parse(updatedRaw!).state.activeTargetByProject["live-target"],
    ).toBe("/worktrees/live-v2");
  });

  it("does not throw on corrupt JSON on startup or rehydrate, leaves storage intact, and allows subsequent selection to overwrite", async () => {
    const corruptBytes = '{"state": {"activeTargetByProject": { "broken": ';
    window.localStorage.setItem(PROJECT_TARGET_STORAGE_KEY, corruptBytes);

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

    // Exception to ts-no-dynamic-import: test case intentionally exercises module loading boundary and fresh singleton initialization
    vi.resetModules();
    const freshModule = await import("./project-target.js");
    const freshStore = freshModule.useProjectTargetStore;

    expect(freshStore.getState().activeTargetByProject).toEqual({});
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(removeItemSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY)).toBe(
      corruptBytes,
    );

    // Select a target to have nonempty live state
    freshStore.getState().selectTarget("live-selection", "/worktrees/live");
    expect(
      freshStore.getState().activeTargetByProject["live-selection"],
    ).toBe("/worktrees/live");

    // Re-seed corrupt bytes to test rehydration over corrupt record
    window.localStorage.setItem(PROJECT_TARGET_STORAGE_KEY, corruptBytes);
    setItemSpy.mockClear();
    removeItemSpy.mockClear();

    // Rehydrate also does not throw, does not delete, does not write, and preserves nonempty live state
    await freshStore.persist.rehydrate();
    expect(
      freshStore.getState().activeTargetByProject["live-selection"],
    ).toBe("/worktrees/live");
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(removeItemSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY)).toBe(
      corruptBytes,
    );

    // Explicit selection safely overwrites with valid v1 envelope
    freshStore.getState().selectTarget("recovered", "/worktrees/recovered");
    const rawAfter = window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY);
    expect(rawAfter).not.toBe(corruptBytes);
    const parsed = JSON.parse(rawAfter!);
    expect(parsed.version).toBe(1);
    expect(parsed.state.activeTargetByProject["recovered"]).toBe(
      "/worktrees/recovered",
    );
  });

  it("operates normally in-memory when localStorage getter throws SecurityError", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    // Exception to ts-no-dynamic-import: test case intentionally exercises module loading boundary and fresh singleton initialization
    vi.resetModules();
    const freshModule = await import("./project-target.js");
    const store = freshModule.useProjectTargetStore;

    expect(store.getState().activeTargetByProject).toEqual({});
    await store.persist.rehydrate();

    store.getState().selectTarget("proj", "/worktrees/proj");
    expect(store.getState().activeTargetByProject["proj"]).toBe(
      "/worktrees/proj",
    );

    store.getState().markTargetUnavailable("proj", "/worktrees/proj");
    expect(store.getState().activeTargetByProject["proj"]).toBeUndefined();
    expect(store.getState().unavailableTargetByProject["proj"]).toBe(
      "/worktrees/proj",
    );

    store.getState().resetTarget("proj");
    expect(store.getState().unavailableTargetByProject["proj"]).toBeUndefined();

    expect(() => store.persist.clearStorage()).not.toThrow();
  });

  it("operates normally in-memory when getItem throws during fresh initialization and rehydration, preserving live state", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage access blocked");
    });

    // Exception to ts-no-dynamic-import: test case intentionally exercises module loading boundary and fresh singleton initialization
    vi.resetModules();
    const freshModule = await import("./project-target.js");
    const store = freshModule.useProjectTargetStore;

    expect(store.getState().activeTargetByProject).toEqual({});
    store.getState().selectTarget("live-proj", "/worktrees/live");
    expect(store.getState().activeTargetByProject["live-proj"]).toBe(
      "/worktrees/live",
    );

    // Rehydrating while getItem throws does not clear live state
    await store.persist.rehydrate();
    expect(store.getState().activeTargetByProject["live-proj"]).toBe(
      "/worktrees/live",
    );
  });

  it("updates in-memory state without throwing when setItem throws QuotaExceededError across select, root, unavailable, and reset", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    const store = useProjectTargetStore;
    // select
    expect(() =>
      store.getState().selectTarget("proj", "/worktrees/proj"),
    ).not.toThrow();
    expect(store.getState().activeTargetByProject["proj"]).toBe(
      "/worktrees/proj",
    );

    // root
    expect(() => store.getState().selectTarget("proj", null)).not.toThrow();
    expect(
      store.getState().activeTargetByProject["proj"],
    ).toBeUndefined();

    // unavailable
    store.getState().selectTarget("proj2", "/worktrees/proj2");
    expect(() =>
      store.getState().markTargetUnavailable("proj2", "/worktrees/proj2"),
    ).not.toThrow();
    expect(
      store.getState().activeTargetByProject["proj2"],
    ).toBeUndefined();
    expect(
      store.getState().unavailableTargetByProject["proj2"],
    ).toBe("/worktrees/proj2");

    // resetTarget
    expect(() => store.getState().resetTarget("proj2")).not.toThrow();
    expect(
      store.getState().unavailableTargetByProject["proj2"],
    ).toBeUndefined();
  });

  it("does not throw when removeItem throws on clearStorage and invokes removeItem", () => {
    const removeItemSpy = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new Error("Permission denied");
      });

    const store = useProjectTargetStore;
    expect(() => store.getState().resetTarget("proj")).not.toThrow();
    expect(() => store.persist.clearStorage()).not.toThrow();
    expect(removeItemSpy).toHaveBeenCalled();
  });

  it("initializes safely without window global", async () => {
    try {
      vi.stubGlobal("window", undefined);

      // Exception to ts-no-dynamic-import: test case intentionally exercises module loading boundary and fresh singleton initialization
      vi.resetModules();
      const freshModule = await import("./project-target.js");
      const store = freshModule.useProjectTargetStore;

      expect(store.getState().activeTargetByProject).toEqual({});
      store.getState().selectTarget("alpha", "/worktrees/alpha");
      expect(store.getState().activeTargetByProject["alpha"]).toBe(
        "/worktrees/alpha",
      );
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
  it("integrates with fresh-state reset: isLegacyResourceKey is false and reset preserves the target key", () => {
    expect(isLegacyResourceKey(PROJECT_TARGET_STORAGE_KEY)).toBe(false);

    // Seed target key and legacy keys
    const targetBytes = JSON.stringify({
      version: 1,
      state: { activeTargetByProject: { demo: "/worktrees/demo" } },
    });
    window.localStorage.setItem(PROJECT_TARGET_STORAGE_KEY, targetBytes);
    window.localStorage.setItem("dam-hopper:active-project", "legacy-project");
    window.localStorage.setItem("dam-hopper:terminal-pins", "[1, 2]");

    const clearSpy = vi.spyOn(Storage.prototype, "clear");

    const result1 = performFreshStateReset();
    expect(result1.applied).toBe(true);
    expect(result1.keysRemoved).toContain("dam-hopper:active-project");
    expect(result1.keysRemoved).toContain("dam-hopper:terminal-pins");
    expect(result1.keysRemoved).not.toContain(PROJECT_TARGET_STORAGE_KEY);

    // localStorage.clear was never called
    expect(clearSpy).not.toHaveBeenCalled();

    // PROJECT_TARGET_STORAGE_KEY is intact
    expect(window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY)).toBe(
      targetBytes,
    );

    // Repeat reset to prove idempotence
    const result2 = performFreshStateReset();
    expect(result2.applied).toBe(true);
    expect(result2.keysRemoved).toEqual([]);
    expect(window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY)).toBe(
      targetBytes,
    );
  });

  it.each([
    [
      "valid v1",
      JSON.stringify({
        version: 1,
        state: { activeTargetByProject: { a: "/a" } },
      }),
    ],
    [
      "mixed-invalid v1",
      JSON.stringify({
        version: 1,
        state: { activeTargetByProject: { a: "/a", bad: 123 } },
      }),
    ],
    ["corrupt json", '{"state": {"incomplete'],
    ["future version", JSON.stringify({ version: 99, state: {} })],
  ])(
    "preserves target key during fresh-state reset for envelope variant '%s'",
    (_variant, rawBytes) => {
      window.localStorage.setItem(PROJECT_TARGET_STORAGE_KEY, rawBytes);
      window.localStorage.setItem(
        "dam-hopper:active-project",
        "legacy-to-remove",
      );

      performFreshStateReset();

      expect(window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY)).toBe(
        rawBytes,
      );
      expect(window.localStorage.getItem("dam-hopper:active-project")).toBeNull();
    },
  );

  it("merges concurrent selections from another tab without overwriting them", () => {
    useProjectTargetStore.getState().selectTarget("project-1", "/worktrees/tab-a-wt");

    // Simulate Tab B writing to localStorage concurrently for a distinct project
    const concurrentDiskBytes = JSON.stringify({
      version: 1,
      state: {
        activeTargetByProject: {
          "project-1": "/worktrees/tab-a-wt",
          "project-2": "/worktrees/tab-b-wt",
        },
      },
    });
    window.localStorage.setItem(PROJECT_TARGET_STORAGE_KEY, concurrentDiskBytes);

    // Tab A now selects a third project
    useProjectTargetStore.getState().selectTarget("project-3", "/worktrees/tab-a-wt-3");

    const storedRaw = window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY);
    expect(storedRaw).not.toBeNull();
    const stored = JSON.parse(storedRaw!);
    // Both Tab B's project-2 and Tab A's project-1 and project-3 are preserved
    expect(stored.state.activeTargetByProject).toEqual({
      "project-1": "/worktrees/tab-a-wt",
      "project-2": "/worktrees/tab-b-wt",
      "project-3": "/worktrees/tab-a-wt-3",
    });
    // Tab A's local store is updated with the merged map
    expect(useProjectTargetStore.getState().activeTargetByProject["project-2"]).toBe(
      "/worktrees/tab-b-wt",
    );
    expect(useProjectTargetStore.getState().activeTargetByProject["project-3"]).toBe(
      "/worktrees/tab-a-wt-3",
    );
  });
  it("preserves remote modification to project X when local tab selects project Y", () => {
    // Both tabs start with project-x at v1
    useProjectTargetStore.getState().selectTarget("project-x", "/worktrees/x-v1");

    // Tab A concurrently updates project-x to v2 in localStorage
    const tabABytes = JSON.stringify({
      version: 1,
      state: {
        activeTargetByProject: {
          "project-x": "/worktrees/x-v2",
        },
      },
    });
    window.localStorage.setItem(PROJECT_TARGET_STORAGE_KEY, tabABytes);

    // Tab B now selects project-y
    useProjectTargetStore.getState().selectTarget("project-y", "/worktrees/y-target");

    const storedRaw = window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY);
    expect(storedRaw).not.toBeNull();
    const stored = JSON.parse(storedRaw!);
    // Must preserve Tab A's new worktree for project-x and Tab B's project-y
    expect(stored.state.activeTargetByProject).toEqual({
      "project-x": "/worktrees/x-v2",
      "project-y": "/worktrees/y-target",
    });
    // Local store is also updated with Tab A's remote change
    expect(useProjectTargetStore.getState().activeTargetByProject["project-x"]).toBe(
      "/worktrees/x-v2",
    );
    expect(useProjectTargetStore.getState().activeTargetByProject["project-y"]).toBe(
      "/worktrees/y-target",
    );
  });

  it("preserves remote reset of project X to root when local tab selects project Y", () => {
    // Both tabs start with project-x at v1
    useProjectTargetStore.getState().selectTarget("project-x", "/worktrees/x-v1");

    // Tab A concurrently resets project-x to root (empty activeTargetByProject)
    const tabABytes = JSON.stringify({
      version: 1,
      state: {
        activeTargetByProject: {},
      },
    });
    window.localStorage.setItem(PROJECT_TARGET_STORAGE_KEY, tabABytes);

    // Tab B selects project-y
    useProjectTargetStore.getState().selectTarget("project-y", "/worktrees/y-target");

    const storedRaw = window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY);
    expect(storedRaw).not.toBeNull();
    const stored = JSON.parse(storedRaw!);
    // project-x must remain root (NOT resurrected from Tab B's stale base), and project-y is selected
    expect(stored.state.activeTargetByProject).toEqual({
      "project-y": "/worktrees/y-target",
    });
    expect(useProjectTargetStore.getState().activeTargetByProject["project-x"]).toBeUndefined();
    expect(useProjectTargetStore.getState().activeTargetByProject["project-y"]).toBe(
      "/worktrees/y-target",
    );
  });

  it("correctly performs 3-way merge calculations across delta combinations", () => {
    // 1. Remote update preserved when local modifies another key
    const merged1 = mergeTargetMapChanges(
      { "proj-x": "/wt-x-v2" },
      { "proj-x": "/wt-x-v1", "proj-y": "/wt-y" },
      { "proj-x": "/wt-x-v1" },
    );
    expect(merged1).toEqual({
      "proj-x": "/wt-x-v2",
      "proj-y": "/wt-y",
    });

    // 2. Remote deletion preserved when local modifies another key
    const merged2 = mergeTargetMapChanges(
      {},
      { "proj-x": "/wt-x-v1", "proj-y": "/wt-y" },
      { "proj-x": "/wt-x-v1" },
    );
    expect(merged2).toEqual({
      "proj-y": "/wt-y",
    });

    // 3. Local deletion applied while preserving remote changes
    const merged3 = mergeTargetMapChanges(
      { "proj-x": "/wt-x-v1", "proj-remote": "/wt-remote" },
      {},
      { "proj-x": "/wt-x-v1" },
    );
    expect(merged3).toEqual({
      "proj-remote": "/wt-remote",
    });

    // 4. Same-key conflict resolved in favor of local modification
    const merged4 = mergeTargetMapChanges(
      { "proj-x": "/wt-x-remote" },
      { "proj-x": "/wt-x-local" },
      { "proj-x": "/wt-x-base" },
    );
    expect(merged4).toEqual({
      "proj-x": "/wt-x-local",
    });
  });

  it("does not write to localStorage when only transient failure maps are mutated", () => {
    useProjectTargetStore.getState().selectTarget("project-stable", "/worktrees/stable");

    const setItemSpy = vi.spyOn(window.localStorage, "setItem");
    setItemSpy.mockClear();

    // Mutating transient failure maps does not change activeTargetByProject
    useProjectTargetStore
      .getState()
      .markTargetUnavailable("unrelated-project", "/worktrees/failed");
    expect(setItemSpy).not.toHaveBeenCalled();

    useProjectTargetStore.getState().clearUnavailableTarget("unrelated-project");
    expect(setItemSpy).not.toHaveBeenCalled();

    setItemSpy.mockRestore();
  });

  it("synchronizes activeTargetByProject in real-time when receiving a storage event from another tab", () => {
    const unsubscribe = initProjectTargetStorageSync();
    try {
      expect(
        useProjectTargetStore.getState().activeTargetByProject["external-tab-proj"],
      ).toBeUndefined();

      // Simulate another tab persisting a new selection
      const externalTabBytes = JSON.stringify({
        version: 1,
        state: {
          activeTargetByProject: {
            "external-tab-proj": "/worktrees/remote-tab-wt",
          },
        },
      });
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: PROJECT_TARGET_STORAGE_KEY,
          newValue: externalTabBytes,
        }),
      );

      expect(
        useProjectTargetStore.getState().activeTargetByProject["external-tab-proj"],
      ).toBe("/worktrees/remote-tab-wt");

      // Simulate another tab clearing storage
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: PROJECT_TARGET_STORAGE_KEY,
          newValue: null,
        }),
      );

      expect(useProjectTargetStore.getState().activeTargetByProject).toEqual({});
    } finally {
      unsubscribe();
    }
  });

  it("restores selection when reset occurs before store initialization", async () => {
    const seedBytes = JSON.stringify({
      version: 1,
      state: {
        activeTargetByProject: { "order-test": "/worktrees/order-before" },
      },
    });
    window.localStorage.setItem(PROJECT_TARGET_STORAGE_KEY, seedBytes);

    // 1. Reset runs first
    performFreshStateReset();
    expect(window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY)).toBe(
      seedBytes,
    );

    // 2. Store dynamically imported second
    // Exception to ts-no-dynamic-import: test case intentionally exercises module loading boundary and fresh singleton initialization
    vi.resetModules();
    const freshModule = await import("./project-target.js");
    const store = freshModule.useProjectTargetStore;

    expect(store.getState().activeTargetByProject["order-test"]).toBe(
      "/worktrees/order-before",
    );
  });

  it("preserves in-memory and persisted selection when store initializes before reset", async () => {
    const seedBytes = JSON.stringify({
      version: 1,
      state: {
        activeTargetByProject: { "order-test": "/worktrees/order-after" },
      },
    });
    window.localStorage.setItem(PROJECT_TARGET_STORAGE_KEY, seedBytes);

    // 1. Store initializes first
    // Exception to ts-no-dynamic-import: test case intentionally exercises module loading boundary and fresh singleton initialization
    vi.resetModules();
    const freshModule = await import("./project-target.js");
    const store = freshModule.useProjectTargetStore;
    expect(store.getState().activeTargetByProject["order-test"]).toBe(
      "/worktrees/order-after",
    );

    // 2. Reset runs second
    performFreshStateReset();

    // In-memory selection survives
    expect(store.getState().activeTargetByProject["order-test"]).toBe(
      "/worktrees/order-after",
    );
    // Storage remains intact
    expect(window.localStorage.getItem(PROJECT_TARGET_STORAGE_KEY)).toBe(
      seedBytes,
    );
  });
});
