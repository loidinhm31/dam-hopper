import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FsArborNode, LanguageFilesResponse } from "@/api/fs-types.js";
import { FileTree } from "@/components/organisms/FileTree.js";
import { buildExplorerLanguageTree } from "@/lib/explorer-language-tree.js";
import "@/index.css";

const harness = vi.hoisted(() => ({
  filter: "rust" as "all" | "rust" | "javascript-typescript" | "java",
  opened: [] as FsArborNode[],
  scanReset: vi.fn(),
  scanMutate: vi.fn().mockResolvedValue(undefined),
  saveSettings: vi.fn(),
  result: {
    files: [
      { path: "src/lib/main.rs", size: 77, mtime: 123, language: "rust" },
      { path: "src/main.rs", size: 42, mtime: 120, language: "rust" },
    ],
    truncated: false,
    limit: 20_000,
  } as LanguageFilesResponse,
  cache: undefined as
    | {
        result: LanguageFilesResponse | null;
        generation: number;
        resultVersion: number;
        stale: boolean;
        scannedAt: number;
      }
    | undefined,
  scanPending: false,
  scanError: null as Error | null,
  liveNodes: [] as FsArborNode[],
}));

vi.mock("@/hooks/use-fs-subscription.js", () => ({
  useFsSubscription: () => ({
    data: { nodes: harness.liveNodes },
    isLoading: false,
    isError: false,
    error: null,
    loadChildren: vi.fn(),
    refetch: vi.fn(),
    isFetching: false,
  }),
}));
vi.mock("@/api/queries.js", () => ({
  invalidateGitFileOperation: vi.fn(),
  useGitDiff: () => ({ data: undefined }),
  useProject: () => ({ data: { path: "/workspace/demo" } }),
  useExplorerLanguageScan: () => ({
    cache: harness.cache,
    scan: {
      isPending: harness.scanPending,
      isError: Boolean(harness.scanError),
      error: harness.scanError,
      reset: harness.scanReset,
      mutateAsync: harness.scanMutate,
    },
  }),
}));
vi.mock("@/hooks/use-fs-ops.js", () => ({
  useFsOps: () => ({
    createFile: vi.fn(),
    createDir: vi.fn(),
    rename: vi.fn(),
    deleteEntry: vi.fn(),
    move: vi.fn(),
    download: vi.fn(),
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
  useEncryptMode: () => ({ isEncryptEnabled: () => false }),
}));
vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: () => ({
    explorerShowHidden: false,
    explorerLanguageFilter: harness.filter,
    saveDebounced: harness.saveSettings,
  }),
}));
vi.mock("@/stores/editor.js", () => ({
  useEditorStore: (selector: (state: { openDiff: () => void }) => unknown) =>
    selector({ openDiff: vi.fn() }),
}));
vi.mock("@/hooks/use-clipboard.js", () => ({
  useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}));
vi.mock("@/components/atoms/LockToggle.js", () => ({ LockToggle: () => null }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

beforeEach(() => {
  harness.filter = "rust";
  harness.cache = {
    result: harness.result,
    generation: 0,
    resultVersion: 1,
    stale: false,
    scannedAt: 100,
  };
  harness.scanPending = false;
  harness.scanError = null;
  harness.liveNodes = [];
  harness.scanReset.mockClear();
  harness.scanMutate.mockClear();
  harness.saveSettings.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  harness.opened.length = 0;
});

describe("language explorer navigation in Chromium", () => {
  it("renders a navigation-only hierarchy and opens exact scan metadata", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <FileTree
          project="demo"
          onFileOpen={(node) => harness.opened.push(node)}
        />,
      );
    });

    expect(
      container
        .querySelector('[aria-label="Filter Explorer by language"]')
        ?.getAttribute("aria-label"),
    ).toBe("Filter Explorer by language");
    expect(container.textContent).not.toContain("main.rs");
    expect(container.textContent).toContain("Filter Explorer by language");
    expect(container.querySelector("[role=menu]")).toBeNull();

    const srcRow = container.querySelector<HTMLElement>('[role="treeitem"]');
    expect(srcRow).not.toBeNull();
    await act(async () => srcRow?.click());
    expect(container.textContent).toContain("main.rs");
    const libRow = [
      ...container.querySelectorAll<HTMLElement>(
        '[role="treeitem"][aria-level="2"]',
      ),
    ].find((row) => row.textContent?.trim() === "lib");
    expect(libRow).not.toBeNull();
    await act(async () => libRow?.click());
    const fileRow = container.querySelector<HTMLElement>(
      '[role="treeitem"][aria-level="3"]',
    );
    expect(fileRow).not.toBeNull();
    await act(async () => fileRow?.click());
    expect(harness.opened).toContainEqual({
      id: "src/lib/main.rs",
      name: "main.rs",
      kind: "file",
      size: 77,
      mtime: 123,
      isSymlink: false,
      children: null,
    });
  });

  it("keeps hierarchy construction deterministic for a keyboard-safe tree", () => {
    const tree = buildExplorerLanguageTree(harness.result.files, "rust", false);
    expect(tree[0]?.id).toBe("src");
    expect(tree[0]?.children?.map((node) => node.id)).toEqual([
      "src/lib",
      "src/main.rs",
    ]);
  });

  it("shows manual scan, stale, truncated, error, and rescan states", async () => {
    harness.cache = undefined;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<FileTree project="demo" />));

    expect(container.textContent).toContain("Scan project to show Rust files");
    const scan = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Scan");
    await act(async () => scan?.click());
    expect(harness.scanReset).toHaveBeenCalledOnce();
    expect(harness.scanMutate).toHaveBeenCalledOnce();

    harness.cache = {
      result: { ...harness.result, truncated: true },
      generation: 1,
      resultVersion: 2,
      stale: true,
      scannedAt: 100,
    };
    harness.scanError = new Error("network unavailable");
    await act(async () => root?.render(<FileTree project="demo" />));
    expect(container.textContent).toContain("Results may be outdated");
    expect(container.textContent).toContain(
      "Showing first 20,000 matching files",
    );
    expect(container.textContent).toContain("network unavailable");
    expect(container.textContent).toContain("Rescan");
  });

  it("keeps no-result scans usable and remounts after a same-generation rescan", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<FileTree project="demo" />));
    const firstTreeItem =
      container.querySelector<HTMLElement>('[role="treeitem"]');
    expect(firstTreeItem).not.toBeNull();

    harness.cache = {
      result: { files: [], truncated: false, limit: 20_000 },
      generation: 0,
      resultVersion: 2,
      stale: false,
      scannedAt: 200,
    };
    await act(async () => root?.render(<FileTree project="demo" />));

    expect(firstTreeItem?.isConnected).toBe(false);
    expect(container.textContent).toContain("No Rust files found.");
    expect(container.textContent).toContain("Last scanned");
  });

  it("resets filtered reveal to All before committing the live tree", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <FileTree
          project="demo"
          revealRequest={{ project: "demo", path: "src/main.rs", nonce: 9 }}
        />,
      );
    });

    expect(harness.saveSettings).toHaveBeenCalledWith({
      explorerLanguageFilter: "all",
    });
  });
});
