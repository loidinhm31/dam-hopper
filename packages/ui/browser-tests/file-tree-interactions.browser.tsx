import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "@/components/organisms/FileTree.js";
import { useExplorerTreeStore } from "@/stores/explorer-tree.js";
import type { FsArborNode } from "@/api/fs-types.js";
import "@/index.css";

const harness = vi.hoisted(() => ({
  nodes: [] as FsArborNode[],
  srcChildren: [
    {
      id: "src/index.ts",
      name: "index.ts",
      kind: "file" as const,
      size: 50,
      mtime: 0,
      isSymlink: false,
      children: undefined,
    },
    {
      id: "src/utils.ts",
      name: "utils.ts",
      kind: "file" as const,
      size: 40,
      mtime: 0,
      isSymlink: false,
      children: undefined,
    },
  ] as FsArborNode[],
  projects: [
    {
      name: "demo-project",
      path: "/workspace/demo-project",
      type: "npm",
    },
  ],
  projectEntries: [
    {
      name: "package.json",
      kind: "file" as const,
      size: 150,
      mtime: 0,
      isSymlink: false,
    },
    {
      name: "src",
      kind: "dir" as const,
      size: 0,
      mtime: 0,
      isSymlink: false,
    },
  ],
  loadChildrenMock: vi.fn(),
  transportInvokeMock: vi.fn(),
  markProjectMutate: vi.fn().mockResolvedValue({ ok: true, name: "demo-project" }),
  spliceChildren: (nodes: FsArborNode[], targetId: string, children: FsArborNode[]): FsArborNode[] => {
    return nodes.map((n) => {
      if (n.id === targetId) return { ...n, children };
      if (n.children && n.children.length > 0) {
        return { ...n, children: harness.spliceChildren(n.children, targetId, children) };
      }
      return n;
    });
  },
  setTreeNodes: null as ((nodes: FsArborNode[]) => void) | null,
  openedFiles: [] as FsArborNode[],
}));

vi.mock("@/hooks/use-fs-subscription.js", () => ({
  useFsSubscription: () => {
    const [nodes, setNodes] = React.useState(harness.nodes);
    React.useEffect(() => {
      harness.setTreeNodes = setNodes;
      return () => {
        harness.setTreeNodes = null;
      };
    }, []);
    return {
      data: { nodes },
      isLoading: false,
      isError: false,
      error: null,
      loadChildren: harness.loadChildrenMock,
      refetch: vi.fn(),
      isFetching: false,
    };
  },
  resolveSubscriptionTransport: () => ({
    invoke: harness.transportInvokeMock,
  }),
  spliceChildren: (nodes: FsArborNode[], targetId: string, children: FsArborNode[]) =>
    harness.spliceChildren(nodes, targetId, children),
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

vi.mock("@/api/queries.js", () => ({
  useGitDiff: () => ({ data: undefined }),
  useProject: () => ({ data: { path: "/workspace/demo" } }),
  useProjects: () => ({ data: harness.projects }),
  useWorkspaceStatus: () => ({ data: { workspaceEpoch: 1 } }),
  useExplorerLanguageScan: () => ({
    scan: {
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
      mutateAsync: vi.fn(),
    },
  }),
  useBranches: () => ({ data: [] }),
  useProjectStatus: () => ({ data: { branch: "main" } }),
  useGitCheckoutBranch: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useGitCreateBranch: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useGitDeleteBranch: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useMarkProject: () => ({
    mutateAsync: harness.markProjectMutate,
    isPending: false,
  }),
  useUnmarkProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  invalidateGitFileOperation: vi.fn(),
}));

vi.mock("@/contexts/EncryptContext.js", () => ({
  useEncryptMode: () => ({ isEncryptEnabled: () => false }),
  toEncryptKey: () => "test",
}));

vi.mock("@/stores/settings.js", () => {
  const settingsState = {
    explorerShowHidden: true,
    systemFontSize: 14,
    explorerLanguageFilter: "all",
    saveDebounced: vi.fn(),
  };
  return {
    useSettingsStore: (selector?: (state: typeof settingsState) => unknown) =>
      selector ? selector(settingsState) : settingsState,
  };
});
vi.mock("@/stores/editor.js", () => ({
  useEditorStore: (selector: (state: { openDiff: () => void }) => unknown) =>
    selector({ openDiff: vi.fn() }),
}));

vi.mock("@/hooks/use-clipboard.js", () => ({
  useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}));

vi.mock("@/components/atoms/LockToggle.js", () => ({ LockToggle: () => null }));

interface ReactActEnvironmentGlobal {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}
const actGlobal = globalThis as ReactActEnvironmentGlobal;
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(element: React.ReactElement) {
  container = document.createElement("div");
  container.style.width = "400px";
  container.style.height = "500px";
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

async function waitForTreeMeasurement() {
  const tree = document.querySelector<HTMLElement>('[role="tree"]');
  const parent = tree?.parentElement;
  if (!parent) throw new Error("FileTree measurement container not found");
  const { promise, resolve } = Promise.withResolvers<void>();
  const observer = new ResizeObserver(() => {
    observer.disconnect();
    resolve();
  });
  observer.observe(parent);
  await act(async () => {
    await promise;
  });
}

function menuItem(label: string) {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.includes(label),
    ) ?? null
  );
}

beforeEach(() => {
  useExplorerTreeStore.setState({ openMapByTarget: {} });
  harness.openedFiles.length = 0;
  harness.markProjectMutate.mockClear();
  harness.nodes = [
    {
      id: "src",
      name: "src",
      kind: "dir",
      size: 0,
      mtime: 0,
      isSymlink: false,
      children: null,
    },
    {
      id: "README.md",
      name: "README.md",
      kind: "file",
      size: 120,
      mtime: 0,
      isSymlink: false,
      children: undefined,
    },
  ];
  harness.loadChildrenMock.mockImplementation(async (nodeId: string) => {
    if (nodeId === "src") {
      const updated = harness.spliceChildren(harness.nodes, "src", harness.srcChildren);
      harness.nodes = updated;
      harness.setTreeNodes?.(updated);
      return harness.srcChildren;
    }
    return [];
  });
  harness.transportInvokeMock.mockImplementation(
    async (method: string, _params: unknown) => {
      if (method === "fs:list") {
        return { entries: harness.projectEntries };
      }
      return {};
    },
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.replaceChildren();
});

describe("FileTree interactions and expansion in Chromium", () => {
  it("Test 1: Click directly on the directory text/label -> verify lucide-chevron-down appears and child items render", async () => {
    await mount(
      <div style={{ height: 400, width: 360 }}>
        <FileTree mode="workspace" onFileOpen={(f) => harness.openedFiles.push(f)} />
      </div>,
    );
    await waitForTreeMeasurement();

    // Verify initial closed state
    const srcRow = document.querySelector<HTMLElement>('[data-testid="file-tree-item-src"]');
    expect(srcRow).not.toBeNull();
    expect(srcRow?.querySelector(".lucide-chevron-right")).not.toBeNull();
    expect(srcRow?.querySelector(".lucide-chevron-down")).toBeNull();
    expect(document.querySelector('[data-testid="file-tree-item-src/index.ts"]')).toBeNull();

    // Click directly on the text/label span inside src directory
    const srcLabel = srcRow?.querySelector<HTMLElement>(".truncate");
    expect(srcLabel).not.toBeNull();
    expect(srcLabel?.textContent).toBe("src");

    await act(async () => {
      srcLabel?.click();
    });

    // Verify chevron changed to down and child items rendered
    await vi.waitFor(() => {
      const updatedSrc = document.querySelector<HTMLElement>('[data-testid="file-tree-item-src"]');
      expect(updatedSrc?.querySelector(".lucide-chevron-down")).not.toBeNull();
      expect(document.querySelector('[data-testid="file-tree-item-src/index.ts"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-testid="file-tree-item-src/utils.ts"]')).not.toBeNull();
  });

  it("Test 2: Click the chevron directly -> verify toggle open/close", async () => {
    // Start with children already present
    harness.nodes = [
      {
        id: "src",
        name: "src",
        kind: "dir",
        size: 0,
        mtime: 0,
        isSymlink: false,
        children: harness.srcChildren,
      },
    ];

    await mount(
      <div style={{ height: 400, width: 360 }}>
        <FileTree mode="workspace" />
      </div>,
    );
    await waitForTreeMeasurement();

    const srcRow = document.querySelector<HTMLElement>('[data-testid="file-tree-item-src"]');
    expect(srcRow).not.toBeNull();

    // Click the chevron directly to expand
    const chevronIcon = srcRow?.querySelector<HTMLElement>(".lucide-chevron-right");
    expect(chevronIcon).not.toBeNull();
    const chevronSpan = chevronIcon?.parentElement;
    expect(chevronSpan).not.toBeNull();

    await act(async () => {
      chevronSpan?.click();
    });

    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-testid="file-tree-item-src"] .lucide-chevron-down'),
      ).not.toBeNull();
      expect(document.querySelector('[data-testid="file-tree-item-src/index.ts"]')).not.toBeNull();
    });

    // Click the chevron directly to close
    const chevronDown = document.querySelector<HTMLElement>(
      '[data-testid="file-tree-item-src"] .lucide-chevron-down',
    );
    expect(chevronDown).not.toBeNull();
    const openChevronSpan = chevronDown?.parentElement;

    await act(async () => {
      openChevronSpan?.click();
    });

    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-testid="file-tree-item-src"] .lucide-chevron-right'),
      ).not.toBeNull();
      expect(document.querySelector('[data-testid="file-tree-item-src/index.ts"]')).toBeNull();
    });
  });

  it("Test 3: Right-click an unmarked folder -> click 'Mark as Project…' in context menu -> verify dialog opens", async () => {
    await mount(
      <div style={{ height: 400, width: 360 }}>
        <FileTree mode="workspace" />
      </div>,
    );
    await waitForTreeMeasurement();

    const srcRow = document.querySelector<HTMLElement>('[data-testid="file-tree-item-src"]');
    expect(srcRow).not.toBeNull();

    // Right-click the folder to open context menu
    await act(async () => {
      srcRow?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          clientX: 120,
          clientY: 120,
        }),
      );
    });

    await vi.waitFor(() => {
      expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    });

    const markAction = menuItem("Mark as Project…");
    expect(markAction).not.toBeNull();

    await act(async () => {
      markAction?.click();
    });

    // Verify Mark Project dialog opened
    await vi.waitFor(() => {
      const dialog = document.querySelector<HTMLElement>('[data-testid="mark-project-dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog?.textContent).toContain("Mark as Project");
    });
  });

  it("Test 4: Switch to mode='projects' -> click project root -> verify children expand", async () => {
    await mount(
      <div style={{ height: 400, width: 360 }}>
        <FileTree mode="projects" />
      </div>,
    );
    await waitForTreeMeasurement();

    // The project root should be rendered in Projects mode
    const projectRow = document.querySelector<HTMLElement>(
      '[data-testid="file-tree-item-demo-project"]',
    );
    expect(projectRow).not.toBeNull();
    expect(projectRow?.textContent).toContain("demo-project");

    // Click the project row text to expand
    const label = projectRow?.querySelector<HTMLElement>(".truncate");
    expect(label).not.toBeNull();

    await act(async () => {
      label?.click();
    });

    // Verify transport was invoked for fs:list on demo-project
    await vi.waitFor(() => {
      expect(harness.transportInvokeMock).toHaveBeenCalledWith(
        "fs:list",
        expect.objectContaining({
          target: expect.objectContaining({ project: "demo-project" }),
        }),
      );
    });

    // Verify children expanded and rendered in DOM
    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-testid="file-tree-item-demo-project/package.json"]'),
      ).not.toBeNull();
    });
    expect(
      document.querySelector('[data-testid="file-tree-item-demo-project/src"]'),
    ).not.toBeNull();
  });
});
