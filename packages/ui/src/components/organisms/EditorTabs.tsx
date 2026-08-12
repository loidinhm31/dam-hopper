/**
 * EditorTabs — tab bar + active editor host.
 *
 * - Tab bar: open tabs with dirty indicators and close buttons.
 * - Editor area: routes to MonacoHost / MarkdownHost / LargeFileViewer / BinaryPreview
 *   based on the active tab's tier and file type.
 * - MonacoHost / MarkdownHost are lazy-loaded (dynamic import) to keep the main chunk clean.
 * - ConflictDialog is shown when save returns a conflict.
 */
import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import type * as monacoNs from "monaco-editor";
import type { SemanticNavigationTarget } from "@dam-hopper/shared";
import { FileCode, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEditorStore } from "@/stores/editor.js";
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
import { useSemanticNavigation } from "@/contexts/SemanticNavigationContext.js";
import { NavigationResultsPanel } from "@/components/organisms/NavigationResultsPanel.js";
import { SemanticNavigationEditorBridge } from "@/components/organisms/SemanticNavigationEditorBridge.js";
import { SemanticTrustDialog } from "@/components/organisms/SemanticTrustDialog.js";
import { useNavigationResultsStore } from "@/stores/navigation-results.js";
import { LockToggle } from "@/components/atoms/LockToggle.js";
import { ContextMenu } from "@/components/ui/ContextMenu.js";
import {
  invalidateGitFileOperation,
  useGitDiff,
  useGitFileDiff,
} from "@/api/queries.js";
import { buildGitFileStateIndex } from "@/lib/git-file-state.js";
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

export function EditorTabs({ project }: { project: string | null }) {
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
  } = useEditorStore();

  const {
    isEncryptEnabled,
    getPassphrase,
    promptPassphrase,
    setPassphrase,
    getSession,
  } = useEncryptMode();
  const encryptedWrite = useEncryptedWrite();
  const semantic = useSemanticNavigation();
  const [activeEditor, setActiveEditor] =
    useState<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const [activeMonaco, setActiveMonaco] = useState<typeof monacoNs | null>(
    null,
  );
  const pendingSemanticReveal = useRef<{
    tabKey: string;
    line: number;
    character: number;
  } | null>(null);
  const { data: gitDiff } = useGitDiff(project ?? "", "*");

  const handleSave = useCallback(
    async (key: string) => {
      const tab = tabs.find((t) => t.key === key);
      if (!project || !isEncryptEnabled(project)) {
        const saved = await save(key);
        if (saved && tab?.path) {
          await invalidateGitFileOperation(queryClient, tab.project, tab.path);
        }
        return;
      }
      if (!tab) return;
      if (isPreviewOnlyFile(tab.tier, tab.name)) return;
      if (!tab.path) return save(key);

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

      const result = await encryptedWrite.saveText(
        project,
        tab.path,
        tab.content,
        resolvedPassphrase,
      );
      if (result.ok) {
        markSaved(key, result.newMtime ?? tab.mtime);
        await invalidateGitFileOperation(queryClient, project, tab.path);
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
    ],
  );

  const projectTabs = project ? tabs.filter((t) => t.project === project) : [];
  const activeKey = project ? activeKeys[project] : null;
  const activeTab = projectTabs.find((t) => t.key === activeKey) ?? null;
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
    project ?? "",
    activeGitState?.rootRelativePath ?? "",
    activeDiffRoot,
  );
  const activeLineChanges = activeFileDiff.data?.lineChanges ?? [];
  const openActiveDiff = () => {
    if (!project || !activeGitState) return;
    openDiff(
      project,
      activeGitState.path,
      activeGitState.status,
      activeGitState.additions,
      activeGitState.deletions,
      undefined,
      activeGitState.rootId,
      activeGitState.rootRelativePath,
    );
  };
  // Auto-hydrate persisted tab metadata before rendering/syncing its content.
  useEffect(() => {
    if (
      activeTab &&
      !activeTab.hydrated &&
      !activeTab.loading &&
      activeTab.tier !== "large" &&
      activeTab.tier !== "binary" &&
      !isPreviewOnlyFile(activeTab.tier, activeTab.name)
    ) {
      void loadContent(activeTab.key);
    }
  }, [activeTab, loadContent]);

  useEffect(() => {
    const reveal = pendingSemanticReveal.current;
    if (
      !reveal ||
      !activeEditor ||
      !activeTab ||
      activeTab.key !== reveal.tabKey
    )
      return;
    if (activeTab.loading) return;
    if (activeTab.error) {
      pendingSemanticReveal.current = null;
      return;
    }
    const position = {
      lineNumber: Math.max(1, reveal.line + 1),
      column: Math.max(1, reveal.character + 1),
    };
    activeEditor.setPosition(position);
    activeEditor.revealPositionInCenter(position);
    pendingSemanticReveal.current = null;
  }, [activeEditor, activeTab]);

  const openSemanticTarget = useCallback((target: SemanticNavigationTarget) => {
    const fileName = target.uri.path.split("/").pop() ?? target.uri.path;
    pendingSemanticReveal.current = {
      tabKey: `${target.uri.projectId}::${target.uri.path}`,
      line: target.range.start.line,
      character: target.range.start.character,
    };
    void useEditorStore.getState().open(target.uri.projectId, {
      id: target.uri.path,
      name: fileName,
      kind: "file",
      size: 0,
      mtime: 0,
      isSymlink: false,
      children: null,
    });
    useNavigationResultsStore.getState().clear();
  }, []);

  if (!project || projectTabs.length === 0) {
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
                  gitState={
                    tab.tier === "diff"
                      ? undefined
                      : gitIndex.files.get(tab.path)
                  }
                  onGitIndicatorClick={() => {
                    const state = gitIndex.files.get(tab.path);
                    if (!project || !state) return;
                    openDiff(
                      project,
                      state.path,
                      state.status,
                      state.additions,
                      state.deletions,
                      undefined,
                      state.rootId,
                      state.rootRelativePath,
                    );
                  }}
                  onClick={() => project && setActive(project, tab.key)}
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
                    if (project) closeAll(project);
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

      {/* Editor area + status bar */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <div className="flex-1 overflow-hidden relative">
          {activeIsVideo && activeTab ? (
            <VideoPreview
              key={`${activeTab.key}:${activeTab.previewRevision ?? 0}`}
              project={activeTab.project}
              path={activeTab.path}
              fileName={activeTab.name}
              mime={activeTab.mime ?? videoMimeType(activeTab.name)}
            />
          ) : activeIsImage && activeTab ? (
            <ImagePreview
              key={`${activeTab.key}:${activeTab.previewRevision ?? 0}`}
              project={activeTab.project}
              path={activeTab.path}
              fileName={activeTab.name}
              mime={activeTab.mime ?? imageMimeType(activeTab.name)}
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
              project={activeTab.project}
              filePath={activeTab.path}
              fileStatus={activeTab.fileStatus ?? "modified"}
              additions={activeTab.additions ?? 0}
              deletions={activeTab.deletions ?? 0}
              commitHash={activeTab.commitHash}
              gitRootId={activeTab.gitRootId}
              diffPath={activeTab.diffPath}
              onClose={() => close(activeTab.key)}
            />
          ) : activeTab.tier === "large" ? (
            <LargeFileViewer
              project={activeTab.project}
              path={activeTab.path}
              fileName={activeTab.name}
              size={activeTab.size}
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
                onChange={(val) => setContent(activeTab.key, val)}
                onSave={() => void handleSave(activeTab.key)}
                onViewStateChange={(vs) => saveViewState(activeTab.key, vs)}
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
                key={activeTab.key}
                tabKey={activeTab.key}
                path={activeTab.path}
                content={activeTab.content}
                tier={activeTab.tier}
                mime={activeTab.mime}
                viewState={activeTab.viewState}
                onChange={(val) => setContent(activeTab.key, val)}
                onSave={() => void handleSave(activeTab.key)}
                onViewStateChange={(vs) => saveViewState(activeTab.key, vs)}
                onEditorReady={setActiveEditor}
                onMonacoReady={setActiveMonaco}
                lineChanges={activeLineChanges}
                onGitIndicatorClick={openActiveDiff}
              />
            </Suspense>
          )}

          <SemanticNavigationEditorBridge
            editor={activeEditor}
            monaco={activeMonaco}
            project={project}
          />
          {project && semantic.trust && semantic.trustApi && (
            <div className="absolute top-2 left-3 z-10 flex items-center gap-2 rounded bg-[var(--color-surface)]/90 px-2 py-1 shadow">
              <SemanticTrustDialog
                projectId={project}
                state={semantic.trust}
                api={semantic.trustApi}
                availability={semantic.availability}
                onChanged={semantic.acceptTrustState}
              />
            </div>
          )}
          <NavigationResultsPanel onOpen={openSemanticTarget} />
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
