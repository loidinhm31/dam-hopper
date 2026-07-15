export type PromptState = "RUNNING" | "PROMPT_READY" | "INPUT_ACTIVE";

interface PromptDetectorOptions {
  idleThresholdMs?: number;
}

/**
 * Legacy compatibility shell activity observer.
 *
 * PTY silence cannot prove that a shell is accepting a command, so this class no
 * longer transitions into prompt or input states. Phase 02 replaces it with a
 * verified shell lifecycle capability.
 */
export class PromptDetector {
  onStateChange: ((state: PromptState) => void) | null = null;

  constructor(_options: PromptDetectorOptions = {}) {
    void _options;
  }

  notifyOutput(): void {}

  notifyInput(_data: string): void {
    void _data;
  }

  get state(): PromptState {
    return "RUNNING";
  }

  dispose(): void {}
}
