import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { TopNav } from "@/components/organisms/TopNav.js";
import { useResizeHandle } from "@/hooks/use-resize-handle.js";
import { useSidebarCollapse } from "@/hooks/use-sidebar-collapse.js";
import { cn } from "@/lib/utils.js";
import type { WorkspaceMode } from "@/lib/workspace-mode.js";
import {
  resolveTerminalWorkspacePanelActivation,
  type TerminalWorkspacePanelId,
  type TerminalWorkspacePanelRequest,
} from "@/lib/terminal-workspace-panel.js";

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
  terminalOverlayContent,
  fleetContent,
  gitContent,
  portsContent,
  activatePanelRequest,
  workspaceMode,
  onWorkspaceModeChange,
  workspaceModeShortcutLabel,
  onFleetLayoutChange,
  toolbarActions,
}: {
  terminalContent: ReactNode;
  terminalOverlayContent?: ReactNode;
  fleetContent: ReactNode;
  gitContent: ReactNode;
  portsContent?: ReactNode;
  activatePanelRequest?: TerminalWorkspacePanelRequest | null;
  workspaceMode: WorkspaceMode;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
  workspaceModeShortcutLabel?: string;
  onFleetLayoutChange?: () => void;
  toolbarActions?: ReactNode;
}) {
  const { collapsed, toggle } = useSidebarCollapse();
  const [activePanelId, setActivePanelId] =
    useState<TerminalWorkspacePanelId | null>(() =>
      loadFleetCollapsed() ? null : "terminals",
    );

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

  const closeSidePanel = useCallback(() => {
    setActivePanelId((current) => {
      if (current === null) return current;
      saveFleetCollapsed(true);
      return null;
    });
  }, []);

  useEffect(() => {
    onFleetLayoutChange?.();
  }, [activePanelId, onFleetLayoutChange]);

  useEffect(() => {
    if (!activatePanelRequest) return;
    // This request prop is an intentional imperative bridge from WorkspacePage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActivePanelId((current) => {
      const next = resolveTerminalWorkspacePanelActivation({
        activePanelId: current,
        targetId: activatePanelRequest.targetId,
      });
      saveFleetCollapsed(next === null);
      return next;
    });
  }, [activatePanelRequest]);

  const activePanel =
    activePanelId === "git"
      ? { label: "Git", content: gitContent }
      : activePanelId === "ports"
        ? { label: "Ports", content: portsContent }
        : { label: "Fleet Terminal", content: fleetContent };

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
      {toolbarActions && (
        <div className="flex h-10 shrink-0 items-center justify-end border-b border-[var(--color-border)] bg-[var(--color-surface)]/30 px-3">
          {toolbarActions}
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {terminalContent}
          {terminalOverlayContent}
        </main>

        {activePanelId !== null && (
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
              <section className="flex min-h-0 flex-1 flex-col">
                <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                    {activePanel.label}
                  </span>
                  <button
                    type="button"
                    onClick={closeSidePanel}
                    className="rounded-sm p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                    title={`Collapse ${activePanel.label}`}
                  >
                    <PanelRightClose className="h-4 w-4" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {activePanel.content}
                </div>
              </section>
            </aside>
          </>
        )}

        {activePanelId === null && (
          <div className="flex w-10 shrink-0 flex-col items-center border-l border-[var(--color-border)] bg-[var(--color-surface)] py-2">
            <button
              type="button"
              onClick={() => {
                saveFleetCollapsed(false);
                setActivePanelId("terminals");
              }}
              className="rounded-sm p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              title="Open Fleet Terminal"
            >
              <PanelRightOpen className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
