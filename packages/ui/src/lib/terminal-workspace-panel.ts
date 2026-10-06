export type TerminalWorkspacePanelId =
  | "git"
  | "ports"
  | "project"
  | "terminals"
  | "advisor";

export type TerminalFloatingPanelId = "files" | "tool";

export const TERMINAL_FLOATING_PANEL_BASE_Z_INDEX = 20;
export const TERMINAL_FLOATING_PANEL_FRONT_Z_INDEX = 25;

export type TerminalWorkspacePanelIntent = "toggle" | "reveal";

export interface TerminalWorkspacePanelRequest {
  nonce: number;
  targetId: TerminalWorkspacePanelId;
  intent: TerminalWorkspacePanelIntent;
}

export interface TerminalWorkspacePanelControls {
  zIndex: number;
  onActivate: () => void;
}

export function resolveTerminalFloatingPanelZIndex(
  frontPanelId: TerminalFloatingPanelId | null,
  panelId: TerminalFloatingPanelId,
) {
  return frontPanelId === panelId
    ? TERMINAL_FLOATING_PANEL_FRONT_Z_INDEX
    : TERMINAL_FLOATING_PANEL_BASE_Z_INDEX;
}

/**
 * Select a terminal-workspace side panel, or close the rail when the selected
 * panel is requested again. A new selection replaces the previous panel.
 */
export function resolveTerminalWorkspacePanelActivation({
  activePanelId,
  targetId,
  intent,
}: {
  activePanelId: TerminalWorkspacePanelId | null;
  targetId: TerminalWorkspacePanelId;
  intent: TerminalWorkspacePanelIntent;
}): TerminalWorkspacePanelId | null {
  if (intent === "reveal") {
    return targetId;
  }
  return activePanelId === targetId ? null : targetId;
}
