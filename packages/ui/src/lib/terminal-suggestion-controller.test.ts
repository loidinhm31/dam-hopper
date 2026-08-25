import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHistory,
  setHistoryEnabled,
  type HistorySearchResult,
} from "./command-history.js";
import { createTerminalSuggestionController } from "./terminal-suggestion-controller.js";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

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
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorage());
    setHistoryEnabled(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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

  it("ignores exact terminal echo but fails closed for unrelated output", async () => {
    vi.useFakeTimers();
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: () => [result("git status")],
      debounceMs: 1,
    });
    editing(controller);
    controller.handleInput("g");
    controller.handleOutput("g");
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.snapshot.state).toBe("ghost");

    editing(controller);
    controller.handleInput("g");
    controller.handleOutput("x");
    expect(controller.snapshot.state).toBe("opaque");
    expect(controller.snapshot.suggestion).toBeUndefined();
  });

  it("keeps a verified prompt through bounded split prompt paint", async () => {
    vi.useFakeTimers();
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: () => [result("echo live")],
      debounceMs: 1,
    });
    editing(controller);
    controller.handleOutput("\u001b]0;terminal\u0007");
    controller.handleOutput("\u001b]3008;start=prompt\u0007");
    controller.handleOutput("\u001b[?2004h");
    controller.handleOutput("\u001b[32muser$ \u001b[0m");
    controller.handleInput("e");
    controller.handleOutput("e");
    await vi.advanceTimersByTimeAsync(1);

    expect(controller.snapshot).toMatchObject({
      state: "ghost",
      rawInput: "e",
      suggestion: { entry: { command: "echo live" } },
    });
  });

  it("keeps the exact mixed-style Bash prompt and readline repaint verified", async () => {
    vi.useFakeTimers();
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: () => [result("echo live")],
      debounceMs: 1,
    });
    const prompt =
      "\u001b[0m\u001b[32mloidinh@localhost\u001b[0m:" +
      "\u001b[32m/mnt/data/ws/sharing/clickstream\u001b[0m$ ";

    editing(controller);
    controller.handleOutput(
      "\u001b]0;loidinh@localhost:/mnt/data/ws/sharing/clickstream\u0007",
    );
    controller.handleOutput(
      "\u001b]3008;start=prompt;type=shell;cwd=/mnt/data/ws/sharing/clickstream\u001b\\",
    );
    controller.handleOutput("\u001b[?2004h");
    controller.handleOutput(prompt);
    controller.handleOutput(`\r\u001b[K\r${prompt}`);
    controller.handleInput("e");
    controller.handleOutput("e");
    await vi.advanceTimersByTimeAsync(1);

    expect(controller.snapshot).toMatchObject({
      state: "ghost",
      rawInput: "e",
      suggestion: { entry: { command: "echo live" } },
    });
  });

  it("rejects newline output even when it contains prompt control sequences", () => {
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: () => [result("echo live")],
    });
    editing(controller);

    controller.handleOutput("background output\r\n\u001b[32muser$ \u001b[0m");

    expect(controller.snapshot.state).toBe("opaque");
  });

  it("fails closed for colored background output after prompt paint", () => {
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: () => [result("echo live")],
    });
    editing(controller);
    controller.handleOutput("\u001b[32muser$ \u001b[0m");

    controller.handleOutput("\u001b[33mbackground job output\u001b[0m");

    expect(controller.snapshot.state).toBe("opaque");
  });

  it("fails closed for unrelated output before input", () => {
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: () => [result("echo live")],
    });
    editing(controller);

    controller.handleOutput("background job output\n");

    expect(controller.snapshot.state).toBe("opaque");
  });

  it("fails closed for a single-line background message during prompt paint", () => {
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: () => [result("echo live")],
    });
    editing(controller);

    controller.handleOutput("background job output");

    expect(controller.snapshot.state).toBe("opaque");
  });

  it("fails closed for replay, paste, and cursor movement", async () => {
    vi.useFakeTimers();
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: () => [result("git status")],
      debounceMs: 1,
    });
    editing(controller);
    controller.handleInput("g");
    controller.handleOutput("g");
    await vi.advanceTimersByTimeAsync(1);
    controller.handleOutput("unexpected output");
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

  it("re-queries after Bash Backspace and its exact terminal echo", async () => {
    vi.useFakeTimers();
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: (query) =>
        query === "cho" ? [result("chown")] : [result("chmod")],
      debounceMs: 1,
    });
    editing(controller);
    controller.handleInput("c");
    controller.handleOutput("c");
    controller.handleInput("h");
    controller.handleOutput("h");
    controller.handleInput("o");
    controller.handleOutput("o");
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.snapshot.suggestion?.entry.command).toBe("chown");

    controller.handleInput("");
    expect(controller.snapshot.state).toBe("opaque");

    editing(controller);
    controller.handleInput("c");
    controller.handleOutput("c");
    controller.handleInput("h");
    controller.handleOutput("h");
    controller.handleInput("o");
    controller.handleOutput("o");
    await vi.advanceTimersByTimeAsync(1);
    controller.prepareBackspace();
    controller.handleInput("");
    controller.handleOutput("\b\u001b[K");
    await vi.advanceTimersByTimeAsync(1);

    expect(controller.snapshot).toMatchObject({
      state: "ghost",
      rawInput: "ch",
      suggestion: { entry: { command: "chmod" } },
    });
  });

  it("restores a lifecycle received while suggestions are temporarily disabled", () => {
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: () => [],
      enabled: false,
    });
    editing(controller);
    expect(controller.snapshot.state).toBe("disabled");

    controller.setEnabled(true);

    expect(controller.snapshot.state).toBe("ready-clean");
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
    expect(getHistory()).toEqual([]);
    controller.handleLifecycle({
      id: "one",
      lifecycle: "submitted",
      generation: 1,
      command: "git status",
    });
    expect(controller.snapshot.state).toBe("unverified");
    expect(getHistory()).toEqual([
      expect.objectContaining({ command: "git status" }),
    ]);
  });

  it("stops history persistence immediately when the suggestion kill switch turns off", () => {
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: () => [],
    });
    editing(controller);
    controller.setEnabled(false);
    controller.handleLifecycle({
      id: "one",
      lifecycle: "submitted",
      generation: 1,
      command: "sudo secret-command",
    });

    expect(controller.snapshot.state).toBe("disabled");
    expect(getHistory()).toEqual([]);
  });

  it("does not retroactively persist a submission after re-enabling suggestions", () => {
    const controller = createTerminalSuggestionController({
      sessionId: "one",
      project: "web",
      search: () => [],
    });
    controller.setEnabled(false);
    controller.handleLifecycle({
      id: "one",
      lifecycle: "submitted",
      generation: 1,
      command: "sudo secret-command",
    });
    controller.setEnabled(true);

    expect(getHistory()).toEqual([]);
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
