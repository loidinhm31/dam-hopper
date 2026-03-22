import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { cn } from "@/lib/utils.js";

interface TerminalPanelProps {
  /** Unique session ID (e.g. "build:api-server", "run:api-server") */
  sessionId: string;
  /** Project name — used to resolve env + cwd in main process */
  project: string;
  /** Shell command to execute immediately on mount */
  command: string;
  /** Called when the PTY process exits */
  onExit?: (exitCode: number | null) => void;
  className?: string;
}

const DARK_THEME = {
  background: "#0a0a0f",
  foreground: "#ebebf0",
  cursor: "#ebebf0",
  selectionBackground: "#3a3a5a",
  black: "#1a1a2e",
  red: "#ff6b6b",
  green: "#6bcb77",
  yellow: "#ffd93d",
  blue: "#6c9ee0",
  magenta: "#c589e8",
  cyan: "#6bcbce",
  white: "#ebebf0",
  brightBlack: "#4a4a6a",
  brightRed: "#ff8e8e",
  brightGreen: "#88e09a",
  brightYellow: "#ffe06a",
  brightBlue: "#88b4ee",
  brightMagenta: "#d4a0f0",
  brightCyan: "#88d4d7",
  brightWhite: "#ffffff",
};

export function TerminalPanel({
  sessionId,
  project,
  command,
  onExit,
  className,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      theme: DARK_THEME,
      fontFamily: "monospace",
      fontSize: 13,
      lineHeight: 1.4,
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // Fit after open (layout must be visible)
    requestAnimationFrame(() => fitAddon.fit());

    const { cols, rows } = term;

    // Track all cleanups so the effect return can always run them
    let unsubData: (() => void) | null = null;
    let unsubExit: (() => void) | null = null;
    let inputDisposable: { dispose: () => void } | null = null;
    let observer: ResizeObserver | null = null;

    // Create PTY session
    window.devhub.terminal
      .create({ id: sessionId, project, command, cols, rows })
      .then(() => {
        // Stream PTY output → xterm
        unsubData = window.devhub.terminal.onData(sessionId, (data) => {
          term.write(data);
        });

        // Handle PTY exit
        unsubExit = window.devhub.terminal.onExit(sessionId, (exitCode) => {
          onExit?.(exitCode);
        });

        // Forward user input → PTY stdin
        inputDisposable = term.onData((data) => {
          window.devhub.terminal.write(sessionId, data);
        });

        // Resize PTY on panel resize
        observer = new ResizeObserver(() => {
          fitAddon.fit();
          window.devhub.terminal.resize(sessionId, term.cols, term.rows);
        });
        observer.observe(container);
      })
      .catch((err: unknown) => {
        term.write(
          `\r\n\x1b[31mFailed to start: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`,
        );
      });

    return () => {
      // Always runs, regardless of whether create() resolved or not
      unsubData?.();
      unsubExit?.();
      inputDisposable?.dispose();
      observer?.disconnect();
      window.devhub.terminal.kill(sessionIdRef.current);
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once per mount — use key prop to force remount

  return (
    <div
      ref={containerRef}
      className={cn("w-full h-full min-h-48", className)}
      style={{ background: DARK_THEME.background }}
    />
  );
}
