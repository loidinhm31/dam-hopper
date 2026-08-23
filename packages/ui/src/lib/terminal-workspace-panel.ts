export type TerminalWorkspacePanelId =
  | "git"
  | "ports"
  | "project"
  | "terminals";

export type TerminalFloatingPanelId = "files" | "tool";

export const TERMINAL_FLOATING_PANEL_BASE_Z_INDEX = 20;
export const TERMINAL_FLOATING_PANEL_FRONT_Z_INDEX = 25;

export interface TerminalWorkspacePanelRequest {
  nonce: number;
  targetId: TerminalWorkspacePanelId;
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
}: {
  activePanelId: TerminalWorkspacePanelId | null;
  targetId: TerminalWorkspacePanelId;
}): TerminalWorkspacePanelId | null {
  return activePanelId === targetId ? null : targetId;
}
