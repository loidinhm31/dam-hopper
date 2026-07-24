export type TerminalWorkspacePanelId = "git" | "ports" | "terminals" | "browser";

export interface TerminalWorkspacePanelRequest {
  nonce: number;
  targetId: TerminalWorkspacePanelId;
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
