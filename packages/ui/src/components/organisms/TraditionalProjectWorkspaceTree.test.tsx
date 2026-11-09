// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectTargetStore } from "@/stores/project-target.js";
import { explorerTreeScopeKey } from "@/stores/explorer-tree.js";
import type { IntentPayloadMap } from "@/os/intents.js";
import type { FsArborNode } from "@/api/fs-types.js";
import type { FileTreeProps } from "@/components/organisms/FileTree.js";
import { TraditionalProjectWorkspaceTree } from "./TraditionalProjectWorkspaceTree.js";

const mocks = vi.hoisted(() => ({
  fileTreeProps: null as FileTreeProps | null,
  connectionSnapshotByProfile: new Map<
    string,
    {
      owner: { profileId: string; generation: number };
      status: string;
      serverUrl: string;
    } | null
  >(),
}));

vi.mock("@/components/organisms/FileTree.js", () => ({
  FileTree: (props: FileTreeProps) => {
    mocks.fileTreeProps = props;
    return (
      <div data-testid="mock-file-tree">
        <button
          type="button"
          data-testid="mock-open-file-btn"
          onClick={() =>
            props.onFileOpen?.({
              id: "src/index.ts",
              name: "index.ts",
              kind: "file",
            } as FsArborNode)
          }
        >
          Open file
        </button>
      </div>
    );
  },
}));

vi.mock("@/api/connections.js", () => ({
  useConnectionSnapshot: (profileId: string) => {
    return mocks.connectionSnapshotByProfile.get(profileId) ?? null;
  },
  subscribeConnections: () => () => {},
}));

describe("TraditionalProjectWorkspaceTree", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.fileTreeProps = null;
    mocks.connectionSnapshotByProfile.clear();
    useProjectTargetStore.getState().resetTarget({ profileId: "profile-1", project: "dam-hopper" });
    useProjectTargetStore.getState().resetTarget({ profileId: "profile-2", project: "dam-hopper" });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders a region with proper ARIA labeling and mounts FileTree when connected", async () => {
    mocks.connectionSnapshotByProfile.set("profile-1", {
      owner: { profileId: "profile-1", generation: 3 },
      status: "connected",
      serverUrl: "http://localhost:8080",
    });

    await act(async () => {
      root.render(
        <TraditionalProjectWorkspaceTree
          projectName="dam-hopper"
          profileId="profile-1"
          regionId="test-region-id"
        />,
      );
    });

    const region = container.querySelector('[role="region"]')!;
    expect(region).not.toBeNull();
    expect(region.id).toBe("test-region-id");
    expect(region.getAttribute("aria-label")).toBe("dam-hopper files");
    expect(container.querySelector('[data-testid="mock-file-tree"]')).not.toBeNull();
  });

  it("clicking a file emits owner-qualified float file:open payload (AC1)", async () => {
    mocks.connectionSnapshotByProfile.set("profile-1", {
      owner: { profileId: "profile-1", generation: 4 },
      status: "connected",
      serverUrl: "http://localhost:8080",
    });

    useProjectTargetStore
      .getState()
      .selectTarget({ profileId: "profile-1", project: "dam-hopper" }, "/workspace/dam-hopper/wt-feat");

    const onOpenFile = vi.fn();

    await act(async () => {
      root.render(
        <TraditionalProjectWorkspaceTree
          projectName="dam-hopper"
          profileId="profile-1"
          projectRef={{ profileId: "profile-1", project: "dam-hopper" }}
          regionId="tree-region-1"
          onOpenFile={onOpenFile}
        />,
      );
    });

    const openBtn = container.querySelector<HTMLButtonElement>('[data-testid="mock-open-file-btn"]')!;
    act(() => openBtn.click());

    expect(onOpenFile).toHaveBeenCalledOnce();
    const payload: IntentPayloadMap["file:open"] = onOpenFile.mock.calls[0][0];
    expect(payload).toEqual({
      profileId: "profile-1",
      projectId: "dam-hopper",
      worktreeId: "/workspace/dam-hopper/wt-feat",
      target: {
        kind: "project",
        profileId: "profile-1",
        project: "dam-hopper",
        worktreePath: "/workspace/dam-hopper/wt-feat",
      },
      filePath: "src/index.ts",
      mode: "float",
      generation: 4,
    });
  });

  it("disconnected owner renders status notice, does not mount FileTree, and emits nothing", async () => {
    mocks.connectionSnapshotByProfile.set("profile-1", {
      owner: { profileId: "profile-1", generation: 2 },
      status: "disconnected",
      serverUrl: "http://localhost:8080",
    });

    const onOpenFile = vi.fn();

    await act(async () => {
      root.render(
        <TraditionalProjectWorkspaceTree
          projectName="dam-hopper"
          profileId="profile-1"
          regionId="tree-region-disc"
          onOpenFile={onOpenFile}
        />,
      );
    });

    expect(container.querySelector('[data-testid="mock-file-tree"]')).toBeNull();
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("dam-hopper owner is disconnected");
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("missing profileId fails closed, renders notice and does not mount FileTree", async () => {
    const onOpenFile = vi.fn();

    await act(async () => {
      root.render(
        <TraditionalProjectWorkspaceTree
          projectName="unqualified-proj"
          regionId="tree-region-unq"
          onOpenFile={onOpenFile}
        />,
      );
    });

    expect(container.querySelector('[data-testid="mock-file-tree"]')).toBeNull();
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Profile not specified for unqualified-proj");
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("passes target from useProjectTarget directly to FileTree so explorer-tree scope key is preserved (AC3, AC4)", async () => {
    mocks.connectionSnapshotByProfile.set("profile-1", {
      owner: { profileId: "profile-1", generation: 1 },
      status: "connected",
      serverUrl: "http://localhost:8080",
    });

    await act(async () => {
      root.render(
        <TraditionalProjectWorkspaceTree
          projectName="dam-hopper"
          profileId="profile-1"
          regionId="tree-region-scope"
        />,
      );
    });

    expect(mocks.fileTreeProps?.target).toBeDefined();
    const scopeKey1 = explorerTreeScopeKey(mocks.fileTreeProps!.target!);
    expect(scopeKey1).toContain("profile-1");
    expect(scopeKey1).toContain("dam-hopper");

    // Switching worktree produces a stable new worktree scope key
    act(() => {
      useProjectTargetStore
        .getState()
        .selectTarget({ profileId: "profile-1", project: "dam-hopper" }, "/workspace/dam-hopper/wt-2");
    });

    await act(async () => {
      root.render(
        <TraditionalProjectWorkspaceTree
          projectName="dam-hopper"
          profileId="profile-1"
          regionId="tree-region-scope"
        />,
      );
    });

    const scopeKey2 = explorerTreeScopeKey(mocks.fileTreeProps!.target!);
    expect(scopeKey2).toContain("wt-2");
    expect(scopeKey2).not.toEqual(scopeKey1);
  });

  it("isolates targets and generations for two profiles with the same project name", async () => {
    mocks.connectionSnapshotByProfile.set("profile-1", {
      owner: { profileId: "profile-1", generation: 10 },
      status: "connected",
      serverUrl: "http://server-1:8080",
    });
    mocks.connectionSnapshotByProfile.set("profile-2", {
      owner: { profileId: "profile-2", generation: 20 },
      status: "connected",
      serverUrl: "http://server-2:8080",
    });

    const onOpenFileA = vi.fn();
    const onOpenFileB = vi.fn();

    // Render tree for Profile 1
    await act(async () => {
      root.render(
        <TraditionalProjectWorkspaceTree
          projectName="same-project"
          profileId="profile-1"
          regionId="tree-a"
          onOpenFile={onOpenFileA}
        />,
      );
    });

    container.querySelector<HTMLButtonElement>('[data-testid="mock-open-file-btn"]')!.click();
    expect(onOpenFileA).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "profile-1",
        projectId: "same-project",
        generation: 10,
      }),
    );

    // Render tree for Profile 2
    await act(async () => {
      root.render(
        <TraditionalProjectWorkspaceTree
          projectName="same-project"
          profileId="profile-2"
          regionId="tree-b"
          onOpenFile={onOpenFileB}
        />,
      );
    });

    container.querySelector<HTMLButtonElement>('[data-testid="mock-open-file-btn"]')!.click();
    expect(onOpenFileB).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "profile-2",
        projectId: "same-project",
        generation: 20,
      }),
    );
  });

  it("forwards revealRequest prop to FileTree", async () => {
    mocks.connectionSnapshotByProfile.set("profile-1", {
      owner: { profileId: "profile-1", generation: 1 },
      status: "connected",
      serverUrl: "http://localhost:8080",
    });

    const revealRequest = {
      project: "dam-hopper",
      path: "src/app.ts",
      nonce: 12345,
    };

    await act(async () => {
      root.render(
        <TraditionalProjectWorkspaceTree
          projectName="dam-hopper"
          profileId="profile-1"
          regionId="test-region-id"
          revealRequest={revealRequest}
        />,
      );
    });

    expect(mocks.fileTreeProps?.revealRequest).toEqual(revealRequest);
  });
});
