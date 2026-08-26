import type { TerminalUsageMode } from "./terminal-usage-mode.js";

/**
 * Traditional terminal mode normally falls back to an empty terminal state
 * when no sessions are mounted. Browser must take that surface when opened.
 */
export function shouldRenderEmptyTerminalBrowserSurface({
  terminalUsageMode,
  mountedSessionCount,
  browserOpen,
  isCompactWorkspace,
}: {
  terminalUsageMode: TerminalUsageMode;
  mountedSessionCount: number;
  browserOpen: boolean;
  isCompactWorkspace: boolean;
}): boolean {
  return (
    terminalUsageMode === "traditional" &&
    mountedSessionCount === 0 &&
    browserOpen &&
    !isCompactWorkspace
  );
}
