// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionRef } from "@/api/ownership.js";
import { applyTerminalBufferReplay } from "@/lib/terminal-buffer-replay.js";
import { TerminalPanel } from "./TerminalPanel.js";

interface TestTerminal {
  options: { disableStdin: boolean };
  input: Set<(data: string) => void>;
  resize: Set<(size: { cols: number; rows: number }) => void>;
  output: string;
  disposed: boolean;
}

const state = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  snapshots: new Map<string, { owner: ConnectionRef; status: string }>(),
  transports: new Map<string, ReturnType<typeof makeTransport>>(),
  terminals: [] as TestTerminal[],
  registry: new Map<string, unknown>(),
}));
function makeTransport() {
  const data = new Set<
    (value: string, offset: number, incarnation?: number) => void
  >();
  const buffers = new Set<(value: unknown) => void>();
  const events = new Map<string, Set<(payload: unknown) => void>>();
  return {
    data,
    buffers,
    events,
    invoke: vi.fn(async (_channel: string) => [
      { id: "shared", project: "shared", alive: true },
    ]),
    terminalWrite: vi.fn(),
    terminalResize: vi.fn(),
    terminalAttach: vi.fn(() => true),
    onTerminalData: (
      _id: string,
      cb: (value: string, offset: number, incarnation?: number) => void,
    ) => {
      data.add(cb);
      return () => data.delete(cb);
    },
    onTerminalBuffer: (_id: string, cb: (value: unknown) => void) => {
      buffers.add(cb);
      return () => buffers.delete(cb);
    },
    onTerminalExit: () => () => {},
    onEvent: (channel: string, cb: (payload: unknown) => void) => {
      if (!events.has(channel)) events.set(channel, new Set());
      events.get(channel)!.add(cb);
      return () => events.get(channel)?.delete(cb);
    },
  };
}

vi.mock("@/api/connections.js", () => ({
  getConnectionSnapshot: (id: string) => state.snapshots.get(id) ?? null,
  getTransport: (owner: ConnectionRef) =>
    state.transports.get(`${owner.profileId}-${owner.generation}`),
  isCurrentConnection: (owner: ConnectionRef) => {
    const snapshot = state.snapshots.get(owner.profileId);
    return (
      snapshot?.status === "connected" &&
      snapshot.owner.generation === owner.generation
    );
  },
  subscribeConnections: (cb: () => void) => {
    state.listeners.add(cb);
    return () => state.listeners.delete(cb);
  },
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options = { disableStdin: false };
    unicode = { activeVersion: "" };
    element = document.createElement("div");
    textarea = document.createElement("textarea");
    input = new Set<(data: string) => void>();
    resize = new Set<(size: { cols: number; rows: number }) => void>();
    output = "";
    disposed = false;
    constructor() {
      state.terminals.push(this);
    }
    open(host: HTMLElement) {
      host.appendChild(this.element);
    }
    loadAddon() {}
    onData(cb: (data: string) => void) {
      this.input.add(cb);
      return { dispose: () => this.input.delete(cb) };
    }
    onResize(cb: (size: { cols: number; rows: number }) => void) {
      this.resize.add(cb);
      return { dispose: () => this.resize.delete(cb) };
    }
    onTitleChange() {
      return { dispose() {} };
    }
    attachCustomKeyEventHandler() {}
    write(data: string) {
      this.output += data;
    }
    reset() {
      this.output = "";
    }
    dispose() {
      this.disposed = true;
    }
    hasSelection() {
      return false;
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {} }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@/lib/terminal-registry.js", () => ({
  getTerminal: (key: string) => state.registry.get(key),
  registerTerminal: (
    key: string,
    terminal: unknown,
    fitAddon: unknown,
    findController: unknown,
    attachmentElement: HTMLElement,
  ) => {
    const entry = { terminal, fitAddon, findController, attachmentElement };
    state.registry.set(key, entry);
    return entry;
  },
  removeTerminal: (key: string) => state.registry.delete(key),
}));
vi.mock("@/lib/terminal-find-controller.js", () => ({
  TerminalFindController: class {
    getSnapshot() {
      return { isOpen: false };
    }
    subscribe() {
      return () => {};
    }
    dispose() {}
  },
}));
vi.mock("@/lib/terminal-cursor-geometry-adapter.js", () => ({
  geometryEquals: () => true,
  TerminalCursorGeometryAdapter: class {
    invalidate() {}
    hide() {}
    dispose() {}
  },
}));
vi.mock("@/lib/terminal-fit-scheduler.js", () => ({
  cancelScheduledTerminalFit() {},
  scheduleTerminalFit() {},
  isTerminalFitEligible: () => true,
}));
vi.mock("@/lib/terminal-renderer.js", () => ({
  createTerminalRendererController: vi.fn(() => ({
    currentRenderer: "dom",
    commitRenderer: vi.fn((desired: string) => desired),
    dispose: vi.fn(),
  })),
  activateTerminalWebglRenderer: vi.fn(() => ({ dispose() {} })),
}));
vi.mock("@/lib/terminal-native-input-policy.js", () => ({
  syncNativeKeyboardSuppression: (
    term?: { options: { disableStdin: boolean } } | null,
    suppress = false,
  ) => {
    if (term) term.options.disableStdin = suppress;
  },
}));
vi.mock("@/lib/terminal-touch-scroll.js", () => ({
  bindTerminalTouchScroll: () => () => {},
}));
vi.mock("@/lib/terminal-buffer-replay.js", () => ({
  applyTerminalBufferReplay: vi.fn(
    (
      term: { reset: () => void; write: (data: string) => void },
      replay: { data: string; reset: boolean },
      done?: () => void,
      _gate?: { activeReplayWrites: number; isReplayWriting: boolean },
    ) => {
      if (replay.reset) term.reset();
      term.write(replay.data);
      done?.();
      return 0;
    },
  ),
  utf8ByteLength: (value: string) => value.length,
}));
vi.mock("@/hooks/use-terminal-suggestions.js", () => ({
  useTerminalSuggestions: () => ({
    snapshot: { state: "unverified", rawInput: "" },
    handleInput: (data: string) => ({ forward: true, data }),
    handleOutput() {},
    handleReplay() {},
    closeExplicitList() {},
  }),
}));
vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: Object.assign(
    (selector: (value: unknown) => unknown) =>
      selector({ terminalFontSize: 14 }),
    { getState: () => ({}) },
  ),
}));
vi.mock("@/hooks/use-coarse-pointer.js", () => ({
  useCoarsePointer: () => false,
}));
vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: false,
  }),
}));
vi.mock("@/contexts/AppZoomContext.js", () => ({
  useAppZoom: () => ({ level: 100 }),
}));
vi.mock("@/components/organisms/TerminalHistoryList.js", () => ({
  TerminalHistoryList: () => null,
}));
vi.mock("@/lib/diagnostics-client.js", () => ({ recordClientDiagnostic() {} }));

describe("TerminalPanel owned connections", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    state.snapshots.clear();
    state.transports.clear();
    state.registry.clear();
    state.terminals.length = 0;
    state.listeners.clear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    root = createRoot(container);
    vi.mocked(applyTerminalBufferReplay).mockImplementation(
      (
        term: { reset: () => void; write: (data: string) => void },
        replay: { data: string; reset: boolean },
        done?: () => void,
      ) => {
        if (replay.reset) term.reset();
        term.write(replay.data);
        done?.();
        return 0;
      },
    );
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  async function connect(profileId: string, generation: number) {
    const transport = makeTransport();
    await act(async () => {
      state.transports.set(`${profileId}-${generation}`, transport);
      state.snapshots.set(profileId, {
        owner: { profileId, generation },
        status: "connected",
      });
      state.listeners.forEach((listener) => listener());
    });
    return transport;
  }

  it("keeps same-ID peers live and preserves xterms while rebinding only the reconnecting owner", async () => {
    const a = await connect("a", 1);
    const b = await connect("b", 1);
    await act(async () => {
      root.render(
        createElement(
          "div",
          null,
          ...["a", "b"].map((profileId) =>
            createElement(TerminalPanel, {
              key: profileId,
              profileId,
              sessionId: "shared",
              project: "shared",
              command: "bash",
            }),
          ),
        ),
      );
    });
    const [termA, termB] = state.terminals;
    const staleData = [...a.data][0]!;
    await act(async () => {
      a.buffers.forEach((cb) =>
        cb({
          offset: 0,
          data: "",
          reset: false,
          truncated: false,
          incarnation: 1,
        }),
      );
      b.buffers.forEach((cb) =>
        cb({
          offset: 0,
          data: "",
          reset: false,
          truncated: false,
          incarnation: 1,
        }),
      );
      a.data.forEach((cb) => cb("only-A", 6, 1));
      b.data.forEach((cb) => cb("only-B", 6, 1));
      termA.input.forEach((cb: (value: string) => void) => cb("input-A"));
      termB.input.forEach((cb: (value: string) => void) => cb("input-B"));
      termA.resize.forEach(
        (cb: (value: { cols: number; rows: number }) => void) =>
          cb({ cols: 100, rows: 30 }),
      );
    });
    expect(a.terminalWrite.mock.calls).toEqual([["shared", "input-A"]]);
    expect(b.terminalWrite.mock.calls).toEqual([["shared", "input-B"]]);
    expect(a.terminalResize.mock.calls).toEqual([["shared", 100, 30]]);
    expect(b.terminalResize).not.toHaveBeenCalled();
    await act(async () => {
      state.snapshots.set("a", {
        owner: { profileId: "a", generation: 2 },
        status: "offline",
      });
      state.listeners.forEach((listener) => listener());
      staleData("stale-A", 13, 1);
      termA.input.forEach((cb: (value: string) => void) => cb("blocked"));
      b.data.forEach((cb) => cb("-still-B", 14, 1));
    });
    expect(termA.options.disableStdin).toBe(true);
    expect(termA.output).toBe("only-A");
    expect(termB.output).toBe("only-B-still-B");
    const replacement = await connect("a", 3);
    await act(async () => {
      replacement.buffers.forEach((cb) =>
        cb({
          offset: 0,
          data: "",
          reset: false,
          truncated: false,
          incarnation: 1,
        }),
      );
      replacement.data.forEach((cb) => cb("-new-A", 6, 1));
      termA.input.forEach((cb: (value: string) => void) => cb("new-input"));
    });
    expect(state.terminals).toEqual([termA, termB]);
    expect(termA.disposed).toBe(false);
    expect(termB.disposed).toBe(false);
    expect(termA.output).toBe("only-A-new-A");
    expect(replacement.terminalWrite.mock.calls).toEqual([
      ["shared", "new-input"],
    ]);
    expect(a.terminalWrite.mock.calls).toEqual([["shared", "input-A"]]);
    expect(b.terminalWrite.mock.calls).toEqual([["shared", "input-B"]]);
    expect(
      a.invoke.mock.calls.every(([channel]) => channel !== "terminal:create"),
    ).toBe(true);
  });

  it("fences outbound onData query responses during historical replay parsing", async () => {
    let replayDoneCallback: (() => void) | undefined;

    vi.mocked(applyTerminalBufferReplay).mockImplementationOnce(
      (_term, _replay, done, gate) => {
        if (gate) {
          gate.activeReplayWrites += 1;
          gate.isReplayWriting = true;
        }
        replayDoneCallback = () => {
          if (gate) {
            gate.activeReplayWrites = Math.max(0, gate.activeReplayWrites - 1);
            gate.isReplayWriting = gate.activeReplayWrites > 0;
          }
          done?.();
        };
        return 10;
      },
    );

    const transport = await connect("fence-test", 1);
    await act(async () => {
      root.render(
        createElement(TerminalPanel, {
          profileId: "fence-test",
          sessionId: "shared",
          project: "shared",
          command: "bash",
        }),
      );
    });
    const term = state.terminals[0]!;

    // Trigger buffer replay (which starts asynchronous parsing)
    await act(async () => {
      transport.buffers.forEach((cb) =>
        cb({
          offset: 10,
          data: "prompt",
          reset: true,
          truncated: false,
          incarnation: 1,
        }),
      );
    });

    // While replay is parsing in xterm, outbound query replies must be fenced
    await act(async () => {
      term.input.forEach((cb: (v: string) => void) => cb("\x1b[1;1R"));
    });
    expect(transport.terminalWrite).not.toHaveBeenCalled();

    // Once replay parsing completes, outbound replies are allowed
    await act(async () => {
      replayDoneCallback?.();
    });
    await act(async () => {
      term.input.forEach((cb: (v: string) => void) => cb("\x1b[1;1R"));
    });
    expect(transport.terminalWrite).toHaveBeenCalledWith("shared", "\x1b[1;1R");
  });

  it("deduplicates replay/live overlap and detects gaps triggering reattach", async () => {
    const transport = await connect("stream-overlap", 1);
    await act(async () => {
      root.render(
        createElement(TerminalPanel, {
          profileId: "stream-overlap",
          sessionId: "shared",
          project: "shared",
          command: "bash",
        }),
      );
    });
    const term = state.terminals[0]!;

    // Replay ends at offset 20
    await act(async () => {
      transport.buffers.forEach((cb) =>
        cb({
          offset: 20,
          data: "initial-output-data",
          reset: true,
          truncated: false,
          incarnation: 1,
        }),
      );
    });

    // 1. Live chunk entirely within replay offset (endOffset 20 <= 20) -> discarded
    const initialOutput = term.output;
    await act(async () => {
      transport.data.forEach((cb) => cb("initial-output-data", 20, 1));
    });
    expect(term.output).toBe(initialOutput);

    // 2. Partial overlap: chunk is 10 bytes ending at 25 (start: 15).
    // Bytes 15..20 overlap. Remainder (5 bytes) rendered, offset advances to 25.
    await act(async () => {
      transport.data.forEach((cb) => cb("1234567890", 25, 1));
    });
    expect(term.output).toBe(initialOutput + "67890");

    // 3. Gap: next chunk starts at offset 35 (10 bytes gap from 25) -> triggers sendAttach
    transport.terminalAttach.mockClear();
    await act(async () => {
      transport.data.forEach((cb) => cb("gap-data", 43, 1)); // 8 bytes, starts at 35 > 25
    });
    expect(transport.terminalAttach).toHaveBeenCalledWith("shared", 25);
  });

  it("rejects duplicate in-flight replay buffers while active replay write is parsing", async () => {
    let replayDoneCallback: (() => void) | undefined;
    let replayCallCount = 0;
    vi.mocked(applyTerminalBufferReplay).mockImplementationOnce(
      (_term, _replay, done, gate) => {
        replayCallCount += 1;
        if (gate) {
          gate.activeReplayWrites += 1;
          gate.isReplayWriting = true;
        }
        replayDoneCallback = () => {
          if (gate) {
            gate.activeReplayWrites = Math.max(0, gate.activeReplayWrites - 1);
            gate.isReplayWriting = gate.activeReplayWrites > 0;
          }
          done?.();
        };
        return 10;
      },
    );

    const transport = await connect("dup-replay", 1);
    await act(async () => {
      root.render(
        createElement(TerminalPanel, {
          profileId: "dup-replay",
          sessionId: "shared",
          project: "shared",
          command: "bash",
        }),
      );
    });

    // First attach buffer starts parsing
    await act(async () => {
      transport.buffers.forEach((cb) =>
        cb({
          offset: 10,
          data: "first",
          reset: true,
          truncated: false,
          incarnation: 1,
        }),
      );
    });
    expect(replayCallCount).toBe(1);

    // Second delayed duplicate attach buffer arrives while first is still parsing -> must be rejected
    await act(async () => {
      transport.buffers.forEach((cb) =>
        cb({
          offset: 10,
          data: "duplicate",
          reset: true,
          truncated: false,
          incarnation: 1,
        }),
      );
    });
    expect(replayCallCount).toBe(1); // not incremented!

    // Complete first replay
    await act(async () => {
      replayDoneCallback?.();
    });
  });

  it("invalidates and triggers reattach on terminal:lagged event", async () => {
    const transport = await connect("lagged-test", 1);
    await act(async () => {
      root.render(
        createElement(TerminalPanel, {
          profileId: "lagged-test",
          sessionId: "shared",
          project: "shared",
          command: "bash",
        }),
      );
    });

    // Set offset via initial buffer
    await act(async () => {
      transport.buffers.forEach((cb) =>
        cb({
          offset: 50,
          data: "init",
          reset: true,
          truncated: false,
          incarnation: 1,
        }),
      );
    });

    // Server broadcast lags and emits terminal:lagged
    transport.terminalAttach.mockClear();
    await act(async () => {
      const laggedListeners = transport.events.get("terminal:lagged");
      laggedListeners?.forEach((cb) => cb({ dropped: 5 }));
    });

    expect(transport.terminalAttach).toHaveBeenCalledWith("shared", 50);
  });

  it("recovers on manual same-ID create with higher incarnation even when new output offset <= old offset", async () => {
    const transport = await connect("incarnation-test", 1);
    await act(async () => {
      root.render(
        createElement(TerminalPanel, {
          profileId: "incarnation-test",
          sessionId: "shared",
          project: "shared",
          command: "bash",
        }),
      );
    });
    const term = state.terminals[0]!;

    // Initial session (incarnation 1) reaches high offset (e.g. 5000)
    await act(async () => {
      transport.buffers.forEach((cb) =>
        cb({
          offset: 5000,
          data: "initial-5000",
          reset: true,
          truncated: false,
          incarnation: 1,
        }),
      );
    });
    expect(term.output).toBe("initial-5000");

    // Live chunk from dead incarnation 1 after manual create arrives -> ignored as stale
    await act(async () => {
      transport.data.forEach((cb) => cb("stale-old", 5010, 1));
    });
    expect(term.output).toBe("initial-5000");

    // Manual same-ID create: new incarnation 2 output arrives with offset 10 (<= old 5000)
    transport.terminalAttach.mockClear();
    await act(async () => {
      transport.data.forEach((cb) => cb("new-inc-2", 10, 2));
    });

    // Panel detects incarnation 2 > 1: resets offset to 0 and triggers full attach(undefined)
    expect(transport.terminalAttach).toHaveBeenCalledWith("shared", undefined);
    // Full buffer reset for incarnation 2 arrives from backend
    await act(async () => {
      transport.buffers.forEach((cb) =>
        cb({
          offset: 10,
          data: "incarnation-2-fresh",
          reset: true,
          truncated: false,
          incarnation: 2,
        }),
      );
    });

    // Terminal was reset cleanly, old content is removed, and renders fresh incarnation buffer
    expect(term.output).not.toContain("initial-5000");
    expect(term.output).toBe("incarnation-2-fresh");
    // Stale incarnation 1 replay arriving late is ignored
    await act(async () => {
      transport.buffers.forEach((cb) =>
        cb({
          offset: 5000,
          data: "stale-replay-1",
          reset: true,
          truncated: false,
          incarnation: 1,
        }),
      );
    });
    expect(term.output).toBe("incarnation-2-fresh");
  });

  it("disables stdin during active replay and re-enables it once replay finishes", async () => {
    let completeReplay: (() => void) | undefined;
    vi.mocked(applyTerminalBufferReplay).mockImplementationOnce(
      (term, replay, done, gate) => {
        if (gate) {
          gate.activeReplayWrites += 1;
          gate.isReplayWriting = true;
        }
        completeReplay = () => {
          if (gate) {
            gate.activeReplayWrites = Math.max(0, gate.activeReplayWrites - 1);
            gate.isReplayWriting = gate.activeReplayWrites > 0;
          }
          if (replay.reset) (term as TestTerminal).reset();
          (term as TestTerminal).write(replay.data);
          done?.();
        };
        return 10;
      },
    );

    const transport = await connect("stdin-gate-test", 1);
    await act(async () => {
      root.render(
        createElement(TerminalPanel, {
          profileId: "stdin-gate-test",
          sessionId: "shared",
          project: "shared",
          command: "bash",
        }),
      );
    });
    const term = state.terminals[0]!;

    // Initial buffer arrives and is held parsing
    await act(async () => {
      transport.buffers.forEach((cb) =>
        cb({
          offset: 10,
          data: "held-replay",
          reset: true,
          truncated: false,
          incarnation: 1,
        }),
      );
    });

    // While replay write is in-flight, stdin must be disabled
    expect(term.options.disableStdin).toBe(true);

    // Replay write completes
    await act(async () => {
      completeReplay?.();
    });

    // Stdin must be re-enabled once replay completes
    expect(term.options.disableStdin).toBe(false);
  });

  it("transitions cleanly when held replay is superseded by a newer incarnation and queues live chunks", async () => {
    let completeA: (() => void) | undefined;
    let completeB: (() => void) | undefined;

    vi.mocked(applyTerminalBufferReplay).mockImplementation(
      (term, replay, done, gate) => {
        if (gate) {
          gate.activeReplayWrites += 1;
          gate.isReplayWriting = true;
        }
        const onCompleteCallback = () => {
          if (gate) {
            gate.activeReplayWrites = Math.max(0, gate.activeReplayWrites - 1);
            gate.isReplayWriting = gate.activeReplayWrites > 0;
          }
          if (replay.reset) (term as TestTerminal).reset();
          (term as TestTerminal).write(replay.data);
          done?.();
          if (gate && gate.activeReplayWrites === 0) {
            gate.onReplayDrain?.();
          }
        };

        if (replay.data.includes("replay-A")) {
          completeA = onCompleteCallback;
        } else {
          completeB = onCompleteCallback;
        }
        return replay.offset;
      },
    );

    const transport = await connect("supersede-test", 1);
    await act(async () => {
      root.render(
        createElement(TerminalPanel, {
          profileId: "supersede-test",
          sessionId: "shared",
          project: "shared",
          command: "bash",
        }),
      );
    });
    const term = state.terminals[0]!;

    // 1. Buffer A (offset 1000, incarnation 1) arrives and is held parsing
    await act(async () => {
      transport.buffers.forEach((cb) =>
        cb({
          offset: 1000,
          data: "replay-A-1000",
          reset: true,
          truncated: false,
          incarnation: 1,
        }),
      );
    });

    // 2. Buffer B (offset 1, incarnation 2) arrives while A is active -> deferred to pendingReplayBuffer
    await act(async () => {
      transport.buffers.forEach((cb) =>
        cb({
          offset: 1,
          data: "replay-B-1",
          reset: true,
          truncated: false,
          incarnation: 2,
        }),
      );
    });

    // 3. Live chunk for B (offset 2, incarnation 2) arrives -> queued
    await act(async () => {
      transport.data.forEach((cb) => cb("delta-B-2", 10, 2));
    });

    // 4. Complete A: onReplayDrain fires, applies pending Buffer B
    await act(async () => {
      completeA?.();
    });

    // 5. Complete B: flushes queued live chunk delta-B-2
    await act(async () => {
      completeB?.();
    });

    // Stale A is completely gone, and B's replay + delta is visible exactly once!
    expect(term.output).not.toContain("replay-A");
    expect(term.output).toBe("replay-B-1delta-B-2");
  });
});
