// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffFileEntry, GitLogEntry } from "@/api/client.js";
import type { FsArborNode } from "@/api/fs-types.js";
import { ContextMenu } from "@/components/ui/ContextMenu.js";
import { CommitFileContextMenu } from "./CommitDetailsPanel.js";
import { GitContextMenuPopover } from "./ChangedFilesList.js";
import {
  EditorTabContextMenu,
  getEditorTabContextMenuItems,
} from "./EditorTabContextMenu.js";
import {
  GitBranchContextMenu,
  getDeleteBranchMenuState,
} from "./GitBranchContextMenu.js";
import { HistoryContextMenu } from "./GitLogTree.js";
import { TerminalDiagnosticsContextMenu } from "./TerminalDiagnosticsContextMenu.js";
import { TreeContextMenu } from "./TreeContextMenu.js";
import { FileTree } from "./FileTree.js";

const fileTreeHarness = vi.hoisted(() => ({
  node: {
    id: "src/main.ts",
    name: "main.ts",
    kind: "file",
    size: 42,
    mtime: 0,
    isSymlink: false,
    children: null,
  },
  nodes: [] as FsArborNode[],
  treeRenderCount: 0,
  onMove: undefined as
    | undefined
    | ((args: {
        dragIds: string[];
        parentId: string | null;
        parentNode: { data: { id: string; kind: "file" | "dir" } } | null;
      }) => Promise<void>),
  selectedNodes: [] as Array<{ id: string; data: typeof fileTreeHarness.node }>,
  selected: false,
  dragHandle: vi.fn(),
  upload: vi.fn(),
  ops: {
    createFile: vi.fn().mockResolvedValue({ ok: true }),
    createDir: vi.fn().mockResolvedValue({ ok: true }),
    rename: vi.fn().mockResolvedValue({ ok: true }),
    deleteEntry: vi.fn().mockResolvedValue({ ok: true }),
    move: vi.fn().mockResolvedValue({ ok: true }),
    download: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("react-arborist", async () => {
  const React = await import("react");
  return {
    Tree: React.forwardRef(function VirtualTree(
      {
        children,
        onMove,
      }: {
        children: (props: unknown) => React.ReactNode;
        onMove: typeof fileTreeHarness.onMove;
      },
      ref,
    ) {
      React.useImperativeHandle(ref, () => ({
        get selectedNodes() {
          return fileTreeHarness.selectedNodes;
        },
        focus: vi.fn(),
      }));
      fileTreeHarness.treeRenderCount += 1;
      fileTreeHarness.onMove = onMove;
      return React.createElement(
        "div",
        { "data-testid": "virtual-tree" },
        children({
          node: {
            data: fileTreeHarness.node,
            isSelected: fileTreeHarness.selected,
            isFocused: true,
            isOpen: false,
            isDragging: false,
            willReceiveDrop: false,
            toggle: vi.fn(),
          },
          style: {},
          dragHandle: fileTreeHarness.dragHandle,
          tabIndex: 0,
          "data-testid": "virtual-tree-row",
        }),
      );
    }),
  };
});

vi.mock("@/hooks/use-fs-subscription.js", () => ({
  useFsSubscription: () => ({
    data: { nodes: fileTreeHarness.nodes },
    isLoading: false,
    isError: false,
    error: null,
    loadChildren: vi.fn(),
    refetch: vi.fn(),
    isFetching: false,
  }),
}));

vi.mock("@/hooks/use-fs-ops.js", () => ({
  useFsOps: () => fileTreeHarness.ops,
}));

vi.mock("@/hooks/use-fs-upload.js", () => ({
  useFsUpload: () => ({
    progress: null,
    upload: fileTreeHarness.upload,
    clearProgress: vi.fn(),
  }),
}));

vi.mock("@/api/queries.js", () => ({
  useGitDiff: () => ({ data: undefined }),
  useProject: () => ({ data: { path: "/workspace/demo" } }),
  useExplorerLanguageScan: () => ({
    cache: null,
    scan: {
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
      mutateAsync: vi.fn(),
    },
  }),
}));

vi.mock("@/contexts/EncryptContext.js", () => ({
  useEncryptMode: () => ({ isEncryptEnabled: () => false }),
}));

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: () => ({
    explorerShowHidden: true,
    saveDebounced: vi.fn(),
  }),
}));

vi.mock("@/stores/editor.js", () => ({
  useEditorStore: (selector: (state: { openDiff: () => void }) => unknown) =>
    selector({ openDiff: vi.fn() }),
}));

vi.mock("@/hooks/use-clipboard.js", () => ({
  useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

async function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

async function openMenu(trigger: HTMLElement) {
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        clientX: 80,
        clientY: 60,
      }),
    );
  });
}

async function pressKey(target: Element | null, key: string, shiftKey = false) {
  expect(target).not.toBeNull();
  await act(async () => {
    target?.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        shiftKey,
      }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

beforeEach(() => {
  fileTreeHarness.node = {
    id: "src/main.ts",
    name: "main.ts",
    kind: "file",
    size: 42,
    mtime: 0,
    isSymlink: false,
    children: null,
  };
  fileTreeHarness.nodes = [fileTreeHarness.node];
  fileTreeHarness.treeRenderCount = 0;
  fileTreeHarness.onMove = undefined;
  fileTreeHarness.selectedNodes = [];
  fileTreeHarness.selected = false;
  fileTreeHarness.dragHandle.mockClear();
  fileTreeHarness.upload.mockClear();
  Object.values(fileTreeHarness.ops).forEach((operation) =>
    operation.mockClear(),
  );
  globalThis.ResizeObserver = class {
    disconnect() {}
    observe() {}
    unobserve() {}
  };
});

function treeHandlers() {
  return {
    onCopyAbsolutePath: vi.fn(),
    onCopyRelativePath: vi.fn(),
    onNewFile: vi.fn(),
    onNewFolder: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onDownload: vi.fn(),
    onUpload: vi.fn(),
  };
}

describe("migrated context-menu consumers", () => {
  it("preserves tree actions and closes after one selected action", async () => {
    const handlers = treeHandlers();

    await mount(
      <TreeContextMenu {...handlers} isDir={false}>
        <button data-trigger="tree" type="button">
          README.md
        </button>
      </TreeContextMenu>,
    );

    await openMenu(
      document.querySelector<HTMLElement>('[data-trigger="tree"]')!,
    );
    const rename = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === "Rename");
    expect(rename).not.toBeUndefined();
    await act(async () => rename?.click());

    expect(handlers.onRename).toHaveBeenCalledOnce();
  });

  it("keeps a virtual file row mounted while targeting its download action", async () => {
    await mount(<FileTree project="demo" />);
    const row = document.querySelector<HTMLElement>(
      "[data-testid=virtual-tree-row]",
    );
    expect(row).not.toBeNull();

    await openMenu(row!);
    expect(fileTreeHarness.treeRenderCount).toBe(1);
    expect(fileTreeHarness.dragHandle).toHaveBeenCalledWith(row);
    expect(row?.isConnected).toBe(true);

    const download = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ].find((item) => item.textContent === "Download");
    await act(async () => download?.click());
    expect(fileTreeHarness.ops.download).toHaveBeenCalledWith(
      "src/main.ts",
      42,
    );
  });

  it("opens and dismisses a virtual row menu from the keyboard", async () => {
    await mount(<FileTree project="demo" />);
    const row = document.querySelector<HTMLElement>(
      "[data-testid=virtual-tree-row]",
    );
    expect(row).not.toBeNull();

    row?.focus();
    await pressKey(row, "ContextMenu");
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(fileTreeHarness.treeRenderCount).toBe(1);

    await pressKey(document.activeElement, "Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(row);

    await pressKey(row, "F10", true);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await pressKey(document.activeElement, "Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("binds directory uploads to the originating virtual row", async () => {
    fileTreeHarness.node = {
      id: "src/components",
      name: "components",
      kind: "dir",
      size: 0,
      mtime: 0,
      isSymlink: false,
      children: [],
    };
    fileTreeHarness.nodes = [fileTreeHarness.node];
    await mount(<FileTree project="demo" />);
    const row = document.querySelector<HTMLElement>(
      "[data-testid=virtual-tree-row]",
    );
    expect(row).not.toBeNull();

    await openMenu(row!);
    const uploadHere = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ].find((item) => item.textContent === "Upload Here");
    await act(async () => uploadHere?.click());

    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["icon"], "icon.svg", {
      type: "image/svg+xml",
    });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () =>
      input?.dispatchEvent(new Event("change", { bubbles: true })),
    );

    expect(fileTreeHarness.upload).toHaveBeenCalledWith("src/components", file);
  });

  it("creates a file at project root from the Explorer toolbar", async () => {
    await mount(<FileTree project="demo" />);
    const action = document.querySelector<HTMLButtonElement>(
      '[aria-label="New File in project root"]',
    );
    await act(async () => action?.click());

    const input = document.querySelector<HTMLInputElement>("#name");
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "root.ts");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Create File")
        ?.click(),
    );

    expect(fileTreeHarness.ops.createFile).toHaveBeenCalledWith("root.ts");
  });

  it("renames once through the focus-safe dialog", async () => {
    await mount(<FileTree project="demo" />);
    const row = document.querySelector<HTMLElement>(
      "[data-testid=virtual-tree-row]",
    );
    await openMenu(row!);
    await act(async () =>
      [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
        .find((item) => item.textContent === "Rename")
        ?.click(),
    );

    const input = document.querySelector<HTMLInputElement>("#rename-item-name");
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "app.ts");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Rename")
        ?.click(),
    );

    expect(fileTreeHarness.ops.rename).toHaveBeenCalledTimes(1);
    expect(fileTreeHarness.ops.rename).toHaveBeenCalledWith(
      "src/main.ts",
      "src/app.ts",
    );
  });

  it("closes the rename dialog and reports a rejected filesystem request", async () => {
    fileTreeHarness.ops.rename.mockRejectedValueOnce(new Error("offline"));
    await mount(<FileTree project="demo" />);
    const row = document.querySelector<HTMLElement>(
      "[data-testid=virtual-tree-row]",
    );
    await openMenu(row!);
    await act(async () =>
      [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
        .find((item) => item.textContent === "Rename")
        ?.click(),
    );
    const input = document.querySelector<HTMLInputElement>("#rename-item-name");
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "offline.ts");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Rename")
        ?.click(),
    );
    expect(fileTreeHarness.ops.rename).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#rename-item-name")).toBeNull();
    expect(document.body.textContent).toContain("offline");
  });

  it("deletes the selected entries once and ignores selected descendants", async () => {
    fileTreeHarness.node = {
      id: "src",
      name: "src",
      kind: "dir",
      size: 0,
      mtime: 0,
      isSymlink: false,
      children: [],
    };
    fileTreeHarness.nodes = [fileTreeHarness.node];
    fileTreeHarness.selected = true;
    fileTreeHarness.selectedNodes = [
      { id: "src", data: fileTreeHarness.node },
      {
        id: "src/main.ts",
        data: {
          ...fileTreeHarness.node,
          id: "src/main.ts",
          name: "main.ts",
          kind: "file",
          children: null,
        },
      },
    ];
    await mount(<FileTree project="demo" />);
    const row = document.querySelector<HTMLElement>(
      "[data-testid=virtual-tree-row]",
    );
    await openMenu(row!);
    await act(async () =>
      [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
        .find((item) => item.textContent === "Delete")
        ?.click(),
    );
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Delete")
        ?.click(),
    );

    expect(fileTreeHarness.ops.deleteEntry).toHaveBeenCalledTimes(1);
    expect(fileTreeHarness.ops.deleteEntry).toHaveBeenCalledWith("src");
  });

  it("does not delete when Enter is pressed on the cancel control", async () => {
    await mount(<FileTree project="demo" />);
    const row = document.querySelector<HTMLElement>(
      "[data-testid=virtual-tree-row]",
    );
    await openMenu(row!);
    await act(async () =>
      [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
        .find((item) => item.textContent === "Delete")
        ?.click(),
    );
    const cancel = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Cancel");
    expect(cancel).not.toBeNull();
    cancel?.focus();
    await act(async () =>
      cancel?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      ),
    );
    expect(fileTreeHarness.ops.deleteEntry).not.toHaveBeenCalled();
  });

  it("moves every selected top-level path in a deterministic order", async () => {
    fileTreeHarness.nodes = [
      {
        id: "README.md",
        name: "README.md",
        kind: "file",
        size: 1,
        mtime: 0,
        isSymlink: false,
        children: null,
      },
      {
        id: "src",
        name: "src",
        kind: "dir",
        size: 0,
        mtime: 0,
        isSymlink: false,
        children: [fileTreeHarness.node],
      },
      {
        id: "dest",
        name: "dest",
        kind: "dir",
        size: 0,
        mtime: 0,
        isSymlink: false,
        children: [],
      },
    ];
    await mount(<FileTree project="demo" />);
    await fileTreeHarness.onMove?.({
      dragIds: ["src/main.ts", "src", "README.md"],
      parentId: "dest",
      parentNode: { data: { id: "dest", kind: "dir" } },
    });

    expect(fileTreeHarness.ops.move).toHaveBeenNthCalledWith(
      1,
      "README.md",
      "dest/README.md",
    );
    expect(fileTreeHarness.ops.move).toHaveBeenNthCalledWith(
      2,
      "src",
      "dest/src",
    );
    expect(fileTreeHarness.ops.move).toHaveBeenCalledTimes(2);
  });

  it("continues a bulk move after one rejected request", async () => {
    fileTreeHarness.nodes = [
      {
        id: "README.md",
        name: "README.md",
        kind: "file",
        size: 1,
        mtime: 0,
        isSymlink: false,
        children: null,
      },
      {
        id: "src",
        name: "src",
        kind: "dir",
        size: 0,
        mtime: 0,
        isSymlink: false,
        children: [fileTreeHarness.node],
      },
      {
        id: "dest",
        name: "dest",
        kind: "dir",
        size: 0,
        mtime: 0,
        isSymlink: false,
        children: [],
      },
    ];
    fileTreeHarness.ops.move
      .mockRejectedValueOnce(new Error("locked"))
      .mockResolvedValueOnce({ ok: true });
    await mount(<FileTree project="demo" />);
    await fileTreeHarness.onMove?.({
      dragIds: ["README.md", "src/main.ts"],
      parentId: "dest",
      parentNode: { data: { id: "dest", kind: "dir" } },
    });
    expect(fileTreeHarness.ops.move).toHaveBeenCalledTimes(2);
  });

  it("ignores stale drag sources and destinations", async () => {
    await mount(<FileTree project="demo" />);
    await fileTreeHarness.onMove?.({
      dragIds: ["removed.ts"],
      parentId: null,
      parentNode: null,
    });
    await fileTreeHarness.onMove?.({
      dragIds: ["src/main.ts"],
      parentId: "removed-dir",
      parentNode: { data: { id: "removed-dir", kind: "dir" } },
    });

    expect(fileTreeHarness.ops.move).not.toHaveBeenCalled();
  });

  it("preserves editor-tab disabled state and callback identity", async () => {
    const onCloseTab = vi.fn();
    const onCloseOthers = vi.fn();
    const onCloseAll = vi.fn();
    const items = getEditorTabContextMenuItems({
      tabCount: 1,
      onCloseTab,
      onCloseOthers,
      onCloseAll,
    });

    await mount(
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <button data-trigger="tab" role="tab" type="button">
            editor.ts
          </button>
        </ContextMenu.Trigger>
        <EditorTabContextMenu items={items} />
      </ContextMenu.Root>,
    );

    await openMenu(
      document.querySelector<HTMLElement>('[data-trigger="tab"]')!,
    );
    const menuItems = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    expect(menuItems[1]?.hasAttribute("data-disabled")).toBe(true);
    await act(async () => menuItems[0]?.click());
    expect(onCloseTab).toHaveBeenCalledOnce();
    expect(onCloseOthers).not.toHaveBeenCalled();
  });

  it("preserves branch deletion guards and action callbacks", async () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();
    expect(getDeleteBranchMenuState({ isCurrent: true }).disabled).toBe(true);

    await mount(
      <GitBranchContextMenu
        x={20}
        y={30}
        branchName="feature/demo"
        isCurrent={false}
        onDelete={onDelete}
        onClose={onClose}
      />,
    );
    await act(async () => undefined);

    const item = document.querySelector<HTMLElement>('[role="menuitem"]');
    expect(item?.textContent).toBe("Delete branch");
    expect(item?.hasAttribute("data-disabled")).toBe(false);
    await act(async () => item?.click());
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preserves history and commit-file actions and disabled states", async () => {
    const entry: GitLogEntry = {
      hash: "abc1234",
      parents: [],
      refs: ["HEAD -> main"],
      authorName: "Dev",
      authorEmail: "dev@example.com",
      message: "Keep me",
      timestamp: 1,
      isPushed: false,
    };
    const onCherryPick = vi.fn();
    const onCommitOpen = vi.fn();
    await mount(
      <HistoryContextMenu
        entry={entry}
        isHead
        onCherryPick={onCherryPick}
        onOpen={vi.fn()}
      >
        <button data-trigger="history" type="button">
          Keep me
        </button>
      </HistoryContextMenu>,
    );
    await openMenu(
      document.querySelector<HTMLElement>('[data-trigger="history"]')!,
    );
    const cherryPick = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === "Cherry-pick commit");
    await act(async () => cherryPick?.click());
    expect(onCherryPick).toHaveBeenCalledOnce();

    await mount(
      <CommitFileContextMenu
        count={0}
        canDrop={false}
        onOpen={onCommitOpen}
        onCherryPick={vi.fn()}
        onRevert={vi.fn()}
        onDrop={vi.fn()}
      >
        <button data-trigger="commit-file" type="button">
          file.ts
        </button>
      </CommitFileContextMenu>,
    );
    await openMenu(
      document.querySelector<HTMLElement>('[data-trigger="commit-file"]')!,
    );
    expect(
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].every(
        (item) => item.hasAttribute("data-disabled"),
      ),
    ).toBe(true);
    expect(onCommitOpen).toHaveBeenCalledOnce();
  });

  it("preserves changed-file action selection", async () => {
    const entry: DiffFileEntry = {
      path: "README.md",
      status: "modified",
      staged: false,
      additions: 1,
      deletions: 0,
    };
    const onStage = vi.fn();
    await mount(
      <GitContextMenuPopover
        entry={entry}
        section="changes"
        onStage={onStage}
        onUnstage={vi.fn()}
        onDiscard={vi.fn()}
      >
        <button data-trigger="changed-file" type="button">
          README.md
        </button>
      </GitContextMenuPopover>,
    );
    await openMenu(
      document.querySelector<HTMLElement>('[data-trigger="changed-file"]')!,
    );
    const add = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === "Add to commit");
    await act(async () => add?.click());
    expect(onStage).toHaveBeenCalledOnce();
  });

  it("preserves diagnostics export selection exactly once", async () => {
    const onExport = vi.fn();
    const onClose = vi.fn();
    await mount(
      <TerminalDiagnosticsContextMenu
        x={40}
        y={50}
        isPending={false}
        error={null}
        onExport={onExport}
        onClose={onClose}
      />,
    );
    await act(async () => undefined);

    const item = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((candidate) => candidate.textContent?.includes("Export Diagnostics"));
    expect(item?.textContent).toContain("Export Diagnostics");
    await act(async () => item?.click());
    expect(onExport).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
