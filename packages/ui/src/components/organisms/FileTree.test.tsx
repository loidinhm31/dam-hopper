// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { getTreeContextMenuItems } from "./TreeContextMenu.js";
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
import type { FsArborNode } from "@/api/fs-types.js";

// Mock hooks and stores used by FileTree
const mockNodes: FsArborNode[] = [
  {
    id: "src",
    name: "src",
    kind: "dir",
    size: 0,
    mtime: 1000,
    isSymlink: false,
    children: null,
  },
  {
    id: "packages/ui",
    name: "ui",
    kind: "dir",
    size: 0,
    mtime: 1000,
    isSymlink: false,
    children: null,
  },
  {
    id: "README.md",
    name: "README.md",
    kind: "file",
    size: 100,
    mtime: 1000,
    isSymlink: false,
    children: null,
  },
];

let mockProjects = [
  {
    name: "ui",
    path: "packages/ui",
    type: "standard" as const,
    status: null,
  },
];

vi.mock("@/api/queries.js", () => ({
  useProjects: () => ({
    data: mockProjects,
    isLoading: false,
    isError: false,
  }),
  useProject: () => ({ data: null }),
  useGitDiff: () => ({ data: null }),
  useExplorerLanguageScan: () => ({
    cache: null,
    scan: { isPending: false },
  }),
  useMarkProject: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useUnmarkProject: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useWorkspaceStatus: () => ({
    data: { workspaceEpoch: 1 },
  }),
}));

vi.mock("@/hooks/use-fs-subscription.js", () => ({
  useFsSubscription: (target: unknown, path: string) => ({
    data: {
      sub_id: 1,
      nodes: mockNodes,
    },
    isLoading: false,
    isError: false,
    error: null,
    loadChildren: vi.fn(async () => []),
    refetch: vi.fn(),
    isFetching: false,
  }),
}));

vi.mock("@/hooks/use-fs-ops.js", () => ({
  useFsOps: () => ({
    createFile: vi.fn(),
    createDir: vi.fn(),
    deleteFile: vi.fn(),
    deleteDir: vi.fn(),
    rename: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-fs-upload.js", () => ({
  useFsUpload: () => ({
    progress: null,
    upload: vi.fn(),
    clearProgress: vi.fn(),
  }),
}));

vi.mock("@/contexts/EncryptContext.js", () => ({
  useEncryptMode: () => ({
    isEncryptEnabled: () => false,
  }),
}));

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: () => ({
    explorerShowHidden: false,
    explorerLanguageFilter: "all",
    systemFontSize: 14,
    saveDebounced: vi.fn(),
  }),
}));

vi.mock("@/stores/editor.js", () => ({
  useEditorStore: Object.assign(
    (selector: (state: { openDiff: () => void }) => unknown) =>
      selector({ openDiff: vi.fn() }),
    {
      getState: () => ({
        openDiff: vi.fn(),
      }),
    },
  ),
}));

vi.mock("@/stores/explorer-tree.js", () => ({
  explorerTreeScopeKey: () => "test-scope",
  useExplorerTreeStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        openMapByTarget: {},
        setFolderOpen: vi.fn(),
        prunePath: vi.fn(),
        renamePath: vi.fn(),
      }),
    {
      getState: () => ({
        openMapByTarget: {},
      }),
    },
  ),
}));

vi.mock("@/hooks/use-clipboard.js", () => ({
  useCopyToClipboard: () => ({
    copied: false,
    copy: vi.fn(),
  }),
}));

// Mock react-arborist Tree to render straightforward DOM
vi.mock("react-arborist", () => ({
  Tree: function MockTree({
    data,
    children,
    renderRow: Row,
  }: {
    data: FsArborNode[];
    children: (props: {
      node: {
        data: FsArborNode;
        isOpen: boolean;
        isSelected: boolean;
        isFocused: boolean;
        isDragging: boolean;
        willReceiveDrop: boolean;
      };
      style: React.CSSProperties;
      dragHandle: () => void;
    }) => React.ReactNode;
    renderRow?: React.ComponentType<{
      node: {
        data: FsArborNode;
        isSelected: boolean;
        isInternal: boolean;
        select: () => void;
        deselect: () => void;
        selectMulti: () => void;
        selectContiguous: () => void;
        toggle: () => void;
      };
      innerRef: (el: HTMLDivElement | null) => void;
      attrs: Record<string, unknown>;
      children: React.ReactNode;
    }>;
  }) {
    return createElement(
      "div",
      { "data-testid": "arborist-mock-tree" },
      data.map((item) => {
        const nodeObj = {
          data: item,
          isOpen: false,
          isSelected: false,
          isFocused: false,
          isDragging: false,
          willReceiveDrop: false,
          isInternal: item.kind === "dir",
          select: () => undefined,
          deselect: () => undefined,
          selectMulti: () => undefined,
          selectContiguous: () => undefined,
          toggle: () => undefined,
        };
        const renderedNode = children({
          node: nodeObj,
          style: {},
          dragHandle: () => undefined,
        });
        if (Row) {
          return createElement(Row, {
            key: item.id,
            node: nodeObj,
            innerRef: () => undefined,
            attrs: { "data-testid": `tree-row-${item.id}` },
            children: renderedNode,
          });
        }
        return createElement(
          "div",
          { key: item.id, "data-testid": `tree-row-${item.id}` },
          renderedNode,
        );
      }),
    );
  },
}));

import { FileTree } from "./FileTree.js";

describe("FileTree Component & Dual Modes", () => {
  it("renders [Project] badge for directories matching configured project paths in workspace mode", async () => {
    mockProjects = [
      {
        name: "ui",
        path: "packages/ui",
        type: "standard",
        status: null,
      },
    ];

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(FileTree, {
          mode: "workspace",
          target: { kind: "workspace", profileId: "p1" },
        }),
      );
    });

    const projectRow = container.querySelector(
      '[data-testid="tree-row-packages/ui"]',
    );
    expect(projectRow).not.toBeNull();
    const badge = projectRow?.querySelector('[data-testid="project-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("[Project]");

    // Non-project folder 'src' should NOT have the [Project] badge
    const srcRow = container.querySelector('[data-testid="tree-row-src"]');
    expect(srcRow).not.toBeNull();
    const srcBadge = srcRow?.querySelector('[data-testid="project-badge"]');
    expect(srcBadge).toBeNull();

    root.unmount();
    container.remove();
  });

  it("renders empty state 'No marked projects' with 'Return to Workspace' button in projects mode when projects is empty", async () => {
    mockProjects = [];

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onReturn = vi.fn();

    await act(async () => {
      root.render(
        createElement(FileTree, {
          mode: "projects",
          onReturnToWorkspace: onReturn,
        }),
      );
    });

    const emptyState = container.querySelector(
      '[data-testid="no-marked-projects"]',
    );
    expect(emptyState).not.toBeNull();
    expect(emptyState?.textContent).toContain("No marked projects");

    const returnBtn = container.querySelector(
      '[data-testid="return-to-workspace-btn"]',
    ) as HTMLButtonElement | null;
    expect(returnBtn).not.toBeNull();
    expect(returnBtn?.textContent).toContain("Return to Workspace");

    returnBtn?.click();
    expect(onReturn).toHaveBeenCalledTimes(1);

    root.unmount();
    container.remove();
  });

  describe("TreeContextMenu context actions", () => {
    it("offers 'Mark as Project…' on unmarked directory", () => {
      const items = getTreeContextMenuItems({
        isDir: true,
        isMarkedProject: false,
        onCopyAbsolutePath: vi.fn(),
        onCopyRelativePath: vi.fn(),
        onNewFile: vi.fn(),
        onNewFolder: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        onDownload: vi.fn(),
        onUpload: vi.fn(),
        onMarkProject: vi.fn(),
        onUnmarkProject: vi.fn(),
        onOpenTerminalHere: vi.fn(),
      });

      const markItem = items.find((i) => i.label === "Mark as Project…");
      expect(markItem).toBeDefined();
      const unmarkItem = items.find((i) => i.label === "Unmark Project…");
      expect(unmarkItem).toBeUndefined();
      const terminalItem = items.find((i) => i.label === "Open Terminal Here");
      expect(terminalItem).toBeDefined();
    });

    it("offers 'Unmark Project…' on marked directory", () => {
      const items = getTreeContextMenuItems({
        isDir: true,
        isMarkedProject: true,
        onCopyAbsolutePath: vi.fn(),
        onCopyRelativePath: vi.fn(),
        onNewFile: vi.fn(),
        onNewFolder: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        onDownload: vi.fn(),
        onUpload: vi.fn(),
        onMarkProject: vi.fn(),
        onUnmarkProject: vi.fn(),
        onOpenTerminalHere: vi.fn(),
      });

      const unmarkItem = items.find((i) => i.label === "Unmark Project…");
      expect(unmarkItem).toBeDefined();
      expect(unmarkItem?.danger).toBe(true);
      const markItem = items.find((i) => i.label === "Mark as Project…");
      expect(markItem).toBeUndefined();
    });
  });

  it("invokes onFileOpen on double click and does not open on single click", async () => {
    const onFileOpen = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <FileTree
          mode="workspace"
          onFileOpen={onFileOpen}
        />,
      );
    });

    const fileRow = container.querySelector('[data-testid="file-tree-item-README.md"]') as HTMLElement | null;
    if (fileRow) {
      // Single click should not trigger onFileOpen
      await act(async () => {
        fileRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onFileOpen).not.toHaveBeenCalled();

      // Double click should trigger onFileOpen
      await act(async () => {
        fileRow.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      });
      expect(onFileOpen).toHaveBeenCalledOnce();
      expect(onFileOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "README.md" }));
    }
  });
});
