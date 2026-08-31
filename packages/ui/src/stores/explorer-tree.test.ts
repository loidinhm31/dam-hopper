import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  explorerTreeScopeKey,
  useExplorerTreeStore,
} from "./explorer-tree.js";

function resetStore() {
  useExplorerTreeStore.setState({
    openMapByTarget: {},
  });
}

describe("explorerTreeScopeKey", () => {
  it("derives scope key from string project name", () => {
    expect(explorerTreeScopeKey("my-project")).toBe("my-project::root");
  });

  it("derives scope key from project target object without worktree", () => {
    expect(explorerTreeScopeKey({ project: "my-project" })).toBe(
      "my-project::root",
    );
  });

  it("derives distinct scope key for worktree targets", () => {
    expect(
      explorerTreeScopeKey({
        project: "my-project",
        worktreePath: "/home/user/ws/feat-1",
      }),
    ).toBe("my-project::worktree:/home/user/ws/feat-1");
  });
});

describe("useExplorerTreeStore", () => {
  beforeEach(resetStore);
  afterEach(resetStore);

  it("sets folders as open and closed per target scope", () => {
    const scope1 = "project-1::root";
    const scope2 = "project-2::root";

    useExplorerTreeStore.getState().setFolderOpen(scope1, "src", true);
    useExplorerTreeStore
      .getState()
      .setFolderOpen(scope1, "src/components", true);
    useExplorerTreeStore.getState().setFolderOpen(scope2, "docs", true);

    expect(useExplorerTreeStore.getState().openMapByTarget[scope1]).toEqual({
      src: true,
      "src/components": true,
    });
    expect(useExplorerTreeStore.getState().openMapByTarget[scope2]).toEqual({
      docs: true,
    });

    // Closing a folder deletes the key to keep storage compact
    useExplorerTreeStore
      .getState()
      .setFolderOpen(scope1, "src/components", false);
    expect(useExplorerTreeStore.getState().openMapByTarget[scope1]).toEqual({
      src: true,
    });

    // Setting same state is a no-op
    const prev = useExplorerTreeStore.getState().openMapByTarget;
    useExplorerTreeStore.getState().setFolderOpen(scope1, "src", true);
    expect(useExplorerTreeStore.getState().openMapByTarget).toBe(prev);
  });

  it("ignores invalid inputs gracefully", () => {
    useExplorerTreeStore.getState().setFolderOpen("", "src", true);
    useExplorerTreeStore.getState().setFolderOpen("scope", "", true);
    expect(useExplorerTreeStore.getState().openMapByTarget).toEqual({});
  });

  it("prunes deleted directory and all its descendants", () => {
    const scope = "demo::root";
    const store = useExplorerTreeStore.getState();

    store.setFolderOpen(scope, "src", true);
    store.setFolderOpen(scope, "src/components", true);
    store.setFolderOpen(scope, "src/components/atoms", true);
    store.setFolderOpen(scope, "src/components-other", true);
    store.setFolderOpen(scope, "tests", true);

    useExplorerTreeStore.getState().prunePath(scope, "src/components");

    expect(useExplorerTreeStore.getState().openMapByTarget[scope]).toEqual({
      src: true,
      "src/components-other": true,
      tests: true,
    });
  });

  it("renames folder and updates all descendant paths", () => {
    const scope = "demo::root";
    const store = useExplorerTreeStore.getState();

    store.setFolderOpen(scope, "src", true);
    store.setFolderOpen(scope, "src/old-components", true);
    store.setFolderOpen(scope, "src/old-components/button", true);
    store.setFolderOpen(scope, "src/old-components/button/icons", true);
    store.setFolderOpen(scope, "src/other", true);

    useExplorerTreeStore
      .getState()
      .renamePath(scope, "src/old-components", "src/new-components");

    expect(useExplorerTreeStore.getState().openMapByTarget[scope]).toEqual({
      src: true,
      "src/new-components": true,
      "src/new-components/button": true,
      "src/new-components/button/icons": true,
      "src/other": true,
    });
  });

  it("clears target scope when requested", () => {
    const scope1 = "p1::root";
    const scope2 = "p2::root";

    useExplorerTreeStore.getState().setFolderOpen(scope1, "src", true);
    useExplorerTreeStore.getState().setFolderOpen(scope2, "src", true);

    useExplorerTreeStore.getState().clearTarget(scope1);

    expect(
      useExplorerTreeStore.getState().openMapByTarget[scope1],
    ).toBeUndefined();
    expect(useExplorerTreeStore.getState().openMapByTarget[scope2]).toEqual({
      src: true,
    });
  });
});
