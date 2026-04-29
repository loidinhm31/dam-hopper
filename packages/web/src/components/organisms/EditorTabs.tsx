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
import { FileCode, Loader2 } from "lucide-react";
import { useEditorStore } from "@/stores/editor.js";
import { EditorTab } from "@/components/molecules/EditorTab.js";
import { LargeFileViewer } from "@/components/organisms/LargeFileViewer.js";
import { BinaryPreview } from "@/components/organisms/BinaryPreview.js";
import { DiffViewer } from "@/components/organisms/DiffViewer.js";
import { ConflictDialog } from "@/components/organisms/ConflictDialog.js";
import { EditorStatusBar } from "@/components/organisms/EditorStatusBar.js";
import { mimeToLanguage } from "@/lib/mime-to-language.js";
import { useEncryptMode } from "@/contexts/EncryptContext.js";
import { useEncryptedWrite } from "@/hooks/useEncryptedWrite.js";
import { LockToggle } from "@/components/atoms/LockToggle.js";

const MonacoHost = lazy(() =>
  import("@/components/organisms/MonacoHost.js").then((m) => ({ default: m.MonacoHost })),
);

const MarkdownHost = lazy(() =>
  import("@/components/organisms/MarkdownHost.js").then((m) => ({ default: m.MarkdownHost })),
);

export function EditorTabs({ project }: { project: string | null }) {
  const {
    tabs,
    activeKeys,
    setActive,
    close,
    setContent,
    save,
    saveViewState,
    forceOverwrite,
    reloadTab,
    clearConflict,
    markSaved,
    loadContent,
  } = useEditorStore();

  const { isEncryptEnabled, getPassphrase, promptPassphrase, setPassphrase, getSession } = useEncryptMode();
  const encryptedWrite = useEncryptedWrite();

  const [activeEditor, setActiveEditor] = useState<monacoNs.editor.IStandaloneCodeEditor | null>(
    null,
  );

  const handleSave = useCallback(async (key: string) => {
    if (!project || !isEncryptEnabled(project)) {
      return save(key);
    }
    const tab = tabs.find((t) => t.key === key);
    if (!tab) return;

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

    const result = await encryptedWrite.saveText(project, tab.path, tab.content, passphrase);
    if (result.ok) {
      markSaved(key, result.newMtime ?? tab.mtime);
    }
  }, [project, isEncryptEnabled, getPassphrase, getSession, promptPassphrase, setPassphrase, encryptedWrite, save, tabs, markSaved]);

  const projectTabs = project ? tabs.filter((t) => t.project === project) : [];
  const activeKey = project ? activeKeys[project] : null;
  const activeTab = projectTabs.find((t) => t.key === activeKey) ?? null;

  // Auto-hydrate active tab if content is not loaded
  useEffect(() => {
    if (activeTab?.hydrated && !activeTab.loading) {
      void loadContent(activeTab.key);
    }
  }, [activeTab?.key, activeTab?.hydrated, activeTab?.loading, loadContent]);

  if (!project || projectTabs.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-[var(--color-text-muted)] glass-card">
        <FileCode className="h-10 w-10 opacity-20" />
        <p className="text-sm opacity-40">Select a file from {project ?? "a project"} to open</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col glass-card">
      {/* Tab bar */}
      <div className="shrink-0 flex items-stretch border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <div
          role="tablist"
          className="flex-1 flex overflow-x-auto"
          style={{ scrollbarWidth: "none" }}
        >
          {projectTabs.map((tab) => (
            <EditorTab
              key={tab.key}
              name={tab.name}
              active={tab.key === activeKey}
              dirty={tab.dirty}
              onClick={() => project && setActive(project, tab.key)}
              onClose={() => close(tab.key)}
            />
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
        {activeTab === null ? (
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
              content={activeTab.content}
              tier={activeTab.tier}
              mime={activeTab.mime}
              viewState={activeTab.viewState}
              onChange={(val) => setContent(activeTab.key, val)}
              onSave={() => void handleSave(activeTab.key)}
              onViewStateChange={(vs) => saveViewState(activeTab.key, vs)}
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
              content={activeTab.content}
              tier={activeTab.tier}
              mime={activeTab.mime}
              viewState={activeTab.viewState}
              onChange={(val) => setContent(activeTab.key, val)}
              onSave={() => void handleSave(activeTab.key)}
              onViewStateChange={(vs) => saveViewState(activeTab.key, vs)}
              onEditorReady={setActiveEditor}
            />
          </Suspense>
        )}

        {/* Saving overlay */}
        {activeTab?.saving && (
          <div className="absolute top-2 right-3 flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving…
          </div>
        )}
      </div>

        {/* Status bar — only for Monaco-hosted tabs */}
        {activeTab && activeTab.tier !== "binary" && activeTab.tier !== "large" && !/\.mdx?$/i.test(activeTab.name) && (
          <EditorStatusBar editor={activeEditor} language={mimeToLanguage(activeTab.mime)} />
        )}
      </div>

      {/* Conflict dialog */}
      {activeTab && (
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
