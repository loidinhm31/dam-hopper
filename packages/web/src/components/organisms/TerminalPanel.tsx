import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { cn } from "@/lib/utils.js";
import { getTransport } from "@/api/transport.js";
import { api } from "@/api/client.js";

interface TerminalPanelProps {
  /** Unique session ID (e.g. "build:api-server", "run:api-server") */
  sessionId: string;
  /** Project name — used to resolve env + cwd in main process */
  project: string;
  /** Shell command to execute immediately on mount */
  command: string;
  /** Working directory — only used when the session must be created (not reconnected) */
  cwd?: string;
  /** Called when the PTY process exits */
  onExit?: (exitCode: number | null) => void;
  /** Called when Shift+Enter is pressed — used to open a new terminal */
  onNewTerminal?: () => void;
  className?: string;
}

const DARK_THEME = {
  background: "#0f172a",
  foreground: "#f1f5f9",
  cursor: "#3b82f6",
  selectionBackground: "#334155",
  black: "#0f172a",
  red: "#dc2626",
  green: "#10b981",
  yellow: "#facc15",
  blue: "#3b82f6",
  magenta: "#a855f7",
  cyan: "#06b6d4",
  white: "#f1f5f9",
  brightBlack: "#334155",
  brightRed: "#f87171",
  brightGreen: "#34d399",
  brightYellow: "#fde047",
  brightBlue: "#60a5fa",
  brightMagenta: "#c084fc",
  brightCyan: "#22d3ee",
  brightWhite: "#ffffff",
};

export function TerminalPanel({
  sessionId,
  project,
  command,
  cwd,
  onExit,
  onNewTerminal,
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
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // Fit after open and focus so newly-created terminals are immediately interactive
    const mountRafId = requestAnimationFrame(() => {
      fitAddon.fit();
      term.focus();
    });

    const { cols, rows } = term;

    // Track all cleanups so the effect return can always run them
    let unsubData: (() => void) | null = null;
    let unsubExit: (() => void) | null = null;
    let inputDisposable: { dispose: () => void } | null = null;
    let observer: ResizeObserver | null = null;
    let fitTimer: ReturnType<typeof setTimeout> | null = null;

    const transport = getTransport();

    // Create or reconnect to existing PTY session
    api.workspace.status()
      .then(() => transport.invoke<Array<{ id: string }>>("terminal:list"))
      .then((alive) => {
        if (alive.some((s) => s.id === sessionId)) {
          // Reconnect — replay scrollback so the user sees past output
          return transport
            .invoke<{ buffer: string }>("terminal:buffer", sessionId)
            .then(({ buffer }) => {
              if (buffer) term.write(buffer);
            });
        }
        return transport
          .invoke<string>("terminal:create", { id: sessionId, project, command, cwd, cols, rows })
          .then(() => {});
      })
      .then(() => {
        // Stream PTY output → xterm
        unsubData = transport.onTerminalData(sessionId, (data) => {
          term.write(data);
        });

        // Handle PTY exit
        unsubExit = transport.onTerminalExit(sessionId, (exitCode) => {
          onExit?.(exitCode);
        });

        // Forward user input → PTY stdin
        // Ctrl+Shift+C → copy selection; Ctrl+Shift+V → paste from clipboard
        inputDisposable = term.onData((data) => {
          transport.terminalWrite(sessionId, data);
        });

        term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
          if (e.ctrlKey && e.shiftKey && e.code === "KeyC" && e.type === "keydown") {
            const sel = term.getSelection();
            if (sel) void navigator.clipboard.writeText(sel);
            return false; // prevent sending to PTY
          }
          if (e.ctrlKey && e.shiftKey && e.code === "KeyV" && e.type === "keydown") {
            void navigator.clipboard.readText().then((text) => {
              transport.terminalWrite(sessionId, text);
            });
            return false;
          }
          // Ctrl+` is a global shortcut — don't forward to PTY
          if (e.ctrlKey && e.code === "Backquote") return false;
          // Shift+Enter — open a new empty terminal
          if (e.shiftKey && !e.ctrlKey && !e.altKey && e.code === "Enter" && e.type === "keydown") {
            onNewTerminal?.();
            return false;
          }
          return true;
        });

        // Resize PTY on panel resize — debounced to avoid xterm flicker during CSS transitions
        observer = new ResizeObserver(() => {
          if (fitTimer) clearTimeout(fitTimer);
          fitTimer = setTimeout(() => {
            fitAddon.fit();
            transport.terminalResize(sessionId, term.cols, term.rows);
          }, 200);
        });
        observer.observe(container);
      })
      .catch((err: unknown) => {
        term.write(
          `\r\n\x1b[31mFailed to start: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`,
        );
      });

    return () => {
      // Unsubscribe listeners but do NOT kill the PTY session —
      // it should persist across navigation so the user can return to it.
      cancelAnimationFrame(mountRafId);
      unsubData?.();
      unsubExit?.();
      inputDisposable?.dispose();
      if (fitTimer) clearTimeout(fitTimer);
      observer?.disconnect();
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
