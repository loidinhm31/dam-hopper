import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, Suspense, lazy } from "react";
import { Loader2 } from "lucide-react";
import type { OsWindow, ResourceClaimKey } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { useResourceClaim } from "../resource-registry.js";
import {
  attachMonacoToSlot,
  getMonacoParkingHost,
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

export function EditorApp({ window }: EditorAppProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const owner = useWindowOwner();
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const filePath =
    (window.appState?.filePath as string | undefined) ?? "untitled.ts";
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
  if (!tab || tab.loading) {
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
