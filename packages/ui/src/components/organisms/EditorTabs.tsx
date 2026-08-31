/**
 * EditorTabs — tab bar + active editor host.
 *
 * - Tab bar: open tabs with dirty indicators and close buttons.
 * - Editor area: routes to MonacoHost / MarkdownHost / LargeFileViewer / BinaryPreview
 *   based on the active tab's tier and file type.
 * - MonacoHost / MarkdownHost are lazy-loaded (dynamic import) to keep the main chunk clean.
 * - ConflictDialog is shown when save returns a conflict.
 */
import { lazy, Suspense, useState, useEffect, useCallback } from "react";
import type * as monacoNs from "monaco-editor";
import { AlertTriangle, FileCode, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  editorActiveKeyForTarget,
  editorTargetScopeKey,
  useEditorStore,
  type Tab,
} from "@/stores/editor.js";
import { EditorTab } from "@/components/molecules/EditorTab.js";
import { LargeFileViewer } from "@/components/organisms/LargeFileViewer.js";
import { BinaryPreview } from "@/components/organisms/BinaryPreview.js";
import { VideoPreview } from "@/components/organisms/VideoPreview.js";
import { ImagePreview } from "@/components/organisms/ImagePreview.js";
import { DiffViewer } from "@/components/organisms/DiffViewer.js";
import { ConflictDialog } from "@/components/organisms/ConflictDialog.js";
import { EditorStatusBar } from "@/components/organisms/EditorStatusBar.js";
import { mimeToLanguage } from "@/lib/mime-to-language.js";
import { isPreviewOnlyFile } from "@/lib/file-tier.js";
import { imageMimeType, isImagePreviewCandidate } from "@/lib/image-file.js";
import { isVideoPreviewCandidate, videoMimeType } from "@/lib/video-file.js";
import { useEncryptMode } from "@/contexts/EncryptContext.js";
import { useEncryptedWrite } from "@/hooks/use-encrypted-write.js";
import { LockToggle } from "@/components/atoms/LockToggle.js";
import { ContextMenu } from "@/components/ui/ContextMenu.js";
import {
  invalidateGitFileOperation,
  useGitDiff,
  useGitFileDiff,
} from "@/api/queries.js";
import { buildGitFileStateIndex } from "@/lib/git-file-state.js";
import {
  normalizeProjectTarget,
  type ProjectTargetInput,
} from "@/api/client.js";
import { markProjectTargetUnavailable } from "@/stores/project-target.js";
import {
  EditorTabContextMenu,
  getEditorTabContextMenuItems,
} from "@/components/organisms/EditorTabContextMenu.js";

const MonacoHost = lazy(() =>
  import("@/components/organisms/MonacoHost.js").then((m) => ({
    default: m.MonacoHost,
  })),
);

const MarkdownHost = lazy(() =>
  import("@/components/organisms/MarkdownHost.js").then((m) => ({
    default: m.MarkdownHost,
  })),
);

export function EditorTabs({
  project,
  target,
}: {
  project: string | null;
  target?: ProjectTargetInput;
}) {
  const targetRef = normalizeProjectTarget(
    target ?? project ?? { project: "" },
  );
  const targetScopeKey = editorTargetScopeKey(targetRef);
  const queryClient = useQueryClient();
  const {
    tabs,
    activeKeys,
    setActive,
    openDiff,
    close,
    closeOthers,
    closeAll,
    setContent,
    save,
    saveViewState,
    forceOverwrite,
    reloadTab,
    clearConflict,
    clearStale,
    markSaved,
    loadContent,
    markTargetUnavailable,
    beginAsyncRequest,
    isCurrentAsyncRequest,
  } = useEditorStore();

  const {
    isEncryptEnabled,
    getPassphrase,
    promptPassphrase,
    setPassphrase,
    getSession,
  } = useEncryptMode();
  const encryptedWrite = useEncryptedWrite();

  const [activeEditor, setActiveEditor] =
    useState<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const { data: gitDiff } = useGitDiff(targetRef, "*");

  const handleSave = useCallback(
    async (key: string) => {
      const tab = tabs.find((t) => t.key === key);
      if (!project || !isEncryptEnabled(project)) {
        const saved = await save(key);
        if (saved && tab?.path) {
          await invalidateGitFileOperation(queryClient, tab.target, tab.path);
        }
        return;
      }
      if (!tab) return;
      if (!tab.targetAvailable) return;
      if (isPreviewOnlyFile(tab.tier, tab.name)) return;
      if (!tab.path) return save(key);

      const requestGeneration = beginAsyncRequest(key);

      // If a session is already cached the AES key is live — no passphrase needed
      const sessionActive = !!getSession(project);
      let passphrase = sessionActive ? "" : getPassphrase(project);
      if (!sessionActive && !passphrase) {
        try {
          passphrase = await promptPassphrase(project);
          setPassphrase(project, passphrase);
        } catch {
          return;
        }
      }
      const resolvedPassphrase = sessionActive ? "" : passphrase;
      if (resolvedPassphrase === null) return;
      if (!isCurrentAsyncRequest(key, requestGeneration)) return;

      const result = await encryptedWrite.saveText(
        tab.target,
        tab.path,
        tab.content,
        resolvedPassphrase,
      );
      if (!isCurrentAsyncRequest(key, requestGeneration)) return;
      if (result.ok) {
        markSaved(key, result.newMtime ?? tab.mtime);
        await invalidateGitFileOperation(queryClient, tab.target, tab.path);
      }
    },
    [
      project,
      queryClient,
      isEncryptEnabled,
      getPassphrase,
      getSession,
      promptPassphrase,
      setPassphrase,
      encryptedWrite,
      save,
      tabs,
      markSaved,
      beginAsyncRequest,
      isCurrentAsyncRequest,
    ],
  );

  const projectTabs = project
    ? tabs.filter(
        (tab) =>
          tab.project === project &&
          editorTargetScopeKey(tab.target) === targetScopeKey,
      )
    : [];
  const activeKey = project
    ? editorActiveKeyForTarget(activeKeys, targetRef)
    : null;
  const activeTab = projectTabs.find((t) => t.key === activeKey) ?? null;
  const activeTargetProject = activeTab?.target.project;
  const activeTargetWorktreePath = activeTab?.target.worktreePath;
  const handleActiveTargetUnavailable = () => {
    if (activeTargetProject) {
      const unavailableTarget = {
        project: activeTargetProject,
        worktreePath: activeTargetWorktreePath,
      };
      markProjectTargetUnavailable(unavailableTarget);
      markTargetUnavailable(unavailableTarget);
    }
  };
  // Older persisted tabs predate the video tier. Route by the closed extension
  // contract before any viewer can mount and trigger a legacy fsRead.
  const activeIsVideo = Boolean(
    activeTab && isVideoPreviewCandidate(activeTab.tier, activeTab.name),
  );
  const activeIsImage = Boolean(
    activeTab && isImagePreviewCandidate(activeTab.tier, activeTab.name),
  );
  const activeIsPreviewOnly = activeIsVideo || activeIsImage;
  const gitIndex = buildGitFileStateIndex(gitDiff?.entries);
  const activeGitState =
    activeTab && activeTab.tier !== "diff"
      ? gitIndex.files.get(activeTab.path)
      : undefined;
  const activeDiffRoot =
    activeGitState?.rootId && activeGitState.rootId !== "."
      ? activeGitState.rootId
      : undefined;
  const activeFileDiff = useGitFileDiff(
    targetRef,
    activeGitState?.rootRelativePath ?? "",
    activeDiffRoot,
  );
  const activeLineChanges = activeFileDiff.data?.lineChanges ?? [];
  const openActiveDiff = () => {
    if (!project || !activeGitState) return;
    openDiff(
      activeTab?.target ?? targetRef,
      activeGitState.path,
      activeGitState.status,
      activeGitState.additions,
      activeGitState.deletions,
      undefined,
      activeGitState.rootId,
      activeGitState.rootRelativePath,
    );
  };
  // Auto-hydrate active tab if content is not loaded
  useEffect(() => {
    if (activeTab?.hydrated && !activeTab.loading) {
      void loadContent(activeTab.key);
    }
  }, [activeTab?.key, activeTab?.hydrated, activeTab?.loading, loadContent]);

  const unavailableTabs = project
    ? tabs.filter((tab) => tab.project === project && !tab.targetAvailable)
    : [];
  const downloadTabCopy = useCallback((tab: Tab) => {
    const blob = new Blob([tab.content], {
      type: tab.mime ?? "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${tab.name || "file"}.local-copy`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  if (!project || (projectTabs.length === 0 && unavailableTabs.length === 0)) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-[var(--color-text-muted)] glass-card">
        <FileCode className="h-10 w-10 opacity-20" />
        <p className="text-sm opacity-40">
          Select a file from {project ?? "a project"} to open
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full flex flex-col glass-card">
      {/* Tab bar */}
      <div className="shrink-0 flex items-stretch border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <div
          role="tablist"
          className="flex-1 flex overflow-x-auto"
          style={{ scrollbarWidth: "none" }}
        >
          {projectTabs.map((tab) => (
            <ContextMenu.Root key={tab.key}>
              <ContextMenu.Trigger>
                <EditorTab
                  name={tab.name}
                  path={tab.path}
                  active={tab.key === activeKey}
                  dirty={tab.dirty}
                  targetAvailable={tab.targetAvailable}
                  gitState={
                    tab.tier === "diff"
                      ? undefined
                      : gitIndex.files.get(tab.path)
                  }
                  onGitIndicatorClick={() => {
                    const state = gitIndex.files.get(tab.path);
                    if (!project || !state) return;
                    openDiff(
                      tab.target,
                      state.path,
                      state.status,
                      state.additions,
                      state.deletions,
                      undefined,
                      state.rootId,
                      state.rootRelativePath,
                    );
                  }}
                  onClick={() => project && setActive(tab.target, tab.key)}
                  onClose={() => close(tab.key)}
                />
              </ContextMenu.Trigger>
              <EditorTabContextMenu
                items={getEditorTabContextMenuItems({
                  tabCount: projectTabs.length,
                  onCloseTab: () => close(tab.key),
                  onCloseOthers: () => {
                    if (project) closeOthers(project, tab.key);
                  },
                  onCloseAll: () => {
                    if (project) closeAll(project, targetRef);
                  },
                })}
              />
            </ContextMenu.Root>
          ))}
        </div>
        {project && (
          <div className="shrink-0 flex items-center px-2 border-l border-[var(--color-border)]">
            <LockToggle project={project} />
          </div>
        )}
      </div>

      {unavailableTabs.length > 0 && (
        <div
          role="alert"
          className="shrink-0 flex flex-wrap items-center gap-2 border-b border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-300"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            Unavailable target recovery: local edits from missing worktrees are
            preserved and writes stay disabled until the target returns.
          </span>
          {unavailableTabs.map((tab) => (
            <span key={tab.key} className="flex shrink-0 items-center gap-1">
              <span
                className="max-w-[12rem] truncate"
                title={`${tab.target.worktreePath ?? "Project root"}: ${tab.path}`}
              >
                {tab.target.worktreePath
                  ? `${tab.target.worktreePath}: `
                  : "Project root: "}
                {tab.name}
              </span>
              {tab.dirty && (
                <button
                  type="button"
                  className="rounded border border-amber-400/30 px-1.5 py-0.5 hover:bg-amber-400/10"
                  onClick={() => downloadTabCopy(tab)}
                >
                  Download copy
                </button>
              )}
              <button
                type="button"
                className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                onClick={() => close(tab.key)}
              >
                Close
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Editor area + status bar */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <div className="flex-1 overflow-hidden relative">
          {activeIsVideo && activeTab ? (
            <VideoPreview
              key={`${activeTab.key}:${activeTab.previewRevision ?? 0}`}
              project={activeTab.project}
              target={activeTab.target}
              path={activeTab.path}
              fileName={activeTab.name}
              mime={activeTab.mime ?? videoMimeType(activeTab.name)}
              onTargetUnavailable={handleActiveTargetUnavailable}
            />
          ) : activeIsImage && activeTab ? (
            <ImagePreview
              key={`${activeTab.key}:${activeTab.previewRevision ?? 0}`}
              project={activeTab.project}
              target={activeTab.target}
              path={activeTab.path}
              fileName={activeTab.name}
              mime={activeTab.mime ?? imageMimeType(activeTab.name)}
              onTargetUnavailable={handleActiveTargetUnavailable}
            />
          ) : activeTab === null ? (
            <div className="h-full flex items-center justify-center text-xs text-[var(--color-text-muted)]">
              No file open
            </div>
          ) : activeTab.loading ? (
            <div className="h-full flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : activeTab.error ? (
            <div className="h-full flex items-center justify-center text-xs text-red-400 px-4 text-center">
              {activeTab.error}
            </div>
          ) : activeTab.tier === "binary" ? (
            <BinaryPreview
              base64={activeTab.binaryBase64 ?? ""}
              fileName={activeTab.name}
              mime={activeTab.mime}
            />
          ) : activeTab.tier === "diff" ? (
            <DiffViewer
              key={activeTab.key}
              project={activeTab.project}
              target={activeTab.target}
              filePath={activeTab.path}
              fileStatus={activeTab.fileStatus ?? "modified"}
              additions={activeTab.additions ?? 0}
              deletions={activeTab.deletions ?? 0}
              commitHash={activeTab.commitHash}
              gitRootId={activeTab.gitRootId}
              diffPath={activeTab.diffPath}
              targetAvailable={activeTab.targetAvailable}
              onTargetUnavailable={handleActiveTargetUnavailable}
              onClose={() => close(activeTab.key)}
            />
          ) : activeTab.tier === "large" ? (
            <LargeFileViewer
              project={activeTab.project}
              target={activeTab.target}
              path={activeTab.path}
              fileName={activeTab.name}
              size={activeTab.size}
              onTargetUnavailable={handleActiveTargetUnavailable}
            />
          ) : /\.mdx?$/i.test(activeTab.name) ? (
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading editor…
                </div>
              }
            >
              <MarkdownHost
                tabKey={activeTab.key}
                path={activeTab.path}
                content={activeTab.content}
                tier={activeTab.tier}
                mime={activeTab.mime}
                viewState={activeTab.viewState}
                readOnly={!activeTab.targetAvailable}
                onChange={(val) => setContent(activeTab.key, val)}
                onSave={() => void handleSave(activeTab.key)}
                onViewStateChange={(vs, key) =>
                  saveViewState(key ?? activeTab.key, vs)
                }
                lineChanges={activeLineChanges}
                onGitIndicatorClick={openActiveDiff}
              />
            </Suspense>
          ) : (
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading editor…
                </div>
              }
            >
              <MonacoHost
                tabKey={activeTab.key}
                path={activeTab.path}
                content={activeTab.content}
                tier={activeTab.tier}
                mime={activeTab.mime}
                viewState={activeTab.viewState}
                readOnly={!activeTab.targetAvailable}
                onChange={(val) => setContent(activeTab.key, val)}
                onSave={() => void handleSave(activeTab.key)}
                onViewStateChange={(vs, key) =>
                  saveViewState(key ?? activeTab.key, vs)
                }
                onEditorReady={setActiveEditor}
                lineChanges={activeLineChanges}
                onGitIndicatorClick={openActiveDiff}
              />
            </Suspense>
          )}

          {/* Saving overlay */}
          {activeTab?.saving && !activeIsPreviewOnly && (
            <div className="absolute top-2 right-3 flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving…
            </div>
          )}

          {!activeIsPreviewOnly && activeTab?.stale && activeTab.dirty && (
            <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-300 shadow-lg">
              <span className="truncate">
                File changed on disk while this tab has unsaved edits.
              </span>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  className="rounded border border-amber-500/30 px-2 py-0.5 hover:bg-amber-500/10"
                  onClick={() => void reloadTab(activeTab.key)}
                >
                  Reload
                </button>
                <button
                  type="button"
                  className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  onClick={() => clearStale(activeTab.key)}
                >
                  Keep edits
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Status bar — only for Monaco-hosted tabs */}
        {activeTab &&
          activeTab.tier !== "binary" &&
          activeTab.tier !== "large" &&
          !activeIsPreviewOnly &&
          !/\.mdx?$/i.test(activeTab.name) && (
            <EditorStatusBar
              editor={activeEditor}
              language={mimeToLanguage(activeTab.mime, activeTab.path)}
              gitState={activeGitState}
              onGitIndicatorClick={openActiveDiff}
            />
          )}
      </div>

      {/* Conflict dialog */}
      {activeTab && !activeIsPreviewOnly && (
        <ConflictDialog
          open={activeTab.conflicted}
          fileName={activeTab.name}
          onReload={() => void reloadTab(activeTab.key)}
          onOverwrite={() => void forceOverwrite(activeTab.key)}
          onCancel={() => clearConflict(activeTab.key)}
        />
      )}
    </div>
  );
}
