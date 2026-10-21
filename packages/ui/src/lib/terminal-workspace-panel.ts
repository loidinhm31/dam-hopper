export type TerminalWorkspacePanelId =
  | "git"
  | "ports"
  | "project"
  | "terminals";

export type TerminalFloatingPanelId = "files" | "tool" | "resolver";

export const TERMINAL_FLOATING_PANEL_BASE_Z_INDEX = 20;
export const TERMINAL_FLOATING_PANEL_FRONT_Z_INDEX = 25;
export const TERMINAL_FLOATING_PANEL_TOPMOST_Z_INDEX = 30;
export type TerminalWorkspacePanelIntent = "toggle" | "reveal";

export interface TerminalWorkspacePanelRequest {
  nonce: number;
  targetId: TerminalWorkspacePanelId;
  intent: TerminalWorkspacePanelIntent;
}

export interface TerminalWorkspacePanelControls {
  zIndex: number;
  onActivate: () => void;
  isTopmost?: boolean;
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
 * Return true if panelId is currently the topmost active floating panel.
 */
export function isTopmostFloatingPanel(
  panelId: TerminalFloatingPanelId,
  frontPanelId: TerminalFloatingPanelId | null,
): boolean {
  return frontPanelId === panelId;
}

/**
 * Maintain an ordered stack of open floating panels, where the last item is topmost.
 */
export function updateFloatingPanelStack(
  currentStack: readonly TerminalFloatingPanelId[],
  panelId: TerminalFloatingPanelId,
  action: "bringToFront" | "remove",
): TerminalFloatingPanelId[] {
  if (action === "bringToFront") {
    if (
      currentStack.length > 0 &&
      currentStack[currentStack.length - 1] === panelId
    ) {
      return currentStack as TerminalFloatingPanelId[];
    }
    const filtered = currentStack.filter((id) => id !== panelId);
    return [...filtered, panelId];
  }
  const filtered = currentStack.filter((id) => id !== panelId);
  if (filtered.length === currentStack.length) {
    return currentStack as TerminalFloatingPanelId[];
  }
  return filtered;
}

/**
 * Determine zIndex from a floating panel stack. Topmost panel receives the highest zIndex.
 */
export function resolveFloatingPanelStackZIndex(
  panelId: TerminalFloatingPanelId,
  stack: readonly TerminalFloatingPanelId[],
): number {
  const index = stack.indexOf(panelId);
  if (index === -1) return TERMINAL_FLOATING_PANEL_BASE_Z_INDEX;
  return TERMINAL_FLOATING_PANEL_BASE_Z_INDEX + (index + 1) * 2;
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
