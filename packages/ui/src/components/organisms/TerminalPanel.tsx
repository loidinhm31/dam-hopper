import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Terminal } from "@xterm/xterm";
import { SearchAddon } from "@xterm/addon-search";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { logger } from "@dam-hopper/shared/logger";
import { terminalKey, type TerminalRef } from "@/api/ownership.js";
import {
  getConnectionSnapshot,
  isCurrentConnection,
  subscribeConnections,
  getTransport as getConnectionTransport,
} from "@/api/connections.js";
import { cn } from "@/lib/utils.js";
import { getTransport, type Transport } from "@/api/transport.js";
import { useTransportGeneration } from "@/hooks/use-transport-generation.js";
import type { SessionInfo } from "@/api/client.js";
import {
  getTerminal,
  registerTerminal,
  removeTerminal,
} from "@/lib/terminal-registry.js";
import {
  TerminalFindController,
  type TerminalFindSnapshot,
} from "@/lib/terminal-find-controller.js";
import {
  cancelScheduledTerminalFit,
  isTerminalFitEligible,
  scheduleTerminalFit,
} from "@/lib/terminal-fit-scheduler.js";
import { syncNativeKeyboardSuppression } from "@/lib/terminal-native-input-policy.js";
import {
  createTerminalRendererController,
  type TerminalRendererController,
} from "@/lib/terminal-renderer.js";
import {
  handleSharedTerminalKeyEvent,
  shouldConsumeCognitoModeTerminalKey,
} from "@/lib/terminal-keyboard-shortcuts.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { handleTerminalSuggestionKeyEvent } from "@/lib/terminal-suggestion-key-handler.js";
import { getTerminalSuggestionSuffix } from "@/lib/terminal-suggestion-acceptance.js";
import {
  TerminalCursorGeometryAdapter,
  geometryEquals,
  type CursorGeometry,
} from "@/lib/terminal-cursor-geometry-adapter.js";
import { bindTerminalTouchScroll } from "@/lib/terminal-touch-scroll.js";
import {
  applyTerminalBufferReplay,
  type TerminalBufferReplay,
} from "@/lib/terminal-buffer-replay.js";
import { copyToClipboard } from "@/hooks/use-clipboard.js";
import {
  createTerminalStreamReplayGate,
  markTerminalStreamReadyAfterRestart,
  reconcileTerminalOutput,
  resetTerminalStreamReplayGateForAttach,
  shouldForwardTerminalData,
  utf8ByteLength,
  type TerminalStreamReplayGate,
} from "@/lib/terminal-stream-replay-gate.js";
import { registerTerminalOutputActivity } from "@/lib/terminal-output-activity.js";
import {
  TerminalAttachRecoveryController,
  type TerminalConnectionStatus,
} from "@/lib/terminal-attach-recovery-controller.js";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer.js";
import { useTerminalSuggestions } from "@/hooks/use-terminal-suggestions.js";
import { useAndroidChromeInputPolicy } from "@/contexts/AndroidChromeInputPolicyContext.js";
import { useAppZoom } from "@/contexts/AppZoomContext.js";
import { TerminalFindBar } from "@/components/atoms/TerminalFindBar.js";
import { TerminalSuggestionGhost } from "@/components/atoms/TerminalSuggestionGhost.js";
import { TerminalHistoryList } from "@/components/organisms/TerminalHistoryList.js";
import { getHistory, searchHistory } from "@/lib/command-history.js";
import {
  latestTerminalSessionIncarnation,
  rememberTerminalSessionIncarnation,
} from "@/lib/terminal-incarnation-state.js";

interface TerminalPanelProps {
  /** Unique session ID (e.g. "build:api-server", "run:api-server") */
  sessionId: string;
  /** Project name for owner-local notifications and history. */
  project: string;
  /** Launch metadata; the manager creates the session before mounting. */
  command: string;
  /** Launch working directory; never used to recreate a missing session. */
  cwd?: string;
  /** Server-validated launch target retained as session metadata. */
  worktreePath?: string;
  profileId?: string;
  terminalRef?: TerminalRef;
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
  profileId,
  terminalRef,
  onExit,
  onNewTerminal,
  onTerminalReady,
  suppressAutoFocus = false,
  suppressNativeKeyboard = suppressAutoFocus,
  terminalOrder,
  webglEnabled = false,
  className,
}: TerminalPanelProps) {
  const ownerProfileId = terminalRef?.profileId ?? profileId;
  const transportGeneration = useTransportGeneration(ownerProfileId);
  const boundTransportRef = useRef<{
    transport: Transport;
    isCurrent: () => boolean;
  } | null>(null);
  const syncConnectionRef = useRef<() => void>(() => {});
  useEffect(() => {
    syncConnectionRef.current();
  }, [transportGeneration]);
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
  // This is the backend ID, not the manager's qualified UI key.
  const safeSessionId = terminalRef?.id ?? sessionId;
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

  const effectiveTerminalRef = useMemo<TerminalRef | undefined>(
    () =>
      terminalRef ??
      (ownerProfileId
        ? { profileId: ownerProfileId, id: safeSessionId }
        : undefined),
    [ownerProfileId, safeSessionId, terminalRef],
  );
  const terminalRegistrationKey = effectiveTerminalRef
    ? terminalKey(effectiveTerminalRef)
    : safeSessionId;

  const writePanelInput = useCallback(
    (data: string) => {
      const binding = boundTransportRef.current;
      if (binding?.isCurrent()) {
        binding.transport.terminalWrite(safeSessionId, data);
      }
    },
    [safeSessionId],
  );
  // Terminal instance ref — set after term.open(), used by useTerminalSuggestions
  const shouldEnableWebgl = webglEnabled && appZoomLevel === 100;
  const desiredRenderer = shouldEnableWebgl ? "webgl" : "dom";
  const desiredRendererRef = useRef<"dom" | "webgl">(desiredRenderer);
  desiredRendererRef.current = desiredRenderer;
  const shouldSuppressNativeKeyboardRef = useRef(shouldSuppressNativeKeyboard);
  shouldSuppressNativeKeyboardRef.current = shouldSuppressNativeKeyboard;
  const streamReplayGateRef = useRef<TerminalStreamReplayGate | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const rendererControllerRef = useRef<TerminalRendererController | null>(null);

  const syncEffectiveStdinSuppression = useCallback(
    (targetTerm: Terminal | null) => {
      if (!targetTerm) return;
      const gate = streamReplayGateRef.current;
      const isReplayOrAttachActive =
        !gate?.isLiveStreamReady || (gate?.activeReplayWrites ?? 0) > 0;
      const effectiveSuppression =
        shouldSuppressNativeKeyboardRef.current || isReplayOrAttachActive;
      syncNativeKeyboardSuppression(targetTerm, effectiveSuppression);
    },
    [],
  );
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
    ownerProfileId,
    automaticSuggestionsAllowed,
  );
  // Keep a stable ref so closures inside the main useEffect always access the latest methods
  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;
  const historyResults = !ownerProfileId
    ? []
    : historyQuery
      ? searchHistory(historyQuery, 50, ownerProfileId)
      : getHistory(ownerProfileId)
          .slice(0, 50)
          .map((entry) => ({ entry, score: 0 }));
  const ghostSuffix = getTerminalSuggestionSuffix(suggestions.snapshot, "full");

  const useHistoryCommand = useCallback(
    (historyCommand: string) => {
      // A newline is an execution boundary in a PTY; the dialog keeps it copy-only.
      if (/\r|\n/.test(historyCommand)) return;
      suggestionsRef.current.closeExplicitList();
      writePanelInput(historyCommand);
      if (!shouldSuppressNativeKeyboard) termRef.current?.focus();
    },
    [shouldSuppressNativeKeyboard, writePanelInput],
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

    const handleContextMenu = (e: MouseEvent) => {
      if (term.hasSelection()) {
        e.preventDefault();
        const selection = term.getSelection();
        if (selection) void copyToClipboard(selection);
      }
    };
    terminalBoundary.addEventListener("contextmenu", handleContextMenu);
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
    syncEffectiveStdinSuppression(term);
    setTermElement(term.element ?? null);
    const rendererController = createTerminalRendererController(term);
    rendererControllerRef.current = rendererController;
    let releaseTouchScroll = () => {};
    let geometryAdapter: TerminalCursorGeometryAdapter | null = null;

    // Register in global registry so PaneContainer can reparent the terminal element
    const terminalEntry = registerTerminal(
      terminalRegistrationKey,
      term,
      fitAddon,
      findController,
      terminalBoundary,
      effectiveTerminalRef,
      () => rendererController.commitRenderer(desiredRendererRef.current),
    );
    geometryAdapter = new TerminalCursorGeometryAdapter(term, (geometry) => {
      setCursorGeometry((current) =>
        geometryEquals(current, geometry) ? current : geometry,
      );
    });
    cursorGeometryAdapterRef.current = geometryAdapter;
    terminalEntry.invalidateSuggestionGeometry = () =>
      geometryAdapter?.invalidate();
    onTerminalReady?.(safeSessionId);
    releaseTouchScroll = bindTerminalTouchScroll(term.element ?? null, term);
    let boundServerUrl: string | undefined;
    // Shared stream gate has same lifetime as terminal instance so in-flight
    // replay writes from an older connection continue to fence outbound queries
    // across reconnects and connection swaps.
    const streamReplayGate = createTerminalStreamReplayGate();
    streamReplayGateRef.current = streamReplayGate;
    const bindConnection = (): (() => void) => {
      if (
        terminalRef &&
        (terminalRef.id !== sessionId ||
          (profileId !== undefined && terminalRef.profileId !== profileId))
      ) {
        return () => {};
      }
      let transport: Transport;
      let isCurrent: () => boolean;
      if (ownerProfileId && getConnectionSnapshot(ownerProfileId)) {
        const snapshot = getConnectionSnapshot(ownerProfileId)!;
        if (snapshot.status !== "connected") return () => {};
        if (
          boundServerUrl !== undefined &&
          snapshot.serverUrl !== boundServerUrl
        ) {
          return () => {};
        }
        boundServerUrl = snapshot.serverUrl;
        const owner = snapshot.owner;
        transport = getConnectionTransport(owner);
        isCurrent = () => !disposed && isCurrentConnection(owner);
      } else {
        try {
          transport = getTransport();
          isCurrent = () => !disposed;
        } catch {
          return () => {};
        }
      }
      const binding = { transport, isCurrent };
      boundTransportRef.current = binding;
      term.options.disableStdin = false;
      resetTerminalStreamReplayGateForAttach(streamReplayGate);
      const outputActivity = registerTerminalOutputActivity(
        terminalRegistrationKey,
      );
      let disposed = false;
      let restartRecoveryPending = false;
      let restartProbeGeneration = 0;
      let recordedSuppressedOutput = false;
      let lastServerOffset = 0;
      let confirmedRestartPending = false;
      let pendingReplayBuffer: TerminalBufferReplay | null = null;
      let attachSentGeneration = 0;
      let acceptedStreamIncarnation: number | null = null;

      const resetActivityForUnavailableStream = () => {
        resetTerminalStreamReplayGateForAttach(streamReplayGate);
        outputActivity.setStreamReady(false);
        pendingReplayBuffer = null;
        confirmedRestartPending = false;
        term.options.disableStdin = true;
      };
      // Track all cleanups so the effect return can always run them
      let unsubData: (() => void) | null = null;
      let unsubExit: (() => void) | null = null;
      let unsubExitEnhanced: (() => void) | null = null;
      let unsubRestart: (() => void) | null = null;
      let unsubTerminalChanged: (() => void) | null = null;
      let unsubBuffer: (() => void) | null = null;
      let unsubLifecycle: (() => void) | null = null;
      let unsubStatus: (() => void) | null = null;
      let unsubLagged: (() => void) | null = null;
      let inputDisposable: { dispose: () => void } | null = null;
      let releaseCompositionGuards = () => {};
      let observer: ResizeObserver | null = null;
      let recoveryController: TerminalAttachRecoveryController | null = null;
      const retryUnavailableAfterReplayRef = { current: false };
      const reopenLiveStreamAfterRestart = () => {
        if (!isCurrent()) return;
        restartRecoveryPending = false;
        restartProbeGeneration += 1;
        lastServerOffset = 0;
        confirmedRestartPending = streamReplayGate.activeReplayWrites > 0;
        markTerminalStreamReadyAfterRestart(streamReplayGate);
        if (streamReplayGate.isLiveStreamReady) {
          syncEffectiveStdinSuppression(term);
          outputActivity.setStreamReady(true);
        }
      };

      const probeRestartReadiness = () => {
        if (!isCurrent() || !restartRecoveryPending) return;
        const probeGeneration = ++restartProbeGeneration;
        void transport
          .invoke<SessionInfo[]>("terminal:listDetailed")
          .then((sessions) => {
            if (
              !isCurrent() ||
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

      const writeLiveData = (data: string) => {
        term.write(data);
        if (data.length > 0) outputActivity.markOutput();
        suggestionsRef.current.handleOutput(data);
      };

      const processLiveChunk = (data: string, endOffset: number) => {
        const reconciled = reconcileTerminalOutput(
          data,
          endOffset,
          lastServerOffset,
        );
        if (reconciled.action === "discard") {
          return;
        }
        if (reconciled.action === "gap") {
          recordClientDiagnostic(
            "transport",
            "terminal-panel",
            "stream_gap_detected",
            {
              sessionId: safeSessionId,
              expectedOffset: reconciled.expectedOffset,
              receivedStartOffset: reconciled.receivedStartOffset,
            },
          );
          sendAttach(lastServerOffset);
          return;
        }
        lastServerOffset = reconciled.nextOffset;
        writeLiveData(reconciled.data);
      };

      // ── Register all listeners immediately to avoid race conditions ──────────
      // 1. Stream PTY output → xterm + invalidate the suggestion controller.
      // Output alone never establishes a shell prompt or command boundary.
      unsubData = transport.onTerminalData(
        safeSessionId,
        (data, offset, incarnation) => {
          if (!isCurrent()) return;
          const globalIncarnation = latestTerminalSessionIncarnation(
            terminalRegistrationKey,
          );
          if (
            globalIncarnation !== undefined &&
            incarnation < globalIncarnation
          ) {
            return;
          }
          if (
            acceptedStreamIncarnation === null ||
            incarnation > acceptedStreamIncarnation
          ) {
            acceptedStreamIncarnation = incarnation;
            rememberTerminalSessionIncarnation(
              terminalRegistrationKey,
              incarnation,
            );
            restartRecoveryPending = false;
            restartProbeGeneration += 1;
            lastServerOffset = 0;
            sendAttach(undefined);
            return;
          }
          if (
            streamReplayGate.hasAttachBufferBeenReceived &&
            streamReplayGate.isLiveStreamReady
          ) {
            processLiveChunk(data, offset);
          } else if (
            streamReplayGate.hasAttachBufferBeenReceived ||
            streamReplayGate.activeReplayWrites > 0 ||
            attachStateRef.current === "attaching"
          ) {
            streamReplayGate.queuedLiveData.push({ data, offset, incarnation });
          } else if (!recordedSuppressedOutput) {
            recordedSuppressedOutput = true;
            recordClientDiagnostic(
              "transport",
              "terminal-panel",
              "stream_suppressed_before_buffer",
              {
                sessionId: safeSessionId,
                bytes: utf8ByteLength(data),
                offset,
                incarnation,
                attachState: attachStateRef.current,
              },
            );
          }
        },
      );

      // 1a. Only the server's nonce-validated lifecycle may establish an
      // editable command boundary. PTY output and outgoing input stay passive.
      unsubLifecycle =
        transport.onTerminalLifecycle?.(safeSessionId, (event) => {
          if (!isCurrent()) return;
          suggestionsRef.current.handleLifecycle(event);
        }) ?? null;

      const applyBuffer = (replay: TerminalBufferReplay) => {
        recoveryController?.onBuffer();
        suggestionsRef.current.handleReplay();
        term.options.disableStdin = true;
        streamReplayGate.hasAttachBufferBeenReceived = true;
        streamReplayGate.isLiveStreamReady = false;
        outputActivity.setStreamReady(false);
        const currentReplayGeneration = ++streamReplayGate.replayGeneration;
        lastServerOffset = replay.offset;
        applyTerminalBufferReplay(
          term,
          replay,
          () => {
            if (!isCurrent()) return;
            if (currentReplayGeneration !== streamReplayGate.replayGeneration) {
              return;
            }

            streamReplayGate.isLiveStreamReady = true;
            syncEffectiveStdinSuppression(term);
            outputActivity.setStreamReady(true);
            const queuedLiveDataSnapshot =
              streamReplayGate.queuedLiveData.splice(0);
            for (const queued of queuedLiveDataSnapshot) {
              if (!streamReplayGate.isLiveStreamReady) break;
              processLiveChunk(queued.data, queued.offset);
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
          },
          streamReplayGate,
        );
        recordClientDiagnostic("transport", "terminal-panel", "buffer_replay", {
          sessionId: safeSessionId,
          offset: replay.offset,
          reset: replay.reset,
          truncated: replay.truncated,
          hadSuppressedOutput: recordedSuppressedOutput,
        });
        setAttachState("attached");
      };

      // 2. Handle PTY buffer (response to terminal:attach)
      if (transport.onTerminalBuffer) {
        unsubBuffer = transport.onTerminalBuffer(safeSessionId, (replay) => {
          if (!isCurrent()) return;
          const globalIncarnation = latestTerminalSessionIncarnation(
            terminalRegistrationKey,
          );
          if (
            globalIncarnation !== undefined &&
            replay.incarnation < globalIncarnation
          ) {
            return;
          }

          const isNewerIncarnation =
            acceptedStreamIncarnation === null ||
            replay.incarnation > acceptedStreamIncarnation;

          if (isNewerIncarnation) {
            acceptedStreamIncarnation = replay.incarnation;
            rememberTerminalSessionIncarnation(
              terminalRegistrationKey,
              replay.incarnation,
            );
            // Supersede the old parser completion before accepting this namespace.
            resetActivityForUnavailableStream();
            restartRecoveryPending = false;
            lastServerOffset = 0;
            attachSentGeneration = streamReplayGate.replayGeneration;
            if (streamReplayGate.activeReplayWrites > 0) {
              pendingReplayBuffer = replay;
              return;
            }
            applyBuffer(replay);
            return;
          }

          // Same incarnation buffer:
          if (restartRecoveryPending || streamReplayGate.isLiveStreamReady)
            return;
          if (streamReplayGate.activeReplayWrites > 0) {
            // Defer only if received after a NEW attach/generation/bind
            if (attachSentGeneration === streamReplayGate.replayGeneration) {
              pendingReplayBuffer = replay;
            }
            return;
          }
          applyBuffer(replay);
        });
      }

      const handleReplayDrain = () => {
        if (!isCurrent()) return;
        syncEffectiveStdinSuppression(term);
        if (pendingReplayBuffer) {
          const nextReplay = pendingReplayBuffer;
          pendingReplayBuffer = null;
          applyBuffer(nextReplay);
          return;
        }
        if (confirmedRestartPending) {
          confirmedRestartPending = false;
          streamReplayGate.isLiveStreamReady = true;
          syncEffectiveStdinSuppression(term);
          outputActivity.setStreamReady(true);
          const queuedLiveDataSnapshot =
            streamReplayGate.queuedLiveData.splice(0);
          for (const queued of queuedLiveDataSnapshot) {
            if (!streamReplayGate.isLiveStreamReady) break;
            processLiveChunk(queued.data, queued.offset);
          }
        }
      };
      streamReplayGate.onReplayDrain = handleReplayDrain;

      unsubExitEnhanced =
        transport.onTerminalExitEnhanced?.(safeSessionId, (exitEvent) => {
          if (!isCurrent()) return;
          const currentIncarnation = latestTerminalSessionIncarnation(
            terminalRegistrationKey,
          );
          if (
            exitEvent.incarnation === undefined
              ? currentIncarnation !== undefined
              : currentIncarnation !== undefined &&
                exitEvent.incarnation !== currentIncarnation
          ) {
            return;
          }

          if (exitEvent.incarnation !== undefined) {
            rememberTerminalSessionIncarnation(
              terminalRegistrationKey,
              exitEvent.incarnation,
            );
          }

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
          onExitRef.current?.(exitCode);
        }) ?? null;
      if (!unsubExitEnhanced) {
        unsubExit = transport.onTerminalExit(safeSessionId, () => {
          if (!isCurrent()) return;
          resetActivityForUnavailableStream();
        });
      }

      // 4. Handle process restart event. Respawns reuse the session ID and do not
      // replay the retained buffer, so the confirmed replacement can reopen the
      // live gate without counting the synthetic restart banner as output.
      unsubRestart =
        transport.onProcessRestarted?.(safeSessionId, (restartEvent) => {
          if (!isCurrent() || !restartRecoveryPending) return;
          reopenLiveStreamAfterRestart();
          suggestionsRef.current.handleReplay();
          const { restartCount } = restartEvent;
          term.write(
            `\x1b[33m[Process restarted (#${restartCount})]\x1b[0m\r\n`,
          );
        }) ?? null;

      // Older servers emit terminal:changed after a respawn without the dedicated
      // process:restarted event. Probe liveness only while this panel expects one.
      unsubTerminalChanged = transport.onEvent("terminal:changed", () => {
        probeRestartReadiness();
      });

      unsubLagged =
        transport.onEvent?.("terminal:lagged", (payload) => {
          if (!isCurrent()) return;
          recordClientDiagnostic(
            "transport",
            "terminal-panel",
            "broadcast_lagged",
            {
              sessionId: safeSessionId,
              payload,
              lastServerOffset,
            },
          );
          sendAttach(lastServerOffset);
        }) ?? null;

      // 5. Forward user input → PTY stdin, with suggestion interception
      inputDisposable = term.onData((data) => {
        if (!isCurrent()) return;
        if (!shouldForwardTerminalData(streamReplayGate)) return;
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

      // 6. PTY resize: fired by fitAddon.fit()
      const resizeDisposable = term.onResize(({ cols: c, rows: r }) => {
        if (!isCurrent()) return;
        if (!isTerminalFitEligible(terminalEntry)) return;
        transport.terminalResize(safeSessionId, c, r);
      });

      // 7. One composed keyboard handler: an acceptance only wins after the
      // controller invalidates its current ghost and yields a suffix.
      const baseKeyEventHandler = (e: KeyboardEvent) => {
        const cognitoActive = useCognitoModeStore.getState().active;
        const cognitoShortcut =
          useCognitoModeStore.getState().activationShortcut ??
          useSettingsStore.getState().cognitoModeShortcut;
        if (
          shouldConsumeCognitoModeTerminalKey(
            e,
            cognitoShortcut,
            cognitoActive,
          )
        ) {
          return false;
        }

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
              if (suffix && isCurrent())
                transport.terminalWrite(safeSessionId, suffix);
              return suffix;
            },
            openHistory: () => suggestionsRef.current.openExplicitList(),
          })
        ) {
          return false;
        }
        const isCopyShortcut =
          e.type === "keydown" &&
          (e.ctrlKey || e.metaKey) &&
          !e.shiftKey &&
          !e.altKey &&
          (e.code === "KeyC" || e.key === "c" || e.key === "C") &&
          term.hasSelection();
        if (isCopyShortcut) {
          const selection = term.getSelection();
          if (selection) void copyToClipboard(selection);
          return false;
        }
        const settings = useSettingsStore.getState();
        return handleSharedTerminalKeyEvent(e, {
          cognitoModeShortcut: cognitoShortcut,
          cognitoModeActive: cognitoActive,
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
            if (selection) void copyToClipboard(selection);
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
      scheduleTerminalFit(terminalEntry, {
        focus: !shouldSuppressTerminalFocus,
      });

      // Session creation belongs to the manager's explicit launch action.
      // Reattaching a kept-alive panel must never recreate a missing PTY.

      const sendAttach = (fromOffset?: number, retryAttempt = 0) => {
        if (!isCurrent()) return false;
        suggestionsRef.current.handleReplay();
        // Every attach starts a new replay ownership window. In particular, a
        // reconnect must close the prior live-ready gate before sending attach so
        // old-stream output cannot render ahead of the replacement replay.
        resetActivityForUnavailableStream();
        attachSentGeneration = streamReplayGate.replayGeneration;
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
        create: () =>
          Promise.reject(new Error("Terminal session is unavailable")),
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

      // Start initialization flow without ambient workspace.status()
      transport
        .invoke<SessionInfo[]>("terminal:listDetailed")
        .then((sessions) => {
          if (!isCurrent()) return;
          const existingSession = sessions.find((s) => s.id === safeSessionId);
          retryUnavailableAfterReplayRef.current =
            existingSession?.targetUnavailable === true;
          if (existingSession) {
            recoveryController?.start();
          } else {
            setAttachState("idle");
          }
        })
        .then(() => {
          if (!isCurrent()) return;
          // Hidden terminals still fit when their presentation host changes.
          observer = new ResizeObserver(() => {
            if (isCurrent()) scheduleTerminalFit(terminalEntry);
          });
          observer.observe(container);
        })
        .catch((err: unknown) => {
          if (!isCurrent()) return;
          term.write(
            `\r\n\x1b[31mFailed to start: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`,
          );
        });

      return () => {
        disposed = true;
        suggestionsRef.current.handleReplay();
        if (boundTransportRef.current === binding) {
          boundTransportRef.current = null;
        }
        term.options.disableStdin = true;
        setAttachState("idle");
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
        unsubLagged?.();
        outputActivity.dispose();
        recoveryController?.dispose();
        inputDisposable?.dispose();
        resizeDisposable.dispose();
        releaseCompositionGuards();
        if (streamReplayGate.onReplayDrain === handleReplayDrain) {
          streamReplayGate.onReplayDrain = undefined;
        }
        pendingReplayBuffer = null;
        confirmedRestartPending = false;
        observer?.disconnect();
      };
    };

    let releaseConnection = () => {};
    let boundOwner: string | null = undefined as unknown as null;
    const syncConnection = () => {
      let nextOwner: string | null = null;
      if (ownerProfileId && getConnectionSnapshot(ownerProfileId)) {
        const snapshot = getConnectionSnapshot(ownerProfileId)!;
        nextOwner =
          snapshot.status === "connected"
            ? JSON.stringify(snapshot.owner)
            : null;
      } else {
        nextOwner = `ambient:${transportGeneration}`;
      }
      if (nextOwner === boundOwner) return;
      releaseConnection();
      boundOwner = nextOwner;
      releaseConnection = bindConnection();
    };
    term.options.disableStdin = true;
    const unsubscribeConnection = subscribeConnections(syncConnection);
    syncConnectionRef.current = syncConnection;
    syncConnection();

    return () => {
      unsubscribeConnection();
      releaseConnection();
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
      if (getTerminal(terminalRegistrationKey) === terminalEntry) {
        removeTerminal(terminalRegistrationKey);
      }
      termRef.current = null;
      openedRef.current = false;
      rendererControllerRef.current?.dispose();
      rendererControllerRef.current = null;
      term.dispose();
      terminalBoundary.removeEventListener("contextmenu", handleContextMenu);
      terminalBoundary.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ownerProfileId,
    terminalRegistrationKey,
    ownerProfileId ? null : transportGeneration,
  ]);

  useClientLayoutEffect(() => {
    const term = termRef.current;
    const entry = getTerminal(terminalRegistrationKey);
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

  useClientLayoutEffect(() => {
    if (!termElement) return;
    const entry = getTerminal(terminalRegistrationKey);
    if (!entry) return;
    if (!isTerminalFitEligible(entry)) {
      if (desiredRenderer === "dom") {
        rendererControllerRef.current?.commitRenderer("dom");
      }
      return;
    }
    scheduleTerminalFit(entry, { focus: false, refresh: true });
  }, [desiredRenderer, termElement, terminalRegistrationKey]);
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
    syncEffectiveStdinSuppression(termRef.current);
    if (!shouldSuppressTerminalFocus) return;
    const entry = getTerminal(terminalRegistrationKey);
    if (entry) {
      cancelScheduledTerminalFit(entry);
      scheduleTerminalFit(entry, { focus: false });
    }
  }, [
    safeSessionId,
    shouldSuppressNativeKeyboard,
    shouldSuppressTerminalFocus,
    termElement,
    syncEffectiveStdinSuppression,
    terminalRegistrationKey,
  ]);

  useEffect(() => {
    if (suggestions.snapshot.state === "ghost") {
      cursorGeometryAdapterRef.current?.invalidate();
      return;
    }
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
