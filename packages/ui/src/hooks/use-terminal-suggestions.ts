import type { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import type { TerminalLifecycleEvent } from "@/api/client.js";
import type { OverlayPosition } from "@/components/atoms/TerminalSuggestionOverlay.js";
import {
  createTerminalSuggestionController,
  type TerminalSuggestionController,
  type TerminalSuggestionSnapshot,
} from "@/lib/terminal-suggestion-controller.js";
import {
  searchHistory,
  type HistorySearchResult,
} from "@/lib/command-history.js";
import { useSettingsStore } from "@/stores/settings.js";

export interface HandleInputResult {
  /** The terminal adapter always forwards the original byte sequence to the PTY. */
  forward: true;
  data: string;
}

export interface TerminalSuggestionsState {
  /** Phase 04 owns automatic ghost rendering; Phase 03 is controller-only. */
  isVisible: boolean;
  suggestions: HistorySearchResult[];
  selectedIndex: number;
  position: OverlayPosition;
}

export interface UseTerminalSuggestionsResult {
  state: TerminalSuggestionsState;
  /** Immutable controller state for the Phase 04 presentation adapter. */
  snapshot: TerminalSuggestionSnapshot;
  handleInput: (data: string) => HandleInputResult;
  handleLifecycle: (event: TerminalLifecycleEvent) => void;
  handleOutput: () => void;
  handleReplay: () => void;
  handleComposition: () => void;
}

const PASSIVE_STATE: TerminalSuggestionsState = {
  isVisible: false,
  suggestions: [],
  selectedIndex: 0,
  position: { x: 0, y: 0, flipAbove: false },
};

/**
 * Preserves the browser/xterm byte sequence. Controller observation is kept
 * separate so Phase 03 cannot take ownership of native terminal keys.
 */
export function handleTerminalSuggestionInput(data: string): HandleInputResult {
  return { forward: true, data };
}

function searchSuggestionHistory(query: string): HistorySearchResult[] {
  return searchHistory(query, 5);
}

/**
 * Session-local React adapter for the non-React suggestion controller.
 *
 * It deliberately never renders or accepts a ghost: until Phase 04 has a
 * validated geometry adapter, all keyboard bytes continue through xterm to
 * the PTY unchanged. The controller still receives server-validated lifecycle
 * events so it can safely maintain exact local command history.
 */
export function useTerminalSuggestions(
  _termRef: RefObject<Terminal | null>,
  sessionId: string,
  project: string,
): UseTerminalSuggestionsResult {
  void _termRef;
  const terminalSuggestionsEnabled = useSettingsStore(
    (state) => state.terminalSuggestionsEnabled,
  );
  const [controller] = useState<TerminalSuggestionController>(() =>
    createTerminalSuggestionController({
      sessionId,
      project,
      search: searchSuggestionHistory,
      enabled: terminalSuggestionsEnabled,
    }),
  );

  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  );
  const getSnapshot = useCallback(() => controller.snapshot, [controller]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    controller.setEnabled(terminalSuggestionsEnabled);
  }, [controller, terminalSuggestionsEnabled]);

  useEffect(
    () => () => {
      controller.dispose();
    },
    [controller],
  );

  const handleInput = useCallback(
    (data: string): HandleInputResult => {
      controller.handleInput(data);
      return handleTerminalSuggestionInput(data);
    },
    [controller],
  );
  const handleLifecycle = useCallback(
    (event: TerminalLifecycleEvent): void => controller.handleLifecycle(event),
    [controller],
  );
  const handleOutput = useCallback(
    (): void => controller.handleOutput(),
    [controller],
  );
  const handleReplay = useCallback(
    (): void => controller.handleReplay(),
    [controller],
  );
  const handleComposition = useCallback(
    (): void => controller.handleComposition(),
    [controller],
  );

  return {
    state: PASSIVE_STATE,
    snapshot,
    handleInput,
    handleLifecycle,
    handleOutput,
    handleReplay,
    handleComposition,
  };
}
