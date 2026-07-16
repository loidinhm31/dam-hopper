import type { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import type { TerminalLifecycleEvent } from "@/api/client.js";
import {
  createTerminalSuggestionController,
  type TerminalSuggestionController,
  type TerminalSuggestionSnapshot,
} from "@/lib/terminal-suggestion-controller.js";
import type { TerminalSuggestionAcceptKind } from "@/lib/terminal-suggestion-acceptance.js";
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

export interface UseTerminalSuggestionsResult {
  /** Immutable controller state for the Phase 04 presentation adapter. */
  snapshot: TerminalSuggestionSnapshot;
  handleInput: (data: string) => HandleInputResult;
  handleLifecycle: (event: TerminalLifecycleEvent) => void;
  handleOutput: (data: string) => void;
  handleReplay: () => void;
  handleComposition: () => void;
  accept: (kind: TerminalSuggestionAcceptKind) => string | null;
  openExplicitList: () => boolean;
  closeExplicitList: () => void;
}

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
 * It keeps native terminal input passive while exposing controller actions for
 * the Phase 04 presentation adapter. Only TerminalPanel may consume a
 * configured accept key after the controller atomically yields a safe suffix.
 */
export function useTerminalSuggestions(
  _termRef: RefObject<Terminal | null>,
  sessionId: string,
  project: string,
  automaticEnabled = true,
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
    controller.setEnabled(terminalSuggestionsEnabled && automaticEnabled);
  }, [automaticEnabled, controller, terminalSuggestionsEnabled]);

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
    (data: string): void => controller.handleOutput(data),
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
  const accept = useCallback(
    (kind: TerminalSuggestionAcceptKind): string | null => controller.accept(kind),
    [controller],
  );
  const openExplicitList = useCallback(
    (): boolean => controller.openExplicitList(),
    [controller],
  );
  const closeExplicitList = useCallback(
    (): void => controller.closeExplicitList(),
    [controller],
  );

  return {
    snapshot,
    handleInput,
    handleLifecycle,
    handleOutput,
    handleReplay,
    handleComposition,
    accept,
    openExplicitList,
    closeExplicitList,
  };
}
