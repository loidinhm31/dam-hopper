import { useRef } from "react";
import { TerminalPanel } from "@/components/organisms/TerminalPanel.js";

/** Session ID prefix for IDE-shell terminals; stable per project mount. */
const IDE_TERMINAL_PREFIX = "ide:shell:" as const;

interface TerminalDockProps {
  project: string;
  className?: string;
}

/**
 * Wraps TerminalPanel for the IDE shell.
 * Reuses an existing PTY session (or creates one) scoped to the project.
 * Session persists across IDE route navigations so the user keeps their context.
 */
export function TerminalDock({ project, className }: TerminalDockProps) {
  // Stable session ID for the lifetime of the component; doesn't change on re-render.
  const sessionId = useRef(`${IDE_TERMINAL_PREFIX}${project}`).current;

  return (
    <TerminalPanel
      sessionId={sessionId}
      project={project}
      command="$SHELL"
      className={className}
    />
  );
}
