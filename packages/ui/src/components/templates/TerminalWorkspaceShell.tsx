import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { TopNav } from "@/components/organisms/TopNav.js";
import { useResizeHandle } from "@/hooks/use-resize-handle.js";
import { useSidebarCollapse } from "@/hooks/use-sidebar-collapse.js";
import { cn } from "@/lib/utils.js";
import type { WorkspaceMode } from "@/lib/workspace-mode.js";

const FLEET_WIDTH_KEY = "dam-hopper:terminal-workspace-fleet-width";
const FLEET_COLLAPSED_KEY = "dam-hopper:terminal-workspace-fleet-collapsed";

function loadFleetCollapsed() {
  try {
    return localStorage.getItem(FLEET_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveFleetCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(FLEET_COLLAPSED_KEY, String(collapsed));
  } catch {}
}

export function TerminalWorkspaceShell({
  terminalContent,
  fleetContent,
  portsContent,
  workspaceMode,
  onWorkspaceModeChange,
  workspaceModeShortcutLabel,
  onFleetLayoutChange,
}: {
  terminalContent: ReactNode;
  fleetContent: ReactNode;
  portsContent?: ReactNode;
  workspaceMode: WorkspaceMode;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
  workspaceModeShortcutLabel?: string;
  onFleetLayoutChange?: () => void;
}) {
  const { collapsed, toggle } = useSidebarCollapse();
  const [fleetCollapsed, setFleetCollapsed] = useState(loadFleetCollapsed);

  const {
    width: fleetWidth,
    handleProps,
    isDragging,
  } = useResizeHandle({
    min: 220,
    max: 560,
    defaultWidth: 300,
    storageKey: FLEET_WIDTH_KEY,
    reversed: true,
    onResizeEnd: onFleetLayoutChange,
  });

  const toggleFleet = useCallback(() => {
    setFleetCollapsed((current) => {
      const next = !current;
      saveFleetCollapsed(next);
      return next;
    });
  }, []);

  useEffect(() => {
    onFleetLayoutChange?.();
  }, [fleetCollapsed, onFleetLayoutChange]);

  return (
    <div
      className={cn(
        "flex h-screen flex-col overflow-hidden gradient-bg",
        isDragging && "select-none",
      )}
    >
      <TopNav
        collapsed={collapsed}
        onToggle={toggle}
        workspaceMode={workspaceMode}
        onWorkspaceModeChange={onWorkspaceModeChange}
        workspaceModeShortcutLabel={workspaceModeShortcutLabel}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {terminalContent}
        </main>

        {!fleetCollapsed && (
          <>
            <div
              {...handleProps}
              className="group relative w-1 shrink-0 cursor-col-resize hover:bg-[var(--color-primary)]/20"
            >
              <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-[var(--color-primary)]/50 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <aside
              style={{ width: fleetWidth }}
              className="flex min-h-0 shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]"
            >
              <section className="flex min-h-0 flex-[3] flex-col border-b border-[var(--color-border)]">
                <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                    Fleet Terminal
                  </span>
                  <button
                    type="button"
                    onClick={toggleFleet}
                    className="rounded-sm p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                    title="Collapse Fleet Terminal"
                  >
                    <PanelRightClose className="h-4 w-4" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {fleetContent}
                </div>
              </section>

              {portsContent && (
                <section className="flex min-h-48 flex-[2] flex-col">
                  <div className="flex h-9 shrink-0 items-center border-b border-[var(--color-border)] px-3">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                      Ports
                    </span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    {portsContent}
                  </div>
                </section>
              )}
            </aside>
          </>
        )}

        {fleetCollapsed && (
          <div className="flex w-10 shrink-0 flex-col items-center border-l border-[var(--color-border)] bg-[var(--color-surface)] py-2">
            <button
              type="button"
              onClick={toggleFleet}
              className="rounded-sm p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              title="Expand Fleet Terminal"
            >
              <PanelRightOpen className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
