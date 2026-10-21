import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { TopNav } from "@/components/organisms/TopNav.js";
import { useSidebarCollapse } from "@/hooks/use-sidebar-collapse.js";
import { TerminalFloatingToolPanel } from "@/components/organisms/TerminalFloatingToolPanel.js";
import type { WorkspaceMode } from "@/lib/workspace-mode.js";
import {
  resolveFloatingPanelStackZIndex,
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
  projectContent,
  portsContent,
  activatePanelRequest,
  workspaceMode,
  onWorkspaceModeChange,
  workspaceModeShortcutLabel,
  toolbarActions,
  floatingPanelStack,
  onActivateFloatingPanel,
  onDeactivateFloatingPanel,
}: {
  terminalContent: ReactNode;
  terminalOverlayContent?: TerminalOverlayContent;
  terminalOverlayOpen?: boolean;
  fleetContent: ReactNode;
  gitContent: ReactNode;
  projectContent: ReactNode;
  portsContent?: ReactNode;
  activatePanelRequest?: TerminalWorkspacePanelRequest | null;
  workspaceMode: WorkspaceMode;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
  workspaceModeShortcutLabel?: string;
  toolbarActions?: ReactNode;
  floatingPanelStack?: readonly TerminalFloatingPanelId[];
  onActivateFloatingPanel?: (panelId: TerminalFloatingPanelId) => void;
  onDeactivateFloatingPanel?: (panelId: TerminalFloatingPanelId) => void;
}) {
  const { collapsed, toggle } = useSidebarCollapse();
  const [activePanelId, setActivePanelId] =
    useState<TerminalWorkspacePanelId | null>(null);
  const [frontPanelId, setFrontPanelId] =
    useState<TerminalFloatingPanelId | null>(null);
  const lastConsumedNonceRef = useRef<number | null>(null);
  const prevActivePanelIdRef = useRef<TerminalWorkspacePanelId | null>(null);

  const activateFloatingPanel = useCallback(
    (panelId: TerminalFloatingPanelId) => {
      setFrontPanelId(panelId);
      onActivateFloatingPanel?.(panelId);
    },
    [onActivateFloatingPanel],
  );

  const closeSidePanel = useCallback(() => {
    setActivePanelId(null);
  }, []);

  useEffect(() => {
    if (!activatePanelRequest) return;
    if (
      activatePanelRequest.nonce !== undefined &&
      lastConsumedNonceRef.current === activatePanelRequest.nonce
    ) {
      return;
    }
    if (activatePanelRequest.nonce !== undefined) {
      lastConsumedNonceRef.current = activatePanelRequest.nonce;
    }
    // This request prop is an intentional imperative bridge from WorkspacePage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActivePanelId((current) => {
      const next = resolveTerminalWorkspacePanelActivation({
        activePanelId: current,
        targetId: activatePanelRequest.targetId,
        intent: activatePanelRequest.intent,
      });
      return next;
    });
    if (activatePanelRequest.intent === "reveal") {
      activateFloatingPanel("tool");
    }
  }, [activateFloatingPanel, activatePanelRequest]);

  useEffect(() => {
    const wasOpen = prevActivePanelIdRef.current !== null;
    prevActivePanelIdRef.current = activePanelId;
    if (!wasOpen || activePanelId !== null) return;
    // Clear tool ownership after Escape or a panel-toggle request closes it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrontPanelId((current) => (current === "tool" ? null : current));
    onDeactivateFloatingPanel?.("tool");
  }, [activePanelId, onDeactivateFloatingPanel]);
  useEffect(() => {
    if (terminalOverlayOpen !== false) return;
    // Files can close from WorkspacePage, so synchronize its external open state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrontPanelId((current) => (current === "files" ? null : current));
    onDeactivateFloatingPanel?.("files");
  }, [onDeactivateFloatingPanel, terminalOverlayOpen]);

  const activePanel =
    activePanelId === "git"
      ? { label: "Git", content: gitContent }
      : activePanelId === "project"
        ? { label: "Project", content: projectContent }
        : activePanelId === "ports"
          ? { label: "Ports", content: portsContent }
            : { label: "Fleet Terminal", content: fleetContent };

  const effectiveFront =
    floatingPanelStack && floatingPanelStack.length > 0
      ? floatingPanelStack[floatingPanelStack.length - 1]
      : frontPanelId;
  const effectiveTopmost =
    effectiveFront ??
    (frontPanelId !== null
      ? frontPanelId
      : activePanelId !== null
        ? "tool"
        : terminalOverlayOpen
          ? "files"
          : null);
  const resolveZ = (panelId: TerminalFloatingPanelId) => {
    if (floatingPanelStack && floatingPanelStack.length > 0) {
      return resolveFloatingPanelStackZIndex(panelId, floatingPanelStack);
    }
    return resolveTerminalFloatingPanelZIndex(frontPanelId, panelId);
  };
  return (
    <div className="app-screen-height flex flex-col overflow-clip gradient-bg">
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

      <div className="flex min-h-0 flex-1 overflow-clip">
        <main className="relative flex min-w-0 flex-1 flex-col overflow-clip">
          {terminalContent}
          {terminalOverlayContent?.({
            zIndex: resolveZ("files"),
            isTopmost: effectiveTopmost === "files",
            onActivate: () => activateFloatingPanel("files"),
          })}
          <TerminalFloatingToolPanel
            open={activePanelId !== null}
            title={activePanel.label}
            content={activePanel.content}
            zIndex={resolveZ("tool")}
            isTopmost={effectiveTopmost === "tool"}
            onActivate={() => activateFloatingPanel("tool")}
            onClose={closeSidePanel}
          />
        </main>
      </div>
    </div>
  );
}
