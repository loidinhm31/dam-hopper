import type { WorkspaceMode } from "@/lib/workspace-mode.js";
import type { FileTreeRevealRequest } from "@/lib/file-tree-reveal.js";

export interface ActivateToolRequest {
  nonce: number;
  toolId: string;
  exclusiveTarget?: "git" | "ports" | "project" | "terminals";
}

export interface ResolveRevealActiveFileOutcomeArgs {
  projectName: string | null;
  path: string | null;
  nonce: number;
  workspaceMode: WorkspaceMode;
  isCompactWorkspace: boolean;
}

export interface RevealActiveFileOutcome {
  revealRequest: FileTreeRevealRequest;
  compactSurfaceId?: string;
  leftTopToolRequest?: ActivateToolRequest;
  openTerminalFilePanel?: boolean;
}

export function resolveRevealActiveFileOutcome({
  projectName,
  path,
  nonce,
  workspaceMode,
  isCompactWorkspace,
}: ResolveRevealActiveFileOutcomeArgs): RevealActiveFileOutcome | null {
  if (!projectName || !path) return null;

  const revealRequest: FileTreeRevealRequest = {
    project: projectName,
    path,
    nonce,
  };

  if (isCompactWorkspace) {
    if (workspaceMode === "terminal") return null;
    return {
      revealRequest,
      compactSurfaceId: "explorer",
    };
  }

  if (workspaceMode === "terminal") {
    return {
      revealRequest,
      openTerminalFilePanel: true,
    };
  }

  return {
    revealRequest,
    leftTopToolRequest: {
      nonce,
      toolId: "explorer",
    },
  };
}
