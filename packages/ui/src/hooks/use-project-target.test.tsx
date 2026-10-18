// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useProjectTarget } from "./use-project-target.js";
import {
  PROJECT_TARGET_STORAGE_KEY,
  projectScopeKey,
  useProjectTargetStore,
  type ProjectTargetSnapshot,
} from "@/stores/project-target.js";
import type { ProjectRef } from "@/api/ownership.js";

const registeredCleanups: Array<() => void> = [];

function renderProjectTargetHook(
  project: ProjectRef | string | null,
): {
  getSnapshot: () => ProjectTargetSnapshot | null;
  rerender: (nextProject: ProjectRef | string | null) => void;
  cleanup: () => void;
} {
  let latestSnapshot: ProjectTargetSnapshot | null = null;
  let unmounted = false;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const cleanup = () => {
    if (unmounted) return;
    unmounted = true;
    try {
      act(() => {
        root.unmount();
      });
    } finally {
      container.remove();
    }
  };

  registeredCleanups.push(cleanup);

  function Consumer({
    currentProject,
  }: {
    currentProject: ProjectRef | string | null;
  }) {
    latestSnapshot = useProjectTarget(currentProject);
    return null;
  }

  act(() => {
    root.render(createElement(Consumer, { currentProject: project }));
  });

  return {
    getSnapshot: () => latestSnapshot,
    rerender: (nextProject) => {
      act(() => {
        root.render(createElement(Consumer, { currentProject: nextProject }));
      });
    },
    cleanup,
  };
}

describe("useProjectTarget", () => {
  beforeEach(() => {
    useProjectTargetStore.setState({
      activeTargetByProject: Object.create(null),
      unavailableTargetByProject: {},
      unavailableTargetsByProject: {},
    });
    try {
      window.localStorage.removeItem(PROJECT_TARGET_STORAGE_KEY);
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    while (registeredCleanups.length > 0) {
      const cleanup = registeredCleanups.pop();
      try {
        cleanup?.();
      } catch {
        // ignore
      }
    }
    useProjectTargetStore.setState({
      activeTargetByProject: Object.create(null),
      unavailableTargetByProject: {},
      unavailableTargetsByProject: {},
    });
    try {
      window.localStorage.removeItem(PROJECT_TARGET_STORAGE_KEY);
    } catch {
      // ignore
    }
  });

  it("returns null when project is null", () => {
    const harness = renderProjectTargetHook(null);
    expect(harness.getSnapshot()).toBeNull();
    harness.cleanup();
  });

  it("reads root when no target has been selected", () => {
    const harness = renderProjectTargetHook({ profileId: "server-a", project: "demo" });
    const snapshot = harness.getSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.isRoot).toBe(true);
    expect(snapshot?.target.worktreePath).toBeUndefined();
    harness.cleanup();
  });

  it("isolates targets by profile and prevents qualified roots from falling through to legacy bare keys", () => {
    const store = useProjectTargetStore.getState();
    // Legacy bare key set for "demo"
    store.selectTarget("demo", "/tmp/legacy-bare-wt");
    // Profile A selects a feature worktree
    store.selectTarget({ profileId: "server-a", project: "demo" }, "/tmp/server-a-wt");

    const harnessA = renderProjectTargetHook({ profileId: "server-a", project: "demo" });
    const harnessB = renderProjectTargetHook({ profileId: "server-b", project: "demo" });
    const harnessBare = renderProjectTargetHook("demo");

    // Profile A gets server-a target
    expect(harnessA.getSnapshot()?.isRoot).toBe(false);
    expect(harnessA.getSnapshot()?.target.worktreePath).toBe("/tmp/server-a-wt");

    // Profile B is at root and MUST NOT fall back to legacy bare target "/tmp/legacy-bare-wt"
    expect(harnessB.getSnapshot()?.isRoot).toBe(true);
    expect(harnessB.getSnapshot()?.target.worktreePath).toBeUndefined();

    // Bare "demo" gets legacy bare target
    expect(harnessBare.getSnapshot()?.isRoot).toBe(false);
    expect(harnessBare.getSnapshot()?.target.worktreePath).toBe("/tmp/legacy-bare-wt");

    harnessA.cleanup();
    harnessB.cleanup();
    harnessBare.cleanup();
  });

  it("clears only the exact owner target on root selection", () => {
    const store = useProjectTargetStore.getState();
    store.selectTarget({ profileId: "server-a", project: "demo" }, "/tmp/server-a-wt");
    store.selectTarget({ profileId: "server-b", project: "demo" }, "/tmp/server-b-wt");

    const harnessA = renderProjectTargetHook({ profileId: "server-a", project: "demo" });
    const harnessB = renderProjectTargetHook({ profileId: "server-b", project: "demo" });

    expect(harnessA.getSnapshot()?.target.worktreePath).toBe("/tmp/server-a-wt");
    expect(harnessB.getSnapshot()?.target.worktreePath).toBe("/tmp/server-b-wt");

    // Reset profile A target
    act(() => {
      useProjectTargetStore.getState().selectTarget({ profileId: "server-a", project: "demo" }, null);
    });

    expect(harnessA.getSnapshot()?.isRoot).toBe(true);
    expect(harnessA.getSnapshot()?.target.worktreePath).toBeUndefined();
    // Profile B target remains unaffected
    expect(harnessB.getSnapshot()?.isRoot).toBe(false);
    expect(harnessB.getSnapshot()?.target.worktreePath).toBe("/tmp/server-b-wt");

    harnessA.cleanup();
    harnessB.cleanup();
  });

  it("provides restored selection snapshot on first render before discovery metadata arrives", async () => {
    const project = { profileId: "server-a", project: "demo" };
    const key = projectScopeKey(project);
    const targetPath = "/worktrees/restored-wt";

    window.localStorage.setItem(
      PROJECT_TARGET_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: { activeTargetByProject: { [key]: targetPath } },
      }),
    );
    await useProjectTargetStore.persist.rehydrate();

    const harness = renderProjectTargetHook(project);
    const snapshot = harness.getSnapshot();

    expect(snapshot).not.toBeNull();
    expect(snapshot?.project).toBe("demo");
    expect(snapshot?.target).toEqual({
      profileId: "server-a",
      project: "demo",
      worktreePath: targetPath,
    });
    expect(snapshot?.targetKey).toBe(`worktree:${targetPath}`);
    expect(snapshot?.isRoot).toBe(false);
    expect(snapshot?.available).toBe(false);
    harness.cleanup();
  });

  it("restores cross-profile selections independently for the same project name", async () => {
    const ownerA = { profileId: "server-a", project: "demo" };
    const ownerB = { profileId: "server-b", project: "demo" };
    const ownerC = { profileId: "server-c", project: "demo" };
    const keyA = projectScopeKey(ownerA);
    const keyB = projectScopeKey(ownerB);

    window.localStorage.setItem(
      PROJECT_TARGET_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          activeTargetByProject: {
            [keyA]: "/worktrees/server-a-wt",
            [keyB]: "/worktrees/server-b-wt",
            demo: "/worktrees/bare-demo-wt",
          },
        },
      }),
    );
    await useProjectTargetStore.persist.rehydrate();

    const harnessA = renderProjectTargetHook(ownerA);
    const harnessB = renderProjectTargetHook(ownerB);
    const harnessC = renderProjectTargetHook(ownerC);

    expect(harnessA.getSnapshot()?.isRoot).toBe(false);
    expect(harnessA.getSnapshot()?.target.worktreePath).toBe(
      "/worktrees/server-a-wt",
    );

    expect(harnessB.getSnapshot()?.isRoot).toBe(false);
    expect(harnessB.getSnapshot()?.target.worktreePath).toBe(
      "/worktrees/server-b-wt",
    );

    // Qualified owner C has no selection and must stay root without falling back to bare "demo"
    expect(harnessC.getSnapshot()?.isRoot).toBe(true);
    expect(harnessC.getSnapshot()?.target.worktreePath).toBeUndefined();

    harnessA.cleanup();
    harnessB.cleanup();
    harnessC.cleanup();
  });

  it("switches cleanly between qualified owners on prop update without leaking stale targets", async () => {
    const ownerA = { profileId: "server-a", project: "demo" };
    const ownerB = { profileId: "server-b", project: "demo" };
    const ownerC = { profileId: "server-c", project: "demo" };
    const keyA = projectScopeKey(ownerA);
    const keyB = projectScopeKey(ownerB);

    window.localStorage.setItem(
      PROJECT_TARGET_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          activeTargetByProject: {
            [keyA]: "/worktrees/target-a",
            [keyB]: "/worktrees/target-b",
            demo: "/worktrees/bare-target",
          },
        },
      }),
    );
    await useProjectTargetStore.persist.rehydrate();

    const harness = renderProjectTargetHook(ownerA);
    expect(harness.getSnapshot()?.target.worktreePath).toBe(
      "/worktrees/target-a",
    );

    harness.rerender(ownerB);
    expect(harness.getSnapshot()?.target.worktreePath).toBe(
      "/worktrees/target-b",
    );

    harness.rerender(ownerC);
    expect(harness.getSnapshot()?.isRoot).toBe(true);
    expect(harness.getSnapshot()?.target.worktreePath).toBeUndefined();

    harness.cleanup();
  });

  it("reactively updates mounted hook when rehydrated inside act, including empty-map resets", async () => {
    const owner = { profileId: "server-a", project: "demo" };
    const key = projectScopeKey(owner);

    const harness = renderProjectTargetHook(owner);
    expect(harness.getSnapshot()?.isRoot).toBe(true);

    // Rehydrate with valid selection inside act
    window.localStorage.setItem(
      PROJECT_TARGET_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          activeTargetByProject: { [key]: "/worktrees/reactive-target" },
        },
      }),
    );
    await act(async () => {
      await useProjectTargetStore.persist.rehydrate();
    });

    expect(harness.getSnapshot()?.isRoot).toBe(false);
    expect(harness.getSnapshot()?.target.worktreePath).toBe(
      "/worktrees/reactive-target",
    );

    // Rehydrate with empty map inside act
    window.localStorage.setItem(
      PROJECT_TARGET_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: { activeTargetByProject: {} },
      }),
    );
    await act(async () => {
      await useProjectTargetStore.persist.rehydrate();
    });

    expect(harness.getSnapshot()?.isRoot).toBe(true);
    expect(harness.getSnapshot()?.target.worktreePath).toBeUndefined();

    // Actions remain callable
    act(() => {
      useProjectTargetStore
        .getState()
        .selectTarget(owner, "/worktrees/after-reset");
    });
    expect(harness.getSnapshot()?.target.worktreePath).toBe(
      "/worktrees/after-reset",
    );

    harness.cleanup();
  });

  it("updates snapshot on root selection and confirms no resurrection upon subsequent rehydration", async () => {
    const ownerA = { profileId: "server-a", project: "demo" };
    const ownerB = { profileId: "server-b", project: "demo" };
    const keyA = projectScopeKey(ownerA);
    const keyB = projectScopeKey(ownerB);

    window.localStorage.setItem(
      PROJECT_TARGET_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          activeTargetByProject: {
            [keyA]: "/worktrees/target-a",
            [keyB]: "/worktrees/target-b",
          },
        },
      }),
    );
    await useProjectTargetStore.persist.rehydrate();

    const harnessA = renderProjectTargetHook(ownerA);
    const harnessB = renderProjectTargetHook(ownerB);

    expect(harnessA.getSnapshot()?.target.worktreePath).toBe(
      "/worktrees/target-a",
    );
    expect(harnessB.getSnapshot()?.target.worktreePath).toBe(
      "/worktrees/target-b",
    );

    // Set owner A to root
    act(() => {
      useProjectTargetStore.getState().selectTarget(ownerA, null);
    });

    expect(harnessA.getSnapshot()?.isRoot).toBe(true);
    expect(harnessB.getSnapshot()?.isRoot).toBe(false);
    expect(harnessB.getSnapshot()?.target.worktreePath).toBe(
      "/worktrees/target-b",
    );

    // Rehydrate from storage (which was updated by selectTarget(ownerA, null))
    await act(async () => {
      await useProjectTargetStore.persist.rehydrate();
    });

    // Owner A does not resurrect
    expect(harnessA.getSnapshot()?.isRoot).toBe(true);
    expect(harnessB.getSnapshot()?.isRoot).toBe(false);
    expect(harnessB.getSnapshot()?.target.worktreePath).toBe(
      "/worktrees/target-b",
    );

    harnessA.cleanup();
    harnessB.cleanup();
  });

  it("provides correct snapshots for special project names (constructor, toString, __proto__)", async () => {
    const specialNames = ["constructor", "toString", "__proto__"] as const;

    for (const name of specialNames) {
      const harness = renderProjectTargetHook(name);
      expect(harness.getSnapshot()?.isRoot).toBe(true);

      act(() => {
        useProjectTargetStore
          .getState()
          .selectTarget(name, `/worktrees/${name}`);
      });
      expect(harness.getSnapshot()?.isRoot).toBe(false);
      expect(harness.getSnapshot()?.target.worktreePath).toBe(
        `/worktrees/${name}`,
      );

      act(() => {
        useProjectTargetStore.getState().selectTarget(name, null);
      });
      expect(harness.getSnapshot()?.isRoot).toBe(true);
      harness.cleanup();
    }
  });
});
