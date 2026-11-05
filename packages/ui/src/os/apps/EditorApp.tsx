import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Suspense, lazy } from "react";
import { Loader2 } from "lucide-react";
import type { ConnectionRef } from "@/api/ownership.js";
import type { OsWindow, ResourceClaimKey } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { useResourceClaim } from "../resource-registry.js";
import {
  attachMonacoToSlot,
  getMonacoParkingHost,
  getParkedMonacoEntry,
  parkMonacoElement,
  subscribeToMonacoParking,
} from "../MonacoKeepAliveHost.js";
import { useWindowStore } from "../window-store.js";
import { editorFileTabKey, useEditorStore } from "@/stores/editor.js";
import { normalizeFsTarget, type FsTargetRef } from "@/api/ownership.js";
import type { FsArborNode } from "@/api/fs-types.js";
import { ImagePreview } from "@/components/organisms/ImagePreview.js";
import { VideoPreview } from "@/components/organisms/VideoPreview.js";
import { LargeFileViewer } from "@/components/organisms/LargeFileViewer.js";
import { BinaryPreview } from "@/components/organisms/BinaryPreview.js";
import { getEditorFormat } from "@/lib/editor-format.js";
import { registerEditorSlot } from "../action-dispatch.js";
import { getActiveMonacoSelectionText } from "@/components/organisms/MonacoHost.js";
import { getConnectionSnapshot } from "@/api/connections.js";

const MarkdownHost = lazy(() =>
  import("@/components/organisms/MarkdownHost.js").then((m) => ({
    default: m.MarkdownHost,
  })),
);

const HtmlHost = lazy(() =>
  import("@/components/organisms/HtmlHost.js").then((m) => ({
    default: m.HtmlHost,
  })),
);
export interface EditorAppProps {
  window: OsWindow;
}

function EditorTargetChooser({
  window,
  target,
  owner,
}: {
  window: OsWindow;
  target: FsTargetRef;
  owner: ConnectionRef;
}) {
  const [filePath, setFilePath] = useState("");
  const [collisionMsg, setCollisionMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = () => {
    const trimmed = filePath.trim();
    if (!trimmed) {
      setError("Please specify a valid file path to open");
      return;
    }

    const snap = getConnectionSnapshot(owner.profileId);
    if (
      !snap ||
      snap.status !== "connected" ||
      snap.owner.generation !== owner.generation
    ) {
      setError(
        `Connection generation changed or disconnected for profile '${owner.profileId}'. Please re-open.`,
      );
      return;
    }

    setError(null);
    setCollisionMsg(null);

    const targetTabKey = editorFileTabKey(target, trimmed);
    const windows = useWindowStore.getState().session.windows;
    const collision = Object.values(windows).find((w) => {
      if (w.id === window.id || w.appId !== "editor" || !w.appState?.filePath) {
        return false;
      }
      const wTarget = w.ctx.target
        ? normalizeFsTarget(w.ctx.target, w.ctx.profileId)
        : w.ctx.projectId
          ? normalizeFsTarget({
              profileId: w.ctx.profileId ?? "",
              project: w.ctx.projectId,
              worktreePath: w.ctx.worktreeId,
            })
          : { kind: "workspace" as const, profileId: w.ctx.profileId ?? "" };
      const wTabKey = editorFileTabKey(wTarget, w.appState.filePath as string);
      return wTabKey === targetTabKey;
    });
    if (collision) {
      if (collision.minimized) {
        useWindowStore.getState().restoreWindow(collision.id);
      }
      useWindowStore.getState().focusWindow(collision.id);
      setCollisionMsg(
        `File '${trimmed}' is already open in another window. Focused existing window.`,
      );
      return;
    }

    useWindowStore.getState().updateAppState(window.id, {
      presentation: { kind: "resource", target, filePath: trimmed },
      filePath: trimmed,
    });
    useWindowStore.getState().focusWindow(window.id);
  };

  const handleCancel = () => {
    useWindowStore.getState().closeWindow(window.id);
  };

  return (
    <div
      data-testid={`editor-chooser-${window.id}`}
      data-os-editor-chooser="true"
      className="flex flex-col items-center justify-center p-6 h-full bg-[var(--color-surface)] text-[var(--color-text)] gap-4 select-none"
    >
      <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6 space-y-4 shadow-md">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          Open File in Editor
        </h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          Select an authorized workspace or project file to open with exclusive editing claims.
        </p>

        {collisionMsg && (
          <div
            role="alert"
            data-testid="editor-chooser-collision"
            className="rounded border border-[var(--color-warning)] bg-[var(--color-warning)]/10 p-2.5 text-xs text-[var(--color-warning)]"
          >
            {collisionMsg}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded border border-[var(--color-danger)] bg-[var(--color-danger)]/10 p-2 text-xs text-[var(--color-danger)]"
          >
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">
            File Path
          </label>
          <input
            type="text"
            data-testid="editor-chooser-file-input"
            value={filePath}
            placeholder="e.g. src/main.rs"
            onChange={(e) => {
              setFilePath(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleOpen();
              if (e.key === "Escape") handleCancel();
            }}
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-1.5 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
            autoFocus
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            data-testid="editor-chooser-cancel-btn"
            onClick={handleCancel}
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="editor-chooser-open-btn"
            onClick={handleOpen}
            className="rounded bg-[var(--color-primary)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-primary)]/90"
          >
            Open File
          </button>
        </div>
      </div>
    </div>
  );
}

export function EditorApp({ window }: EditorAppProps) {
  const owner = useWindowOwner();
  const target = useMemo<FsTargetRef>(() => {
    if (window.ctx.target) {
      return normalizeFsTarget(window.ctx.target, owner.profileId);
    }
    if (window.ctx.projectId) {
      return normalizeFsTarget({
        profileId: owner.profileId,
        project: window.ctx.projectId,
        worktreePath: window.ctx.worktreeId,
      });
    }
    return { kind: "workspace", profileId: owner.profileId ?? "" };
  }, [window.ctx.target, owner.profileId, window.ctx.projectId, window.ctx.worktreeId]);

  const presentation = window.appState?.presentation as { kind?: string } | undefined;
  const isChooser =
    presentation?.kind === "choose-target" ||
    (!window.appState?.filePath && presentation?.kind !== "resource");

  if (isChooser) {
    return <EditorTargetChooser window={window} target={target} owner={owner} />;
  }

  return <EditorResourceView window={window} target={target} owner={owner} />;
}

function EditorResourceView({
  window,
  target,
  owner,
}: {
  window: OsWindow;
  target: FsTargetRef;
  owner: ConnectionRef;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const filePath = (window.appState?.filePath as string | undefined) ?? "";
  const tabKey = useMemo(
    () => editorFileTabKey(target, filePath),
    [target, filePath],
  );
  const appStateDocumentKey =
    typeof window.appState?.documentKey === "string" && window.appState.documentKey
      ? window.appState.documentKey
      : undefined;

  const tab = useEditorStore(
    useCallback(
      (s) =>
        s.tabs.find(
          (t) => (t.documentKey && t.documentKey === appStateDocumentKey) || t.key === tabKey,
        ) ?? null,
      [appStateDocumentKey, tabKey],
    ),
  );

  const format = useMemo(
    () => getEditorFormat(filePath, tab?.size, tab?.tier),
    [filePath, tab?.size, tab?.tier],
  );
  useEffect(() => {
    if (!tab && filePath && filePath !== "untitled.ts") {
      const fileNode: FsArborNode = {
        id: filePath,
        name: filePath.split("/").pop() || "",
        kind: "file",
        size: 0,
        mtime: 0,
        isSymlink: false,
        children: null,
      };
      void useEditorStore.getState().open(target, fileNode);
    }
  }, [tab, target, filePath]);

  const documentKey = useEditorStore(
    useCallback(
      (s) => {
        if (appStateDocumentKey) {
          return appStateDocumentKey;
        }
        const tab = s.tabs.find((t) => t.key === tabKey);
        return tab?.documentKey ?? tabKey;
      },
      [appStateDocumentKey, tabKey],
    ),
  );

  const claimKey = useMemo<ResourceClaimKey>(
    () => ({
      resourceKind: "editor",
      profileId: owner.profileId,
      generation: owner.generation,
      resourceId: documentKey,
    }),
    [owner.profileId, owner.generation, documentKey],
  );

  const claimStatus = useResourceClaim(claimKey, window.id);

  useLayoutEffect(() => {
    if (!claimStatus.success || format !== "code") return;
    const el = slotRef.current;
    if (!el) return;

    const attach = () => {
      attachMonacoToSlot(el, documentKey, tabKey);
    };

    attach();
    const unsubscribe = subscribeToMonacoParking(documentKey, attach, tabKey);

    return () => {
      unsubscribe();
      const parkingHost = getMonacoParkingHost();
      if (parkingHost) {
        parkMonacoElement(parkingHost, documentKey, tabKey);
      }
    };
  }, [documentKey, tabKey, claimStatus.success, format]);
  useEffect(() => {
    if (!claimStatus.success) return;
    return registerEditorSlot({
      windowId: window.id,
      resourceId: documentKey,
      owner,
      target,
      windowContext: window.ctx,
      getFilePath: () =>
        (window.appState?.filePath as string | undefined) ?? filePath,
      getSelectedText: () =>
        getActiveMonacoSelectionText() ||
        (typeof globalThis.window !== "undefined"
          ? globalThis.window.getSelection()?.toString()
          : undefined),
    });
  }, [
    claimStatus.success,
    window.id,
    documentKey,
    owner,
    target,
    window.ctx,
    filePath,
  ]);

  if (!claimStatus.success) {
    const holderId = claimStatus.existingHolderWindowId ?? "unknown";
    return (
      <div
        data-os-claim-denied="true"
        data-testid="editor-claim-denied"
        className="flex flex-col items-center justify-center p-4 text-center h-full bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)] gap-3"
      >
        <p>File is already open in another editor window ({filePath}).</p>
        <button
          type="button"
          onClick={() => focusWindow(holderId)}
          className="px-3 py-1.5 rounded bg-[var(--color-primary)] text-white text-xs font-medium hover:opacity-90 transition-opacity"
        >
          Focus Existing Window
        </button>
      </div>
    );
  }
  const hasParkedEntry = Boolean(getParkedMonacoEntry(documentKey, tabKey));
  if ((!tab || tab.loading) && !hasParkedEntry) {
    return (
      <div
        data-os-editor-app={window.id}
        data-testid={`editor-loading-${window.id}`}
        className="flex h-full w-full items-center justify-center text-xs text-[var(--color-text-muted)] gap-2 bg-[var(--color-bg)]"
      >
        <Loader2 className="h-4 w-4 animate-spin text-[var(--color-primary)]" />
        <span>Loading {filePath.split("/").pop()}…</span>
      </div>
    );
  }

  if (tab?.error) {
    return (
      <div
        data-os-editor-app={window.id}
        data-testid={`editor-error-${window.id}`}
        className="flex h-full w-full flex-col items-center justify-center text-xs text-red-400 gap-2 p-4 text-center bg-[var(--color-bg)]"
      >
        <p>Failed to load {filePath}: {tab.error}</p>
        <button
          type="button"
          onClick={() => tab && void useEditorStore.getState().reloadTab(tab.key)}
          className="px-3 py-1 rounded bg-[var(--color-surface-2)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  if (format === "image") {
    return (
      <div
        data-os-editor-app={window.id}
        data-testid={`editor-app-${window.id}`}
        className="relative w-full h-full bg-[var(--color-bg)] overflow-hidden"
      >
        <ImagePreview
          project={target.kind === "project" ? target.project : ""}
          target={target}
          path={filePath}
          fileName={filePath.split("/").pop() ?? filePath}
        />
      </div>
    );
  }

  if (format === "video") {
    return (
      <div
        data-os-editor-app={window.id}
        data-testid={`editor-app-${window.id}`}
        className="relative w-full h-full bg-[var(--color-bg)] overflow-hidden"
      >
        <VideoPreview
          project={target.kind === "project" ? target.project : ""}
          target={target}
          path={filePath}
          fileName={filePath.split("/").pop() ?? filePath}
        />
      </div>
    );
  }

  if (format === "large") {
    return (
      <div
        data-os-editor-app={window.id}
        data-testid={`editor-app-${window.id}`}
        className="relative w-full h-full bg-[var(--color-bg)] overflow-hidden"
      >
        <LargeFileViewer
          project={target.kind === "project" ? target.project : ""}
          target={target}
          path={filePath}
          fileName={filePath.split("/").pop() ?? filePath}
          size={tab?.size ?? 0}
        />
      </div>
    );
  }

  if (format === "binary") {
    return (
      <div
        data-os-editor-app={window.id}
        data-testid={`editor-app-${window.id}`}
        className="relative w-full h-full bg-[var(--color-bg)] overflow-hidden"
      >
        <BinaryPreview
          base64={tab?.content ?? ""}
          fileName={filePath.split("/").pop() ?? filePath}
          mime={tab?.mime}
        />
      </div>
    );
  }

  if (format === "markdown") {
    return (
      <div
        data-os-editor-app={window.id}
        data-testid={`editor-app-${window.id}`}
        className="relative w-full h-full bg-[var(--color-bg)] overflow-hidden"
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--color-primary)]" />
            </div>
          }
        >
          <MarkdownHost
            tabKey={tabKey}
            path={filePath}
            content={tab?.content ?? ""}
            tier={tab?.tier === "diff" ? "normal" : (tab?.tier ?? "normal")}
            onChange={(val) => useEditorStore.getState().setContent(tabKey, val)}
            onSave={() => void useEditorStore.getState().save(tabKey)}
            onViewStateChange={(vs) => useEditorStore.getState().saveViewState(tabKey, vs)}
          />
        </Suspense>
      </div>
    );
  }

  if (format === "html") {
    return (
      <div
        data-os-editor-app={window.id}
        data-testid={`editor-app-${window.id}`}
        className="relative w-full h-full bg-[var(--color-bg)] overflow-hidden"
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--color-primary)]" />
            </div>
          }
        >
          <HtmlHost
            key={tabKey}
            tabKey={tabKey}
            path={filePath}
            content={tab?.content ?? ""}
            tier={tab?.tier === "diff" ? "normal" : (tab?.tier ?? "normal")}
            onChange={(val) => useEditorStore.getState().setContent(tabKey, val)}
            onSave={() => void useEditorStore.getState().save(tabKey)}
            onViewStateChange={(vs) => useEditorStore.getState().saveViewState(tabKey, vs)}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div
      ref={slotRef}
      data-os-editor-app={window.id}
      data-testid={`editor-app-${window.id}`}
      className="relative w-full h-full bg-[var(--color-bg)] overflow-hidden"
    >
      <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--color-text-muted)] pointer-events-none">
        Editor slot: {filePath}
      </div>
    </div>
  );
}
