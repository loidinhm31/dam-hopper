import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsRead = vi.fn();

vi.mock("@/api/transport.js", () => ({
  getTransport: () => ({ fsRead }),
}));

import { useEditorStore, type Tab } from "./editor.js";

function makeTab(project: string, path: string): Tab {
  return {
    key: `${project}::${path}`,
    project,
    path,
    name: path.split("/").pop() ?? path,
    mtime: 1,
    size: 1,
    tier: "normal",
    content: "",
    savedContent: "",
    dirty: false,
    loading: false,
    saving: false,
    conflicted: false,
  };
}

function resetEditorStore() {
  useEditorStore.setState({ tabs: [], activeKeys: {} });
}

describe("editor store bulk closing", () => {
  beforeEach(resetEditorStore);
  afterEach(resetEditorStore);

  it("closeOthers keeps only the chosen tab within one project", () => {
    const alphaOne = makeTab("alpha", "src/one.ts");
    const alphaTwo = makeTab("alpha", "src/two.ts");
    const betaOne = makeTab("beta", "src/other.ts");

    useEditorStore.setState({
      tabs: [alphaOne, alphaTwo, betaOne],
      activeKeys: {
        alpha: alphaOne.key,
        beta: betaOne.key,
      },
    });

    useEditorStore.getState().closeOthers("alpha", alphaTwo.key);

    const state = useEditorStore.getState();
    expect(state.tabs.map((tab) => tab.key)).toEqual([
      alphaTwo.key,
      betaOne.key,
    ]);
    expect(state.activeKeys).toEqual({
      alpha: alphaTwo.key,
      beta: betaOne.key,
    });
  });

  it("closeAll removes only the current project's tabs and clears its active key", () => {
    const alphaOne = makeTab("alpha", "src/one.ts");
    const alphaTwo = makeTab("alpha", "src/two.ts");
    const betaOne = makeTab("beta", "src/other.ts");

    useEditorStore.setState({
      tabs: [alphaOne, alphaTwo, betaOne],
      activeKeys: {
        alpha: alphaTwo.key,
        beta: betaOne.key,
      },
    });

    useEditorStore.getState().closeAll("alpha");

    const state = useEditorStore.getState();
    expect(state.tabs.map((tab) => tab.key)).toEqual([betaOne.key]);
    expect(state.activeKeys).toEqual({
      alpha: null,
      beta: betaOne.key,
    });
  });
});

describe("editor store Git mutation reconciliation", () => {
  beforeEach(() => {
    resetEditorStore();
    fsRead.mockReset();
  });
  afterEach(resetEditorStore);

  it("silently reloads clean tabs affected by a Git mutation", async () => {
    const tab = makeTab("alpha", "src/one.ts");
    useEditorStore.setState({ tabs: [tab], activeKeys: { alpha: tab.key } });
    fsRead.mockResolvedValue({
      ok: true,
      binary: false,
      content: btoa("from git"),
      mime: "text/plain",
      mtime: 2,
      size: 8,
    });

    await useEditorStore
      .getState()
      .reconcileGitMutationFiles("alpha", ["src/one.ts"]);

    const updated = useEditorStore.getState().tabs[0];
    expect(updated.content).toBe("from git");
    expect(updated.savedContent).toBe("from git");
    expect(updated.dirty).toBe(false);
    expect(updated.stale).toBe(false);
    expect(updated.mtime).toBe(2);
  });

  it("marks dirty tabs stale instead of overwriting unsaved edits", async () => {
    const tab = {
      ...makeTab("alpha", "src/one.ts"),
      content: "local edit",
      savedContent: "base",
      dirty: true,
    };
    useEditorStore.setState({ tabs: [tab], activeKeys: { alpha: tab.key } });

    await useEditorStore
      .getState()
      .reconcileGitMutationFiles("alpha", ["src/one.ts"]);

    const updated = useEditorStore.getState().tabs[0];
    expect(fsRead).not.toHaveBeenCalled();
    expect(updated.content).toBe("local edit");
    expect(updated.dirty).toBe(true);
    expect(updated.stale).toBe(true);
  });

  it("reconciles all open project tabs after branch-level Git mutations", async () => {
    const cleanTab = makeTab("alpha", "src/clean.ts");
    const dirtyTab = {
      ...makeTab("alpha", "src/dirty.ts"),
      content: "local edit",
      savedContent: "base",
      dirty: true,
    };
    const otherProjectTab = makeTab("beta", "src/other.ts");
    useEditorStore.setState({
      tabs: [cleanTab, dirtyTab, otherProjectTab],
      activeKeys: { alpha: cleanTab.key, beta: otherProjectTab.key },
    });
    fsRead.mockResolvedValue({
      ok: true,
      binary: false,
      content: btoa("branch version"),
      mime: "text/plain",
      mtime: 3,
      size: 14,
    });

    await useEditorStore.getState().reconcileGitProjectFiles("alpha");

    const tabs = useEditorStore.getState().tabs;
    expect(tabs.find((tab) => tab.key === cleanTab.key)?.content).toBe(
      "branch version",
    );
    expect(tabs.find((tab) => tab.key === dirtyTab.key)?.stale).toBe(true);
    expect(tabs.find((tab) => tab.key === dirtyTab.key)?.content).toBe(
      "local edit",
    );
    expect(tabs.find((tab) => tab.key === otherProjectTab.key)?.content).toBe(
      "",
    );
  });
});
