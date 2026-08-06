import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { LayoutGrid } from "lucide-react";
import { TopNav } from "@/components/organisms/TopNav.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import { cn } from "@/lib/utils.js";
import { useSidebarCollapse } from "@/hooks/use-sidebar-collapse.js";
import type { WorkspaceMode } from "@/lib/workspace-mode.js";

export interface MobileWorkspaceSurface {
  id: string;
  label: string;
  icon: LucideIcon;
  content: ReactNode;
}

interface MobileWorkspaceShellProps {
  surfaces: MobileWorkspaceSurface[];
  activeSurfaceId: string;
  onSurfaceChange: (surfaceId: string) => void;
  workspaceMode: WorkspaceMode;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
  workspaceModeShortcutLabel?: string;
  toolbarActions?: ReactNode;
}

export function MobileWorkspaceShell({
  surfaces,
  activeSurfaceId,
  onSurfaceChange,
  workspaceMode,
  onWorkspaceModeChange,
  workspaceModeShortcutLabel,
  toolbarActions,
}: MobileWorkspaceShellProps) {
  const { collapsed, toggle } = useSidebarCollapse();
  const hasSurfaces = surfaces.length > 0;

  if (!hasSurfaces) {
    return (
      <div className="app-screen-height safe-area-bottom flex flex-col overflow-hidden gradient-bg">
        <TopNav
          collapsed={collapsed}
          onToggle={toggle}
          workspaceMode={workspaceMode}
          onWorkspaceModeChange={onWorkspaceModeChange}
          workspaceModeShortcutLabel={workspaceModeShortcutLabel}
        />

        <main className="safe-area-inline compact-scroll-region flex flex-1 items-center justify-center px-4 text-center text-xs text-[var(--color-text-muted)]">
          Workspace surfaces unavailable
        </main>
      </div>
    );
  }

  const activeSurface =
    surfaces.find((surface) => surface.id === activeSurfaceId) ?? surfaces[0]!;
  const resolvedActiveSurfaceId = activeSurface.id;
  const triggerBottomClass =
    workspaceMode === "terminal"
      ? "bottom-[max(var(--safe-area-bottom),min(25rem,calc(100dvh-var(--top-nav-height)-3.5rem)))]"
      : "bottom-[calc(var(--safe-area-bottom)+1rem)]";

  return (
    <div className="app-screen-height safe-area-bottom flex flex-col overflow-hidden gradient-bg">
      <TopNav
        collapsed={collapsed}
        onToggle={toggle}
        workspaceMode={workspaceMode}
        onWorkspaceModeChange={onWorkspaceModeChange}
        workspaceModeShortcutLabel={workspaceModeShortcutLabel}
      />

      {toolbarActions && (
        <div className="safe-area-inline flex min-h-10 items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 px-3 py-1 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-xs font-semibold text-[var(--color-text)]">
              {activeSurface?.label}
            </p>
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
              {workspaceMode === "ide" ? "IDE" : "Terminal"}
            </span>
          </div>
          <div className="flex shrink-0 items-center">{toolbarActions}</div>
        </div>
      )}

      <main className="relative flex-1 overflow-hidden">
        {surfaces.map((surface) => {
          const isActive = surface.id === resolvedActiveSurfaceId;
          return (
            <section
              key={surface.id}
              hidden={!isActive}
              aria-hidden={!isActive}
              inert={!isActive}
              className={cn(
                "absolute inset-0 flex min-h-0 flex-col",
                isActive
                  ? "z-10 opacity-100"
                  : "pointer-events-none z-0 opacity-0",
              )}
            >
              {surface.content}
            </section>
          );
        })}
      </main>

      <Select value={resolvedActiveSurfaceId} onValueChange={onSurfaceChange}>
        <SelectTrigger
          aria-label={`Switch workspace surface, currently ${activeSurface.label}`}
          className={cn(
            "fixed left-[calc(var(--safe-area-left)+0.75rem)] z-[40] h-11 w-auto min-w-24 max-w-[calc(100vw-2rem)] border-[var(--color-primary)]/40 bg-[var(--color-surface)]/95 px-3 text-xs shadow-xl backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] motion-reduce:transition-none",
            triggerBottomClass,
          )}
        >
          <SelectValue>
            <span className="flex min-w-0 items-center gap-1.5">
              <LayoutGrid
                className="h-4 w-4 shrink-0 text-[var(--color-primary)]"
                aria-hidden="true"
              />
              <span className="shrink-0 font-semibold">Panels</span>
              <span className="max-w-20 truncate text-[10px] text-[var(--color-text-muted)]">
                {activeSurface.label}
              </span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          position="popper"
          side="top"
          align="start"
          sideOffset={8}
          className="z-40 max-h-[calc(100dvh-var(--top-nav-height)-var(--safe-area-bottom)-6rem)] w-[min(16rem,calc(100vw-2rem-var(--safe-area-left)-var(--safe-area-right)))] motion-reduce:animate-none"
        >
          {surfaces.map(({ id, label, icon: Icon }) => (
            <SelectItem
              key={id}
              value={id}
              className="min-h-11 gap-2 py-2 pl-8 pr-3 text-xs font-semibold"
            >
              <Icon
                className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]"
                aria-hidden="true"
              />
              <span className="truncate">{label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
