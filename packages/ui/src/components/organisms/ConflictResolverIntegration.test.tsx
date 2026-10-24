// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffFileEntry, GitDiffResult } from "@/api/client.js";

const queryState = vi.hoisted(() => ({
  data: undefined as GitDiffResult | undefined,
  isLoading: false,
  isError: false,
}));

const operationState = vi.hoisted(() => ({
  data: undefined as
    | {
        operation: "none" | "merge" | "rebase" | "cherry-pick" | "revert" | "unsupported" | "unknown";
        canContinue: boolean;
        canAbort: boolean;
        operationFingerprint: string;
        fullIndexFingerprint: string;
        stoppedReason?: "conflicts" | "messageEditRequired" | "hookBlocked" | "unknown";
      }
    | undefined,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/api/queries.js", () => ({
  useGitDiff: () => ({ ...queryState, refetch: vi.fn() }),
  useGitUntracked: () => ({ data: undefined, isFetching: false }),
  useGitOperationStatus: () => ({ data: operationState.data, isLoading: false }),
  markTargetUnavailableIfNeeded: vi.fn(),
  invalidateGitFileOperation: vi.fn(),
}));

vi.mock("@/api/client.js", () => ({
  api: { git: { stage: vi.fn(), unstage: vi.fn() } },
  normalizeProjectTarget: (target: string | { project: string }) =>
    typeof target === "string" ? { project: target } : target,
  projectTargetCacheKey: (target: { project: string }) => target.project,
}));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: false,
  }),
}));
import {
  ChangedFilesList,
  GitContextMenuPopover,
  createChangedFileSelection,
  entryRootId,
} from "./ChangedFilesList.js";
import { buildConflictRevealIntent } from "../pages/WorkspacePage.js";
describe("Phase 08 Workspace Integration & Cutover", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.querySelectorAll('[data-radix-portal]').forEach((el) => el.remove());
  });

  async function mount(node: React.ReactElement) {
    await act(async () => {
      root.render(node);
    });
  }

  async function openMenu(trigger: HTMLElement) {
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
  }

  it("derives exact child VCS root and project path for aggregate conflict entries", () => {
    const entry: DiffFileEntry = {
      path: "child/conflict.ts",
      status: "conflicted",
      staged: false,
      additions: 5,
      deletions: 3,
      rootId: "packages/child",
      rootPath: "packages/child",
    };

    expect(entryRootId(entry)).toBe("packages/child");
    const selection = createChangedFileSelection(entry);
    expect(selection.gitRootId).toBe("packages/child");
    expect(selection.diffPath).toBe("child/conflict.ts");
    expect(selection.projectPath).toBe("packages/child/child/conflict.ts");
    expect(selection.status).toBe("conflicted");
  });

  it("disables stage checkbox and shows conflict notice on conflicted rows in ChangedFilesList", () => {
    queryState.data = {
      gitAvailable: true,
      entries: [
        {
          path: "clean.ts",
          status: "modified",
          staged: false,
          additions: 1,
          deletions: 0,
          rootId: ".",
        },
        {
          path: "conflict.ts",
          status: "conflicted",
          staged: false,
          additions: 10,
          deletions: 5,
          rootId: ".",
        },
      ],
      total: 2,
    };
    operationState.data = undefined;

    const markup = renderToStaticMarkup(
      <ChangedFilesList
        project="demo"
        selectedFile={null}
        onSelectFile={vi.fn()}
      />,
    );

    expect(markup).toContain('title="Conflict in conflict.ts must be resolved before staging"');
    expect(markup).toContain('aria-label="Conflict in conflict.ts must be resolved before staging"');
    expect(markup).toContain('aria-label="Stage clean.ts"');
  });

  it("renders active Git operation banner with Open Resolver action in ChangedFilesList", () => {
    queryState.data = {
      gitAvailable: true,
      entries: [],
      total: 0,
    };
    operationState.data = {
      operation: "rebase",
      canContinue: false,
      canAbort: true,
      operationFingerprint: "fp1",
      fullIndexFingerprint: "ifp1",
      stoppedReason: "conflicts",
    };

    const onOpenResolver = vi.fn();
    const markup = renderToStaticMarkup(
      <ChangedFilesList
        project="demo"
        selectedFile={null}
        onSelectFile={vi.fn()}
        onOpenOperationResolver={onOpenResolver}
      />,
    );
    expect(markup).toContain("rebase");
    expect(markup).toContain("in progress (conflicts)");
    expect(markup).toContain("Open Resolver");
  });

  it("excludes Add to commit and includes Resolve conflict in context menu for conflicted files", async () => {
    const conflictedEntry: DiffFileEntry = {
      path: "src/conflict.ts",
      status: "conflicted",
      staged: false,
      additions: 2,
      deletions: 1,
    };
    const onResolveConflict = vi.fn();

    await mount(
      <GitContextMenuPopover
        entry={conflictedEntry}
        section="changes"
        onStage={vi.fn()}
        onUnstage={vi.fn()}
        onDiscard={vi.fn()}
        onResolveConflict={onResolveConflict}
      >
        <button data-trigger="test-trigger" type="button">Trigger</button>
      </GitContextMenuPopover>,
    );

    const trigger = document.querySelector<HTMLElement>('[data-trigger="test-trigger"]')!;
    await openMenu(trigger);

    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const itemTexts = items.map((i) => i.textContent?.trim());

    expect(itemTexts).toContain("Resolve conflict…");
    expect(itemTexts).not.toContain("Add to commit");
    expect(itemTexts).not.toContain("Discard changes");

    const resolveItem = items.find((i) => i.textContent?.includes("Resolve conflict…"));
    await act(async () => resolveItem?.click());
    expect(onResolveConflict).toHaveBeenCalledOnce();
  });

  it("includes Add to commit for normal non-conflicted unstaged files", async () => {
    const normalEntry: DiffFileEntry = {
      path: "src/normal.ts",
      status: "modified",
      staged: false,
      additions: 2,
      deletions: 1,
    };
    const onStage = vi.fn();

    await mount(
      <GitContextMenuPopover
        entry={normalEntry}
        section="changes"
        onStage={onStage}
        onUnstage={vi.fn()}
        onDiscard={vi.fn()}
      >
        <button data-trigger="test-normal" type="button">Trigger</button>
      </GitContextMenuPopover>,
    );

    const trigger = document.querySelector<HTMLElement>('[data-trigger="test-normal"]')!;
    await openMenu(trigger);

    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const itemTexts = items.map((i) => i.textContent?.trim());

    expect(itemTexts).toContain("Add to commit");
    expect(itemTexts).toContain("Discard changes");
    expect(itemTexts).not.toContain("Resolve conflict…");

    const stageItem = items.find((i) => i.textContent?.includes("Add to commit"));
    await act(async () => stageItem?.click());
    expect(onStage).toHaveBeenCalledOnce();
  });

  describe("buildConflictRevealIntent pure routing helper", () => {
    it("extracts nested git root id into root property and preserves diffPath", () => {
      const selection = {
        path: "packages/child/src/app.ts",
        diffPath: "src/app.ts",
        gitRootId: "packages/child",
        status: "conflicted" as const,
        additions: 1,
        deletions: 2,
      };
      const intent = buildConflictRevealIntent(selection);
      expect(intent.root).toBe("packages/child");
      expect(intent.filePath).toBe("src/app.ts");
      expect(typeof intent.nonce).toBe("number");
    });

    it("normalizes primary dot root to undefined", () => {
      const selection = {
        path: "src/app.ts",
        diffPath: "src/app.ts",
        gitRootId: ".",
        status: "conflicted" as const,
        additions: 0,
        deletions: 0,
      };
      const intent = buildConflictRevealIntent(selection);
      expect(intent.root).toBeUndefined();
      expect(intent.filePath).toBe("src/app.ts");
    });

    it("handles undefined selection cleanly for banner/pill opening", () => {
      const intent = buildConflictRevealIntent(undefined);
      expect(intent.root).toBeUndefined();
      expect(intent.filePath).toBeUndefined();
      expect(typeof intent.nonce).toBe("number");
    });
  });

  it("invokes onSelectConflict when a conflicted row is clicked", async () => {
    queryState.data = {
      entries: [
        {
          path: "src/conflict.ts",
          status: "conflicted",
          additions: 2,
          deletions: 1,
          isBinary: false,
          staged: false,
        },
      ],
      staged: [],
      unstaged: [],
    };

    const onSelectFile = vi.fn();
    const onSelectConflict = vi.fn();
    await mount(
      <ChangedFilesList
        project="demo"
        selectedFile={null}
        onSelectFile={onSelectFile}
        onSelectConflict={onSelectConflict}
      />,
    );

    const fileRow = container.querySelector<HTMLElement>('[role="row"]')!;
    expect(fileRow).not.toBeNull();
    await act(async () => {
      fileRow.click();
    });
    expect(onSelectConflict).toHaveBeenCalledOnce();
    const passedSelection = onSelectConflict.mock.calls[0][0];
    expect(passedSelection.status).toBe("conflicted");
    expect(passedSelection.diffPath).toBe("src/conflict.ts");
    expect(onSelectFile).not.toHaveBeenCalled();
  });
});
