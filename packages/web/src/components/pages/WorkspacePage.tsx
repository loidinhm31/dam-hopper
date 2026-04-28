import { useState, useEffect, useRef, useMemo } from "react";
import { Terminal as TerminalIcon, Plus, Files, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { IdeShell } from "@/components/templates/IdeShell.js";
import { FileTree } from "@/components/organisms/FileTree.js";
import { EditorTabs } from "@/components/organisms/EditorTabs.js";
import { TerminalTreeView } from "@/components/organisms/TerminalTreeView.js";
import { TerminalTabBar } from "@/components/organisms/TerminalTabBar.js";
import { MultiTerminalDisplay } from "@/components/organisms/MultiTerminalDisplay.js";
import { ProjectInfoPanel } from "@/components/organisms/ProjectInfoPanel.js";
import { SearchPanel } from "@/components/organisms/SearchPanel.js";

import { Button, inputClass } from "@/components/atoms/Button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import { useEditorStore } from "@/stores/editor.js";
import { useSearchUiStore } from "@/stores/searchUi.js";
import { useTerminalManager } from "@/hooks/useTerminalManager.js";
import { api } from "@/api/client.js";
import type { FsArborNode } from "@/api/fs-types.js";
import type { ToolWindowDef } from "@/types/ide.js";

const ACTIVE_PROJECT_KEY = "dam-hopper:active-project";

export default function WorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeProject, setActiveProjectState] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_PROJECT_KEY),
  );
  function setActiveProject(name: string | null) {
    setActiveProjectState(name);
    if (name) localStorage.setItem(ACTIVE_PROJECT_KEY, name);
    else localStorage.removeItem(ACTIVE_PROJECT_KEY);
  }
  const openFile = useEditorStore((s) => s.open);
  const openDiff = useEditorStore((s) => s.openDiff);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects.list(),
  });

  // Validate persisted project still exists in the current workspace.
  useEffect(() => {
    if (projects.length > 0 && activeProject) {
      if (!projects.some((p) => p.name === activeProject)) {
        setActiveProject(null);
      }
    }
  }, [projects]); // Only re-validate when projects list changes, not when activeProject changes

  const { state, derived, actions } = useTerminalManager(searchParams, setSearchParams);
  const { openTabs, activeTab, mountedSessions, launchForm, savePrompt, freeTerminalSavePrompt, selection } = state;
  const { tree, freeTerminals, isLoading, tabsWithLiveSession, selectedId } = derived;
  const {
    handleSelectProject, handleSelectTerminal, handleLaunchTerminal, handleLaunchProfile,
    handleLaunchFormSubmit, handleDeleteProfile, handleSaveProfile, handleAddFreeTerminal,
    handleLaunchFreeWithCommand, handleLaunchSuggestedCommand, handleAddShell, handleLaunchShell,
    handleSelectTab, handleCloseTab, handleKillTerminal, handleRemoveFreeTerminal,
    handleOpenFreeTerminalSavePrompt, handleSaveFreeTerminalToProject, handleSessionExit,
    setSavePrompt, setFreeTerminalSavePrompt, setLaunchForm,
  } = actions;

  const projectName =
    activeProject ?? (projects.length > 0 ? projects[0].name : null);

  const { open: searchOpen, close: closeSearch, openWith: openSearch } = useSearchUiStore();
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === "F") {
        e.preventDefault();
        openSearch();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openSearch]);

  function handleFileOpen(node: FsArborNode) {
    if (projectName) void openFile(projectName, node);
  }

  function handleSelectProjectInTree(name: string) {
    setActiveProject(name);
    handleSelectProject(name);
  }

  const leftTools = useMemo<ToolWindowDef[]>(() => [
    {
      id: "explorer",
      label: "Explorer",
      icon: Files,
      content: (
        <div className="flex flex-col h-full">
          {projects.length > 1 && (
            <div className="shrink-0 px-2 py-1.5 border-b border-[var(--color-border)]">
              <Select value={projectName ?? ""} onValueChange={setActiveProject}>
                <SelectTrigger className="text-xs h-7">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {projectName ? (
            <FileTree
              key={projectName}
              project={projectName}
              path=""
              onFileOpen={handleFileOpen}
              onOpenTerminal={() => handleLaunchShell(projectName)}
              className="flex-1"
              onSelectDiffFile={(path, _isConflict) => {
                if (projectName) openDiff(projectName, path, "modified", 0, 0);
              }}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
              No projects configured
            </div>
          )}
        </div>
      )
    },
    {
      id: "search",
      label: "Search",
      icon: Search,
      content: projectName ? (
        <SearchPanel
          project={projectName}
          onResultClick={(match) => {
            const targetProject = match.project ?? projectName;
            if (match.project && match.project !== projectName) {
              setActiveProject(match.project);
            }
            void openFile(targetProject, {
              id: match.path,
              name: match.path.split("/").pop()!,
              kind: "file",
              size: 0,
              mtime: 0,
              isSymlink: false,
              children: null,
            });
          }}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
          Select a project to search
        </div>
      )
    }
  ], [projects, projectName, handleFileOpen, handleLaunchShell, openDiff, openFile]);

  const rightTools = useMemo<ToolWindowDef[]>(() => [
    {
      id: "terminals",
      label: "Terminals",
      icon: TerminalIcon,
      content: isLoading ? (
        <div className="flex items-center justify-center flex-1 h-full">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
        </div>
      ) : (
        <TerminalTreeView
          projects={tree}
          freeTerminals={freeTerminals}
          selectedId={selectedId}
          onSelectProject={handleSelectProjectInTree}
          onSelectTerminal={handleSelectTerminal}
          onLaunchTerminal={handleLaunchTerminal}
          onKillTerminal={handleKillTerminal}
          onAddShell={handleAddShell}
          onLaunchProfile={handleLaunchProfile}
          onDeleteProfile={handleDeleteProfile}
          onLaunchSuggestedCommand={handleLaunchSuggestedCommand}
          onAddFreeTerminal={handleAddFreeTerminal}
          onLaunchFreeWithCommand={handleLaunchFreeWithCommand}
          onSelectFreeTerminal={handleSelectTerminal}
          onKillFreeTerminal={handleKillTerminal}
          onRemoveFreeTerminal={handleRemoveFreeTerminal}
          onSaveFreeTerminal={handleOpenFreeTerminalSavePrompt}
        />
      )
    }
  ], [isLoading, tree, freeTerminals, selectedId, handleSelectProjectInTree, handleSelectTerminal, handleLaunchTerminal, handleKillTerminal, handleAddShell, handleLaunchProfile, handleDeleteProfile, handleLaunchSuggestedCommand, handleAddFreeTerminal, handleLaunchFreeWithCommand, handleOpenFreeTerminalSavePrompt, handleRemoveFreeTerminal]);

  const terminalPanel = (
    <div className="flex flex-col h-full">
      {freeTerminalSavePrompt && projects.length > 0 && (
        <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <p className="text-xs font-medium text-[var(--color-text)] mb-2">Save terminal as profile in project</p>
          <div className="flex gap-2 flex-wrap">
            <Select
              value={freeTerminalSavePrompt.projectName}
              onValueChange={(v) => setFreeTerminalSavePrompt((p) => p ? { ...p, projectName: v, error: undefined } : p)}
            >
              <SelectTrigger className="flex-1 min-w-32 text-xs h-7">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex-1 min-w-32">
              <input
                type="text"
                autoFocus
                placeholder="Profile name"
                value={freeTerminalSavePrompt.name}
                onChange={(e) => setFreeTerminalSavePrompt((p) => p ? { ...p, name: e.target.value, error: undefined } : p)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveFreeTerminalToProject(); if (e.key === "Escape") setFreeTerminalSavePrompt(null); }}
                className={inputClass + " w-full" + (freeTerminalSavePrompt.error ? " border-[var(--color-danger)]" : "")}
              />
              {freeTerminalSavePrompt.error && <p className="text-[10px] text-[var(--color-danger)] mt-0.5">{freeTerminalSavePrompt.error}</p>}
            </div>
            <Button size="sm" variant="primary" onClick={handleSaveFreeTerminalToProject}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setFreeTerminalSavePrompt(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {launchForm && (
        <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <p className="text-xs font-medium text-[var(--color-text)] mb-2">
            New terminal in <span className="text-[var(--color-primary)]">{launchForm.projectName}</span>
          </p>
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              autoFocus
              placeholder="Path (relative to project root)"
              value={launchForm.cwd}
              onChange={(e) => setLaunchForm((f) => f ? { ...f, cwd: e.target.value } : f)}
              onKeyDown={(e) => { if (e.key === "Enter") handleLaunchFormSubmit(); if (e.key === "Escape") setLaunchForm(null); }}
              className={inputClass + " flex-1 min-w-32"}
            />
            <input
              type="text"
              placeholder="Command (blank for bash)"
              value={launchForm.command}
              onChange={(e) => setLaunchForm((f) => f ? { ...f, command: e.target.value } : f)}
              onKeyDown={(e) => { if (e.key === "Enter") handleLaunchFormSubmit(); if (e.key === "Escape") setLaunchForm(null); }}
              className={inputClass + " flex-1 min-w-32"}
            />
            <Button size="sm" variant="primary" onClick={handleLaunchFormSubmit}>Launch</Button>
            <Button size="sm" variant="ghost" onClick={() => setLaunchForm(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {openTabs.length > 0 && (
        <TerminalTabBar
          tabs={tabsWithLiveSession}
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          savePrompt={savePrompt}
          onSaveTab={(sessionId) => setSavePrompt({ sessionId, name: "" })}
          onSavePromptChange={(name) => setSavePrompt((p) => p ? { ...p, name, error: undefined } : p)}
          onSavePromptSubmit={handleSaveProfile}
          onSavePromptCancel={() => setSavePrompt(null)}
        />
      )}

      <div className="flex-1 min-h-0">
        {selection?.type === "project" ? (
          <ProjectInfoPanel
            projectName={selection.name}
            onLaunchCommand={(cmd) => {
              if (selection.type === "project") handleLaunchTerminal(selection.name, cmd);
            }}
          />
        ) : mountedSessions.length > 0 ? (
          <MultiTerminalDisplay
            activeSessionId={activeTab}
            mountedSessions={mountedSessions}
            openTabs={tabsWithLiveSession}
            onSessionExit={handleSessionExit}
            onNewTerminal={handleAddFreeTerminal}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
          />
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-[var(--color-text-muted)]">
            <TerminalIcon className="h-12 w-12 opacity-20" />
            <div className="text-center">
              <p className="text-sm mb-1">No projects configured</p>
              <p className="text-xs opacity-60">Open a free terminal to get started</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" size="sm" onClick={handleAddFreeTerminal}>Open Terminal</Button>
              <kbd className="text-[10px] text-[var(--color-text-muted)]/50 font-mono">Ctrl+`</kbd>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--color-text-muted)]">
            <TerminalIcon className="h-10 w-10 opacity-20" />
            <p className="text-sm">Select a project or terminal from the tree</p>
            {projectName && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleLaunchShell(projectName)}
              >
                <Plus className="h-3.5 w-3.5" />
                Open Terminal
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <IdeShell
        leftTools={leftTools}
        rightTools={rightTools}
        editor={<EditorTabs project={projectName} />}
        terminal={terminalPanel}
        hideEditor={false}
      />

      {/* Floating search dialog */}
      {searchOpen && projectName && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
          onClick={closeSearch}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

          {/* Dialog */}
          <div
            className="relative z-10 w-full max-w-2xl mx-4 rounded-xl shadow-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden flex flex-col h-[70vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <SearchPanel
              project={projectName}
              inputRef={searchInputRef}
              onClose={closeSearch}
              onResultClick={(match) => {
                closeSearch();
                const targetProject = match.project ?? projectName;
                if (match.project && match.project !== projectName) {
                  setActiveProject(match.project);
                }
                void openFile(targetProject, {
                  id: match.path,
                  name: match.path.split("/").pop()!,
                  kind: "file",
                  size: 0,
                  mtime: 0,
                  isSymlink: false,
                  children: null,
                });
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
