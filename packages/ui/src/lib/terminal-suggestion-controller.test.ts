import { afterEach, describe, expect, it, vi } from "vitest";
import type { HistorySearchResult } from "./command-history.js";
import { createTerminalSuggestionController } from "./terminal-suggestion-controller.js";

const result = (command: string): HistorySearchResult => ({
  entry: {
    id: command,
    command,
    searchText: command,
    lastUsedAt: 1,
    useCount: 1,
    projectUsage: {},
  },
  score: 1,
});

function editing(
  controller: ReturnType<typeof createTerminalSuggestionController>,
): void {
  controller.handleLifecycle({
    id: "one",
    lifecycle: "editing",
    generation: 1,
  });
}

describe("TerminalSuggestionController", () => {
  afterEach(() => vi.useRealTimers());

  it("only surfaces an exact raw prefix after debounce", async () => {
    vi.useFakeTimers();
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: () => [result("git status")],
      debounceMs: 10,
    });
    editing(controller);
    controller.handleInput("g");
    controller.handleInput("i");
    await vi.advanceTimersByTimeAsync(10);

    expect(controller.snapshot).toMatchObject({
      state: "ghost",
      rawInput: "gi",
      suggestion: { entry: { command: "git status" } },
    });
  });

  it("discards the stale gi result after git then Enter", async () => {
    vi.useFakeTimers();
    let resolve!: (value: HistorySearchResult[]) => void;
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      debounceMs: 10,
      search: () =>
        new Promise<HistorySearchResult[]>((done) => {
          resolve = done;
        }),
    });
    editing(controller);
    controller.handleInput("g");
    controller.handleInput("i");
    await vi.advanceTimersByTimeAsync(10);
    controller.handleInput("t");
    controller.handleInput("\r");
    resolve([result("git status")]);
    await Promise.resolve();

    expect(controller.snapshot.state).toBe("opaque");
    expect(controller.snapshot.suggestion).toBeUndefined();
  });

  it("fails closed for output, replay, paste, and cursor movement", async () => {
    vi.useFakeTimers();
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: () => [result("git status")],
      debounceMs: 1,
    });
    editing(controller);
    controller.handleInput("g");
    await vi.advanceTimersByTimeAsync(1);
    controller.handleOutput();
    expect(controller.snapshot.state).toBe("opaque");
    expect(controller.snapshot.suggestion).toBeUndefined();

    editing(controller);
    controller.handleInput("g");
    controller.handleReplay();
    expect(controller.snapshot.state).toBe("unverified");

    editing(controller);
    controller.handleInput("it");
    expect(controller.snapshot.state).toBe("opaque");

    editing(controller);
    controller.handleComposition();
    expect(controller.snapshot.state).toBe("opaque");
  });

  it("rejects stale lifecycle generations and records only verified submission", () => {
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: () => [],
    });
    editing(controller);
    controller.handleLifecycle({
      id: "one",
      lifecycle: "submitted",
      generation: 0,
      command: "should not record",
    });
    expect(controller.snapshot.state).toBe("ready-clean");
    controller.handleLifecycle({
      id: "one",
      lifecycle: "submitted",
      generation: 1,
      command: "git status",
    });
    expect(controller.snapshot.state).toBe("unverified");
  });

  it("consumes a suffix once before a caller can write it to the PTY", async () => {
    vi.useFakeTimers();
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: () => [result("git status")],
      debounceMs: 1,
    });
    editing(controller);
    controller.handleInput("g");
    controller.handleInput("i");
    await vi.advanceTimersByTimeAsync(1);

    expect(controller.accept("full")).toBe("t status");
    expect(controller.snapshot.state).toBe("opaque");
    expect(controller.accept("full")).toBeNull();
  });
});
