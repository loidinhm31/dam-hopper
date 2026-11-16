import { useState, useCallback, useMemo } from "react";
import { Folder } from "lucide-react";
import type { OsWindow } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { useWindowStore } from "../window-store.js";
import { ProjectInfoPanel } from "@/components/organisms/ProjectInfoPanel.js";
import { ConfigEditor } from "@/components/organisms/ConfigEditor.js";
import { useConfig, useProjects, useUpdateConfig } from "@/api/queries.js";
import { dispatchIntent, createIntent } from "../intents.js";
import type { TreeCommand } from "@/hooks/use-terminal-tree.js";
import type { DamHopperConfig } from "@/api/client.js";
import type { ConnectionRef } from "@/api/ownership.js";
import {
  createProjectTargetSnapshot,
  type ProjectTargetSnapshot,
} from "@/stores/project-target.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";

export interface ProjectInfoAppProps {
  window: OsWindow;
}

export function ProjectInfoApp({ window }: ProjectInfoAppProps) {
  const owner = useWindowOwner();
  const profileId = owner.profileId;
  const initialTab =
    window.appState?.activeTab === "config" ? "config" : "overview";
  const [localTab, setLocalTab] = useState<"overview" | "config">(initialTab);
  const persistedTab = window.appState?.activeTab as
    | "overview"
    | "config"
    | undefined;
  const activeTab = persistedTab ?? localTab;

  const ownerRef = useMemo<ConnectionRef>(
    () => ({
      profileId: owner.profileId,
      generation: owner.generation,
    }),
    [owner.profileId, owner.generation],
  );

  const {
    data: projects = [],
    isLoading: isProjectsLoading,
    isError: isProjectsError,
  } = useProjects({
    owner: ownerRef,
    profileId,
  });
  const { data: config, isLoading: isConfigLoading } = useConfig({
    owner: ownerRef,
  });
  const updateConfigMutation = useUpdateConfig({
    owner: ownerRef,
  });

  const [localSelectedProject, setLocalSelectedProject] = useState<
    string | undefined
  >(undefined);
  const persistedProject = window.appState?.selectedProject as
    | string
    | undefined;
  const candidateProject =
    (typeof persistedProject === "string" && persistedProject.length > 0
      ? persistedProject
      : undefined) ??
    localSelectedProject ??
    (typeof window.ctx.projectId === "string" && window.ctx.projectId.length > 0
      ? window.ctx.projectId
      : undefined);

  const project = useMemo(() => {
    if (isProjectsLoading) {
      return candidateProject ?? "";
    }
    if (projects.length === 0) {
      return "";
    }
    if (
      candidateProject &&
      projects.some((item) => item.name === candidateProject)
    ) {
      return candidateProject;
    }
    return projects[0]?.name ?? "";
  }, [isProjectsLoading, projects, candidateProject]);

  const worktreeId =
    project && project === window.ctx.projectId
      ? window.ctx.worktreeId
      : undefined;

  const handleTabChange = useCallback(
    (tab: "overview" | "config") => {
      setLocalTab(tab);
      useWindowStore.getState().updateAppState(window.id, { activeTab: tab });
    },
    [window.id],
  );

  const handleSelectProject = useCallback(
    (nextProject: string) => {
      setLocalSelectedProject(nextProject);
      useWindowStore.getState().updateAppState(window.id, {
        selectedProject: nextProject,
      });
    },
    [window.id],
  );

  const targetSnapshot: ProjectTargetSnapshot = useMemo(
    () =>
      createProjectTargetSnapshot(
        { profileId: owner.profileId, project },
        worktreeId,
      ),
    [owner.profileId, project, worktreeId],
  );

  const handleLaunchCommand = useCallback(
    (command: TreeCommand) => {
      if (!project) return;
      void dispatchIntent(
        createIntent(
          "terminal:open",
          {
            profileId,
            projectId: project,
            worktreeId,
            target: {
              kind: "project",
              profileId,
              project,
              worktreePath: worktreeId,
            },
            cwd: command.cwd ?? null,
            directoryKind: command.cwd ? "explicit-folder" : "target-root",
          },
          window.id,
        ),
      );
    },
    [profileId, project, worktreeId, window.id],
  );

  const handleSaveConfig = useCallback(
    async (updated: DamHopperConfig) => {
      await updateConfigMutation.mutateAsync(updated);
    },
    [updateConfigMutation],
  );

  return (
    <div
      data-os-project-info-app={window.id}
      data-testid={`project-info-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] shrink-0 text-xs font-medium">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleTabChange("overview")}
            className={`px-2.5 py-1 rounded transition-colors ${
              activeTab === "overview"
                ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-xs"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("config")}
            className={`px-2.5 py-1 rounded transition-colors ${
              activeTab === "config"
                ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-xs"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            Configuration
          </button>
        </div>

        {activeTab === "overview" && (
          <div className="flex items-center gap-1.5 min-w-0">
            <Folder className="h-3.5 w-3.5 text-[var(--color-primary)] shrink-0" />
            <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider shrink-0">
              Project:
            </span>
            {projects.length > 0 ? (
              <Select value={project} onValueChange={handleSelectProject}>
                <SelectTrigger
                  data-testid="project-info-project-select"
                  aria-label="Select project"
                  className="h-6 w-auto min-w-[120px] max-w-[220px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0 text-xs font-medium text-[var(--color-text)] gap-1"
                >
                  <SelectValue placeholder="Select project…" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.name} value={p.name} className="text-xs">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {isProjectsLoading ? "Loading…" : "None"}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {activeTab === "overview" && (
          <>
            {!project ? (
              isProjectsLoading ? (
                <div className="flex items-center justify-center h-full py-8">
                  <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
                </div>
              ) : isProjectsError ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 py-8 text-center text-xs text-red-400">
                  <span>Failed to load projects for profile '{profileId}'</span>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 py-8 text-center text-xs text-[var(--color-text-muted)]">
                  <p>No projects configured in this workspace.</p>
                  <button
                    type="button"
                    onClick={() => handleTabChange("config")}
                    className="px-3 py-1 rounded bg-[var(--color-primary)] text-white text-xs font-medium hover:opacity-90 transition-opacity"
                  >
                    Open Configuration
                  </button>
                </div>
              )
            ) : (
              <ProjectInfoPanel
                projectName={project}
                target={targetSnapshot}
                onLaunchCommand={handleLaunchCommand}
              />
            )}
          </>
        )}
        {activeTab === "config" && (
          <div>
            {isConfigLoading || !config ? (
              <div className="flex items-center justify-center py-8 text-xs text-[var(--color-text-muted)]">
                Loading configuration...
              </div>
            ) : (
              <ConfigEditor
                config={config}
                onSave={handleSaveConfig}
                isSaving={updateConfigMutation.isPending}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
