import { useEffect, useRef, useState } from "react";
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
  const [attachState, setAttachState] = useState<"idle" | "attaching" | "attached" | "creating">("idle");
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
    let unsubRestart: (() => void) | null = null;
    let unsubStatus: (() => void) | null = null;
    let unsubBuffer: (() => void) | null = null;
    let inputDisposable: { dispose: () => void } | null = null;
    let observer: ResizeObserver | null = null;
    let fitTimer: ReturnType<typeof setTimeout> | null = null;
    let attachTimeout: ReturnType<typeof setTimeout> | null = null;

    const transport = getTransport();

    // Helper: Create a new session
    const createSession = () => {
      setAttachState("creating");
      return transport
        .invoke<string>("terminal:create", { id: sessionId, project, command, cwd, cols, rows })
        .then(() => {
          setAttachState("attached"); // treat created session as "attached" for consistency
        });
    };

    // Helper: Attach to existing session
    const attachToSession = () => {
      setAttachState("attaching");
      
      // Set up buffer listener BEFORE sending attach
      if (transport.onTerminalBuffer) {
        unsubBuffer = transport.onTerminalBuffer(sessionId, ({ data, offset }) => {
          // Clear terminal and write buffer
          term.clear();
          term.write(data);
          setAttachState("attached");
          
          // Clear timeout since we got response
          if (attachTimeout) {
            clearTimeout(attachTimeout);
            attachTimeout = null;
          }
        });
      }

      // Send attach message
      if (transport.terminalAttach) {
        transport.terminalAttach(sessionId);
      }

      // Timeout fallback: if no buffer response within 3s, create new session
      attachTimeout = setTimeout(() => {
        console.warn(`[TerminalPanel] terminal:attach timeout for ${sessionId}, creating new session`);
        unsubBuffer?.();
        unsubBuffer = null;
        void createSession();
      }, 3000);
    };

    // Create or attach to existing PTY session
    api.workspace.status()
      .then(() => transport.invoke<Array<{ id: string }>>("terminal:list"))
      .then((alive) => {
        if (alive.some((s) => s.id === sessionId)) {
          // Session exists — attach to it
          attachToSession();
        } else {
          // Session doesn't exist — create new one
          return createSession();
        }
      })
      .then(() => {
        // Stream PTY output → xterm
        unsubData = transport.onTerminalData(sessionId, (data) => {
          term.write(data);
        });

        // Handle PTY exit with enhanced restart metadata
        unsubExit = transport.onTerminalExitEnhanced?.(sessionId, (exitEvent) => {
          const { exitCode, willRestart, restartIn } = exitEvent;
          // Choose banner color and text based on restart intent
          const color = willRestart ? "\x1b[33m" : exitCode === 0 ? "\x1b[32m" : "\x1b[31m";
          const text = willRestart
            ? `[Process exited (code ${exitCode ?? "?"}), restarting in ${Math.round((restartIn ?? 0) / 1000)}s…]`
            : `[Process exited with code ${exitCode ?? "?"}]`;
          term.write(`\r\n${color}${text}\x1b[0m\r\n`);
          onExit?.(exitCode);
        }) ?? null;

        // Handle process restart event
        unsubRestart = transport.onProcessRestarted?.(sessionId, (restartEvent) => {
          const { restartCount } = restartEvent;
          term.write(`\x1b[33m[Process restarted (#${restartCount})]\x1b[0m\r\n`);
        }) ?? null;

        // Handle WebSocket connection status for reconnect banner
        unsubStatus = transport.onStatusChange?.((status) => {
          if (status === "disconnected") {
            term.write(`\r\n\x1b[2m[Reconnecting…]\x1b[0m`);
          } else if (status === "connected") {
            // Clear the reconnecting message by writing over it
            term.write(`\x1b[2K\r\x1b[2m[Reconnected]\x1b[0m\r\n`);
          }
        }) ?? null;

        // Forward user input → PTY stdin
        inputDisposable = term.onData((data) => {
          transport.terminalWrite(sessionId, data);
        });

        // Custom keyboard shortcuts:
        // - Ctrl+Shift+C: copy selection
        // - Ctrl+`: global shortcut (don't forward to PTY)
        // - Shift+Enter: open new terminal
        // Note: Ctrl+Shift+V paste is handled by xterm's native paste event (not here) to avoid duplication
        term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
          // Copy selection to clipboard
          if (e.ctrlKey && e.shiftKey && e.code === "KeyC" && e.type === "keydown") {
            const sel = term.getSelection();
            if (sel) void navigator.clipboard.writeText(sel);
            return false; // prevent sending to PTY
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
      unsubRestart?.();
      unsubStatus?.();
      unsubBuffer?.();
      inputDisposable?.dispose();
      if (fitTimer) clearTimeout(fitTimer);
      if (attachTimeout) clearTimeout(attachTimeout);
      observer?.disconnect();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once per mount — use key prop to force remount

  return (
    <div className={cn("relative w-full h-full min-h-48", className)}>
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ background: DARK_THEME.background }}
      />
      {attachState === "attaching" && (
        <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center backdrop-blur-sm">
          <div className="text-sm text-slate-300 flex items-center gap-2 animate-pulse">
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Reconnecting...
          </div>
        </div>
      )}
    </div>
  );
}
