import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Terminal } from "@xterm/xterm";
import { SearchAddon } from "@xterm/addon-search";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { logger } from "@dam-hopper/shared/logger";
import { cn } from "@/lib/utils.js";
import { getTransport } from "@/api/transport.js";
import { api, type SessionInfo } from "@/api/client.js";
import {
  registerTerminal,
  removeTerminal,
  terminalRegistry,
} from "@/lib/terminal-registry.js";
import {
  TerminalFindController,
  type TerminalFindSnapshot,
} from "@/lib/terminal-find-controller.js";
import {
  cancelScheduledTerminalFit,
  scheduleTerminalFit,
} from "@/lib/terminal-fit-scheduler.js";
import { syncNativeKeyboardSuppression } from "@/lib/terminal-native-input-policy.js";
import {
  activateTerminalWebglRenderer,
  type TerminalRendererHandle,
} from "@/lib/terminal-renderer.js";
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
import {
  createTerminalStreamReplayGate,
  markTerminalStreamReadyAfterRestart,
  resetTerminalStreamReplayGateForAttach,
} from "@/lib/terminal-stream-replay-gate.js";
import { registerTerminalOutputActivity } from "@/lib/terminal-output-activity.js";
import {
  TerminalAttachRecoveryController,
  type TerminalConnectionStatus,
} from "@/lib/terminal-attach-recovery-controller.js";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";
import {
  attachTerminalAgentNotifications,
  type TerminalAgentNotificationIntegration,
} from "@/lib/terminal-agent-notification-integration.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer.js";
import { useTerminalSuggestions } from "@/hooks/use-terminal-suggestions.js";
import { useAndroidChromeInputPolicy } from "@/contexts/AndroidChromeInputPolicyContext.js";
import { useAppZoom } from "@/contexts/AppZoomContext.js";
import { useTransportGeneration } from "@/hooks/use-transport-generation.js";
import { TerminalFindBar } from "@/components/atoms/TerminalFindBar.js";
import { TerminalSuggestionGhost } from "@/components/atoms/TerminalSuggestionGhost.js";
import { TerminalHistoryList } from "@/components/organisms/TerminalHistoryList.js";
import { getHistory, searchHistory } from "@/lib/command-history.js";
import { rememberTerminalSessionIncarnation } from "@/lib/terminal-incarnation-state.js";

interface TerminalPanelProps {
  /** Unique session ID (e.g. "build:api-server", "run:api-server") */
  sessionId: string;
  /** Project name — used to resolve env + cwd in main process */
  project: string;
  /** Shell command to execute immediately on mount */
  command: string;
  /** Working directory — only used when the session must be created (not reconnected) */
  cwd?: string;
  /** Server-validated worktree target used when creating or recovering this session. */
  worktreePath?: string;
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
  /** Enables WebGL only while this kept-alive terminal is visible. */
  webglEnabled?: boolean;
  className?: string;
}

const DARK_THEME = {
  background: "#0D1117",
  foreground: "#F8FAFC",
  cursor: "#60A5FA",
  selectionBackground: "#475569",
  black: "#94A3B8",
  red: "#F87171",
  green: "#34D399",
  yellow: "#FACC15",
  blue: "#60A5FA",
  magenta: "#C084FC",
  cyan: "#22D3EE",
  white: "#E2E8F0",
  brightBlack: "#CBD5E1",
  brightRed: "#FCA5A5",
  brightGreen: "#6EE7B7",
  brightYellow: "#FDE047",
  brightBlue: "#93C5FD",
  brightMagenta: "#D8B4FE",
  brightCyan: "#67E8F9",
  brightWhite: "#FFFFFF",
};

const EMPTY_FIND_SNAPSHOT: TerminalFindSnapshot = {
  isOpen: false,
  query: "",
  resultIndex: 0,
  resultCount: 0,
  status: "empty",
};

const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function TerminalPanel({
  sessionId,
  project,
  command,
  cwd,
  worktreePath,
  onExit,
  onNewTerminal,
  onTerminalReady,
  suppressAutoFocus = false,
  suppressNativeKeyboard = suppressAutoFocus,
  terminalOrder,
  webglEnabled = false,
  className,
}: TerminalPanelProps) {
  const transportGeneration = useTransportGeneration();
  const { level: appZoomLevel } = useAppZoom();
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();
  const shouldSuppressNativeKeyboard =
    isAndroidChromeNativeInputSuppressed || suppressNativeKeyboard;
  const shouldSuppressTerminalFocus =
    shouldSuppressNativeKeyboard || suppressAutoFocus;
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const appZoomFactor = appZoomLevel / 100;
  const terminalDisplayFontSize = terminalFontSize * appZoomFactor;
  const containerRef = useRef<HTMLDivElement>(null);
  // Sanitize session ID: server only allows [a-zA-Z0-9:._-]
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9:._-]/g, "-");
  const sessionIdRef = useRef(safeSessionId);
  // Keep the enhanced exit listener subscribed once while invoking the latest
  // manager callback after session state changes.
  const onExitRef = useRef(onExit);
  useClientLayoutEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

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
  const rendererRef = useRef<TerminalRendererHandle | null>(null);
  // Term element state — triggers re-render to mount portal after open()
  const [termElement, setTermElement] = useState<HTMLElement | null>(null);
  const findControllerRef = useRef<TerminalFindController | null>(null);
  const isCoarsePointer = useCoarsePointer();
  // Mobile/touch routing is not unified yet, so every coarse-pointer surface
  // fails closed rather than relying on a compact-width heuristic.
  const automaticSuggestionsAllowed =
    !shouldSuppressNativeKeyboard && !isCoarsePointer;
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
    : getHistory()
        .slice(0, 50)
        .map((entry) => ({ entry, score: 0 }));
  const ghostSuffix = getTerminalSuggestionSuffix(suggestions.snapshot, "full");

  const useHistoryCommand = useCallback(
    (historyCommand: string) => {
      // A newline is an execution boundary in a PTY; the dialog keeps it copy-only.
      if (/\r|\n/.test(historyCommand)) return;
      suggestionsRef.current.closeExplicitList();
      getTransport().terminalWrite(safeSessionId, historyCommand);
      if (!shouldSuppressNativeKeyboard) termRef.current?.focus();
    },
    [safeSessionId, shouldSuppressNativeKeyboard],
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
      fontSize: terminalDisplayFontSize,
      lineHeight: 1.4,
      scrollback: 5000,
      // PTY output already carries terminal newline semantics. Converting LF
      // to CRLF breaks alternate-screen TUIs that use bare LF with
      // cursor-relative redraws (for example, Antigravity's agy picker).
      convertEol: false,
      allowProposedApi: true,
    });

    // Keep a stable, imperatively owned boundary because PaneContainer moves
    // terminal surfaces between hosts outside React's tree. Its reciprocal
    // zoom cancels the document zoom for the xterm subtree only.
    const terminalBoundary = document.createElement("div");
    terminalBoundary.style.position = "absolute";
    terminalBoundary.style.inset = "0";
    terminalBoundary.style.width = "100%";
    terminalBoundary.style.height = "100%";
    terminalBoundary.style.overflow = "hidden";
    terminalBoundary.style.zoom = String(1 / appZoomFactor);
    const terminalHost = document.createElement("div");
    terminalHost.style.position = "relative";
    terminalHost.style.width = "100%";
    terminalHost.style.height = "100%";
    terminalBoundary.appendChild(terminalHost);
    container.appendChild(terminalBoundary);

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalHost);

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

    // Expose terminal instance and element for suggestions hook + portal
    termRef.current = term;
    syncNativeKeyboardSuppression(term, shouldSuppressNativeKeyboard);
    setTermElement(term.element ?? null);

    // Separate receipt from xterm's asynchronous replay completion. Live output
    // remains fail-closed before a buffer arrives, then queues until replay parsing
    // is complete so historical OSC 9 events cannot be delivered as live alerts.
    const streamReplayGate = createTerminalStreamReplayGate();
    const outputActivity = registerTerminalOutputActivity(safeSessionId);
    const resetActivityForUnavailableStream = () => {
      resetTerminalStreamReplayGateForAttach(streamReplayGate);
      outputActivity.setStreamReady(false);
    };
    let disposed = false;
    let restartRecoveryPending = false;
    let restartProbeGeneration = 0;
    let recordedSuppressedOutput = false;
    let lastServerOffset = 0;

    // Track all cleanups so the effect return can always run them
    let unsubData: (() => void) | null = null;
    let unsubExit: (() => void) | null = null;
    let unsubExitEnhanced: (() => void) | null = null;
    let unsubRestart: (() => void) | null = null;
    let unsubTerminalChanged: (() => void) | null = null;
    let unsubBuffer: (() => void) | null = null;
    let unsubLifecycle: (() => void) | null = null;
    let unsubStatus: (() => void) | null = null;
    let inputDisposable: { dispose: () => void } | null = null;
    let releaseCompositionGuards = () => {};
    let agentNotifications: TerminalAgentNotificationIntegration | null = null;
    let observer: ResizeObserver | null = null;
    let recoveryController: TerminalAttachRecoveryController | null = null;
    const retryUnavailableAfterReplayRef = { current: false };

    const reopenLiveStreamAfterRestart = () => {
      if (disposed) return;
      restartRecoveryPending = false;
      restartProbeGeneration += 1;
      markTerminalStreamReadyAfterRestart(streamReplayGate);
      outputActivity.setStreamReady(true);
      agentNotifications?.setReplayActive(false);
    };

    const probeRestartReadiness = () => {
      if (disposed || !restartRecoveryPending) return;
      const probeGeneration = ++restartProbeGeneration;
      void transport
        .invoke<SessionInfo[]>("terminal:listDetailed")
        .then((sessions) => {
          if (
            disposed ||
            !restartRecoveryPending ||
            probeGeneration !== restartProbeGeneration
          )
            return;
          if (
            sessions.some(
              (session) => session.id === safeSessionId && session.alive,
            )
          ) {
            reopenLiveStreamAfterRestart();
          }
        })
        .catch(() => {});
    };
    let releaseTouchScroll = () => {};
    let geometryAdapter: TerminalCursorGeometryAdapter | null = null;

    // Register in global registry so PaneContainer can reparent the terminal element
    const terminalEntry = registerTerminal(
      safeSessionId,
      term,
      fitAddon,
      findController,
      terminalBoundary,
    );
    geometryAdapter = new TerminalCursorGeometryAdapter(
      term,
      setCursorGeometry,
    );
    cursorGeometryAdapterRef.current = geometryAdapter;
    terminalEntry.invalidateSuggestionGeometry = () =>
      geometryAdapter?.invalidate();
    onTerminalReady?.(safeSessionId);
    releaseTouchScroll = bindTerminalTouchScroll(term.element ?? null, term);

    const transport = getTransport();
    agentNotifications = attachTerminalAgentNotifications({
      term,
      sessionId: safeSessionId,
      project,
      getTerminalOrder: () => terminalOrderRef.current,
    });

    const writeLiveData = (data: string) => {
      term.write(data);
      if (data.length > 0) outputActivity.markOutput();
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
      if (
        streamReplayGate.hasAttachBufferBeenReceived &&
        streamReplayGate.isLiveStreamReady
      ) {
        writeLiveData(data);
      } else if (
        streamReplayGate.hasAttachBufferBeenReceived &&
        streamReplayGate.isReplayWriting
      ) {
        streamReplayGate.queuedLiveData.push(data);
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
        // A delayed response from an attach that predates a confirmed restart,
        // or any response during its restart gap, must not replace the new
        // live stream with stale scrollback.
        if (restartRecoveryPending || streamReplayGate.isLiveStreamReady)
          return;
        recoveryController?.onBuffer();
        suggestionsRef.current.handleReplay();
        streamReplayGate.hasAttachBufferBeenReceived = true;
        streamReplayGate.isReplayWriting = true;
        streamReplayGate.isLiveStreamReady = false;
        outputActivity.setStreamReady(false);
        const currentReplayGeneration = ++streamReplayGate.replayGeneration;
        agentNotifications?.setReplayActive(true);
        lastServerOffset = applyTerminalBufferReplay(term, replay, () => {
          if (
            disposed ||
            currentReplayGeneration !== streamReplayGate.replayGeneration
          )
            return;

          streamReplayGate.isReplayWriting = false;
          streamReplayGate.isLiveStreamReady = true;
          outputActivity.setStreamReady(true);
          agentNotifications?.setReplayActive(false);
          const queuedLiveDataSnapshot =
            streamReplayGate.queuedLiveData.splice(0);
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
          recoveryController?.onReplayComplete();
        });
        recordClientDiagnostic("transport", "terminal-panel", "buffer_replay", {
          sessionId: safeSessionId,
          offset: replay.offset,
          reset: replay.reset,
          truncated: replay.truncated,
          hadSuppressedOutput: recordedSuppressedOutput,
        });
        setAttachState("attached");
      });
    }

    // 3. Clear observed activity on every PTY exit. The enhanced listener below
    // owns the existing banner/restart behavior when the transport supports it.
    unsubExit = transport.onTerminalExit(safeSessionId, () => {
      resetActivityForUnavailableStream();
    });
    unsubExitEnhanced =
      transport.onTerminalExitEnhanced?.(safeSessionId, (exitEvent) => {
        const { exitCode, willRestart, restartIn } = exitEvent;
        restartRecoveryPending = willRestart;
        restartProbeGeneration += 1;
        resetActivityForUnavailableStream();
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
        onExitRef.current?.(exitCode);
      }) ?? null;

    // 4. Handle process restart event. Respawns reuse the session ID and do not
    // replay the retained buffer, so the confirmed replacement can reopen the
    // live gate without counting the synthetic restart banner as output.
    unsubRestart =
      transport.onProcessRestarted?.(safeSessionId, (restartEvent) => {
        if (disposed) return;
        reopenLiveStreamAfterRestart();
        suggestionsRef.current.handleReplay();
        const { restartCount } = restartEvent;
        term.write(`\x1b[33m[Process restarted (#${restartCount})]\x1b[0m\r\n`);
      }) ?? null;

    // Older servers emit terminal:changed after a respawn without the dedicated
    // process:restarted event. Probe liveness only while this panel expects one.
    unsubTerminalChanged = transport.onEvent("terminal:changed", () => {
      probeRestartReadiness();
    });

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
        e.type === "keydown" &&
        e.key === "Backspace" &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        !e.isComposing
      ) {
        suggestionsRef.current.prepareBackspace();
      }
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
      const settings = useSettingsStore.getState();
      return handleSharedTerminalKeyEvent(e, {
        workspaceShortcut: settings.terminalWorkspaceShortcut,
        revealActiveFileShortcut: settings.revealActiveFileShortcut,
        panelShortcuts: [
          settings.gitPanelShortcut,
          settings.portsPanelShortcut,
          settings.fleetTerminalShortcut,
        ],
        terminalFontSizeIncreaseShortcut:
          settings.terminalFontSizeIncreaseShortcut,
        terminalFontSizeDecreaseShortcut:
          settings.terminalFontSizeDecreaseShortcut,
        onCopySelection: () => {
          const selection = term.getSelection();
          if (selection) void navigator.clipboard.writeText(selection);
        },
        onFind: () => findController.open(),
        onNewTerminal,
        onIncreaseTerminalFontSize: () => {
          if (settings.terminalFontSize < 32) {
            settings.saveDebounced({
              terminalFontSize: settings.terminalFontSize + 1,
            });
          }
        },
        onDecreaseTerminalFontSize: () => {
          if (settings.terminalFontSize > 10) {
            settings.saveDebounced({
              terminalFontSize: settings.terminalFontSize - 1,
            });
          }
        },
      });
    };
    terminalEntry.baseKeyEventHandler = baseKeyEventHandler;
    term.attachCustomKeyEventHandler(baseKeyEventHandler);

    // Initial fit — container may be hidden (display:none); FitAddon safely no-ops if dims=0
    // Now safe because resize listener is already registered above.
    scheduleTerminalFit(terminalEntry, { focus: !shouldSuppressTerminalFocus });

    const { cols, rows } = term;
    const finalCols = cols > 1 ? cols : 120;
    const finalRows = rows > 1 ? rows : 30;

    // Helper: Create a new session
    const createSession = () => {
      if (disposed) return Promise.resolve();
      setAttachState("creating");
      recordClientDiagnostic("transport", "terminal-panel", "terminal.create", {
        sessionId: safeSessionId,
        project,
      });
      return transport
        .invoke<SessionInfo>("terminal:create", {
          id: safeSessionId,
          project,
          command,
          cwd,
          worktreePath,
          cols: finalCols,
          rows: finalRows,
        })
        .then((session) => {
          if (session) {
            rememberTerminalSessionIncarnation(session.id, session.incarnation);
          }
          retryUnavailableAfterReplayRef.current = false;
        });
    };

    const sendAttach = (fromOffset?: number, retryAttempt = 0) => {
      suggestionsRef.current.handleReplay();
      // Every attach starts a new replay ownership window. In particular, a
      // reconnect must close the prior live-ready gate before sending attach so
      // old-stream output cannot render ahead of the replacement replay.
      resetActivityForUnavailableStream();
      setAttachState("attaching");
      if (retryAttempt === 0) {
        recordClientDiagnostic(
          "transport",
          "terminal-panel",
          "terminal.attach",
          {
            sessionId: safeSessionId,
            fromOffset,
          },
        );
      }

      return transport.terminalAttach
        ? transport.terminalAttach(safeSessionId, fromOffset) !== false
        : false;
    };

    recoveryController = new TerminalAttachRecoveryController({
      sendAttach,
      checkAlive: () =>
        transport
          .invoke<SessionInfo[]>("terminal:listDetailed")
          .then((sessions) =>
            sessions.some(
              (session) => session.id === safeSessionId && session.alive,
            ),
          ),
      create: createSession,
      shouldRetryAfterReplay: () => retryUnavailableAfterReplayRef.current,
      onTimeout: () => {
        logger.warn(
          "TerminalPanel",
          "terminal attach timed out; retrying with backoff",
          {
            sessionId: safeSessionId,
          },
        );
        recordClientDiagnostic(
          "transport",
          "terminal-panel",
          "terminal.attach_timeout_retrying",
          { sessionId: safeSessionId },
        );
      },
      onCreateFailed: (err: unknown) => {
        recordClientDiagnostic(
          "transport",
          "terminal-panel",
          "terminal.create_failed",
          {
            sessionId: safeSessionId,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      },
      onAttachUnavailable: () => {
        recordClientDiagnostic(
          "transport",
          "terminal-panel",
          "terminal.attach_deferred",
          { sessionId: safeSessionId },
        );
      },
    });

    if (transport.onStatusChange) {
      unsubStatus = transport.onStatusChange((status) => {
        if (status !== "connected") {
          restartRecoveryPending = false;
          restartProbeGeneration += 1;
          resetActivityForUnavailableStream();
        }
        recoveryController?.onConnectionStatus(
          status as TerminalConnectionStatus,
          lastServerOffset,
        );
      });
    }

    // Start initialization flow
    api.workspace
      .status()
      .then(() => transport.invoke<SessionInfo[]>("terminal:listDetailed"))
      .then((sessions) => {
        if (disposed) return;
        const existingSession = sessions.find((s) => s.id === safeSessionId);
        retryUnavailableAfterReplayRef.current =
          existingSession?.targetUnavailable === true;
        // An unavailable session is intentionally dead but still owns its
        // persisted scrollback. Attach first so it can be replayed while the
        // worktree is missing; recovery will create only if attach fails.
        if (existingSession?.alive || existingSession?.targetUnavailable) {
          recoveryController?.start();
        } else {
          return createSession().then(() => recoveryController?.start());
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
      streamReplayGate.replayGeneration += 1;
      streamReplayGate.queuedLiveData.length = 0;
      unsubData?.();
      unsubExit?.();
      unsubExitEnhanced?.();
      unsubRestart?.();
      unsubTerminalChanged?.();
      unsubBuffer?.();
      unsubLifecycle?.();
      unsubStatus?.();
      outputActivity.dispose();
      recoveryController?.dispose();
      inputDisposable?.dispose();
      releaseCompositionGuards();
      titleDisposable.dispose();
      agentNotifications?.dispose();
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
      rendererRef.current?.dispose();
      rendererRef.current = null;
      term.dispose();
      terminalBoundary.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transportGeneration]);

  useClientLayoutEffect(() => {
    const term = termRef.current;
    const entry = terminalRegistry.get(safeSessionId);
    const attachmentElement = entry?.attachmentElement ?? term?.element;
    if (!term || !attachmentElement || !entry) return;

    const zoomFactor = appZoomLevel / 100;
    const nextFontSize = terminalFontSize * zoomFactor;
    const nextElementZoom = String(1 / zoomFactor);
    const fontSizeChanged = term.options.fontSize !== nextFontSize;
    const zoomChanged = attachmentElement.style.zoom !== nextElementZoom;
    if (!fontSizeChanged && !zoomChanged) return;

    attachmentElement.style.zoom = nextElementZoom;
    if (fontSizeChanged) term.options.fontSize = nextFontSize;
    entry.invalidateSuggestionGeometry?.();
    scheduleTerminalFit(entry, { focus: false });
  }, [safeSessionId, termElement, terminalFontSize, appZoomLevel]);

  const shouldEnableWebgl = webglEnabled && appZoomLevel === 100;
  useEffect(() => {
    const term = termRef.current;
    if (!term || !termElement || !shouldEnableWebgl) {
      rendererRef.current?.dispose();
      rendererRef.current = null;
      return;
    }

    if (rendererRef.current) return;

    rendererRef.current = activateTerminalWebglRenderer(term);

    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [shouldEnableWebgl, termElement]);

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
    syncNativeKeyboardSuppression(
      termRef.current,
      shouldSuppressNativeKeyboard,
    );
    if (!shouldSuppressTerminalFocus) return;
    const entry = terminalRegistry.get(safeSessionId);
    if (entry) {
      cancelScheduledTerminalFit(entry);
      scheduleTerminalFit(entry, { focus: false });
    }
  }, [
    safeSessionId,
    shouldSuppressNativeKeyboard,
    shouldSuppressTerminalFocus,
    termElement,
  ]);

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
              if (!shouldSuppressNativeKeyboard) termRef.current?.focus();
            }}
            autoFocusInput={!shouldSuppressNativeKeyboard}
          />,
          termElement,
        )}
      {termElement &&
        ghostSuffix &&
        cursorGeometry &&
        createPortal(
          <TerminalSuggestionGhost
            suffix={ghostSuffix}
            position={cursorGeometry}
            fontSize={terminalDisplayFontSize}
          />,
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
