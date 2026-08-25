import { cn } from "@/lib/utils.js";
import type { WorkspaceMode } from "@/lib/workspace-mode.js";

interface TopNavWorkspaceModeSwitchProps {
  compactLabelClass: string;
  isCompactWorkspace: boolean;
  workspaceMode: WorkspaceMode;
  workspaceModeShortcutLabel?: string;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
}

export function TopNavWorkspaceModeSwitch({
  compactLabelClass,
  isCompactWorkspace,
  workspaceMode,
  workspaceModeShortcutLabel,
  onWorkspaceModeChange,
}: TopNavWorkspaceModeSwitchProps) {
  return (
    <div
      className="flex items-center rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)]/60 p-0.5"
      title={
        workspaceModeShortcutLabel
          ? `Switch workspace mode (${workspaceModeShortcutLabel})`
          : "Switch workspace mode"
      }
    >
      {(["ide", "terminal"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onWorkspaceModeChange(mode)}
          aria-pressed={workspaceMode === mode}
          className={cn(
            "rounded-[3px] px-1.5 py-1 font-bold uppercase tracking-wider transition-colors",
            !isCompactWorkspace && "sm:px-2",
            isCompactWorkspace ? compactLabelClass : "text-[10px]",
            workspaceMode === mode
              ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
          )}
        >
          {mode === "ide" ? "IDE" : "Terminal"}
        </button>
      ))}
    </div>
  );
}
