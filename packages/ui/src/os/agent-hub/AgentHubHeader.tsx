import type { ReactElement } from "react";
import { Menu, BookOpen, AlertCircle, CircleDot, FolderTree } from "lucide-react";
import { cn } from "@/lib/utils.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import type { AgentHubSummary } from "../agent-hub.js";

export interface AgentHubHeaderProps {
  readonly sidebarHidden: boolean;
  readonly fileTreeHidden?: boolean;
  readonly selectedGroup: TraditionalTerminalProjectGroup | null;
  readonly selectedWorktree?: string | null;
  readonly summary: AgentHubSummary;
  readonly navigatorId?: string;
  onToggleSidebar(): void;
  onToggleFileTree?(): void;
  onOpenRecipes(): void;
}

export function AgentHubHeader({
  sidebarHidden,
  fileTreeHidden = false,
  selectedGroup,
  selectedWorktree,
  summary,
  navigatorId = "traditional-projects-navigator",
  onToggleSidebar,
  onToggleFileTree,
  onOpenRecipes,
}: AgentHubHeaderProps): ReactElement {
  const profileText = selectedGroup
    ? selectedGroup.profileName || selectedGroup.profileId
    : null;
  const projectText = selectedGroup ? selectedGroup.projectName : null;
  const worktreeText = selectedWorktree || "main";

  const contextPillText = selectedGroup
    ? `${profileText}/${projectText} · ${worktreeText}`
    : "No project";

  return (
    <header className="flex h-10 min-h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle projects sidebar"
          aria-expanded={!sidebarHidden}
          aria-controls={navigatorId}
          className="flex h-7 w-7 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
        </button>

        <span className="font-semibold text-[var(--color-text)]">
          Agent Hub
        </span>

        <span
          data-testid="agent-hub-context-pill"
          className="max-w-[280px] truncate rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 font-medium text-[var(--color-text-muted)]"
          title={contextPillText}
        >
          {contextPillText}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Urgency Counters */}
        <div className="flex items-center gap-1.5 font-medium">
          <span
            data-testid="agent-hub-attn-counter"
            className="flex items-center gap-1 rounded bg-[var(--color-warning)]/15 px-2 py-0.5 text-[var(--color-warning)]"
            title={`${summary.needsAttention} session(s) need attention`}
          >
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            <span>!{summary.needsAttention} Attn</span>
          </span>

          <span
            data-testid="agent-hub-work-counter"
            className="flex items-center gap-1 rounded bg-[var(--color-info)]/15 px-2 py-0.5 text-[var(--color-info)]"
            title={`${summary.working} session(s) working`}
          >
            <CircleDot className="h-3 w-3" aria-hidden="true" />
            <span>●{summary.working} Work</span>
          </span>
        </div>

        {/* Recipes launcher */}
        <button
          type="button"
          onClick={onOpenRecipes}
          aria-label="Open Recipes"
          className="flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 font-medium text-[var(--color-text)] hover:bg-[var(--color-surface)]"
        >
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Recipes</span>
        </button>

        {/* Project Files toggle button */}
        {onToggleFileTree && (
          <button
            type="button"
            onClick={onToggleFileTree}
            aria-label="Toggle files sidebar"
            aria-expanded={!fileTreeHidden}
            title={fileTreeHidden ? "Open project files" : "Close project files"}
            className={cn(
              "flex items-center gap-1.5 rounded border px-2.5 py-1 font-medium transition-colors",
              !fileTreeHidden
                ? "border-[var(--color-primary)]/40 bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)] hover:bg-[var(--color-surface)]",
            )}
          >
            <FolderTree className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Files</span>
          </button>
        )}
      </div>
    </header>
  );
}
