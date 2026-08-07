import { useCallback, useEffect, useState, type ReactNode } from "react";
import { TopNav } from "@/components/organisms/TopNav.js";
import { useSidebarCollapse } from "@/hooks/use-sidebar-collapse.js";
import { TerminalFloatingToolPanel } from "@/components/organisms/TerminalFloatingToolPanel.js";
import type { WorkspaceMode } from "@/lib/workspace-mode.js";
import {
  resolveTerminalFloatingPanelZIndex,
  resolveTerminalWorkspacePanelActivation,
  type TerminalFloatingPanelId,
  type TerminalWorkspacePanelControls,
  type TerminalWorkspacePanelId,
  type TerminalWorkspacePanelRequest,
} from "@/lib/terminal-workspace-panel.js";

type TerminalOverlayContent = (
  controls: TerminalWorkspacePanelControls,
) => ReactNode;

export function TerminalWorkspaceShell({
  terminalContent,
  terminalOverlayContent,
  terminalOverlayOpen,
  fleetContent,
  gitContent,
  portsContent,
  activatePanelRequest,
  workspaceMode,
  onWorkspaceModeChange,
  workspaceModeShortcutLabel,
  toolbarActions,
}: {
  terminalContent: ReactNode;
  terminalOverlayContent?: TerminalOverlayContent;
  terminalOverlayOpen?: boolean;
  fleetContent: ReactNode;
  gitContent: ReactNode;
  portsContent?: ReactNode;
  activatePanelRequest?: TerminalWorkspacePanelRequest | null;
  workspaceMode: WorkspaceMode;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
  workspaceModeShortcutLabel?: string;
  toolbarActions?: ReactNode;
}) {
  const { collapsed, toggle } = useSidebarCollapse();
  const [activePanelId, setActivePanelId] =
    useState<TerminalWorkspacePanelId | null>(null);
  const [frontPanelId, setFrontPanelId] =
    useState<TerminalFloatingPanelId | null>(null);

  const activateFloatingPanel = useCallback(
    (panelId: TerminalFloatingPanelId) => {
      setFrontPanelId(panelId);
    },
    [],
  );

  const closeSidePanel = useCallback(() => {
    setActivePanelId(null);
    setFrontPanelId((current) => (current === "tool" ? null : current));
  }, []);
  useEffect(() => {
    if (!activatePanelRequest) return;
    // This request prop is an intentional imperative bridge from WorkspacePage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActivePanelId((current) => {
      const next = resolveTerminalWorkspacePanelActivation({
        activePanelId: current,
        targetId: activatePanelRequest.targetId,
      });
      return next;
    });
  }, [activatePanelRequest]);

  useEffect(() => {
    if (activePanelId !== null) return;
    // Clear tool ownership after Escape or a panel-toggle request closes it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrontPanelId((current) => (current === "tool" ? null : current));
  }, [activePanelId]);

  useEffect(() => {
    if (terminalOverlayOpen !== false) return;
    // Files can close from WorkspacePage, so synchronize its external open state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrontPanelId((current) => (current === "files" ? null : current));
  }, [terminalOverlayOpen]);

  const activePanel =
    activePanelId === "git"
      ? { label: "Git", content: gitContent }
      : activePanelId === "ports"
        ? { label: "Ports", content: portsContent }
        : { label: "Fleet Terminal", content: fleetContent };

  return (
    <div className="flex h-screen flex-col overflow-hidden gradient-bg">
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
          {terminalOverlayContent?.({
            zIndex: resolveTerminalFloatingPanelZIndex(frontPanelId, "files"),
            onActivate: () => activateFloatingPanel("files"),
          })}
          <TerminalFloatingToolPanel
            open={activePanelId !== null}
            title={activePanel.label}
            content={activePanel.content}
            zIndex={resolveTerminalFloatingPanelZIndex(frontPanelId, "tool")}
            onActivate={() => activateFloatingPanel("tool")}
            onClose={closeSidePanel}
          />
        </main>
      </div>
    </div>
  );
}
