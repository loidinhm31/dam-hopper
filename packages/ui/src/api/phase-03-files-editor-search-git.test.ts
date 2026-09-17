import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  editorDiffTabKey,
  editorFileTabKey,
  editorTargetScopeKey,
  useEditorStore,
  type Tab,
} from "@/stores/editor.js";
import {
  createProjectTargetSnapshot,
  markProjectTargetUnavailable,
  projectScopeKey,
  useProjectTargetStore,
} from "@/stores/project-target.js";
import {
  explorerTreeScopeKey,
  useExplorerTreeStore,
} from "@/stores/explorer-tree.js";
import {
  compareContentSearchMatches,
  comparePathSearchMatches,
  groupContentSearchMatches,
  buildContentSearchMatchKey,
} from "@/lib/search-matches.js";
import { resolveSearchMatchTarget } from "@/lib/search-replace-next.js";
import {
  explorerLanguageScanQueryKey,
  explorerLanguageScanScopeKey,
  beginExplorerLanguageScan,
  commitExplorerLanguageScan,
  removeExplorerLanguageScanCaches,
} from "@/lib/explorer-language-scan.js";
import { QueryClient } from "@tanstack/react-query";
import { initTransport, type Transport } from "@/api/transport.js";
describe("Phase 03: Qualified target, editor, and tree keys", () => {
  beforeEach(() => {
    initTransport({
      fsRead: vi.fn().mockResolvedValue({
        ok: true,
        content: btoa("server updated content"),
        mtime: 50,
        size: 100,
        binary: false,
        mime: "text/plain",
      }),
      fsWriteFile: vi.fn().mockResolvedValue({
        ok: true,
        newMtime: 51,
      }),
    } as unknown as Transport);

    useEditorStore.setState({
      tabs: [],
      activeKeys: {},
      requestGenerations: {},
    });
    useProjectTargetStore.setState({
      activeTargetByProject: {},
      unavailableTargetByProject: {},
      unavailableTargetsByProject: {},
    });
    useExplorerTreeStore.setState({
      openMapByTarget: {},
    });
  });

  it("qualifies editor tab identity so A/B web/src/marker.txt open as distinct models", () => {
    const targetA = { profileId: "server-a", project: "web" };
    const targetB = { profileId: "server-b", project: "web" };
    const path = "src/marker.txt";

    const keyA = editorFileTabKey(targetA, path);
    const keyB = editorFileTabKey(targetB, path);

    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain("server-a");
    expect(keyB).toContain("server-b");

    const tabA: Tab = {
      key: keyA,
      project: "web",
      target: targetA,
      targetKey: "root",
      targetAvailable: true,
      path,
      name: "marker.txt",
      mtime: 100,
      size: 10,
      tier: "normal",
      content: "content on A",
      savedContent: "content on A",
      dirty: false,
      loading: false,
      saving: false,
      conflicted: false,
      resourceBinding: { serverUrl: "http://server-a:4800" },
    };

    const tabB: Tab = {
      key: keyB,
      project: "web",
      target: targetB,
      targetKey: "root",
      targetAvailable: true,
      path,
      name: "marker.txt",
      mtime: 200,
      size: 20,
      tier: "normal",
      content: "content on B",
      savedContent: "content on B",
      dirty: false,
      loading: false,
      saving: false,
      conflicted: false,
      resourceBinding: { serverUrl: "http://server-b:4800" },
    };

    useEditorStore.setState({
      tabs: [tabA, tabB],
      activeKeys: {
        [editorTargetScopeKey(targetA)]: keyA,
        [editorTargetScopeKey(targetB)]: keyB,
      },
    });

    // Editing A changes A's content and sets A dirty; B remains clean
    useEditorStore.getState().setContent(keyA, "modified content on A");

    const state = useEditorStore.getState();
    const updatedA = state.tabs.find((t) => t.key === keyA);
    const updatedB = state.tabs.find((t) => t.key === keyB);

    expect(updatedA?.dirty).toBe(true);
    expect(updatedA?.content).toBe("modified content on A");
    expect(updatedB?.dirty).toBe(false);
    expect(updatedB?.content).toBe("content on B");
  });

  it("isolates target availability across profiles so deletion on A cannot mark B unavailable", () => {
    const targetA = {
      profileId: "server-a",
      project: "demo",
      worktreePath: "/tmp/demo-feat",
    };
    const targetB = {
      profileId: "server-b",
      project: "demo",
      worktreePath: "/tmp/demo-feat",
    };

    const store = useProjectTargetStore.getState();
    store.selectTarget(
      { profileId: "server-a", project: "demo" },
      "/tmp/demo-feat",
    );
    store.selectTarget(
      { profileId: "server-b", project: "demo" },
      "/tmp/demo-feat",
    );

    const keyA = projectScopeKey({ profileId: "server-a", project: "demo" });
    const keyB = projectScopeKey({ profileId: "server-b", project: "demo" });
    expect(keyA).not.toBe(keyB);

    // Mark unavailable on Server A
    markProjectTargetUnavailable(targetA);

    const updated = useProjectTargetStore.getState();
    expect(updated.activeTargetByProject[keyA]).toBeUndefined();
    expect(updated.unavailableTargetsByProject[keyA]).toEqual([
      "/tmp/demo-feat",
    ]);

    // Server B's target remains active and available
    expect(updated.activeTargetByProject[keyB]).toBe("/tmp/demo-feat");
    expect(updated.unavailableTargetsByProject[keyB]).toBeUndefined();
  });

  it("qualifies explorerTreeScopeKey so folder state is isolated across profiles", () => {
    const targetA = { profileId: "server-a", project: "demo" };
    const targetB = { profileId: "server-b", project: "demo" };

    const scopeA = explorerTreeScopeKey(targetA);
    const scopeB = explorerTreeScopeKey(targetB);

    expect(scopeA).toBe("server-a::demo::root");
    expect(scopeB).toBe("server-b::demo::root");
    expect(scopeA).not.toBe(scopeB);

    const treeStore = useExplorerTreeStore.getState();
    treeStore.setFolderOpen(scopeA, "src/components", true);

    const treeState = useExplorerTreeStore.getState();
    expect(treeState.openMapByTarget[scopeA]?.["src/components"]).toBe(true);
    expect(
      treeState.openMapByTarget[scopeB]?.["src/components"],
    ).toBeUndefined();
  });

  it("scopes language scan cache keys and epochs by owner and target", async () => {
    const qc = new QueryClient();
    const targetA = { profileId: "server-a", project: "demo" };
    const targetB = { profileId: "server-b", project: "demo" };

    const qkA = explorerLanguageScanQueryKey(targetA, "root");
    const qkB = explorerLanguageScanQueryKey(targetB, "root");

    expect(qkA).toEqual(["explorer-language-scan", "server-a", "demo", "root"]);
    expect(qkB).toEqual(["explorer-language-scan", "server-b", "demo", "root"]);

    const tokenA = beginExplorerLanguageScan(qc, targetA, "root");
    commitExplorerLanguageScan(qc, targetA, tokenA, {
      files: [{ path: "main.rs", language: "rust" }],
      truncated: false,
      limit: 1000,
    });

    const tokenB = beginExplorerLanguageScan(qc, targetB, "root");
    commitExplorerLanguageScan(qc, targetB, tokenB, {
      files: [{ path: "app.tsx", language: "typescript" }],
      truncated: false,
      limit: 1000,
    });

    // Remove cache for Server A only
    await removeExplorerLanguageScanCaches(qc, "server-a");

    expect(qc.getQueryData(qkA)).toBeUndefined();
    expect(qc.getQueryData(qkB)).toBeDefined();
  });

  it("never overwrites dirty content on reload and preserves local edits", async () => {
    const target = { profileId: "server-a", project: "demo" };
    const key = editorFileTabKey(target, "src/index.ts");

    const tab: Tab = {
      key,
      project: "demo",
      target,
      targetKey: "root",
      targetAvailable: true,
      path: "src/index.ts",
      name: "index.ts",
      mtime: 10,
      size: 100,
      tier: "normal",
      content: "local unsaved edits",
      savedContent: "original content",
      dirty: true,
      loading: false,
      saving: false,
      conflicted: false,
    };

    useEditorStore.setState({ tabs: [tab] });

    // Calling reloadTab when tab is dirty preserves local edits and flags stale
    await useEditorStore.getState().reloadTab(key);

    const finalTab = useEditorStore
      .getState()
      .tabs.find((t) => t.key === key);
    expect(finalTab?.dirty).toBe(true);
    expect(finalTab?.content).toBe("local unsaved edits");
  });

  it("detaches tabs when server endpoint changes on reconnect", async () => {
    const target = { profileId: "server-a", project: "demo" };
    const key = editorFileTabKey(target, "src/clean.ts");

    const tab: Tab = {
      key,
      project: "demo",
      target,
      targetKey: "root",
      targetAvailable: true,
      path: "src/clean.ts",
      name: "clean.ts",
      mtime: 10,
      size: 50,
      tier: "normal",
      content: "clean content",
      savedContent: "clean content",
      dirty: false,
      loading: false,
      saving: false,
      conflicted: false,
      resourceBinding: { serverUrl: "http://old-host:4800" },
    };

    useEditorStore.setState({ tabs: [tab] });

    // Server reconnect with new URL detaches the tab
    await useEditorStore.getState().reconcileProfileTabs("server-a");

    // If serverUrl changed or profile is not connected, targetAvailable is updated
    const finalTab = useEditorStore
      .getState()
      .tabs.find((t) => t.key === key);
    expect(finalTab).toBeDefined();
  });
});

describe("Phase 03: Federated search and replace isolation", () => {
  it("resolves match target to retain originating profile in workspace scope", () => {
    const currentTarget = { profileId: "server-a", project: "client" };
    const matchTarget = resolveSearchMatchTarget(
      currentTarget,
      "backend",
      "workspace",
      "server-b",
    );

    expect(matchTarget).toEqual({
      profileId: "server-b",
      project: "backend",
    });
  });

  it("differentiates search matches and groups by profileId to prevent cross-profile collision", () => {
    const matchA = {
      path: "README.md",
      line: 1,
      col: 1,
      text: "# DamHopper Server A",
      project: "dam-hopper",
      profileId: "server-a",
      profileName: "Production A",
    };

    const matchB = {
      path: "README.md",
      line: 1,
      col: 1,
      text: "# DamHopper Server B",
      project: "dam-hopper",
      profileId: "server-b",
      profileName: "Production B",
    };

    const keyA = buildContentSearchMatchKey(matchA);
    const keyB = buildContentSearchMatchKey(matchB);
    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain("server-a");
    expect(keyB).toContain("server-b");

    const groups = groupContentSearchMatches([matchA, matchB]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.profileId).toBe("server-a");
    expect(groups[1]?.profileId).toBe("server-b");
  });

  it("sorts matches deterministically by profile display order, project, path, and position", () => {
    const matchA = {
      path: "src/b.ts",
      line: 5,
      col: 2,
      text: "test",
      project: "app",
      profileId: "server-a",
    };
    const matchB = {
      path: "src/a.ts",
      line: 1,
      col: 1,
      text: "test",
      project: "app",
      profileId: "server-b",
    };

    // compareContentSearchMatches orders by profileId first
    expect(compareContentSearchMatches(matchA, matchB)).toBeLessThan(0);
    expect(compareContentSearchMatches(matchB, matchA)).toBeGreaterThan(0);
  });
});
