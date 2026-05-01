export type PromptState = "RUNNING" | "PROMPT_READY" | "INPUT_ACTIVE";

interface PromptDetectorOptions {
  /** Milliseconds of PTY silence before we declare "prompt ready". Default 100. */
  idleThresholdMs?: number;
}

/**
 * State machine that tracks whether the user is at a shell prompt.
 *
 * RUNNING → PROMPT_READY: no PTY output for idleThresholdMs after last output burst
 * PROMPT_READY → INPUT_ACTIVE: user starts typing (first notifyInput call)
 * INPUT_ACTIVE → RUNNING: user presses Enter / PTY output arrives
 * Any → RUNNING: PTY output burst
 */
export class PromptDetector {
  private _state: PromptState = "RUNNING";
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private readonly _idleMs: number;

  onStateChange: ((state: PromptState) => void) | null = null;

  constructor({ idleThresholdMs = 100 }: PromptDetectorOptions = {}) {
    this._idleMs = idleThresholdMs;
  }

  /** Call whenever PTY output data arrives. */
  notifyOutput(): void {
    // While the user is actively typing, PTY output is terminal echo —
    // ignore it so echo doesn't reset the state machine on every keystroke.
    if (this._state === "INPUT_ACTIVE") return;
    this._clearTimer();
    this._setState("RUNNING");
    this._timer = setTimeout(() => {
      this._timer = null;
      if (this._state === "RUNNING") this._setState("PROMPT_READY");
    }, this._idleMs);
  }

  /** Call whenever the user types (term.onData fires). */
  notifyInput(data: string): void {
    if (data === "\r" || data === "\x03") {
      // Enter or Ctrl+C — command is being sent, reset to RUNNING
      this._clearTimer();
      this._setState("RUNNING");
      // Shell will print a new prompt after a short delay
      this._timer = setTimeout(() => {
        this._timer = null;
        if (this._state === "RUNNING") this._setState("PROMPT_READY");
      }, this._idleMs);
      return;
    }

    if (this._state === "PROMPT_READY") {
      this._setState("INPUT_ACTIVE");
    }
    // Stay in INPUT_ACTIVE while user keeps typing
  }

  get state(): PromptState {
    return this._state;
  }

  dispose(): void {
    this._clearTimer();
  }

  private _setState(s: PromptState): void {
    if (this._state === s) return;
    this._state = s;
    this.onStateChange?.(s);
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
