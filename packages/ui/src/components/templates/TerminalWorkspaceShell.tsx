import { useCallback, useEffect, useState, type ReactNode } from "react";
import { TopNav } from "@/components/organisms/TopNav.js";
import { useSidebarCollapse } from "@/hooks/use-sidebar-collapse.js";
import { TerminalFloatingToolPanel } from "@/components/organisms/TerminalFloatingToolPanel.js";
import type { WorkspaceMode } from "@/lib/workspace-mode.js";
import {
  resolveTerminalWorkspacePanelActivation,
  type TerminalWorkspacePanelId,
  type TerminalWorkspacePanelRequest,
} from "@/lib/terminal-workspace-panel.js";

export function TerminalWorkspaceShell({
  terminalContent,
  terminalOverlayContent,
  fleetContent,
  gitContent,
  portsContent,
  browserContent,
  activatePanelRequest,
  workspaceMode,
  onWorkspaceModeChange,
  workspaceModeShortcutLabel,
  toolbarActions,
}: {
  terminalContent: ReactNode;
  terminalOverlayContent?: ReactNode;
  fleetContent: ReactNode;
  gitContent: ReactNode;
  portsContent?: ReactNode;
  browserContent?: ReactNode;
  activatePanelRequest?: TerminalWorkspacePanelRequest | null;
  workspaceMode: WorkspaceMode;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
  workspaceModeShortcutLabel?: string;
  toolbarActions?: ReactNode;
}) {
  const { collapsed, toggle } = useSidebarCollapse();
  const [activePanelId, setActivePanelId] =
    useState<TerminalWorkspacePanelId | null>(null);

  const closeSidePanel = useCallback(() => {
    setActivePanelId((current) => {
      if (current === null) return current;
      return null;
    });
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

  const activePanel =
    activePanelId === "git"
      ? { label: "Git", content: gitContent }
      : activePanelId === "ports"
        ? { label: "Ports", content: portsContent }
        : activePanelId === "browser"
          ? { label: "Browser", content: browserContent }
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
          {terminalOverlayContent}
          <TerminalFloatingToolPanel
            open={activePanelId !== null}
            title={activePanel.label}
            content={activePanel.content}
            onClose={closeSidePanel}
          />
        </main>
      </div>
    </div>
  );
}
