import type { Terminal } from "@xterm/xterm";
import type { RefObject } from "react";
import type { HistorySearchResult } from "@/lib/command-history.js";
import type { OverlayPosition } from "@/components/atoms/TerminalSuggestionOverlay.js";
import { useSettingsStore } from "@/stores/settings.js";
import { getTerminalSuggestionCapability } from "@/lib/terminal-suggestion-capability.js";

export interface HandleInputResult {
  /** Passive containment always forwards the original byte sequence to the PTY. */
  forward: true;
  data: string;
}

export interface TerminalSuggestionsState {
  isVisible: boolean;
  suggestions: HistorySearchResult[];
  selectedIndex: number;
  position: OverlayPosition;
}

export interface UseTerminalSuggestionsResult {
  state: TerminalSuggestionsState;
  handleInput: (data: string) => HandleInputResult;
  notifyOutput: () => void;
}

const UNAVAILABLE_STATE: TerminalSuggestionsState = {
  isVisible: false,
  suggestions: [],
  selectedIndex: 0,
  position: { x: 0, y: 0, flipAbove: false },
};

/** Preserves terminal input exactly while automatic suggestions are unavailable. */
export function handleTerminalSuggestionInput(data: string): HandleInputResult {
  return { forward: true, data };
}

function ignoreTerminalSuggestionOutput(): void {}

/**
 * Automatic terminal suggestions are deliberately unavailable until Phase 02
 * supplies a verified shell Editing lifecycle. Keeping this hook as the single
 * gate ensures every terminal byte remains passive during containment.
 */
export function useTerminalSuggestions(
  _termRef: RefObject<Terminal | null>,
  _sessionId: string,
  _project: string,
): UseTerminalSuggestionsResult {
  void _termRef;
  void _sessionId;
  void _project;
  const terminalSuggestionsEnabled = useSettingsStore(
    (state) => state.terminalSuggestionsEnabled,
  );

  const automaticSuggestionsAvailable =
    terminalSuggestionsEnabled &&
    getTerminalSuggestionCapability() === "editing";

  // Phase 03 owns the first non-passive branch. This gate prevents a stale
  // setting or any PTY output pattern from enabling suggestions beforehand.
  if (automaticSuggestionsAvailable) {
    return {
      state: UNAVAILABLE_STATE,
      handleInput: handleTerminalSuggestionInput,
      notifyOutput: ignoreTerminalSuggestionOutput,
    };
  }

  return {
    state: UNAVAILABLE_STATE,
    handleInput: handleTerminalSuggestionInput,
    notifyOutput: ignoreTerminalSuggestionOutput,
  };
}
