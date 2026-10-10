// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useProjectTarget } from "./use-project-target.js";
import {
  useProjectTargetStore,
  type ProjectTargetSnapshot,
} from "@/stores/project-target.js";
import type { ProjectRef } from "@/api/ownership.js";

function renderProjectTargetHook(
  project: ProjectRef | string | null,
): {
  getSnapshot: () => ProjectTargetSnapshot | null;
  rerender: (nextProject: ProjectRef | string | null) => void;
  cleanup: () => void;
} {
  let latestSnapshot: ProjectTargetSnapshot | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  function Consumer({ currentProject }: { currentProject: ProjectRef | string | null }) {
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
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useProjectTarget", () => {
  beforeEach(() => {
    useProjectTargetStore.setState({
      activeTargetByProject: {},
      unavailableTargetByProject: {},
      unavailableTargetsByProject: {},
    });
  });

  afterEach(() => {
    useProjectTargetStore.setState({
      activeTargetByProject: {},
      unavailableTargetByProject: {},
      unavailableTargetsByProject: {},
    });
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
});
