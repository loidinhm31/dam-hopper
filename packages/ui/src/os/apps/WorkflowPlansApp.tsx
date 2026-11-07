import { useCallback, useMemo } from "react";
import type { OsWindow } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { WorkflowContextSurface } from "@/components/organisms/WorkflowContextSurface.js";
import { dispatchIntent, createIntent } from "../intents.js";
import { normalizeProjectTarget } from "@/api/client.js";

export interface WorkflowPlansAppProps {
  window: OsWindow;
}

export function WorkflowPlansApp({ window }: WorkflowPlansAppProps) {
  const owner = useWindowOwner();
  const profileId = owner.profileId;
  const project = window.ctx.projectId ?? "default";
  const worktreeId = window.ctx.worktreeId;

  const target = useMemo(
    () =>
      normalizeProjectTarget({
        profileId,
        project,
        worktreePath: worktreeId,
      }),
    [profileId, project, worktreeId],
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

  return (
    <div
      data-os-workflow-plans-app={window.id}
      data-testid={`workflow-plans-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      <div className="flex-1 min-h-0 relative">
        <WorkflowContextSurface
          target={target}
          isOpen={true}
          onOpenTerminal={handleOpenTerminal}
        />
      </div>
    </div>
  );
}
