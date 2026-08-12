import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "@/components/organisms/FileTree.js";
import { GitBranchControl } from "@/components/organisms/GitBranchControl.js";
import { EditorTab } from "@/components/molecules/EditorTab.js";
import {
  EditorTabContextMenu,
  getEditorTabContextMenuItems,
} from "@/components/organisms/EditorTabContextMenu.js";
import { ContextMenu } from "@/components/ui/ContextMenu.js";
import { useBrowserContextMenuSuppression } from "@/hooks/use-browser-context-menu-suppression.js";
import type { FsArborNode } from "@/api/fs-types.js";
import type { GitFileState } from "@/lib/git-file-state.js";
import "@/index.css";

const harness = vi.hoisted(() => ({
  nodes: [
    {
      id: "src/main.ts",
      name: "main.ts",
      kind: "file",
      size: 10,
      mtime: 0,
      isSymlink: false,
      children: null,
    },
    {
      id: "src/components",
      name: "components",
      kind: "dir",
      size: 0,
      mtime: 0,
      isSymlink: false,
      children: [],
    },
  ] as FsArborNode[],
  download: vi.fn(),
  upload: vi.fn(),
  createFile: vi.fn(),
  createDir: vi.fn(),
  rename: vi.fn(),
  checkout: vi.fn(),
  deleteBranch: vi.fn(),
  showGitState: false,
}));

vi.mock("@/hooks/use-fs-subscription.js", () => ({
  useFsSubscription: () => ({
    data: { nodes: harness.nodes },
    isLoading: false,
    isError: false,
    error: null,
    loadChildren: vi.fn(),
    refetch: vi.fn(),
    isFetching: false,
  }),
}));
vi.mock("@/hooks/use-fs-ops.js", () => ({
  useFsOps: () => ({
    createFile: harness.createFile,
    createDir: harness.createDir,
    rename: harness.rename,
    deleteEntry: vi.fn(),
    move: vi.fn(),
    download: harness.download,
  }),
}));
vi.mock("@/hooks/use-fs-upload.js", () => ({
  useFsUpload: () => ({
    progress: null,
    upload: harness.upload,
    clearProgress: vi.fn(),
  }),
}));
vi.mock("@/api/queries.js", () => ({
  useGitDiff: () => ({
    data: harness.showGitState
      ? {
          entries: [
            {
              path: "src/main.ts",
              status: "modified",
              additions: 1,
              deletions: 0,
              staged: false,
            },
          ],
        }
      : undefined,
  }),
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
  useBranches: () => ({
    data: [
      { name: "main", isCurrent: true, isRemote: false },
      { name: "feature/demo", isCurrent: false, isRemote: false },
    ],
  }),
  useProjectStatus: () => ({ data: { branch: "main" } }),
  useGitCheckoutBranch: () => ({
    isPending: false,
    mutateAsync: harness.checkout,
  }),
  useGitCreateBranch: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useGitDeleteBranch: () => ({
    isPending: false,
    mutateAsync: harness.deleteBranch,
  }),
  invalidateGitFileOperation: vi.fn(),
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
vi.mock("@/components/atoms/LockToggle.js", () => ({ LockToggle: () => null }));

vi.mock("@/components/organisms/GitBranchControlDialogs.js", () => ({
  GitBranchCreateDialog: () => null,
  GitBranchDeleteDialog: () => null,
  GitDirtyCheckoutDialog: () => null,
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

async function settle() {
  await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
}

async function waitForTreeMeasurement() {
  const tree = document.querySelector<HTMLElement>('[role="tree"]');
  const container = tree?.parentElement;
  if (!container) throw new Error("FileTree measurement container not found");
  await act(async () => {
    await new Promise<void>((resolve) => {
      const observer = new ResizeObserver(() => {
        observer.disconnect();
        resolve();
      });
      observer.observe(container!);
    });
  });
}

function row(name: string) {
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="treeitem"]'),
  ].find(
    (candidate) =>
      candidate.querySelector(`span[title="${name}"]`) ||
      candidate.textContent?.trim() === name,
  );
  const trigger = item?.firstElementChild;
  return trigger instanceof HTMLElement ? trigger : (item ?? null);
}

function menuItem(label: string) {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === label,
    ) ?? null
  );
}

function touchPointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  pointerId = 1,
  clientX = 120,
  clientY = 120,
  pointerType: "touch" | "pen" = "touch",
) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    isPrimary: true,
    pointerId,
    pointerType,
  });
}

async function waitForMilliseconds(milliseconds: number) {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  });
}

async function holdTouch(
  target: HTMLElement,
  pointerId = 1,
  pointerType: "touch" | "pen" = "touch",
) {
  await act(async () =>
    target.dispatchEvent(
      touchPointerEvent("pointerdown", pointerId, 120, 120, pointerType),
    ),
  );
  await waitForMilliseconds(760);
  await act(async () =>
    target.dispatchEvent(
      touchPointerEvent("pointerup", pointerId, 120, 120, pointerType),
    ),
  );
}

function SuppressedContextMenuBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  useBrowserContextMenuSuppression();
  return <>{children}</>;
}

const editorGitState: GitFileState = {
  path: "src/alpha.ts",
  rootRelativePath: "src/alpha.ts",
  rootId: ".",
  status: "modified",
  stagedState: "unstaged",
  additions: 1,
  deletions: 0,
  hasConflict: false,
};

function EditorTabsTouchFixture() {
  const [actions, setActions] = React.useState<string[]>([]);
  const tabs = [
    { key: "alpha", name: "alpha.ts", path: "src/alpha.ts" },
    { key: "beta", name: "beta.ts", path: "src/beta.ts" },
  ];
  const record = (action: string, key: string) =>
    setActions((current) => [...current, `${action}:${key}`]);

  return (
    <>
      <output data-testid="editor-tab-actions">{actions.join(",")}</output>
      <div role="tablist" data-testid="editor-tab-list">
        {tabs.map((tab, index) => (
          <ContextMenu.Root key={tab.key}>
            <ContextMenu.Trigger>
              <EditorTab
                name={tab.name}
                path={tab.path}
                active={index === 0}
                dirty={false}
                gitState={index === 0 ? editorGitState : undefined}
                onClick={() => record("activate", tab.key)}
                onGitIndicatorClick={() => record("git", tab.key)}
                onClose={() => record("close", tab.key)}
              />
            </ContextMenu.Trigger>
            <EditorTabContextMenu
              items={getEditorTabContextMenuItems({
                tabCount: tabs.length,
                onCloseTab: () => record("menu-close", tab.key),
                onCloseOthers: () => record("menu-others", tab.key),
                onCloseAll: () => record("menu-all", tab.key),
              })}
            />
          </ContextMenu.Root>
        ))}
      </div>
    </>
  );
}

function CancellableTouchMenuFixture() {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <button data-testid="cancellable-touch-target" type="button">
          Touch target
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
          <ContextMenu.Item>Touch action</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

async function openBranchSelect() {
  await act(async () =>
    document.querySelector<HTMLButtonElement>("[role=combobox]")?.click(),
  );
  return vi.waitFor(() => {
    const option = [
      ...document.querySelectorAll<HTMLElement>("[role=option]"),
    ].find((item) => item.textContent === "feature/demo");
    expect(option).not.toBeNull();
    return option!;
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  harness.download.mockReset();
  harness.upload.mockReset();
  harness.createFile.mockReset();
  harness.createDir.mockReset();
  harness.rename.mockReset();
  harness.checkout.mockReset();
  harness.deleteBranch.mockReset();
  harness.showGitState = false;
});

describe("consumer context menus in Chromium", () => {
  beforeEach(() => {
    harness.download.mockResolvedValue(undefined);
    harness.createFile.mockResolvedValue({ ok: true });
    harness.createDir.mockResolvedValue({ ok: true });
    harness.rename.mockResolvedValue({ ok: true });
    harness.checkout.mockResolvedValue({ ok: true });
    harness.deleteBranch.mockResolvedValue({ ok: true });
    globalThis.ResizeObserver ??= class {
      disconnect() {}
      observe() {}
      unobserve() {}
    } as typeof ResizeObserver;
  });

  it("opens one touch-held Explorer menu, deduplicates native fallback, and targets the held row", async () => {
    harness.showGitState = true;
    await mount(
      <SuppressedContextMenuBoundary>
        <div style={{ height: 320, width: 360 }}>
          <FileTree project="demo" />
        </div>
      </SuppressedContextMenuBoundary>,
    );
    await waitForTreeMeasurement();
    const file = row("main.ts");
    const directory = row("components");
    expect(file).not.toBeNull();
    expect(directory).not.toBeNull();
    expect(file).toHaveAttribute("data-dam-hopper-context-menu-trigger");
    expect(directory).toHaveAttribute("data-dam-hopper-context-menu-trigger");
    const gitButton = file?.querySelector<HTMLButtonElement>(
      '[aria-label="Open diff for main.ts"]',
    );
    expect(gitButton).not.toBeNull();
    await act(async () =>
      gitButton?.dispatchEvent(touchPointerEvent("pointerdown", 1)),
    );
    await waitForMilliseconds(760);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () => gitButton?.click());

    await holdTouch(file!, 2);
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1),
    );
    const nativeFallback = new PointerEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 120,
      clientY: 120,
      pointerId: 1,
      pointerType: "touch",
    });
    await act(async () => file?.dispatchEvent(nativeFallback));
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    await act(async () => menuItem("Download")?.click());
    expect(harness.download).toHaveBeenCalledTimes(1);
    expect(harness.download).toHaveBeenCalledWith("src/main.ts", 10);

    await holdTouch(directory!, 2);
    await vi.waitFor(() =>
      expect(document.querySelector('[role="menu"]')?.textContent).toContain(
        "Upload Here",
      ),
    );
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      ),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[role="menu"]')).toBeNull(),
    );
  });

  it("covers editor-tab mouse, keyboard, touch/pen, fallback, focus, and nested controls", async () => {
    await mount(
      <SuppressedContextMenuBoundary>
        <EditorTabsTouchFixture />
      </SuppressedContextMenuBoundary>,
    );
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs).toHaveLength(2);
    const alpha = tabs[0]!;
    const beta = tabs[1]!;
    expect(alpha).toHaveAttribute("data-dam-hopper-context-menu-trigger");
    expect(beta).toHaveAttribute("data-dam-hopper-context-menu-trigger");
    expect(alpha).toHaveAttribute("tabindex", "0");
    expect(beta).toHaveAttribute("tabindex", "-1");

    await act(async () => {
      alpha.focus();
      alpha.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 120,
          clientY: 120,
        }),
      );
    });
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1),
    );
    expect(
      document
        .querySelector('[role="menu"]')
        ?.closest("[data-radix-popper-content-wrapper]")?.parentElement,
    ).toBe(document.body);
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      ),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[role="menu"]')).toBeNull(),
    );
    expect(document.activeElement).toBe(alpha);

    beta.focus();
    await act(async () =>
      beta.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ContextMenu",
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1),
    );
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      ),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[role="menu"]')).toBeNull(),
    );
    expect(document.activeElement).toBe(beta);

    await holdTouch(beta, 3, "pen");
    await vi.waitFor(() =>
      expect(document.querySelector('[role="menu"]')?.textContent).toContain(
        "Close Other Tabs",
      ),
    );
    const nativeFallback = new PointerEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 120,
      clientY: 120,
      pointerId: 3,
      pointerType: "pen",
    });
    await act(async () => beta.dispatchEvent(nativeFallback));
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    await act(async () => menuItem("Close Other Tabs")?.click());
    expect(
      document.querySelector('[data-testid="editor-tab-actions"]')?.textContent,
    ).toBe("menu-others:beta");

    await holdTouch(alpha, 4);
    await vi.waitFor(() =>
      expect(document.querySelector('[role="menu"]')?.textContent).toContain(
        "Close",
      ),
    );
    await act(async () => menuItem("Close")?.click());
    expect(
      document.querySelector('[data-testid="editor-tab-actions"]')?.textContent,
    ).toBe("menu-others:beta,menu-close:alpha");

    await holdTouch(beta, 5);
    await vi.waitFor(() =>
      expect(document.querySelector('[role="menu"]')?.textContent).toContain(
        "Close All Tabs",
      ),
    );
    await act(async () => menuItem("Close All Tabs")?.click());
    expect(
      document.querySelector('[data-testid="editor-tab-actions"]')?.textContent,
    ).toBe("menu-others:beta,menu-close:alpha,menu-all:beta");

    const gitButton = alpha.querySelector<HTMLButtonElement>(
      '[aria-label="Open diff for alpha.ts"]',
    );
    const closeButton = alpha.querySelector<HTMLButtonElement>(
      '[aria-label="Close alpha.ts"]',
    );
    expect(gitButton).not.toBeNull();
    expect(closeButton).not.toBeNull();
    await act(async () =>
      gitButton?.dispatchEvent(touchPointerEvent("pointerdown", 6)),
    );
    await waitForMilliseconds(760);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () =>
      gitButton?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      ),
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () => gitButton?.click());
    await act(async () =>
      closeButton?.dispatchEvent(touchPointerEvent("pointerdown", 7)),
    );
    await waitForMilliseconds(760);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () =>
      closeButton?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      ),
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () => closeButton?.click());
    expect(
      document.querySelector('[data-testid="editor-tab-actions"]')?.textContent,
    ).toBe(
      "menu-others:beta,menu-close:alpha,menu-all:beta,git:alpha,close:alpha",
    );
  });

  it("cancels touch holds on release, movement/scroll, pointer cancellation, and unmount", async () => {
    await mount(<CancellableTouchMenuFixture />);
    const target = document.querySelector<HTMLElement>(
      '[data-testid="cancellable-touch-target"]',
    )!;

    await act(async () =>
      target.dispatchEvent(touchPointerEvent("pointerdown", 10)),
    );
    await act(async () =>
      target.dispatchEvent(touchPointerEvent("pointerup", 10)),
    );
    await waitForMilliseconds(760);
    expect(document.querySelector('[role="menu"]')).toBeNull();

    await act(async () =>
      target.dispatchEvent(touchPointerEvent("pointerdown", 11)),
    );
    await act(async () =>
      target.dispatchEvent(touchPointerEvent("pointermove", 11, 240, 240)),
    );
    await act(async () =>
      document.dispatchEvent(new Event("scroll", { bubbles: true })),
    );
    await waitForMilliseconds(760);
    expect(document.querySelector('[role="menu"]')).toBeNull();

    await act(async () =>
      target.dispatchEvent(touchPointerEvent("pointerdown", 12)),
    );
    await act(async () =>
      target.dispatchEvent(touchPointerEvent("pointercancel", 12)),
    );
    await waitForMilliseconds(760);
    expect(document.querySelector('[role="menu"]')).toBeNull();

    await act(async () =>
      target.dispatchEvent(touchPointerEvent("pointerdown", 13)),
    );
    await act(async () => {
      root?.unmount();
      root = null;
    });
    await waitForMilliseconds(760);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("keeps the production virtual rows mounted and targets the originating file", async () => {
    await mount(
      <div style={{ height: 320, width: 360 }}>
        <FileTree project="demo" />
      </div>,
    );
    await waitForTreeMeasurement();
    const file = row("main.ts");
    const directory = row("components");
    expect(file).not.toBeNull();
    expect(directory).not.toBeNull();

    await act(async () =>
      file?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          clientX: 120,
          clientY: 120,
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[role="menu"]')).not.toBeNull(),
    );
    expect(
      document
        .querySelector('[role="menu"]')
        ?.closest("[data-radix-popper-content-wrapper]")?.parentElement,
    ).toBe(document.body);
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(file?.className).not.toContain("bg-[var(--color-primary)]/15");
    expect(directory?.className).not.toContain("bg-[var(--color-primary)]/15");
    await act(async () => menuItem("Download")?.click());
    expect(harness.download).toHaveBeenCalledWith("src/main.ts", 10);

    await act(async () =>
      directory?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          clientX: 160,
          clientY: 160,
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1),
    );
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      "Upload Here",
    );
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[role="menu"]')).toBeNull(),
    );
  });

  it("creates a file at the project root from the Explorer toolbar", async () => {
    await mount(
      <div style={{ height: 320, width: 360 }}>
        <FileTree project="demo" />
      </div>,
    );
    await waitForTreeMeasurement();
    const newFile = document.querySelector<HTMLButtonElement>(
      '[aria-label="New File in project root"]',
    );
    expect(newFile).not.toBeNull();
    await act(async () => newFile?.click());

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
    expect(harness.createFile).toHaveBeenCalledWith("root.ts");
    await vi.waitFor(() => expect(document.querySelector("#name")).toBeNull());
  });

  it("keeps rename usable after the context menu closes and submits once", async () => {
    await mount(
      <div style={{ height: 320, width: 360 }}>
        <FileTree project="demo" />
      </div>,
    );
    await waitForTreeMeasurement();
    const file = row("main.ts");
    expect(file).not.toBeNull();
    await act(async () =>
      file?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          clientX: 120,
          clientY: 120,
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[role="menu"]')).not.toBeNull(),
    );
    await vi.waitFor(() => expect(menuItem("Rename")).not.toBeNull());
    await act(async () => menuItem("Rename")?.click());
    let input: HTMLInputElement | null = null;
    await vi.waitFor(() => {
      input = document.querySelector<HTMLInputElement>("#rename-item-name");
      expect(input).not.toBeNull();
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(input));
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
    await vi.waitFor(() => expect(harness.rename).toHaveBeenCalledTimes(1));
    expect(harness.rename).toHaveBeenCalledWith("src/main.ts", "src/app.ts");
  });

  it("hands real SelectItem right-clicks to one body-ported branch menu without checkout", async () => {
    await mount(<GitBranchControl project="demo" />);
    const option = await openBranchSelect();
    const event = new MouseEvent("pointerdown", {
      bubbles: true,
      button: 2,
      cancelable: true,
      clientX: 220,
      clientY: 180,
    });
    await act(async () => option.dispatchEvent(event));
    await act(async () =>
      option.dispatchEvent(
        new MouseEvent("pointerup", {
          bubbles: true,
          button: 2,
          cancelable: true,
          clientX: 220,
          clientY: 180,
        }),
      ),
    );
    await act(async () =>
      option.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          cancelable: true,
          clientX: 220,
          clientY: 180,
        }),
      ),
    );
    await settle();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1),
    );
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(
      menu.closest("[data-radix-popper-content-wrapper]")?.parentElement,
    ).toBe(document.body);
    expect(menu.textContent).toContain("feature/demo");
    expect(harness.checkout).not.toHaveBeenCalled();
  });

  it("keeps the checked-out branch delete action disabled", async () => {
    await mount(<GitBranchControl project="demo" />);
    await openBranchSelect();
    const main = [
      ...document.querySelectorAll<HTMLElement>("[role=option]"),
    ].find((item) => item.textContent === "main");
    await act(async () =>
      main?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          cancelable: true,
          clientX: 220,
          clientY: 180,
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[role="menu"]')).not.toBeNull(),
    );
    const deleteAction =
      document.querySelector<HTMLElement>('[role="menuitem"]');
    expect(deleteAction?.hasAttribute("data-disabled")).toBe(true);
    expect(harness.checkout).not.toHaveBeenCalled();
  });

  it("opens the branch menu from the keyboard and restores focus on Escape", async () => {
    await mount(<GitBranchControl project="demo" />);
    const option = await openBranchSelect();
    await act(async () => {
      option.focus();
      option.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ContextMenu",
        }),
      );
    });
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1),
    );
    expect(harness.checkout).not.toHaveBeenCalled();
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      ),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[role="menu"]')).toBeNull(),
    );
    expect(document.querySelector("[role=combobox]")).toBe(
      document.activeElement,
    );
  });
});
