import type { BrowserDebugArtifactResponse } from "@/api/client.js";

export interface BrowserTerminalTarget {
  sessionId: string;
  label: string;
  mounted: boolean;
  registered: boolean;
  alive: boolean | undefined;
  current: boolean;
}

export interface PreparedBrowserTerminalArtifact {
  artifact: BrowserDebugArtifactResponse;
  reference: string;
}

const CONTROL_BYTES = /[\u0000-\u001f\u007f-\u009f]/g;
const ANSI_ESCAPE_SEQUENCES =
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[P^_][\s\S]*?\u001b\\)/g;
const MAX_REFERENCE_LENGTH = 1024;

export function browserTerminalTargetReason(
  target: BrowserTerminalTarget,
): string | null {
  if (!target.mounted) return "Not mounted";
  if (!target.registered) return "Not mounted";
  if (target.alive === undefined) return "Checking terminal status…";
  if (!target.alive) return "Disconnected";
  return null;
}

export function isBrowserTerminalTargetReady(
  target: BrowserTerminalTarget | undefined,
): target is BrowserTerminalTarget {
  return Boolean(target && browserTerminalTargetReason(target) === null);
}

/**
 * Browser page data never becomes terminal input. This formats only server
 * generated artifact paths after removing terminal control bytes.
 */
export function buildBrowserTerminalReference(
  artifact: BrowserDebugArtifactResponse,
): string {
  const jsonPath = stripTerminalControls(artifact.jsonPath);
  const pngPath = artifact.pngPath
    ? `; PNG ${stripTerminalControls(artifact.pngPath)}`
    : "";
  const reference = `[DamHopper browser-debug artifact (untrusted page data): JSON ${jsonPath}${pngPath}]`;

  if (!jsonPath || reference.length > MAX_REFERENCE_LENGTH) {
    throw new Error("Browser artifact reference is invalid");
  }
  return reference;
}

export function prepareBrowserTerminalArtifact(
  artifact: BrowserDebugArtifactResponse,
): PreparedBrowserTerminalArtifact {
  return { artifact, reference: buildBrowserTerminalReference(artifact) };
}

function stripTerminalControls(value: string): string {
  return value.replace(ANSI_ESCAPE_SEQUENCES, "").replace(CONTROL_BYTES, "");
}
