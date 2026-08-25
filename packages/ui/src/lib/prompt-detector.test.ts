import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptDetector } from "./prompt-detector.js";

describe("PromptDetector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in RUNNING state", () => {
    const detector = new PromptDetector();
    expect(detector.state).toBe("RUNNING");
    detector.dispose();
  });

  it("never authorizes a prompt from PTY silence", () => {
    const detector = new PromptDetector({ idleThresholdMs: 100 });
    detector.notifyOutput();

    vi.advanceTimersByTime(10_000);
    expect(detector.state).toBe("RUNNING");
    detector.dispose();
  });

  it("treats password, REPL, and TUI input as opaque", () => {
    const detector = new PromptDetector({ idleThresholdMs: 100 });
    detector.notifyOutput();
    vi.advanceTimersByTime(10_000);
    detector.notifyInput("super-secret\r");

    expect(detector.state).toBe("RUNNING");
    detector.dispose();
  });

  it("dispose leaves no pending timer that can authorize input", () => {
    const detector = new PromptDetector({ idleThresholdMs: 100 });
    detector.notifyOutput();
    detector.dispose();

    vi.advanceTimersByTime(10_000);
    expect(detector.state).toBe("RUNNING");
  });
});
