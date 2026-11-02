import { useCallback, useMemo } from "react";
import type { OsWindow } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { SearchPanel } from "@/components/organisms/SearchPanel.js";
import { dispatchIntent, createIntent } from "../intents.js";
import { normalizeProjectTarget } from "@/api/client.js";
import type { SearchResultItem } from "@/lib/search-matches.js";
import { isContentSearchMatch, isPathSearchMatch } from "@/lib/search-matches.js";

export interface SearchAppProps {
  window: OsWindow;
}

export function SearchApp({ window }: SearchAppProps) {
  const owner = useWindowOwner();
  const profileId = owner.profileId;
  const project = window.ctx.projectId ?? "";
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

  const handleResultClick = useCallback(
    (match: SearchResultItem) => {
      let filePath = "";
      let line: number | undefined;

      if (isContentSearchMatch(match)) {
        filePath = match.path;
        line = match.line;
      } else if (isPathSearchMatch(match)) {
        filePath = match.path;
      }

      if (filePath) {
        void dispatchIntent(
          createIntent(
            "file:open",
            {
              profileId: match.profileId || profileId,
              projectId: match.project || project,
              worktreeId: match.targetRef?.worktreePath ?? undefined,
              filePath,
              line,
            },
            window.id,
          ),
        );
      }
    },
    [profileId, project, worktreeId, window.id],
  );

  return (
    <div
      data-os-search-app={window.id}
      data-testid={`search-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      <div className="flex-1 min-h-0 relative">
        <SearchPanel
          project={project}
          target={target}
          onResultClick={handleResultClick}
          autoFocus={false}
        />
      </div>
    </div>
  );
}
