import { useState, useRef, useCallback, useEffect, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { TerminalInputBuffer } from "@/lib/terminal-input-buffer.js";
import { PromptDetector } from "@/lib/prompt-detector.js";
import { searchHistory } from "@/lib/command-history.js";
import type { HistorySearchResult } from "@/lib/command-history.js";
import type { OverlayPosition } from "@/components/atoms/TerminalSuggestionOverlay.js";
import { useSettingsStore } from "@/stores/settings.js";

export interface HandleInputResult {
  /** Whether to forward the original data to the PTY. */
  forward: boolean;
  /** If set, send this text to the PTY instead of forwarding. */
  inject?: string;
  /** If set, record this command in BM25 history. */
  record?: string;
}

export interface TerminalSuggestionsState {
  isVisible: boolean;
  suggestions: HistorySearchResult[];
  selectedIndex: number;
  position: OverlayPosition;
}

export interface UseTerminalSuggestionsResult {
  state: TerminalSuggestionsState;
  /** Call from term.onData — decides forwarding and handles overlay interactions. */
  handleInput: (data: string) => HandleInputResult;
  /** Call when PTY output data arrives (notifies PromptDetector, dismisses overlay). */
  notifyOutput: () => void;
  /** Accept a command (e.g. from mouse click). Returns the string to inject into PTY. */
  acceptSuggestion: (cmd: string) => string;
}

const DEBOUNCE_MS = 150;
const MIN_QUERY_LEN = 2;
const OVERLAY_ITEM_HEIGHT = 32;
const PROJECT_BOOST = 1.5;

function computePosition(term: Terminal): OverlayPosition {
  const el = term.element;
  if (!el) return { x: 0, y: 0, flipAbove: false };

  const cellWidth = el.clientWidth / term.cols;
  const cellHeight = el.clientHeight / term.rows;
  const cursorX = term.buffer.active.cursorX;
  const cursorY = term.buffer.active.cursorY;

  // Anchor x at the left edge of the terminal so the popup never covers typed text.
  const x = 4;
  const GAP = 4; // px gap between cursor row and popup edge
  const below = (cursorY + 1) * cellHeight + GAP;
  const overlayHeight = 5 * OVERLAY_ITEM_HEIGHT + 28; // 5 items + hint bar
  const flipAbove = below + overlayHeight > el.clientHeight;

  return { x, y: flipAbove ? cursorY * cellHeight - GAP : below, flipAbove };
}

function searchWithProjectBoost(query: string, project: string): HistorySearchResult[] {
  const results = searchHistory(query);
  if (!project) return results;
  return results
    .map((r) => ({ ...r, score: r.score * (r.entry.project === project ? PROJECT_BOOST : 1) }))
    .sort((a, b) => b.score - a.score);
}

export function useTerminalSuggestions(
  termRef: RefObject<Terminal | null>,
  sessionId: string,
  project: string,
): UseTerminalSuggestionsResult {
  const settings = useSettingsStore();

  // React state for re-renders (read-only outside callbacks)
  const [renderState, setRenderState] = useState<TerminalSuggestionsState>({
    isVisible: false,
    suggestions: [],
    selectedIndex: 0,
    position: { x: 0, y: 0, flipAbove: false },
  });

  // Mutable internal state — ONLY written inside callbacks, never during render
  const m = useRef({
    isVisible: false,
    selectedIndex: 0,
    suggestions: [] as HistorySearchResult[],
    lastTabTime: 0,
    lastTabIntercepted: false,
  });

  // Pure logic objects — stable across renders
  const bufferRef = useRef(new TerminalInputBuffer());
  const detectorRef = useRef(new PromptDetector({ idleThresholdMs: 100 }));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Project ref lets debounce callback always see the latest project name
  const projectRef = useRef(project);
  projectRef.current = project;

  const dismiss = useCallback(() => {
    m.current.isVisible = false;
    setRenderState((prev) => ({ ...prev, isVisible: false }));
  }, []);

  const show = useCallback((results: HistorySearchResult[], pos: OverlayPosition) => {
    if (!settings.terminalSuggestionsEnabled) return;
    m.current.isVisible = true;
    m.current.selectedIndex = 0;
    m.current.suggestions = results;
    setRenderState({ isVisible: true, suggestions: results, selectedIndex: 0, position: pos });
  }, [settings.terminalSuggestionsEnabled]);

  const handleInput = useCallback(
    (data: string): HandleInputResult => {
      const buffer = bufferRef.current;
      const detector = detectorRef.current;
      const now = Date.now();

      // Reset double-tab tracker for non-tab input
      if (data !== "\t") {
        m.current.lastTabTime = 0;
        m.current.lastTabIntercepted = false;
      }

      if (!settings.terminalSuggestionsEnabled) {
        if (data === "\r" || data === "\x03") {
          buffer.reset();
          detector.notifyInput(data);
        } else {
          buffer.append(data);
          detector.notifyInput(data);
        }
        return { forward: true };
      }

      // ── Suggestion overlay interception ────────────────────────────────
      if (m.current.isVisible) {
        if (data === "\t") {
          // Double-tab detection: if user taps Tab twice quickly while suggestions are visible,
          // dismiss the overlay and let the terminal handle it (usually for shell completion).
          if (now - m.current.lastTabTime < 500) {
            const wasIntercepted = m.current.lastTabIntercepted;
            dismiss();
            m.current.lastTabTime = 0;
            // If the previous tab was intercepted, we must send TWO tabs to ensure the shell
            // sees the double-tab intent. If the previous was already forwarded, just one.
            return { forward: false, inject: wasIntercepted ? "\t\t" : "\t" };
          }
          m.current.lastTabTime = now;
          m.current.lastTabIntercepted = true;

          const len = Math.max(m.current.suggestions.length, 1);
          const next = (m.current.selectedIndex + 1) % len;
          m.current.selectedIndex = next;
          setRenderState((prev) => ({ ...prev, selectedIndex: next }));
          return { forward: false };
        }
        if (data === "\x1b[Z") {
          // Shift+Tab
          const len = Math.max(m.current.suggestions.length, 1);
          const prev = (m.current.selectedIndex - 1 + len) % len;
          m.current.selectedIndex = prev;
          setRenderState((s) => ({ ...s, selectedIndex: prev }));
          return { forward: false };
        }
        if (data === "\r") {
          // Accept selected suggestion
          const sel = m.current.suggestions[m.current.selectedIndex];
          const cmd = sel?.entry.command ?? "";
          buffer.reset();
          if (cmd) buffer.append(cmd);
          m.current.isVisible = false;
          setRenderState((prev) => ({ ...prev, isVisible: false }));
          return { forward: false, inject: cmd ? "\x15" + cmd : "\x15" };
        }
        if (data === "\x1b") {
          m.current.isVisible = false;
          setRenderState((prev) => ({ ...prev, isVisible: false }));
          return { forward: true };
        }
      }

      // ── Normal input handling ───────────────────────────────────────────

      if (data === "\r" || data === "\x03") {
        const cmdToRecord = buffer.currentInput.trim();
        buffer.reset();
        detector.notifyInput(data);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        m.current.isVisible = false;
        setRenderState((prev) => ({ ...prev, isVisible: false }));
        return { forward: true, record: cmdToRecord || undefined };
      }

      buffer.append(data);
      detector.notifyInput(data);

      if (data === "\t") {
        m.current.lastTabTime = now;
        m.current.lastTabIntercepted = false;
      }

      if (!buffer.isClean || detector.state !== "INPUT_ACTIVE") {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        m.current.isVisible = false;
        setRenderState((prev) => ({ ...prev, isVisible: false }));
        return { forward: true };
      }

      if (buffer.length >= MIN_QUERY_LEN) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        const query = buffer.currentInput;
        const proj = projectRef.current;
        debounceRef.current = setTimeout(() => {
          const results = searchWithProjectBoost(query, proj);
          const term = termRef.current;
          if (results.length > 0 && term?.element) {
            show(results, computePosition(term));
          } else {
            dismiss();
          }
        }, DEBOUNCE_MS);
      } else {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        m.current.isVisible = false;
        setRenderState((prev) => ({ ...prev, isVisible: false }));
      }

      return { forward: true };
    },
    [termRef, show, dismiss, settings.terminalSuggestionsEnabled],
  );

  const notifyOutput = useCallback(() => {
    const wasActive = detectorRef.current.state === "INPUT_ACTIVE";
    detectorRef.current.notifyOutput();
    // While typing, PTY output is just echo — don't dismiss the overlay.
    if (wasActive) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    m.current.isVisible = false;
    setRenderState((prev) => ({ ...prev, isVisible: false }));
  }, []);

  const acceptSuggestion = useCallback((cmd: string): string => {
    bufferRef.current.reset();
    if (cmd) bufferRef.current.append(cmd);
    m.current.isVisible = false;
    setRenderState((prev) => ({ ...prev, isVisible: false }));
    return cmd ? "\x15" + cmd : "\x15";
  }, []);

  useEffect(() => {
    const detector = detectorRef.current;
    return () => {
      detector.dispose();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { state: renderState, handleInput, notifyOutput, acceptSuggestion };
}
