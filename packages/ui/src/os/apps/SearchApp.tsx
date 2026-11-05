import { useCallback, useMemo, useState } from "react";
import type { OsWindow } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { SearchPanel } from "@/components/organisms/SearchPanel.js";
import { dispatchIntent, createIntent } from "../intents.js";
import type { SearchResultItem } from "@/lib/search-matches.js";
import { isContentSearchMatch, isPathSearchMatch } from "@/lib/search-matches.js";
import { useWindowStore } from "../window-store.js";
import { cn } from "@/lib/utils.js";
import { normalizeFsTarget, type FsTargetRef } from "@/api/ownership.js";

export interface SearchAppProps {
  window: OsWindow;
}
export function SearchApp({ window }: SearchAppProps) {
  const owner = useWindowOwner();
  const profileId = owner.profileId;
  const project = window.ctx.projectId ?? "";
  const worktreeId = window.ctx.worktreeId;
  const requestedQuery = window.appState?.query as string | undefined;
  const deliveryId = window.appState?.deliveryId;
  const rawMode = (window.appState?.searchMode ?? window.appState?.mode) as string | undefined;
  const initialMode: "filename" | "content" = rawMode === "filename" ? "filename" : "content";

  const [searchScope, setSearchScope] = useState<"workspace" | "project">(
    (window.appState?.scope as "workspace" | "project") ?? (project ? "project" : "workspace"),
  );

  const handleScopeChange = useCallback(
    (nextScope: "workspace" | "project") => {
      setSearchScope(nextScope);
      useWindowStore.getState().updateAppState(window.id, { scope: nextScope });
    },
    [window.id],
  );

  const target = useMemo<FsTargetRef | undefined>(() => {
    if (searchScope === "workspace") {
      return { kind: "workspace", profileId };
    }
    if (!project) return undefined;
    return {
      kind: "project",
      profileId,
      project,
      worktreePath: worktreeId,
    };
  }, [searchScope, profileId, project, worktreeId]);
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
        const matchProfileId = match.profileId || profileId;
        const isWs =
          searchScope === "workspace" ||
          (match.targetRef &&
            "kind" in match.targetRef &&
            match.targetRef.kind === "workspace");
        const targetRef = match.targetRef
          ? normalizeFsTarget(match.targetRef, matchProfileId)
          : isWs
            ? { kind: "workspace" as const, profileId: matchProfileId }
            : undefined;

        void dispatchIntent(
          createIntent(
            "file:open",
            {
              profileId: matchProfileId,
              projectId: isWs ? undefined : (match.project || project),
              worktreeId:
                match.targetRef && "worktreePath" in match.targetRef
                  ? match.targetRef.worktreePath ?? undefined
                  : undefined,
              target: targetRef,
              filePath,
              line,
              generation: match.generation,
            },
            window.id,
          ),
        );
      }
    },
    [searchScope, profileId, project, window.id],
  );

  return (
    <div
      data-os-search-app={window.id}
      data-testid={`search-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/60 text-xs shrink-0">
        <span className="text-[10px] text-[var(--color-text-muted)] font-medium uppercase tracking-wider">
          Scope:
        </span>
        <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden text-xs">
          <button
            type="button"
            data-testid="search-scope-workspace"
            onClick={() => handleScopeChange("workspace")}
            className={cn(
              "px-2.5 py-0.5 text-xs font-medium transition-colors",
              searchScope === "workspace"
                ? "bg-[var(--color-primary)] text-white"
                : "bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
          >
            Workspace
          </button>
          <button
            type="button"
            data-testid="search-scope-project"
            onClick={() => handleScopeChange("project")}
            className={cn(
              "px-2.5 py-0.5 text-xs font-medium transition-colors",
              searchScope === "project"
                ? "bg-[var(--color-primary)] text-white"
                : "bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
          >
            Project
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 relative">
        {searchScope === "project" && !project ? (
          <div className="flex flex-col items-center justify-center h-full p-4 text-center text-xs text-[var(--color-text-muted)] gap-2">
            <p>No project selected in this window context.</p>
            <button
              type="button"
              onClick={() => handleScopeChange("workspace")}
              className="px-3 py-1 rounded bg-[var(--color-primary)] text-white text-xs font-medium"
            >
              Search Workspace
            </button>
          </div>
        ) : (
          <SearchPanel
            key={`${window.id}:${searchScope}:${deliveryId ?? "initial"}`}
            project={project}
            target={target}
            initialQuery={requestedQuery}
            onResultClick={handleResultClick}
            autoFocus={false}
            isolatedState={true}
            initialMode={initialMode}
          />
        )}
      </div>
    </div>
  );
}
