import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { TopNav } from "@/components/organisms/TopNav.js";
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
}

export function MobileWorkspaceShell({
  surfaces,
  activeSurfaceId,
  onSurfaceChange,
  workspaceMode,
  onWorkspaceModeChange,
  workspaceModeShortcutLabel,
}: MobileWorkspaceShellProps) {
  const { collapsed, toggle } = useSidebarCollapse();
  const activeSurface =
    surfaces.find((surface) => surface.id === activeSurfaceId) ?? surfaces[0];
  const hasSurfaces = surfaces.length > 0;

  if (!hasSurfaces) {
    return (
      <div className="app-screen-height flex flex-col overflow-hidden gradient-bg">
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

  return (
    <div className="app-screen-height flex flex-col overflow-hidden gradient-bg">
      <TopNav
        collapsed={collapsed}
        onToggle={toggle}
        workspaceMode={workspaceMode}
        onWorkspaceModeChange={onWorkspaceModeChange}
        workspaceModeShortcutLabel={workspaceModeShortcutLabel}
      />

      <div className="safe-area-inline flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 px-3 py-2 backdrop-blur-sm">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-text)]">
            {activeSurface?.label}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
            {workspaceMode === "ide" ? "IDE companion" : "Terminal companion"}
          </p>
        </div>
      </div>

      <main className="compact-scroll-region relative flex-1">
        {surfaces.map((surface) => {
          const isActive = surface.id === activeSurfaceId;
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

      <nav
        className="safe-area-bottom safe-area-inline shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 px-2 py-2 backdrop-blur-md"
        aria-label="Workspace surfaces"
      >
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${surfaces.length}, minmax(0, 1fr))`,
          }}
        >
          {surfaces.map(({ id, label, icon: Icon }) => {
            const isActive = id === activeSurfaceId;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSurfaceChange(id)}
                aria-pressed={isActive}
                className={cn(
                  "flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md border px-1 py-2 text-[10px] font-semibold transition-colors",
                  isActive
                    ? "border-[var(--color-primary)]/40 bg-[var(--color-primary)]/12 text-[var(--color-primary)]"
                    : "border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
