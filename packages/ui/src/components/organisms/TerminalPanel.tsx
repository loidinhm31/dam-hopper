import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Terminal } from "@xterm/xterm";
import { SearchAddon } from "@xterm/addon-search";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { logger } from "@dam-hopper/shared/logger";
import { cn } from "@/lib/utils.js";
import { getTransport } from "@/api/transport.js";
import { api, type SessionInfo } from "@/api/client.js";
import { registerTerminal, removeTerminal } from "@/lib/terminal-registry.js";
import {
  TerminalFindController,
  type TerminalFindSnapshot,
} from "@/lib/terminal-find-controller.js";
import {
  cancelScheduledTerminalFit,
  scheduleTerminalFit,
} from "@/lib/terminal-fit-scheduler.js";
import { activateTerminalWebglRenderer } from "@/lib/terminal-renderer.js";
import { handleSharedTerminalKeyEvent } from "@/lib/terminal-keyboard-shortcuts.js";
import { handleTerminalSuggestionKeyEvent } from "@/lib/terminal-suggestion-key-handler.js";
import { getTerminalSuggestionSuffix } from "@/lib/terminal-suggestion-acceptance.js";
import {
  TerminalCursorGeometryAdapter,
  type CursorGeometry,
} from "@/lib/terminal-cursor-geometry-adapter.js";
import { bindTerminalTouchScroll } from "@/lib/terminal-touch-scroll.js";
import {
  applyTerminalBufferReplay,
  utf8ByteLength,
} from "@/lib/terminal-buffer-replay.js";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";
import {
  attachTerminalAgentNotifications,
  type TerminalAgentNotificationIntegration,
} from "@/lib/terminal-agent-notification-integration.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer.js";
import { useTerminalSuggestions } from "@/hooks/use-terminal-suggestions.js";
import { TerminalFindBar } from "@/components/atoms/TerminalFindBar.js";
import { TerminalSuggestionGhost } from "@/components/atoms/TerminalSuggestionGhost.js";
import { TerminalHistoryList } from "@/components/organisms/TerminalHistoryList.js";
import { getHistory, searchHistory } from "@/lib/command-history.js";

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
  /** Prevents mobile browsers from opening the native keyboard through xterm focus */
  suppressAutoFocus?: boolean;
  /** Disables xterm text input for mobile custom-keyboard mode */
  suppressNativeKeyboard?: boolean;
  /** Current 1-based position in the open terminal list. */
  terminalOrder?: number;
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

const EMPTY_FIND_SNAPSHOT: TerminalFindSnapshot = {
  isOpen: false,
  query: "",
  resultIndex: 0,
  resultCount: 0,
  status: "empty",
};

function syncNativeKeyboardSuppression(
  term: Terminal | null,
  shouldSuppress: boolean,
) {
  if (!term) return;

  term.options.disableStdin = shouldSuppress;
  const textarea = term.textarea;
  if (!textarea) return;

  if (shouldSuppress) {
    textarea.inputMode = "none";
    textarea.setAttribute("inputmode", "none");
    textarea.tabIndex = -1;
    textarea.blur();
  } else {
    textarea.inputMode = "text";
    textarea.removeAttribute("inputmode");
    textarea.tabIndex = 0;
  }
}

export function TerminalPanel({
  sessionId,
  project,
  command,
  cwd,
  onExit,
  onNewTerminal,
  onTerminalReady,
  suppressAutoFocus = false,
  suppressNativeKeyboard = suppressAutoFocus,
  terminalOrder,
  className,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Sanitize session ID: server only allows [a-zA-Z0-9:._-]
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9:._-]/g, "-");
  const sessionIdRef = useRef(safeSessionId);
  const openedRef = useRef(false);
  const terminalOrderRef = useRef(terminalOrder);
  terminalOrderRef.current = terminalOrder;
  const [attachState, setAttachState] = useState<
    "idle" | "attaching" | "attached" | "creating"
  >("idle");
  const attachStateRef = useRef(attachState);
  useEffect(() => {
    attachStateRef.current = attachState;
  }, [attachState]);
  sessionIdRef.current = safeSessionId;

  // Terminal instance ref — set after term.open(), used by useTerminalSuggestions
  const termRef = useRef<Terminal | null>(null);
  // Term element state — triggers re-render to mount portal after open()
  const [termElement, setTermElement] = useState<HTMLElement | null>(null);
  const findControllerRef = useRef<TerminalFindController | null>(null);
  const isCoarsePointer = useCoarsePointer();
  // Mobile/touch routing is not unified yet, so every coarse-pointer surface
  // fails closed rather than relying on a compact-width heuristic.
  const automaticSuggestionsAllowed = !suppressNativeKeyboard && !isCoarsePointer;
  const findUnsubscribeRef = useRef<(() => void) | null>(null);
  const [findSnapshot, setFindSnapshot] =
    useState<TerminalFindSnapshot>(EMPTY_FIND_SNAPSHOT);
  const [cursorGeometry, setCursorGeometry] = useState<CursorGeometry | null>(
    null,
  );
  const [historyQuery, setHistoryQuery] = useState("");
  const cursorGeometryAdapterRef = useRef<TerminalCursorGeometryAdapter | null>(
    null,
  );
  const suggestions = useTerminalSuggestions(
    termRef,
    safeSessionId,
    project,
    automaticSuggestionsAllowed,
  );
  // Keep a stable ref so closures inside the main useEffect always access the latest methods
  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;
  const historyResults = historyQuery
    ? searchHistory(historyQuery, 50)
    : getHistory().slice(0, 50).map((entry) => ({ entry, score: 0 }));
  const ghostSuffix = getTerminalSuggestionSuffix(suggestions.snapshot, "full");

  const useHistoryCommand = useCallback(
    (historyCommand: string) => {
      // A newline is an execution boundary in a PTY; the dialog keeps it copy-only.
      if (/\r|\n/.test(historyCommand)) return;
      suggestionsRef.current.closeExplicitList();
      getTransport().terminalWrite(safeSessionId, historyCommand);
      if (!suppressNativeKeyboard) termRef.current?.focus();
    },
    [safeSessionId, suppressNativeKeyboard],
  );

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
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // Search state belongs to this terminal's lifecycle and never enters PTY
    // transport or React state as an xterm object.
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    const findController = new TerminalFindController(searchAddon);
    findControllerRef.current = findController;
    setFindSnapshot(findController.getSnapshot());

    // Align xterm.js Unicode width tables with backend CLI tools (e.g. agy).
    // Without this, ⚡ (U+26A1, East Asian Width = Ambiguous) is rendered as 2 cells
    // by xterm.js but counted as 1 cell by the backend readline/wcwidth — causing:
    //   1. ANSI escape sequence corruption (⚡r, ⚡n, ⚡A… printed literally)
    //   2. Cursor drift while typing (text visually leads cursor by N cells)
    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = "11";

    const renderer = activateTerminalWebglRenderer(term);

    // Expose terminal instance and element for suggestions hook + portal
    termRef.current = term;
    syncNativeKeyboardSuppression(term, suppressNativeKeyboard);
    setTermElement(term.element ?? null);

    // Separate receipt from xterm's asynchronous replay completion. Live output
    // remains fail-closed before a buffer arrives, then queues until replay parsing
    // is complete so historical OSC 9 events cannot be delivered as live alerts.
    let hasAttachBufferBeenReceived = false;
    let isReplayWriting = false;
    let isLiveStreamReady = false;
    let replayGeneration = 0;
    let disposed = false;
    const queuedLiveData: string[] = [];
    let recordedSuppressedOutput = false;
    let lastServerOffset = 0;

    // Track all cleanups so the effect return can always run them
    let unsubData: (() => void) | null = null;
    let unsubExit: (() => void) | null = null;
    let unsubRestart: (() => void) | null = null;
    let unsubBuffer: (() => void) | null = null;
    let unsubLifecycle: (() => void) | null = null;
    let unsubStatus: (() => void) | null = null;
    let inputDisposable: { dispose: () => void } | null = null;
    let releaseCompositionGuards = () => {};
    let agentNotifications: TerminalAgentNotificationIntegration | null = null;
    let observer: ResizeObserver | null = null;
    let attachTimeout: ReturnType<typeof setTimeout> | null = null;
    let releaseTouchScroll = () => {};
    let geometryAdapter: TerminalCursorGeometryAdapter | null = null;

    const clearAttachTimeout = () => {
      if (!attachTimeout) return;
      clearTimeout(attachTimeout);
      attachTimeout = null;
    };

    // Register in global registry so PaneContainer can reparent the terminal element
    const terminalEntry = registerTerminal(
      safeSessionId,
      term,
      fitAddon,
      findController,
    );
    geometryAdapter = new TerminalCursorGeometryAdapter(term, setCursorGeometry);
    cursorGeometryAdapterRef.current = geometryAdapter;
    terminalEntry.invalidateSuggestionGeometry = () => geometryAdapter?.invalidate();
    onTerminalReady?.(safeSessionId);
    releaseTouchScroll = bindTerminalTouchScroll(term.element ?? null);

    const transport = getTransport();
    agentNotifications = attachTerminalAgentNotifications({
      term,
      sessionId: safeSessionId,
      project,
      getTerminalOrder: () => terminalOrderRef.current,
    });

    const writeLiveData = (data: string) => {
      term.write(data);
      lastServerOffset += utf8ByteLength(data);
      suggestionsRef.current.handleOutput(data);
      agentNotifications?.onOutput();
    };

    // ── Register all listeners immediately to avoid race conditions ──────────
    // 1. Stream PTY output → xterm + invalidate the suggestion controller.
    // Output alone never establishes a shell prompt or command boundary.
    unsubData = transport.onTerminalData(safeSessionId, (data) => {
      // Output before the first attach buffer is not safely orderable. Output that
      // arrives while xterm parses a received replay is held until its completion.
      if (hasAttachBufferBeenReceived && isLiveStreamReady) {
        writeLiveData(data);
      } else if (hasAttachBufferBeenReceived && isReplayWriting) {
        queuedLiveData.push(data);
      } else if (!recordedSuppressedOutput) {
        recordedSuppressedOutput = true;
        recordClientDiagnostic(
          "transport",
          "terminal-panel",
          "stream_suppressed_before_buffer",
          {
            sessionId: safeSessionId,
            bytes: utf8ByteLength(data),
            attachState: attachStateRef.current,
          },
        );
      }
    });

    // 1a. Only the server's nonce-validated lifecycle may establish an
    // editable command boundary. PTY output and outgoing input stay passive.
    unsubLifecycle =
      transport.onTerminalLifecycle?.(safeSessionId, (event) => {
        suggestionsRef.current.handleLifecycle(event);
      }) ?? null;

    // 2. Handle PTY buffer (response to terminal:attach)
    if (transport.onTerminalBuffer) {
      unsubBuffer = transport.onTerminalBuffer(safeSessionId, (replay) => {
        suggestionsRef.current.handleReplay();
        hasAttachBufferBeenReceived = true;
        isReplayWriting = true;
        isLiveStreamReady = false;
        const currentReplayGeneration = ++replayGeneration;
        agentNotifications?.setReplayActive(true);
        lastServerOffset = applyTerminalBufferReplay(term, replay, () => {
          if (disposed || currentReplayGeneration !== replayGeneration) return;

          isReplayWriting = false;
          isLiveStreamReady = true;
          agentNotifications?.setReplayActive(false);
          const queuedLiveDataSnapshot = queuedLiveData.splice(0);
          for (const data of queuedLiveDataSnapshot) {
            writeLiveData(data);
          }
          recordClientDiagnostic(
            "transport",
            "terminal-panel",
            "buffer_replay_complete",
            {
              sessionId: safeSessionId,
              queuedChunkCount: queuedLiveDataSnapshot.length,
            },
          );
        });
        recordClientDiagnostic("transport", "terminal-panel", "buffer_replay", {
          sessionId: safeSessionId,
          offset: replay.offset,
          reset: replay.reset,
          truncated: replay.truncated,
          hadSuppressedOutput: recordedSuppressedOutput,
        });
        setAttachState("attached");
        clearAttachTimeout();
      });
    }

    // 3. Handle PTY exit with enhanced restart metadata
    unsubExit =
      transport.onTerminalExitEnhanced?.(safeSessionId, (exitEvent) => {
        const { exitCode, willRestart, restartIn } = exitEvent;
        const color = willRestart
          ? "\x1b[33m"
          : exitCode === 0
            ? "\x1b[32m"
            : "\x1b[31m";
        const text = willRestart
          ? `[Process exited (code ${exitCode ?? "?"}), restarting in ${Math.round((restartIn ?? 0) / 1000)}s…]`
          : `[Process exited with code ${exitCode ?? "?"}]`;
        term.write(`\r\n${color}${text}\x1b[0m\r\n`);
        agentNotifications?.onTerminalExit({ willRestart });
        onExit?.(exitCode);
      }) ?? null;

    // 4. Handle process restart event
    unsubRestart =
      transport.onProcessRestarted?.(safeSessionId, (restartEvent) => {
        suggestionsRef.current.handleReplay();
        const { restartCount } = restartEvent;
        term.write(`\x1b[33m[Process restarted (#${restartCount})]\x1b[0m\r\n`);
      }) ?? null;

    // 5. Forward user input → PTY stdin, with suggestion interception
    inputDisposable = term.onData((data) => {
      agentNotifications?.onUserInput();
      const result = suggestionsRef.current.handleInput(data);
      if (result.forward) {
        transport.terminalWrite(safeSessionId, result.data);
      }
    });
    const textarea = term.textarea;
    const suppressComposition = () =>
      suggestionsRef.current.handleComposition();
    textarea?.addEventListener("compositionstart", suppressComposition);
    textarea?.addEventListener("paste", suppressComposition);
    releaseCompositionGuards = () => {
      textarea?.removeEventListener("compositionstart", suppressComposition);
      textarea?.removeEventListener("paste", suppressComposition);
    };

    const titleDisposable = term.onTitleChange((title) => {
      agentNotifications?.onTitleChange(title);
    });

    // 6. PTY resize: fired by fitAddon.fit()
    const resizeDisposable = term.onResize(({ cols: c, rows: r }) => {
      transport.terminalResize(safeSessionId, c, r);
    });

    // 7. One composed keyboard handler: an acceptance only wins after the
    // controller invalidates its current ghost and yields a suffix.
    const baseKeyEventHandler = (e: KeyboardEvent) => {
      if (
        !handleTerminalSuggestionKeyEvent(e, {
          accept: (kind) => {
            const suffix = suggestionsRef.current.accept(kind);
            if (suffix) transport.terminalWrite(safeSessionId, suffix);
            return suffix;
          },
          openHistory: () => suggestionsRef.current.openExplicitList(),
        })
      ) {
        return false;
      }
      return handleSharedTerminalKeyEvent(e, {
        workspaceShortcut:
          useSettingsStore.getState().terminalWorkspaceShortcut,
        revealActiveFileShortcut:
          useSettingsStore.getState().revealActiveFileShortcut,
        panelShortcuts: [
          useSettingsStore.getState().gitPanelShortcut,
          useSettingsStore.getState().portsPanelShortcut,
          useSettingsStore.getState().fleetTerminalShortcut,
        ],
        onCopySelection: () => {
          const selection = term.getSelection();
          if (selection) void navigator.clipboard.writeText(selection);
        },
        onFind: () => findController.open(),
        onNewTerminal,
      });
    };
    terminalEntry.baseKeyEventHandler = baseKeyEventHandler;
    term.attachCustomKeyEventHandler(baseKeyEventHandler);

    // Initial fit — container may be hidden (display:none); FitAddon safely no-ops if dims=0
    // Now safe because resize listener is already registered above.
    scheduleTerminalFit(terminalEntry, { focus: !suppressAutoFocus });

    const { cols, rows } = term;
    const finalCols = cols > 1 ? cols : 120;
    const finalRows = rows > 1 ? rows : 30;

    // Helper: Create a new session
    const createSession = () => {
      setAttachState("creating");
      recordClientDiagnostic("transport", "terminal-panel", "terminal.create", {
        sessionId: safeSessionId,
        project,
      });
      return transport
        .invoke<string>("terminal:create", {
          id: safeSessionId,
          project,
          command,
          cwd,
          cols: finalCols,
          rows: finalRows,
        })
        .then(() => {
          setAttachState("attached");
        });
    };

    // Helper: Attach to existing session
    const attachToSession = (fromOffset?: number) => {
      suggestionsRef.current.handleReplay();
      setAttachState("attaching");
      recordClientDiagnostic("transport", "terminal-panel", "terminal.attach", {
        sessionId: safeSessionId,
        fromOffset,
      });
      clearAttachTimeout();

      const attachSent = transport.terminalAttach
        ? transport.terminalAttach(safeSessionId, fromOffset) !== false
        : false;
      if (!attachSent) {
        recordClientDiagnostic(
          "transport",
          "terminal-panel",
          "terminal.attach_deferred",
          { sessionId: safeSessionId },
        );
        return;
      }

      attachTimeout = setTimeout(() => {
        attachTimeout = null;
        if (hasAttachBufferBeenReceived || attachStateRef.current === "attached") {
          return;
        }
        logger.warn(
          "TerminalPanel",
          "terminal attach timeout; creating new session",
          {
            sessionId: safeSessionId,
          },
        );
        recordClientDiagnostic(
          "transport",
          "terminal-panel",
          "terminal.attach_timeout",
          { sessionId: safeSessionId },
        );
        void transport
          .invoke<SessionInfo[]>("terminal:listDetailed")
          .then((sessions) => {
            const stillAlive = sessions.some(
              (s) => s.id === safeSessionId && s.alive,
            );
            if (stillAlive) {
              recordClientDiagnostic(
                "transport",
                "terminal-panel",
                "terminal.attach_timeout_alive",
                { sessionId: safeSessionId },
              );
              attachToSession(fromOffset);
            } else {
              void createSession();
            }
          })
          .catch((err: unknown) => {
            recordClientDiagnostic(
              "transport",
              "terminal-panel",
              "terminal.attach_timeout_check_failed",
              {
                sessionId: safeSessionId,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          });
      }, 3000);
    };

    if (transport.onStatusChange) {
      unsubStatus = transport.onStatusChange((status) => {
        if (
          status !== "connected" &&
          !hasAttachBufferBeenReceived &&
          attachStateRef.current === "attaching"
        ) {
          clearAttachTimeout();
          return;
        }

        if (
          status === "connected" &&
          !hasAttachBufferBeenReceived &&
          attachStateRef.current === "attaching"
        ) {
          attachToSession();
          return;
        }

        if (
          status === "connected" &&
          hasAttachBufferBeenReceived &&
          attachStateRef.current === "attached"
        ) {
          attachToSession(lastServerOffset);
        }
      });
    }

    // Start initialization flow
    api.workspace
      .status()
      .then(() => transport.invoke<SessionInfo[]>("terminal:listDetailed"))
      .then((sessions) => {
        if (sessions.some((s) => s.id === safeSessionId && s.alive)) {
          attachToSession();
        } else {
          return createSession();
        }
      })
      .then(() => {
        // Fallback ResizeObserver: fires when this hidden container changes size.
        observer = new ResizeObserver(() => {
          scheduleTerminalFit(terminalEntry);
        });
        observer.observe(container);

        // Extend inputDisposable to also clean up the resize listener
        const _inputDisposable = inputDisposable;
        inputDisposable = {
          dispose: () => {
            _inputDisposable?.dispose();
            resizeDisposable.dispose();
            titleDisposable.dispose();
          },
        };
      })
      .catch((err: unknown) => {
        term.write(
          `\r\n\x1b[31mFailed to start: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`,
        );
      });

    return () => {
      disposed = true;
      replayGeneration += 1;
      queuedLiveData.length = 0;
      unsubData?.();
      unsubExit?.();
      unsubRestart?.();
      unsubBuffer?.();
      unsubLifecycle?.();
      unsubStatus?.();
      inputDisposable?.dispose();
      releaseCompositionGuards();
      titleDisposable.dispose();
      agentNotifications?.dispose();
      clearAttachTimeout();
      observer?.disconnect();
      releaseTouchScroll();
      geometryAdapter?.dispose();
      if (cursorGeometryAdapterRef.current === geometryAdapter) {
        cursorGeometryAdapterRef.current = null;
      }
      cancelScheduledTerminalFit(terminalEntry);
      findUnsubscribeRef.current?.();
      findUnsubscribeRef.current = null;
      findController.dispose();
      findControllerRef.current = null;
      removeTerminal(safeSessionId);
      termRef.current = null;
      openedRef.current = false;
      renderer.dispose();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once per mount — use key prop to force remount

  useEffect(() => {
    const controller = findControllerRef.current;
    if (!controller || !termElement) return;

    findUnsubscribeRef.current?.();
    setFindSnapshot(controller.getSnapshot());
    const unsubscribe = controller.subscribe(() => {
      setFindSnapshot(controller.getSnapshot());
    });
    findUnsubscribeRef.current = unsubscribe;

    return () => {
      unsubscribe();
      if (findUnsubscribeRef.current === unsubscribe) {
        findUnsubscribeRef.current = null;
      }
    };
  }, [termElement]);

  useEffect(() => {
    syncNativeKeyboardSuppression(termRef.current, suppressNativeKeyboard);
  }, [suppressNativeKeyboard, termElement]);

  useEffect(() => {
    if (suggestions.snapshot.state === "ghost") {
      cursorGeometryAdapterRef.current?.invalidate();
      return;
    }
    setCursorGeometry(null);
    cursorGeometryAdapterRef.current?.hide();
  }, [suggestions.snapshot.state]);

  useEffect(() => {
    if (suggestions.snapshot.state === "explicit-list") {
      setHistoryQuery(suggestions.snapshot.rawInput);
    }
  }, [suggestions.snapshot.rawInput, suggestions.snapshot.state]);

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
            <svg
              className="animate-spin h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            Reconnecting...
          </div>
        </div>
      )}
      {termElement &&
        findControllerRef.current &&
        findSnapshot.isOpen &&
        createPortal(
          <TerminalFindBar
            snapshot={findSnapshot}
            onQueryChange={(query) =>
              findControllerRef.current?.setQuery(query)
            }
            onNext={() => findControllerRef.current?.findNext()}
            onPrevious={() => findControllerRef.current?.findPrevious()}
            onClose={() => {
              findControllerRef.current?.close();
              if (!suppressNativeKeyboard) termRef.current?.focus();
            }}
            autoFocusInput={!suppressNativeKeyboard}
          />,
          termElement,
        )}
      {termElement && ghostSuffix && cursorGeometry &&
        createPortal(
          <TerminalSuggestionGhost suffix={ghostSuffix} position={cursorGeometry} />,
          termElement,
        )}
      <TerminalHistoryList
        open={suggestions.snapshot.state === "explicit-list"}
        query={historyQuery}
        results={historyResults}
        onQueryChange={setHistoryQuery}
        onOpenChange={(open) => {
          if (!open) suggestions.closeExplicitList();
        }}
        onUse={useHistoryCommand}
      />
    </div>
  );
}
