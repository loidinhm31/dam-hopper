import { useCallback, useMemo, useState, useEffect } from "react";
import type { OsWindow } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { FileTree } from "@/components/organisms/FileTree.js";
import { dispatchIntent, createIntent, registerIntentHandler } from "../intents.js";
import { normalizeProjectTarget } from "@/api/client.js";
import type { FsArborNode } from "@/api/fs-types.js";
import type { FileTreeRevealRequest } from "@/lib/file-tree-reveal.js";
import { useProjects, useWorkspaceStatus } from "@/api/queries.js";
import { useWindowStore } from "../window-store.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import { Folder, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils.js";
import type { FsTargetRef } from "@/api/ownership.js";

export interface FilesAppProps {
  window: OsWindow;
}
export function FilesApp({ window }: FilesAppProps) {
  const owner = useWindowOwner();
  const profileId = owner.profileId;
  const project = window.ctx.projectId ?? "";
  const worktreeId = window.ctx.worktreeId;
  const [revealRequest, setRevealRequest] = useState<FileTreeRevealRequest | null>(null);
  const {
    data: projects = [],
    isLoading: projectsLoading,
    isError: projectsError,
  } = useProjects({ profileId });
  const { data: wsStatus } = useWorkspaceStatus(
    profileId ? { profileId } : undefined,
  );
  const updateWindowContext = useWindowStore((state) => state.updateWindowContext);
  const setSelectedProject = useWorkspaceStore((state) => state.setSelectedProject);

  const isProjectKnown = projects.some((p) => p.name === project);
  const persistedMode = window.appState?.mode as "workspace" | "projects" | undefined;
  const [mode, setModeState] = useState<"workspace" | "projects">(
    persistedMode ?? (project && isProjectKnown ? "projects" : "workspace"),
  );
  const effectiveMode = mode;
  const persistedFilter = window.appState?.projectFilter as string | undefined;
  const [projectFilter, setProjectFilterState] = useState<string>(
    persistedFilter || (isProjectKnown ? project : "all"),
  );

  const handleModeChange = useCallback(
    (nextMode: "workspace" | "projects") => {
      setModeState(nextMode);
      useWindowStore
        .getState()
        .updateAppState(window.id, { mode: nextMode, projectFilter });
    },
    [window.id, projectFilter],
  );

  const handleProjectFilterChange = useCallback(
    (nextFilter: string) => {
      setProjectFilterState(nextFilter);
      if (nextFilter !== "all") {
        updateWindowContext(window.id, {
          projectId: nextFilter,
          worktreeId: undefined,
        });
        setSelectedProject({ profileId, project: nextFilter });
      }
      useWindowStore.getState().updateAppState(window.id, {
        mode: effectiveMode,
        projectFilter: nextFilter,
      });
    },
    [window.id, effectiveMode, profileId, updateWindowContext, setSelectedProject],
  );

  const target = useMemo<FsTargetRef>(() => {
    const workspaceEpoch = wsStatus?.workspaceEpoch;
    if (effectiveMode === "workspace") {
      return {
        kind: "workspace",
        profileId,
        ...(workspaceEpoch !== undefined ? { workspaceEpoch } : {}),
      };
    }
    const matchingProject = projects.find(
      (p) => p.name === (projectFilter !== "all" ? projectFilter : project),
    );
    if (!matchingProject) {
      if (projectFilter === "all" || projects.length === 0) {
        return { kind: "project", profileId, project: "" };
      }
      return {
        kind: "workspace",
        profileId,
        ...(workspaceEpoch !== undefined ? { workspaceEpoch } : {}),
      };
    }
    return {
      kind: "project",
      profileId,
      project: matchingProject.name,
      worktreePath: worktreeId,
    };
  }, [effectiveMode, profileId, projectFilter, project, projects, worktreeId, wsStatus?.workspaceEpoch]);
  const handleFileOpen = useCallback(
    (node: FsArborNode) => {
      const isWorkspace = effectiveMode === "workspace";
      if (isWorkspace) {
        void dispatchIntent(
          createIntent(
            "file:open",
            {
              profileId,
              target: { kind: "workspace", profileId },
              filePath: node.id,
            },
            window.id,
          ),
        );
        return;
      }
      let targetProject = projectFilter !== "all" ? projectFilter : project;
      let targetFilePath = node.id;
      if (projectFilter === "all") {
        const parts = node.id.split("/");
        targetProject = parts[0] || targetProject;
        targetFilePath = parts.slice(1).join("/") || node.id;
      }
      void dispatchIntent(
        createIntent(
          "file:open",
          {
            profileId,
            projectId: targetProject,
            worktreeId,
            target: {
              kind: "project",
              profileId,
              project: targetProject,
              worktreePath: worktreeId,
            },
            filePath: targetFilePath,
          },
          window.id,
        ),
      );
    },
    [effectiveMode, profileId, projectFilter, project, worktreeId, window.id],
  );

  const handleOpenTerminal = useCallback(
    (cwd?: string) => {
      const isWorkspace = effectiveMode === "workspace";
      if (isWorkspace) {
        void dispatchIntent(
          createIntent(
            "terminal:open",
            {
              profileId,
              target: { kind: "workspace", profileId },
              cwd: cwd || undefined,
            },
            window.id,
          ),
        );
        return;
      }
      let targetProject = projectFilter !== "all" ? projectFilter : project;
      let targetCwd = cwd;
      if (projectFilter === "all" && cwd) {
        const parts = cwd.split("/");
        targetProject = parts[0] || targetProject;
        targetCwd = parts.slice(1).join("/") || undefined;
      }
      void dispatchIntent(
        createIntent(
          "terminal:open",
          {
            profileId,
            projectId: targetProject,
            worktreeId,
            target: {
              kind: "project",
              profileId,
              project: targetProject,
              worktreePath: worktreeId,
            },
            cwd: targetCwd || undefined,
          },
          window.id,
        ),
      );
    },
    [profileId, effectiveMode, projectFilter, project, worktreeId, window.id],
  );

  useEffect(() => {
    const unregister = registerIntentHandler("file:reveal", (intent) => {
      if (intent.payload.profileId !== profileId) {
        return { status: "unhandled", reason: "Target profile mismatch" };
      }
      const isWorkspace = effectiveMode === "workspace";
      if (isWorkspace) {
        if (intent.payload.target?.kind === "workspace") {
          setRevealRequest({
            project: "",
            path: intent.payload.filePath,
            nonce: Date.now(),
          });
          return { status: "handled", targetWindowId: window.id };
        }
      } else {
        const currentProject = projectFilter !== "all" ? projectFilter : project;
        if (
          intent.payload.projectId === currentProject &&
          intent.payload.worktreeId === worktreeId
        ) {
          setRevealRequest({
            project: currentProject,
            path: intent.payload.filePath,
            nonce: Date.now(),
          });
          return { status: "handled", targetWindowId: window.id };
        }
      }
      return { status: "unhandled", reason: "Target context mismatch" };
    });
    return unregister;
  }, [profileId, project, projectFilter, worktreeId, effectiveMode, window.id]);

  return (
    <div
      data-os-files-app={window.id}
      data-testid={`files-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      {projectsError && effectiveMode === "projects" ? (
        <div className="flex flex-col items-center justify-center h-full gap-2 p-6 text-center text-xs text-red-400">
          <AlertTriangle className="h-6 w-6" />
          <span>Failed to load projects from profile '{profileId}'</span>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/60 text-xs shrink-0 gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden text-xs">
                <button
                  type="button"
                  data-testid="mode-toggle-workspace"
                  onClick={() => handleModeChange("workspace")}
                  className={cn(
                    "px-2.5 py-0.5 text-xs font-medium transition-colors",
                    effectiveMode === "workspace"
                      ? "bg-[var(--color-primary)] text-white"
                      : "bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                  )}
                >
                  Workspace
                </button>
                <button
                  type="button"
                  data-testid="mode-toggle-projects"
                  onClick={() => handleModeChange("projects")}
                  className={cn(
                    "px-2.5 py-0.5 text-xs font-medium transition-colors",
                    effectiveMode === "projects"
                      ? "bg-[var(--color-primary)] text-white"
                      : "bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                  )}
                >
                  Projects
                </button>
              </div>

              {effectiveMode === "projects" && projects.length > 0 && (
                <div className="flex items-center gap-1 ml-2">
                  <Folder className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
                  <span className="text-[10px] text-[var(--color-text-muted)] font-medium uppercase tracking-wider">
                    Project:
                  </span>
                  <Select
                    value={projectFilter}
                    onValueChange={handleProjectFilterChange}
                  >
                    <SelectTrigger
                      data-testid="project-filter-select"
                      className="h-6 w-auto border-none bg-transparent px-1 py-0 text-xs font-semibold text-[var(--color-text)] focus:ring-0 gap-1"
                    >
                      <SelectValue>
                        {projectFilter === "all" ? "All Projects" : projectFilter}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">
                        All Projects
                      </SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.name} value={p.name} className="text-xs">
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 min-h-0 relative">
            <FileTree
              mode={effectiveMode}
              project={
                effectiveMode === "projects" && projectFilter !== "all"
                  ? projectFilter
                  : projects.some((p) => p.name === project)
                    ? project
                    : ""
              }
              projectFilter={projectFilter}
              target={target}
              onReturnToWorkspace={() => handleModeChange("workspace")}
              onFileOpen={handleFileOpen}
              onOpenTerminal={handleOpenTerminal}
              revealRequest={revealRequest}
              className="h-full"
            />
          </div>
        </>
      )}
    </div>
  );
}
