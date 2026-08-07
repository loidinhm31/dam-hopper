import { parseTerminalSessionId } from "@/lib/terminal-auto-attach.js";
import type { SessionInfo } from "@/api/client.js";

export interface TerminalSelectionMetadata {
  project: string;
  command: string;
  sessionType?: SessionInfo["type"];
}

export interface TerminalProjectSyncOptions {
  sessionId: string;
  metadata: TerminalSelectionMetadata | null;
  terminalAutoSwitchProjectEnabled: boolean;
  setActiveProject: (project: string) => void;
}

export interface TerminalSelectionOptions {
  sessionId: string;
  metadata: TerminalSelectionMetadata | null;
  terminalAutoSwitchProjectEnabled: boolean;
  setActiveProject: (project: string) => void;
  openTerminalTab: (
    sessionId: string,
    project: string,
    command: string,
  ) => void;
}

export function syncTerminalProject({
  sessionId,
  metadata,
  terminalAutoSwitchProjectEnabled,
  setActiveProject,
}: TerminalProjectSyncOptions): void {
  const project = metadata?.project ?? "";
  const sessionType =
    metadata?.sessionType ?? parseTerminalSessionId(sessionId).type;
  const isProjectOwned = [
    "build",
    "run",
    "custom",
    "shell",
    "terminal",
  ].includes(sessionType);

  if (
    terminalAutoSwitchProjectEnabled &&
    isProjectOwned &&
    project.trim().length > 0
  ) {
    setActiveProject(project);
  }
}

export function selectTerminal({
  sessionId,
  metadata,
  terminalAutoSwitchProjectEnabled,
  setActiveProject,
  openTerminalTab,
}: TerminalSelectionOptions): void {
  const project = metadata?.project ?? "";
  const command = metadata?.command ?? "";

  syncTerminalProject({
    sessionId,
    metadata,
    terminalAutoSwitchProjectEnabled,
    setActiveProject,
  });

  openTerminalTab(sessionId, project, command);
}
