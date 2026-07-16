import type { TerminalLifecycleEvent } from "@/api/client.js";
import {
  recordCommand,
  type HistorySearchResult,
} from "@/lib/command-history.js";
import { classifyTerminalSuggestionInput } from "./terminal-suggestion-input.js";
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

/** Purely client-side, fail-closed suggestion controller. It never writes PTY bytes. */
export class TerminalSuggestionController {
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private token = 0;
  private generation: number | undefined;
  private pendingEcho = "";
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
  }

  handleLifecycle(event: TerminalLifecycleEvent): void {
    if (event.id !== this.options.sessionId) return;
    if (this.generation !== undefined && event.generation < this.generation)
      return;
    this.generation = event.generation;
    if (!this.enabled) return;
    if (event.lifecycle === "submitted" && event.command !== undefined) {
      recordCommand(event.command, this.options.project);
    }
    if (event.lifecycle === "editing") {
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
    const input = classifyTerminalSuggestionInput(data);
    if (input.kind === "ambiguous") {
      this.reset("opaque");
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

  /** Ignore only the exact bounded echo of printable input sent by this client. */
  handleOutput(data: string): void {
    if (this.current.state === "disabled") return;
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
    this.current = {
      ...EMPTY(this.options.sessionId),
      state,
      promptEpoch: this.current.promptEpoch + 1,
      revision: this.current.revision + 1,
    };
    this.invalidate(true);
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
