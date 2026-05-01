import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PromptDetector } from "./prompt-detector.js";
import type { PromptState } from "./prompt-detector.js";

describe("PromptDetector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in RUNNING state", () => {
    const d = new PromptDetector();
    expect(d.state).toBe("RUNNING");
    d.dispose();
  });

  it("transitions RUNNING → PROMPT_READY after idle threshold", () => {
    const d = new PromptDetector({ idleThresholdMs: 100 });
    const states: PromptState[] = [];
    d.onStateChange = (s) => states.push(s);

    d.notifyOutput(); // start idle timer
    expect(d.state).toBe("RUNNING");

    vi.advanceTimersByTime(100);
    expect(d.state).toBe("PROMPT_READY");
    expect(states).toContain("PROMPT_READY");

    d.dispose();
  });

  it("transitions PROMPT_READY → INPUT_ACTIVE on first input", () => {
    const d = new PromptDetector({ idleThresholdMs: 100 });
    const states: PromptState[] = [];
    d.onStateChange = (s) => states.push(s);

    d.notifyOutput();
    vi.advanceTimersByTime(100);
    expect(d.state).toBe("PROMPT_READY");

    d.notifyInput("l");
    expect(d.state).toBe("INPUT_ACTIVE");
    expect(states).toContain("INPUT_ACTIVE");

    d.dispose();
  });

  it("stays INPUT_ACTIVE while user keeps typing", () => {
    const d = new PromptDetector({ idleThresholdMs: 100 });
    d.notifyOutput();
    vi.advanceTimersByTime(100);
    d.notifyInput("l");
    d.notifyInput("s");
    d.notifyInput(" ");
    expect(d.state).toBe("INPUT_ACTIVE");
    d.dispose();
  });

  it("INPUT_ACTIVE → RUNNING on Enter, then → PROMPT_READY after idle", () => {
    const d = new PromptDetector({ idleThresholdMs: 100 });
    d.notifyOutput();
    vi.advanceTimersByTime(100);
    d.notifyInput("l");
    expect(d.state).toBe("INPUT_ACTIVE");

    d.notifyInput("\r"); // Enter
    expect(d.state).toBe("RUNNING");

    vi.advanceTimersByTime(100);
    expect(d.state).toBe("PROMPT_READY");

    d.dispose();
  });

  it("notifyOutput is ignored while INPUT_ACTIVE (echo does not reset state)", () => {
    const d = new PromptDetector({ idleThresholdMs: 100 });
    d.notifyOutput();
    vi.advanceTimersByTime(100);
    d.notifyInput("l");
    expect(d.state).toBe("INPUT_ACTIVE");

    // PTY echoes the character — must not reset state
    d.notifyOutput();
    expect(d.state).toBe("INPUT_ACTIVE");

    d.dispose();
  });

  it("PTY output resets to RUNNING after Enter transitions out of INPUT_ACTIVE", () => {
    const d = new PromptDetector({ idleThresholdMs: 100 });
    d.notifyOutput();
    vi.advanceTimersByTime(100);
    d.notifyInput("l");
    expect(d.state).toBe("INPUT_ACTIVE");

    d.notifyInput("\r"); // Enter — user submitted command
    expect(d.state).toBe("RUNNING");

    // Command output arrives
    d.notifyOutput();
    expect(d.state).toBe("RUNNING");

    // After idle, back to PROMPT_READY
    vi.advanceTimersByTime(100);
    expect(d.state).toBe("PROMPT_READY");

    d.dispose();
  });

  it("multiple notifyOutput calls reset idle timer (debounce behaviour)", () => {
    const d = new PromptDetector({ idleThresholdMs: 100 });
    d.notifyOutput();
    vi.advanceTimersByTime(80);
    d.notifyOutput(); // reset timer
    vi.advanceTimersByTime(80); // total 160ms but only 80ms since last output
    expect(d.state).toBe("RUNNING"); // not yet PROMPT_READY

    vi.advanceTimersByTime(20); // now 100ms since last output
    expect(d.state).toBe("PROMPT_READY");

    d.dispose();
  });

  it("Ctrl+C from INPUT_ACTIVE transitions to RUNNING", () => {
    const d = new PromptDetector({ idleThresholdMs: 100 });
    d.notifyOutput();
    vi.advanceTimersByTime(100);
    d.notifyInput("x");
    expect(d.state).toBe("INPUT_ACTIVE");

    d.notifyInput("\x03"); // Ctrl+C
    expect(d.state).toBe("RUNNING");

    d.dispose();
  });

  it("dispose clears pending timers without errors", () => {
    const d = new PromptDetector({ idleThresholdMs: 100 });
    d.notifyOutput(); // starts timer
    d.dispose(); // should cancel timer

    vi.advanceTimersByTime(200);
    // State should remain RUNNING (timer was cancelled)
    expect(d.state).toBe("RUNNING");
  });
});
