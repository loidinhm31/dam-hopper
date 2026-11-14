import { useCallback, useMemo, useState } from "react";
import type { OsWindow } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { useWindowStore } from "../window-store.js";
import { WorkflowContextSurface } from "@/components/organisms/WorkflowContextSurface.js";
import { dispatchIntent, createIntent } from "../intents.js";
import { normalizeProjectTarget, type ProjectTargetRef } from "@/api/client.js";
import { useProjects } from "@/api/queries.js";
import { GLOBAL_WORKSPACE_PROJECT } from "@/api/workflow-dto-types.js";
import type { WorkflowPlansMode } from "@/components/organisms/WorkflowContextDeck.js";

export interface WorkflowPlansAppProps {
  window: OsWindow;
}

export function WorkflowPlansApp({ window }: WorkflowPlansAppProps) {
  const owner = useWindowOwner();
  const profileId = owner.profileId;
  const { data: configuredProjects = [] } = useProjects({ owner, profileId });

  const persistedProject = window.appState?.selectedProject as
    | string
    | null
    | undefined;
  const persistedWorktree = window.appState?.selectedWorktreePath as
    | string
    | null
    | undefined;
  const persistedPlansMode = window.appState?.plansMode as
    | WorkflowPlansMode
    | undefined;
  const persistedItemId = window.appState?.selectedItemId as
    | string
    | undefined;

  const [fallbackTarget, setFallbackTarget] = useState<ProjectTargetRef | null>(
    () => {
      if (window.ctx.projectId) {
        return normalizeProjectTarget({
          profileId,
          project: window.ctx.projectId,
          worktreePath: window.ctx.worktreeId,
        });
      }
      return {
        profileId,
        project: GLOBAL_WORKSPACE_PROJECT,
      };
    },
  );

  const selectedTarget = useMemo<ProjectTargetRef | null>(() => {
    if (persistedProject === null) return null;
    if (typeof persistedProject === "string" && persistedProject.length > 0) {
      return normalizeProjectTarget({
        profileId,
        project: persistedProject,
        worktreePath: persistedWorktree ?? undefined,
      });
    }
    return fallbackTarget;
  }, [profileId, persistedProject, persistedWorktree, fallbackTarget]);

  const handleSelectTarget = useCallback(
    (nextTarget: ProjectTargetRef | null) => {
      const qualified = nextTarget
        ? normalizeProjectTarget({
            profileId,
            project: nextTarget.project,
            worktreePath: nextTarget.worktreePath,
          })
        : null;
      setFallbackTarget(qualified);
      useWindowStore.getState().updateAppState(window.id, {
        selectedProject: qualified ? qualified.project : null,
        selectedWorktreePath: qualified?.worktreePath ?? null,
      });
    },
    [profileId, window.id],
  );

  const handlePlansModeChange = useCallback(
    (mode: WorkflowPlansMode) => {
      useWindowStore.getState().updateAppState(window.id, {
        plansMode: mode,
      });
    },
    [window.id],
  );

  const handleOpenTerminal = useCallback(
    (sessionId: string) => {
      void dispatchIntent(
        createIntent(
          "terminal:focus",
          {
            profileId,
            terminalId: sessionId,
          },
          window.id,
        ),
      );
    },
    [profileId, window.id],
  );

  const projectList = useMemo(
    () => configuredProjects.map((p) => ({ name: p.name })),
    [configuredProjects],
  );

  return (
    <div
      data-os-workflow-plans-app={window.id}
      data-testid={`workflow-plans-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      <div className="flex-1 min-h-0 relative">
        <WorkflowContextSurface
          variant="window"
          target={selectedTarget}
          configuredProjects={projectList}
          initialSelectedItemId={persistedItemId ?? null}
          initialPlansMode={persistedPlansMode ?? "manual"}
          onPlansModeChange={handlePlansModeChange}
          onSelectTarget={handleSelectTarget}
          isOpen={true}
          onOpenTerminal={handleOpenTerminal}
        />
      </div>
    </div>
  );
}
