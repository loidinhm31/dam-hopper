import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsRead = vi.fn();
const fsWriteFile = vi.fn();

vi.mock("@/api/transport.js", () => ({
  getTransport: () => ({ fsRead, fsWriteFile }),
}));

import {
  countDirtyTabsForTarget,
  editorFileTabKey,
  editorTargetScopeKey,
  migrateEditorState,
  useEditorStore,
  type Tab,
} from "./editor.js";

function makeTab(project: string, path: string): Tab {
  const target = { project } as const;
  return {
    key: editorFileTabKey(target, path),
    project,
    target,
    targetKey: "root",
    targetAvailable: true,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

type SuccessfulRead = {
  ok: true;
  binary: false;
  content: string;
  mime: string;
  mtime: number;
  size: number;
};

function resetEditorStore() {
  useEditorStore.setState({
    tabs: [],
    activeKeys: {},
    requestGenerations: {},
  });
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
        [editorTargetScopeKey({ project: "alpha" })]: alphaOne.key,
        [editorTargetScopeKey({ project: "beta" })]: betaOne.key,
      },
    });

    useEditorStore.getState().closeOthers("alpha", alphaTwo.key);

    const state = useEditorStore.getState();
    expect(state.tabs.map((tab) => tab.key)).toEqual([
      alphaTwo.key,
      betaOne.key,
    ]);
    expect(state.activeKeys).toEqual({
      [editorTargetScopeKey({ project: "alpha" })]: alphaTwo.key,
      [editorTargetScopeKey({ project: "beta" })]: betaOne.key,
    });
  });

  it("closeAll removes only the current project's tabs and clears its active key", () => {
    const alphaOne = makeTab("alpha", "src/one.ts");
    const alphaTwo = makeTab("alpha", "src/two.ts");
    const betaOne = makeTab("beta", "src/other.ts");

    useEditorStore.setState({
      tabs: [alphaOne, alphaTwo, betaOne],
      activeKeys: {
        [editorTargetScopeKey({ project: "alpha" })]: alphaTwo.key,
        [editorTargetScopeKey({ project: "beta" })]: betaOne.key,
      },
    });

    useEditorStore.getState().closeAll("alpha");

    const state = useEditorStore.getState();
    expect(state.tabs.map((tab) => tab.key)).toEqual([betaOne.key]);
    expect(state.activeKeys).toEqual({
      [editorTargetScopeKey({ project: "beta" })]: betaOne.key,
    });
  });
});

describe("editor store Git mutation reconciliation", () => {
  beforeEach(() => {
    resetEditorStore();
    fsRead.mockReset();
    fsWriteFile.mockReset();
  });
  afterEach(resetEditorStore);

  it("silently reloads clean tabs affected by a Git mutation", async () => {
    const tab = makeTab("alpha", "src/one.ts");
    useEditorStore.setState({
      tabs: [tab],
      activeKeys: { [editorTargetScopeKey({ project: "alpha" })]: tab.key },
    });
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
    useEditorStore.setState({
      tabs: [tab],
      activeKeys: { [editorTargetScopeKey({ project: "alpha" })]: tab.key },
    });

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
      activeKeys: {
        [editorTargetScopeKey({ project: "alpha" })]: cleanTab.key,
        [editorTargetScopeKey({ project: "beta" })]: otherProjectTab.key,
      },
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

describe("editor store project target isolation", () => {
  beforeEach(() => {
    resetEditorStore();
    fsRead.mockReset();
    fsWriteFile.mockReset();
  });
  afterEach(resetEditorStore);

  it("counts dirty tabs only for the exact project target", () => {
    const worktreeTarget = {
      project: "alpha",
      worktreePath: "/tmp/alpha-wt",
    } as const;
    const worktreeTab = {
      ...makeTab("alpha", "src/one.ts"),
      target: worktreeTarget,
      targetKey: "worktree:/tmp/alpha-wt",
      dirty: true,
    };
    const rootTab = { ...makeTab("alpha", "src/two.ts"), dirty: true };
    const otherProjectTab = { ...makeTab("beta", "src/one.ts"), dirty: true };

    expect(
      countDirtyTabsForTarget(
        [worktreeTab, rootTab, otherProjectTab],
        worktreeTarget,
      ),
    ).toBe(1);
    expect(
      countDirtyTabsForTarget([worktreeTab, rootTab, otherProjectTab], {
        project: "alpha",
      }),
    ).toBe(1);
  });

  it("keeps same-path root and worktree tabs independent", async () => {
    fsRead.mockResolvedValue({
      ok: true,
      binary: false,
      content: btoa("target content"),
      mime: "text/plain",
      mtime: 2,
      size: 14,
    });
    const node = {
      id: "src/one.ts",
      name: "one.ts",
      kind: "file" as const,
      size: 1,
      mtime: 1,
      isSymlink: false,
      children: null,
    };

    await useEditorStore.getState().open({ project: "alpha" }, node);
    await useEditorStore
      .getState()
      .open({ project: "alpha", worktreePath: "/tmp/alpha-wt" }, node);

    const tabs = useEditorStore.getState().tabs;
    expect(tabs).toHaveLength(2);
    expect(new Set(tabs.map((tab) => tab.key)).size).toBe(2);
    expect(tabs.map((tab) => tab.target.worktreePath)).toEqual([
      undefined,
      "/tmp/alpha-wt",
    ]);
    expect(
      useEditorStore.getState().activeKeys[
        editorTargetScopeKey({ project: "alpha" })
      ],
    ).toBe(tabs[0]?.key);
    expect(
      useEditorStore.getState().activeKeys[
        editorTargetScopeKey({
          project: "alpha",
          worktreePath: "/tmp/alpha-wt",
        })
      ],
    ).toBe(tabs[1]?.key);
    expect(fsRead).toHaveBeenNthCalledWith(
      1,
      { project: "alpha" },
      "src/one.ts",
    );
    expect(fsRead).toHaveBeenNthCalledWith(
      2,
      { project: "alpha", worktreePath: "/tmp/alpha-wt" },
      "src/one.ts",
    );
  });

  it("migrates legacy root-only persisted tabs to target-scoped keys", () => {
    const legacyKey = "alpha::src/one.ts";
    const migrated = migrateEditorState({
      tabs: [
        {
          key: legacyKey,
          project: "alpha",
          path: "src/one.ts",
          name: "one.ts",
          mtime: 1,
          size: 1,
          tier: "normal",
        },
      ],
      activeKeys: { alpha: legacyKey },
    });

    expect(migrated.tabs[0]?.target).toEqual({ project: "alpha" });
    expect(migrated.tabs[0]?.key).not.toBe(legacyKey);
    expect(
      migrated.activeKeys[editorTargetScopeKey({ project: "alpha" })],
    ).toBe(migrated.tabs[0]?.key);
  });

  it("preserves dirty edits while a worktree is unavailable and blocks writes", async () => {
    const target = { project: "alpha", worktreePath: "/tmp/alpha-wt" } as const;
    const tab = {
      ...makeTab("alpha", "src/one.ts"),
      key: editorFileTabKey(target, "src/one.ts"),
      target,
      targetKey: "worktree:/tmp/alpha-wt",
      content: "local edit",
      savedContent: "base",
      dirty: true,
    };
    useEditorStore.setState({
      tabs: [tab],
      activeKeys: { [editorTargetScopeKey(target)]: tab.key },
    });

    useEditorStore.getState().markTargetUnavailable("alpha", "/tmp/alpha-wt");
    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      dirty: true,
      content: "local edit",
      targetAvailable: false,
    });
    expect(await useEditorStore.getState().save(tab.key)).toBe(false);
    expect(fsWriteFile).not.toHaveBeenCalled();

    useEditorStore.getState().markTargetAvailable("alpha", "/tmp/alpha-wt");
    fsWriteFile.mockResolvedValue({ ok: true, newMtime: 3 });
    expect(await useEditorStore.getState().save(tab.key)).toBe(true);
    expect(fsWriteFile).toHaveBeenCalledWith(
      target,
      "src/one.ts",
      "local edit",
      1,
    );
  });

  it("reconciles only the target scope affected by a Git mutation", async () => {
    const rootTab = makeTab("alpha", "src/one.ts");
    const target = { project: "alpha", worktreePath: "/tmp/alpha-wt" } as const;
    const worktreeTab = {
      ...makeTab("alpha", "src/one.ts"),
      key: editorFileTabKey(target, "src/one.ts"),
      target,
      targetKey: "worktree:/tmp/alpha-wt",
    };
    useEditorStore.setState({ tabs: [rootTab, worktreeTab], activeKeys: {} });
    fsRead.mockResolvedValue({
      ok: true,
      binary: false,
      content: btoa("worktree"),
      mime: "text/plain",
      mtime: 4,
      size: 8,
    });

    await useEditorStore
      .getState()
      .reconcileGitMutationFiles(target, ["src/one.ts"]);

    expect(useEditorStore.getState().tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: rootTab.key, content: "" }),
        expect.objectContaining({ key: worktreeTab.key, content: "worktree" }),
      ]),
    );
    expect(fsRead).toHaveBeenCalledWith(target, "src/one.ts");
  });

  it("ignores a late response after a same-key tab is closed and reopened", async () => {
    const oldResponse = deferred<SuccessfulRead>();
    const newResponse = deferred<SuccessfulRead>();
    fsRead
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementationOnce(() => newResponse.promise);
    const node = {
      id: "src/one.ts",
      name: "one.ts",
      kind: "file" as const,
      size: 1,
      mtime: 1,
      isSymlink: false,
      children: null,
    };
    const oldTab = {
      ...makeTab("alpha", node.id),
      content: "before reload",
      savedContent: "before reload",
      hydrated: false,
    };
    useEditorStore.setState({
      tabs: [oldTab],
      activeKeys: { [editorTargetScopeKey("alpha")]: oldTab.key },
    });

    const oldReload = useEditorStore.getState().reloadTab(oldTab.key);
    await Promise.resolve();
    useEditorStore.getState().close(oldTab.key);
    const newOpen = useEditorStore.getState().open("alpha", node);
    await Promise.resolve();

    oldResponse.resolve({
      ok: true,
      binary: false,
      content: btoa("stale response"),
      mime: "text/plain",
      mtime: 2,
      size: 14,
    });
    newResponse.resolve({
      ok: true,
      binary: false,
      content: btoa("new tab content"),
      mime: "text/plain",
      mtime: 3,
      size: 15,
    });
    await Promise.all([oldReload, newOpen]);

    expect(useEditorStore.getState().tabs).toEqual([
      expect.objectContaining({
        key: oldTab.key,
        content: "new tab content",
        savedContent: "new tab content",
      }),
    ]);
  });

  it("invalidates external async work when a same-key tab is closed", () => {
    const tab = makeTab("alpha", "src/one.ts");
    useEditorStore.setState({ tabs: [tab] });

    const generation = useEditorStore.getState().beginAsyncRequest(tab.key);
    expect(
      useEditorStore.getState().isCurrentAsyncRequest(tab.key, generation),
    ).toBe(true);

    useEditorStore.getState().close(tab.key);

    expect(
      useEditorStore.getState().isCurrentAsyncRequest(tab.key, generation),
    ).toBe(false);
  });
});

describe("editor store video guards", () => {
  beforeEach(() => {
    resetEditorStore();
    fsRead.mockReset();
    fsWriteFile.mockReset();
  });
  afterEach(resetEditorStore);

  it("opens a recognized video without fsRead and marks it ready immediately", async () => {
    await useEditorStore.getState().open("alpha", {
      id: "clips/demo.WEBM",
      name: "demo.WEBM",
      kind: "file",
      size: 3 * 1024 * 1024 * 1024,
      mtime: 1,
      isSymlink: false,
      children: null,
    });

    const tab = useEditorStore.getState().tabs[0];
    expect(tab.tier).toBe("video");
    expect(tab.loading).toBe(false);
    expect(fsRead).not.toHaveBeenCalled();
  });

  it("never reads or writes hydrated/reconciled video tabs", async () => {
    const tab = {
      ...makeTab("alpha", "clips/demo.mp4"),
      name: "demo.mp4",
      // Mirrors a persisted tab created before the video tier existed.
      tier: "large" as const,
      hydrated: true,
      dirty: true,
    };
    useEditorStore.setState({
      tabs: [tab],
      activeKeys: { [editorTargetScopeKey({ project: "alpha" })]: tab.key },
    });

    await useEditorStore.getState().loadContent(tab.key);
    await useEditorStore.getState().save(tab.key);
    await useEditorStore.getState().forceOverwrite(tab.key);
    await useEditorStore.getState().reconcileGitProjectFiles("alpha");

    expect(fsRead).not.toHaveBeenCalled();
    expect(fsWriteFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      tier: "video",
      hydrated: false,
      previewRevision: 1,
    });
  });

  it("opens a large image without fsRead and marks it ready immediately", async () => {
    await useEditorStore.getState().open("alpha", {
      id: "images/preview.WEBP",
      name: "preview.WEBP",
      kind: "file",
      size: 3 * 1024 * 1024 * 1024,
      mtime: 1,
      isSymlink: false,
      children: null,
    });

    const tab = useEditorStore.getState().tabs[0];
    expect(tab.tier).toBe("image");
    expect(tab.loading).toBe(false);
    expect(fsRead).not.toHaveBeenCalled();
  });

  it("never reads or writes hydrated/reconciled image tabs", async () => {
    const tab = {
      ...makeTab("alpha", "images/preview.png"),
      name: "preview.png",
      // Mirrors a persisted tab created before the image tier existed.
      tier: "large" as const,
      hydrated: true,
      dirty: true,
    };
    useEditorStore.setState({
      tabs: [tab],
      activeKeys: { [editorTargetScopeKey({ project: "alpha" })]: tab.key },
    });

    await useEditorStore.getState().loadContent(tab.key);
    await useEditorStore.getState().save(tab.key);
    await useEditorStore.getState().forceOverwrite(tab.key);
    useEditorStore.setState((state) => ({
      tabs: state.tabs.map((candidate) =>
        candidate.key === tab.key ? { ...candidate, dirty: false } : candidate,
      ),
    }));
    await useEditorStore.getState().reconcileGitProjectFiles("alpha");

    expect(fsRead).not.toHaveBeenCalled();
    expect(fsWriteFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      tier: "image",
      hydrated: false,
      previewRevision: 1,
    });
  });

  it("normalizes dirty preview tabs during Git reconciliation", async () => {
    const tab = {
      ...makeTab("alpha", "images/preview.png"),
      name: "preview.png",
      tier: "image" as const,
      dirty: true,
      saving: true,
      conflicted: true,
      stale: true,
    };
    useEditorStore.setState({
      tabs: [tab],
      activeKeys: { [editorTargetScopeKey({ project: "alpha" })]: tab.key },
    });

    await useEditorStore
      .getState()
      .reconcileGitMutationFiles("alpha", [tab.path]);

    expect(fsRead).not.toHaveBeenCalled();
    expect(fsWriteFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      tier: "image",
      dirty: false,
      saving: false,
      conflicted: false,
      stale: false,
      hydrated: false,
      previewRevision: 1,
    });
  });
});

describe("editor store view state persistence and hydration", () => {
  beforeEach(resetEditorStore);
  afterEach(resetEditorStore);

  it("saveViewState updates viewState on the specified tab key", () => {
    const tab1 = makeTab("alpha", "src/one.ts");
    const tab2 = makeTab("alpha", "src/two.ts");
    useEditorStore.setState({ tabs: [tab1, tab2] });

    const mockViewState = {
      cursorState: [{ position: { lineNumber: 42, column: 10 } }],
      viewState: { scrollLeft: 0, firstPosition: { lineNumber: 35, column: 1 } },
    };

    useEditorStore.getState().saveViewState(tab1.key, mockViewState);

    const tabs = useEditorStore.getState().tabs;
    expect(tabs.find((t) => t.key === tab1.key)?.viewState).toEqual(mockViewState);
    expect(tabs.find((t) => t.key === tab2.key)?.viewState).toBeUndefined();
  });

  it("migrateEditorState preserves viewState from persisted storage", () => {
    const sampleViewState = {
      cursorState: [{ position: { lineNumber: 120, column: 5 } }],
      viewState: { scrollLeft: 0, firstPosition: { lineNumber: 110, column: 1 } },
    };

    const persisted = {
      tabs: [
        {
          key: JSON.stringify(["file", "alpha", "root", "src/app.tsx"]),
          project: "alpha",
          path: "src/app.tsx",
          name: "app.tsx",
          mtime: 12345,
          size: 678,
          tier: "normal",
          viewState: sampleViewState,
        },
      ],
      activeKeys: {
        "alpha::root": JSON.stringify(["file", "alpha", "root", "src/app.tsx"]),
      },
    };

    const migrated = migrateEditorState(persisted);
    expect(migrated.tabs).toHaveLength(1);
    expect(migrated.tabs[0].viewState).toEqual(sampleViewState);
    expect(migrated.tabs[0].hydrated).toBe(true);
  });

  it("migrateEditorState safely handles missing or non-object viewState", () => {
    const persisted = {
      tabs: [
        {
          key: JSON.stringify(["file", "alpha", "root", "src/no-vs.ts"]),
          project: "alpha",
          path: "src/no-vs.ts",
          tier: "normal",
        },
        {
          key: JSON.stringify(["file", "alpha", "root", "src/invalid-vs.ts"]),
          project: "alpha",
          path: "src/invalid-vs.ts",
          tier: "normal",
          viewState: "not-an-object",
        },
        {
          key: JSON.stringify(["file", "alpha", "root", "src/null-vs.ts"]),
          project: "alpha",
          path: "src/null-vs.ts",
          tier: "normal",
          viewState: null,
        },
      ],
      activeKeys: {},
    };

    const migrated = migrateEditorState(persisted);
    expect(migrated.tabs).toHaveLength(3);
    expect(migrated.tabs[0].viewState).toBeUndefined();
    expect(migrated.tabs[1].viewState).toBeUndefined();
    expect(migrated.tabs[2].viewState).toBeUndefined();
  });

  it("retains viewState after loadContent executes on a hydrated tab", async () => {
    const sampleViewState = {
      cursorState: [{ position: { lineNumber: 88, column: 1 } }],
      viewState: { scrollLeft: 0, firstPosition: { lineNumber: 80, column: 1 } },
    };

    const tab: Tab = {
      ...makeTab("alpha", "src/main.ts"),
      hydrated: true,
      viewState: sampleViewState,
    };

    useEditorStore.setState({
      tabs: [tab],
      activeKeys: { [editorTargetScopeKey({ project: "alpha" })]: tab.key },
    });

    fsRead.mockResolvedValueOnce({
      ok: true,
      binary: false,
      content: btoa("console.log('hello');"),
      mime: "text/typescript",
      mtime: 2,
      size: 21,
    } as SuccessfulRead);

    await useEditorStore.getState().loadContent(tab.key);

    const updatedTab = useEditorStore.getState().tabs[0];
    expect(updatedTab.hydrated).toBe(false);
    expect(updatedTab.content).toBe("console.log('hello');");
    expect(updatedTab.viewState).toEqual(sampleViewState);
  });
});
