import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { cn } from "@/lib/utils.js";
import { getTransport } from "@/api/transport.js";
import { api } from "@/api/client.js";
import { registerTerminal, removeTerminal } from "@/lib/terminal-registry.js";
import { recordCommand } from "@/lib/command-history.js";
import { useTerminalSuggestions } from "@/hooks/useTerminalSuggestions.js";
import { TerminalSuggestionOverlay } from "@/components/atoms/TerminalSuggestionOverlay.js";

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
  /** Called after the xterm Terminal instance is opened and registered; used by PaneContainer to reparent */
  onTerminalReady?: (sessionId: string) => void;
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
  onTerminalReady,
  className,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Sanitize session ID: server only allows [a-zA-Z0-9:._-]
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9:._-]/g, "-");
  const sessionIdRef = useRef(safeSessionId);
  const openedRef = useRef(false);
  const [attachState, setAttachState] = useState<"idle" | "attaching" | "attached" | "creating">("idle");
  sessionIdRef.current = safeSessionId;

  // Terminal instance ref — set after term.open(), used by useTerminalSuggestions
  const termRef = useRef<Terminal | null>(null);
  // Term element state — triggers re-render to mount portal after open()
  const [termElement, setTermElement] = useState<HTMLElement | null>(null);
  // Transport ref — needed by JSX-level onAccept without a closure over useEffect locals
  const transportRef = useRef<ReturnType<typeof getTransport> | null>(null);

  const suggestions = useTerminalSuggestions(termRef, safeSessionId, project);
  // Keep a stable ref so closures inside the main useEffect always access the latest methods
  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // StrictMode double-invoke guard: only open once per mount
    if (openedRef.current) return;
    openedRef.current = true;

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

    // Expose terminal instance and element for suggestions hook + portal
    termRef.current = term;
    setTermElement(term.element ?? null);

    // Register in global registry so PaneContainer can reparent the terminal element
    registerTerminal(safeSessionId, term, fitAddon);
    onTerminalReady?.(safeSessionId);

    // Flag to prevent double-output during initialization
    let hasBufferBeenWritten = false;

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
    transportRef.current = transport;

    // ── Register all listeners immediately to avoid race conditions ──────────
    // 1. Stream PTY output → xterm + notify suggestion detector
    unsubData = transport.onTerminalData(safeSessionId, (data) => {
      // Only write stream data if we've already handled the initial buffer
      if (hasBufferBeenWritten) {
        term.write(data);
        suggestionsRef.current.notifyOutput();
      }
    });

    // 2. Handle PTY buffer (response to terminal:attach)
    if (transport.onTerminalBuffer) {
      unsubBuffer = transport.onTerminalBuffer(safeSessionId, ({ data }) => {
        // Clear terminal and write buffer
        term.clear();
        term.write(data);
        hasBufferBeenWritten = true;
        setAttachState("attached");
        if (attachTimeout) {
          clearTimeout(attachTimeout);
          attachTimeout = null;
        }
      });
    }

    // 3. Handle PTY exit with enhanced restart metadata
    unsubExit = transport.onTerminalExitEnhanced?.(safeSessionId, (exitEvent) => {
      const { exitCode, willRestart, restartIn } = exitEvent;
      const color = willRestart ? "\x1b[33m" : exitCode === 0 ? "\x1b[32m" : "\x1b[31m";
      const text = willRestart
        ? `[Process exited (code ${exitCode ?? "?"}), restarting in ${Math.round((restartIn ?? 0) / 1000)}s…]`
        : `[Process exited with code ${exitCode ?? "?"}]`;
      term.write(`\r\n${color}${text}\x1b[0m\r\n`);
      onExit?.(exitCode);
    }) ?? null;

    // 4. Handle process restart event
    unsubRestart = transport.onProcessRestarted?.(safeSessionId, (restartEvent) => {
      const { restartCount } = restartEvent;
      term.write(`\x1b[33m[Process restarted (#${restartCount})]\x1b[0m\r\n`);
    }) ?? null;

    // 5. Handle WebSocket connection status for reconnect banner
    unsubStatus = transport.onStatusChange?.((status) => {
      if (status === "disconnected") {
        term.write(`\r\n\x1b[2m[Reconnecting…]\x1b[0m`);
      } else if (status === "connected") {
        term.write(`\x1b[2K\r\x1b[2m[Reconnected]\x1b[0m\r\n`);
      }
    }) ?? null;

    // 6. Forward user input → PTY stdin, with suggestion interception
    inputDisposable = term.onData((data) => {
      const result = suggestionsRef.current.handleInput(data);
      if (result.inject !== undefined) {
        transport.terminalWrite(safeSessionId, result.inject);
      } else if (result.forward) {
        transport.terminalWrite(safeSessionId, data);
      }
      if (result.record) {
        recordCommand(result.record, project);
      }
    });

    // 7. PTY resize: fired by fitAddon.fit()
    const resizeDisposable = term.onResize(({ cols: c, rows: r }) => {
      transport.terminalResize(safeSessionId, c, r);
    });

    // 8. Custom keyboard shortcuts
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === "KeyC" && e.type === "keydown") {
        const sel = term.getSelection();
        if (sel) void navigator.clipboard.writeText(sel);
        return false;
      }
      if (e.ctrlKey && e.code === "Backquote") return false;
      if (e.shiftKey && !e.ctrlKey && !e.altKey && e.code === "Enter" && e.type === "keydown") {
        onNewTerminal?.();
        return false;
      }
      return true;
    });

    // Initial fit — container may be hidden (display:none); FitAddon safely no-ops if dims=0
    // Now safe because resize listener is already registered above.
    const mountRafId = requestAnimationFrame(() => {
      fitAddon.fit();
      term.focus();
    });

    const { cols, rows } = term;
    const finalCols = cols > 1 ? cols : 120;
    const finalRows = rows > 1 ? rows : 30;

    // Helper: Create a new session
    const createSession = () => {
      setAttachState("creating");
      return transport
        .invoke<string>("terminal:create", { 
          id: safeSessionId, 
          project, 
          command, 
          cwd, 
          cols: finalCols, 
          rows: finalRows 
        })
        .then(() => {
          setAttachState("attached");
        });
    };

    // Helper: Attach to existing session
    const attachToSession = () => {
      setAttachState("attaching");
      if (transport.terminalAttach) {
        transport.terminalAttach(safeSessionId);
      }

      attachTimeout = setTimeout(() => {
        console.warn(`[TerminalPanel] terminal:attach timeout for ${safeSessionId}, creating new session`);
        void createSession();
      }, 3000);
    };

    // Start initialization flow
    api.workspace.status()
      .then(() => transport.invoke<Array<{ id: string }>>("terminal:list"))
      .then((alive) => {
        if (alive.some((s) => s.id === safeSessionId)) {
          attachToSession();
        } else {
          return createSession();
        }
      })
      .then(() => {
        // Fallback ResizeObserver: fires when this hidden container changes size.
        observer = new ResizeObserver(() => {
          if (fitTimer) clearTimeout(fitTimer);
          fitTimer = setTimeout(() => {
            fitAddon.fit();
          }, 200);
        });
        observer.observe(container);
        
        // Extend inputDisposable to also clean up the resize listener
        const _inputDisposable = inputDisposable;
        inputDisposable = {
          dispose: () => {
            _inputDisposable?.dispose();
            resizeDisposable.dispose();
          },
        };
      })
      .catch((err: unknown) => {
        term.write(
          `\r\n\x1b[31mFailed to start: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`,
        );
      });

    return () => {
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
      removeTerminal(safeSessionId);
      termRef.current = null;
      openedRef.current = false;
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once per mount — use key prop to force remount

  const { state: suggestionsState, acceptSuggestion } = suggestions;

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
      {termElement &&
        suggestionsState.isVisible &&
        suggestionsState.suggestions.length > 0 &&
        createPortal(
          <TerminalSuggestionOverlay
            suggestions={suggestionsState.suggestions}
            selectedIndex={suggestionsState.selectedIndex}
            position={suggestionsState.position}
            onAccept={(cmd) => {
              const inject = acceptSuggestion(cmd);
              transportRef.current?.terminalWrite(safeSessionId, inject);
            }}
            onDismiss={() => suggestionsRef.current.notifyOutput()}
          />,
          termElement,
        )}
    </div>
  );
}
