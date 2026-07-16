import type { TerminalLifecycleEvent } from "@/api/client.js";
import {
  recordCommand,
  type HistorySearchResult,
} from "@/lib/command-history.js";
import {
  classifyTerminalSuggestionInput,
  removeLastGrapheme,
} from "./terminal-suggestion-input.js";
import {
  getTerminalSuggestionSuffix,
  type TerminalSuggestionAcceptKind,
} from "./terminal-suggestion-acceptance.js";

export type TerminalSuggestionState =
  | "disabled"
  | "unverified"
  | "ready-clean"
  | "querying"
  | "ghost"
  | "opaque"
  | "explicit-list";

export interface TerminalSuggestionSnapshot {
  state: TerminalSuggestionState;
  sessionId: string;
  promptEpoch: number;
  revision: number;
  rawInput: string;
  suggestion?: HistorySearchResult;
}

interface ControllerOptions {
  sessionId: string;
  project: string;
  search: (
    query: string,
  ) => HistorySearchResult[] | Promise<HistorySearchResult[]>;
  debounceMs?: number;
  enabled?: boolean;
}

type Listener = () => void;
const EMPTY = (sessionId: string): TerminalSuggestionSnapshot => ({
  state: "unverified",
  sessionId,
  promptEpoch: 0,
  revision: 0,
  rawInput: "",
});

const MAX_PENDING_ECHO_LENGTH = 4096;
const MAX_PROMPT_PAINT_BYTES = 4096;
const BASH_BACKSPACE_ECHO = "\b\u001b[K";

/** Purely client-side, fail-closed suggestion controller. It never writes PTY bytes. */
export class TerminalSuggestionController {
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private token = 0;
  private generation: number | undefined;
  private pendingEcho = "";
  private promptPaintBytesRemaining = 0;
  private promptPaintSgrOpen = false;
  private promptPaintText = "";
  private promptPaintComplete = false;
  private pendingNativeBackspace = false;
  private deferredLifecycle: TerminalLifecycleEvent | undefined;
  private enabled: boolean;
  private current: TerminalSuggestionSnapshot;

  constructor(private readonly options: ControllerOptions) {
    this.enabled = options.enabled ?? true;
    this.current = {
      ...EMPTY(options.sessionId),
      state: this.enabled ? "unverified" : "disabled",
    };
  }

  get snapshot(): TerminalSuggestionSnapshot {
    return this.current;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.reset(enabled ? "unverified" : "disabled");
    if (enabled && this.deferredLifecycle) {
      const lifecycle = this.deferredLifecycle;
      this.deferredLifecycle = undefined;
      this.handleLifecycle(lifecycle);
    }
  }

  handleLifecycle(event: TerminalLifecycleEvent): void {
    if (event.id !== this.options.sessionId) return;
    if (this.generation !== undefined && event.generation < this.generation)
      return;
    this.generation = event.generation;
    if (!this.enabled) {
      this.deferredLifecycle =
        event.lifecycle === "editing" ? event : undefined;
      return;
    }
    this.deferredLifecycle = undefined;
    if (event.lifecycle === "submitted" && event.command !== undefined) {
      recordCommand(event.command, this.options.project);
    }
    if (event.lifecycle === "editing") {
      this.promptPaintBytesRemaining = MAX_PROMPT_PAINT_BYTES;
      this.promptPaintSgrOpen = false;
      this.promptPaintText = "";
      this.promptPaintComplete = false;
      this.current = {
        ...EMPTY(this.options.sessionId),
        state: "ready-clean",
        promptEpoch: this.current.promptEpoch + 1,
        revision: this.current.revision + 1,
      };
      this.invalidate(false);
      this.publish(this.current);
      return;
    }
    this.reset(event.lifecycle === "opaque" ? "opaque" : "unverified");
  }

  handleInput(data: string): void {
    if (
      this.current.state !== "ready-clean" &&
      this.current.state !== "querying" &&
      this.current.state !== "ghost"
    )
      return;
    if (data === "" && this.pendingNativeBackspace) {
      this.pendingNativeBackspace = false;
      this.handleBackspace();
      return;
    }
    this.pendingNativeBackspace = false;
    const input = classifyTerminalSuggestionInput(data);
    if (input.kind === "ambiguous") {
      this.reset("opaque");
      return;
    }
    if (input.kind === "backspace") {
      this.handleBackspace();
      return;
    }
    this.current = {
      ...this.current,
      state: "ready-clean",
      rawInput: this.current.rawInput + input.text,
      revision: this.current.revision + 1,
      suggestion: undefined,
    };
    this.pendingEcho += input.text;
    if (this.pendingEcho.length > MAX_PENDING_ECHO_LENGTH) {
      this.reset("opaque");
      return;
    }
    this.invalidate(false);
    this.query();
  }

  /** Arm the native-key path used by xterm when Backspace produces no data. */
  prepareBackspace(): void {
    this.pendingNativeBackspace =
      this.current.state === "ready-clean" ||
      this.current.state === "querying" ||
      this.current.state === "ghost";
  }

  /**
   * Accept bounded prompt paint before input; after input, accept only the
   * exact bounded echo of printable input sent by this client.
   */
  handleOutput(data: string): void {
    if (this.current.state === "disabled") return;
    if (
      this.current.state === "ready-clean" &&
      !this.current.rawInput &&
      this.promptPaintBytesRemaining > 0 &&
      this.isPromptPaint(data) &&
      data.length <= this.promptPaintBytesRemaining
    ) {
      this.promptPaintBytesRemaining -= data.length;
      return;
    }
    if (
      !this.pendingEcho ||
      !data ||
      data.length > this.pendingEcho.length ||
      !this.pendingEcho.startsWith(data)
    ) {
      this.reset("opaque");
      return;
    }
    this.pendingEcho = this.pendingEcho.slice(data.length);
  }

  /** Reconnect and replay invalidate shell-line ownership before bytes arrive. */
  handleReplay(): void {
    this.deferredLifecycle = undefined;
    if (this.current.state !== "disabled") this.reset("unverified");
  }

  handleComposition(): void {
    if (this.current.state !== "disabled") this.reset("opaque");
  }

  openExplicitList(): boolean {
    if (!this.enabled) return false;
    this.publish({
      ...this.current,
      state: "explicit-list",
      suggestion: undefined,
    });
    return true;
  }

  closeExplicitList(): void {
    if (this.current.state === "explicit-list") this.reset("unverified");
  }

  /**
   * Atomically consumes the current ghost before the caller writes its suffix.
   * This prevents key-repeat or a later event from accepting it twice.
   */
  accept(kind: TerminalSuggestionAcceptKind): string | null {
    const suffix = getTerminalSuggestionSuffix(this.current, kind);
    if (!suffix) return null;
    this.reset("opaque");
    return suffix;
  }

  dispose(): void {
    this.invalidate(false);
    this.listeners.clear();
  }

  private query(): void {
    const { rawInput, promptEpoch, revision } = this.current;
    if (!rawInput) return;
    const token = ++this.token;
    this.publish({ ...this.current, state: "querying" });
    this.timer = setTimeout(() => {
      void Promise.resolve(this.options.search(rawInput))
        .then((results) => {
          if (
            token !== this.token ||
            !this.matches(promptEpoch, revision, rawInput)
          )
            return;
          const suggestion = results.find(
            (result) =>
              result.entry.command.startsWith(rawInput) &&
              result.entry.command.length > rawInput.length,
          );
          this.publish({
            ...this.current,
            state: suggestion ? "ghost" : "ready-clean",
            suggestion,
          });
        })
        .catch(() => {
          if (
            token === this.token &&
            this.matches(promptEpoch, revision, rawInput)
          )
            this.publish({
              ...this.current,
              state: "ready-clean",
              suggestion: undefined,
            });
        });
    }, this.options.debounceMs ?? 150);
  }

  private matches(
    promptEpoch: number,
    revision: number,
    rawInput: string,
  ): boolean {
    return (
      this.current.promptEpoch === promptEpoch &&
      this.current.revision === revision &&
      this.current.rawInput === rawInput
    );
  }

  private reset(state: TerminalSuggestionState): void {
    this.pendingEcho = "";
    this.promptPaintBytesRemaining = 0;
    this.promptPaintSgrOpen = false;
    this.promptPaintText = "";
    this.promptPaintComplete = false;
    this.pendingNativeBackspace = false;
    this.current = {
      ...EMPTY(this.options.sessionId),
      state,
      promptEpoch: this.current.promptEpoch + 1,
      revision: this.current.revision + 1,
    };
    this.invalidate(true);
  }

  private handleBackspace(): void {
    const previousInput = this.current.rawInput;
    const rawInput = removeLastGrapheme(this.current.rawInput);
    this.current = {
      ...this.current,
      state: "ready-clean",
      rawInput,
      revision: this.current.revision + 1,
      suggestion: undefined,
    };
    if (rawInput !== previousInput) {
      this.pendingEcho += BASH_BACKSPACE_ECHO;
    }
    if (this.pendingEcho.length > MAX_PENDING_ECHO_LENGTH) {
      this.reset("opaque");
      return;
    }
    this.invalidate(false);
    if (rawInput) this.query();
    else this.publish(this.current);
  }

  private isPromptPaint(data: string): boolean {
    if (!data || data.includes("\n")) return false;
    const redrawPrefix = "\r\u001b[K\r";
    if (this.promptPaintComplete) {
      return (
        data.startsWith(redrawPrefix) &&
        data.slice(redrawPrefix.length) === this.promptPaintText
      );
    }
    const startedInSgr = this.promptPaintSgrOpen;
    let hasRecognizedControl = false;
    let hasPromptText = false;
    let hasSgrControl = false;
    let sgrOpen = this.promptPaintSgrOpen;
    let index = 0;
    while (index < data.length) {
      if (data[index] !== "\u001b") {
        const codePoint = data.charCodeAt(index);
        if (codePoint < 0x20) return false;
        hasPromptText = true;
        index += 1;
        continue;
      }
      if (data[index + 1] === "[") {
        let end = index + 2;
        while (end < data.length && !/[\u0040-\u007e]/.test(data[end]!)) {
          end += 1;
        }
        if (end >= data.length) return false;
        if (data[end] === "m") {
          const params = data.slice(index + 2, end);
          sgrOpen = params !== "" && params !== "0";
          hasSgrControl = true;
        }
        hasRecognizedControl = true;
        index = end + 1;
        continue;
      }
      if (data[index + 1] === "]") {
        const bell = data.indexOf("\u0007", index + 2);
        const st = data.indexOf("\u001b\\", index + 2);
        const end = bell >= 0 && (st < 0 || bell < st) ? bell + 1 : st + 2;
        if (end < 2) return false;
        hasRecognizedControl = true;
        index = end;
        continue;
      }
      return false;
    }
    this.promptPaintSgrOpen = sgrOpen;
    const accepted = hasRecognizedControl || startedInSgr;
    if (accepted && (hasPromptText || hasSgrControl || startedInSgr)) {
      this.promptPaintText += data;
      this.promptPaintComplete = hasPromptText && !sgrOpen;
    }
    return accepted;
  }

  private invalidate(publish: boolean): void {
    this.token += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (publish) this.publish(this.current);
  }

  private publish(snapshot: TerminalSuggestionSnapshot): void {
    this.current = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}

export function createTerminalSuggestionController(
  options: ControllerOptions,
): TerminalSuggestionController {
  return new TerminalSuggestionController(options);
}
