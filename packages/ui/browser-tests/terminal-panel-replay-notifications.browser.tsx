import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type BufferCallback = (replay: {
    data: string;
    offset: number;
    reset: boolean;
    truncated: boolean;
  }) => void;
  type ExitEnhancedCallback = (exit: {
    exitCode: number | null;
    willRestart: boolean;
    restartIn?: number;
    restartCount?: number;
  }) => void;

  class FakeTerminal {
    readonly cols = 120;
    readonly rows = 30;
    readonly textarea = document.createElement("textarea");
    readonly unicode = { activeVersion: "" };
    element: HTMLElement | undefined;
    readonly writes: Array<{ data: string; callback?: () => void }> = [];

    options = { disableStdin: false, fontSize: 13 };
    constructor(options?: { fontSize?: number }) {
      this.options.fontSize = options?.fontSize ?? 13;
    }
    loadAddon = vi.fn();
    open = vi.fn((host: HTMLElement) => {
      this.element = host;
      host.append(this.textarea);
    });
    clear = vi.fn();
    write = vi.fn((data: string, callback?: () => void) => {
      this.writes.push({ data, callback });
    });
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onTitleChange = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
    attachCustomKeyEventHandler = vi.fn();
    getSelection = vi.fn(() => "");
    focus = vi.fn();
    dispose = vi.fn();
  }

  return {
    FakeTerminal,
    terminal: null as InstanceType<typeof FakeTerminal> | null,
    terminalBySession: new Map<string, InstanceType<typeof FakeTerminal>>(),
    onBuffer: null as BufferCallback | null,
    onBufferBySession: new Map<string, BufferCallback>(),
    onData: null as ((data: string) => void) | null,
    onDataBySession: new Map<string, (data: string) => void>(),
    onExit: null as ((exitCode: number | null) => void) | null,
    onExitBySession: new Map<string, (exitCode: number | null) => void>(),
    onExitEnhanced: null as ExitEnhancedCallback | null,
    onExitEnhancedBySession: new Map<string, ExitEnhancedCallback>(),
    onStatus: null as ((status: string) => void) | null,
    statusListeners: new Set<(status: string) => void>(),
    transportGeneration: 0,
    transportChangeListeners: new Set<() => void>(),
    bumpTransportGeneration: () => {
      mocks.transportGeneration += 1;
      mocks.transportChangeListeners.forEach((listener) => listener());
    },
    setReplayActive: vi.fn(),
    onOutput: vi.fn(),
    handleOutput: vi.fn(),
    handleReplay: vi.fn(),
    scheduleTerminalFit: vi.fn(),
    invalidateSuggestionGeometry: vi.fn(),
    settings: {
      terminalFontSize: 13,
      terminalWorkspaceShortcut: "Mod+Shift+Backquote",
      revealActiveFileShortcut: "Alt+F1",
      gitPanelShortcut: "Mod+Shift+KeyG",
      portsPanelShortcut: "Mod+Shift+KeyP",
      fleetTerminalShortcut: "Mod+Shift+KeyM",
      terminalFontSizeIncreaseShortcut: "Ctrl+Alt+Shift+Equal",
      terminalFontSizeDecreaseShortcut: "Ctrl+Alt+Minus",
      saveDebounced: vi.fn(),
    },
    transport: {
      invoke: vi.fn().mockResolvedValue([{ id: "term-1", alive: true }]),
      terminalAttach: vi.fn(() => true),
      terminalWrite: vi.fn(),
      terminalResize: vi.fn(),
      onTerminalData: vi.fn((_id: string, callback: (data: string) => void) => {
        mocks.onData = callback;
        mocks.onDataBySession.set(_id, callback);
        return () => {
          if (mocks.onDataBySession.get(_id) === callback) {
            mocks.onDataBySession.delete(_id);
          }
        };
      }),
      onTerminalExit: vi.fn(
        (_id: string, callback: (exitCode: number | null) => void) => {
          mocks.onExit = callback;
          mocks.onExitBySession.set(_id, callback);
          return () => {
            if (mocks.onExitBySession.get(_id) === callback) {
              mocks.onExitBySession.delete(_id);
            }
          };
        },
      ),
      onTerminalExitEnhanced: vi.fn(
        (
          _id: string,
          callback: (exit: {
            exitCode: number | null;
            willRestart: boolean;
            restartIn?: number;
            restartCount?: number;
          }) => void,
        ) => {
          mocks.onExitEnhanced = callback;
          mocks.onExitEnhancedBySession.set(_id, callback);
          return () => {
            if (mocks.onExitEnhancedBySession.get(_id) === callback) {
              mocks.onExitEnhancedBySession.delete(_id);
            }
          };
        },
      ),
      onTerminalBuffer: vi.fn((_id: string, callback: BufferCallback) => {
        mocks.onBuffer = callback;
        mocks.onBufferBySession.set(_id, callback);
        return () => {
          if (mocks.onBufferBySession.get(_id) === callback) {
            mocks.onBufferBySession.delete(_id);
          }
        };
      }),
      onStatusChange: vi.fn((callback: (status: string) => void) => {
        mocks.onStatus = callback;
        mocks.statusListeners.add(callback);
        return () => mocks.statusListeners.delete(callback);
      }),
    },
  };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: class extends mocks.FakeTerminal {
    constructor(options?: { fontSize?: number }) {
      super(options);
      mocks.terminal = this;
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {} }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@dam-hopper/shared/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/api/client.js", () => ({
  api: { workspace: { status: vi.fn().mockResolvedValue({}) } },
}));
vi.mock("@/api/transport.js", () => ({
  getTransportGeneration: () => mocks.transportGeneration,
  subscribeTransportChanges: (listener: () => void) => {
    mocks.transportChangeListeners.add(listener);
    return () => mocks.transportChangeListeners.delete(listener);
  },
  getTransport: () => mocks.transport,
}));
vi.mock("@/lib/terminal-registry.js", () => {
  const terminalRegistry = new Map();
  return {
    registerTerminal: (
      id: string,
      terminal: unknown,
      fitAddon: unknown,
      findController: unknown,
    ) => {
      const entry = {
        terminal,
        fitAddon,
        findController,
        invalidateSuggestionGeometry: mocks.invalidateSuggestionGeometry,
      };
      terminalRegistry.set(id, entry);
      mocks.terminalBySession.set(
        id,
        terminal as InstanceType<typeof mocks.FakeTerminal>,
      );
      return entry;
    },
    removeTerminal: vi.fn(),
    terminalRegistry,
  };
});
vi.mock("@/lib/terminal-find-controller.js", () => ({
  TerminalFindController: class {
    getSnapshot = () => ({
      isOpen: false,
      query: "",
      resultIndex: 0,
      resultCount: 0,
      status: "empty",
    });
    subscribe = () => () => {};
    dispose = vi.fn();
  },
}));
vi.mock("@/lib/terminal-fit-scheduler.js", () => ({
  cancelScheduledTerminalFit: vi.fn(),
  scheduleTerminalFit: mocks.scheduleTerminalFit,
}));
vi.mock("@/lib/terminal-renderer.js", () => ({
  activateTerminalWebglRenderer: () => ({ renderer: "dom", dispose: vi.fn() }),
}));
vi.mock("@/lib/terminal-cursor-geometry-adapter.js", () => ({
  TerminalCursorGeometryAdapter: class {
    invalidate = vi.fn();
    hide = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("@/lib/terminal-touch-scroll.js", () => ({
  bindTerminalTouchScroll: () => () => {},
}));
vi.mock("@/lib/terminal-agent-notification-integration.js", () => ({
  attachTerminalAgentNotifications: () => ({
    setReplayActive: mocks.setReplayActive,
    onOutput: mocks.onOutput,
    onUserInput: vi.fn(),
    onSubmittedCommand: vi.fn(),
    onTitleChange: vi.fn(),
    onTerminalExit: vi.fn(),
    dispose: vi.fn(),
  }),
}));
vi.mock("@/lib/diagnostics-client.js", () => ({
  recordClientDiagnostic: vi.fn(),
}));
vi.mock("@/lib/terminal-suggestion-key-handler.js", () => ({
  handleTerminalSuggestionKeyEvent: () => true,
}));
vi.mock("@/lib/terminal-suggestion-acceptance.js", () => ({
  getTerminalSuggestionSuffix: () => null,
}));
vi.mock("@/hooks/use-coarse-pointer.js", () => ({
  useCoarsePointer: () => false,
}));
vi.mock("@/hooks/use-terminal-suggestions.js", () => ({
  useTerminalSuggestions: () => ({
    snapshot: { state: "idle", rawInput: "" },
    handleInput: (data: string) => ({ forward: true, data }),
    handleLifecycle: vi.fn(),
    handleOutput: mocks.handleOutput,
    handleReplay: mocks.handleReplay,
    handleComposition: vi.fn(),
    accept: () => null,
    openExplicitList: () => false,
    closeExplicitList: vi.fn(),
  }),
}));
vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: Object.assign(
    (selector?: (state: typeof mocks.settings) => unknown) =>
      selector ? selector(mocks.settings) : mocks.settings,
    { getState: () => mocks.settings },
  ),
}));
vi.mock("@/components/atoms/TerminalFindBar.js", () => ({
  TerminalFindBar: () => null,
}));
vi.mock("@/components/atoms/TerminalSuggestionGhost.js", () => ({
  TerminalSuggestionGhost: () => null,
}));
vi.mock("@/components/organisms/TerminalHistoryList.js", () => ({
  TerminalHistoryList: () => null,
}));
vi.mock("@/lib/command-history.js", () => ({
  getHistory: () => [],
  searchHistory: () => [],
}));
vi.mock("@/lib/utils.js", () => ({
  cn: (...values: string[]) => values.join(" "),
}));

import { TerminalPanel } from "@/components/organisms/TerminalPanel.js";
import { TerminalKeepAliveHost } from "@/components/organisms/TerminalKeepAliveHost.js";
import { getTerminalOutputActivitySnapshot } from "@/lib/terminal-output-activity.js";

describe("TerminalPanel replay lifecycle in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.terminal = null;
    mocks.terminalBySession.clear();
    mocks.onBuffer = null;
    mocks.onBufferBySession.clear();
    mocks.onData = null;
    mocks.onExit = null;
    mocks.onExitBySession.clear();
    mocks.onExitEnhanced = null;
    mocks.onExitEnhancedBySession.clear();
    mocks.onStatus = null;
    mocks.statusListeners.clear();
    mocks.transportGeneration = 0;
    mocks.transportChangeListeners.clear();
    mocks.settings.terminalFontSize = 13;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("queues live chunks until xterm completes retained replay", async () => {
    await act(async () => {
      root.render(
        <TerminalPanel sessionId="term-1" project="web" command="bash" />,
      );
    });
    await vi.waitFor(() => expect(mocks.onBuffer).toBeTypeOf("function"));

    await act(async () => {
      mocks.onBuffer?.({
        data: "retained",
        offset: 8,
        reset: true,
        truncated: false,
      });
      expect(getTerminalOutputActivitySnapshot("term-1")).toEqual({
        recentOutput: false,
        streamReady: false,
      });
      mocks.onData?.("live-first");
      mocks.onData?.("live-second");
    });

    expect(mocks.setReplayActive).toHaveBeenLastCalledWith(true);
    expect(mocks.terminal?.writes.map(({ data }) => data)).toEqual([
      "retained",
    ]);
    expect(mocks.handleOutput).not.toHaveBeenCalled();

    await act(async () => mocks.terminal?.writes[0]?.callback?.());

    expect(mocks.setReplayActive).toHaveBeenLastCalledWith(false);
    expect(mocks.terminal?.writes.map(({ data }) => data)).toEqual([
      "retained",
      "live-first",
      "live-second",
    ]);
    expect(mocks.handleOutput).toHaveBeenCalledTimes(2);
    expect(mocks.onOutput).toHaveBeenCalledTimes(2);
    expect(getTerminalOutputActivitySnapshot("term-1")).toEqual({
      recentOutput: true,
      streamReady: true,
    });
  });

  it("keeps hidden mounted panels isolated and clears them on host cleanup", async () => {
    await act(async () => {
      root.render(
        <TerminalKeepAliveHost
          mountedSessions={[
            { sessionId: "hidden-a", project: "web", command: "bash" },
            { sessionId: "hidden-b", project: "api", command: "bash" },
          ]}
          suppressAutoFocus
        />,
      );
    });
    await vi.waitFor(() => {
      expect(mocks.onBufferBySession.get("hidden-a")).toBeTypeOf("function");
      expect(mocks.onBufferBySession.get("hidden-b")).toBeTypeOf("function");
    });

    await act(async () => {
      for (const sessionId of ["hidden-a", "hidden-b"]) {
        mocks.onBufferBySession.get(sessionId)?.({
          data: `retained-${sessionId}`,
          offset: 20,
          reset: true,
          truncated: false,
        });
        mocks.terminalBySession.get(sessionId)?.writes.at(-1)?.callback?.();
      }
      mocks.onDataBySession.get("hidden-a")?.("hidden-live-a");
    });

    expect(getTerminalOutputActivitySnapshot("hidden-a")).toEqual({
      recentOutput: true,
      streamReady: true,
    });
    expect(getTerminalOutputActivitySnapshot("hidden-b")).toEqual({
      recentOutput: false,
      streamReady: true,
    });

    await act(async () => root.render(null));

    expect(getTerminalOutputActivitySnapshot("hidden-a")).toEqual({
      recentOutput: false,
      streamReady: false,
    });
    expect(getTerminalOutputActivitySnapshot("hidden-b")).toEqual({
      recentOutput: false,
      streamReady: false,
    });
  });

  it("ignores empty and synthetic output and clears activity at lifecycle boundaries", async () => {
    await act(async () => {
      root.render(
        <TerminalPanel sessionId="term-1" project="web" command="bash" />,
      );
    });
    await vi.waitFor(() => expect(mocks.onBuffer).toBeTypeOf("function"));

    await act(async () => {
      mocks.onBuffer?.({
        data: "retained",
        offset: 8,
        reset: true,
        truncated: false,
      });
      mocks.terminal?.writes[0]?.callback?.();
    });
    expect(getTerminalOutputActivitySnapshot("term-1")).toEqual({
      recentOutput: false,
      streamReady: true,
    });

    await act(async () => mocks.onData?.(""));
    expect(getTerminalOutputActivitySnapshot("term-1").recentOutput).toBe(
      false,
    );

    await act(async () => mocks.onData?.("live"));
    expect(getTerminalOutputActivitySnapshot("term-1").recentOutput).toBe(true);
    await act(async () => mocks.onExit?.(0));
    expect(getTerminalOutputActivitySnapshot("term-1")).toEqual({
      recentOutput: false,
      streamReady: false,
    });
    await act(async () => mocks.onData?.("late-after-exit"));
    expect(getTerminalOutputActivitySnapshot("term-1").recentOutput).toBe(
      false,
    );

    await act(async () =>
      mocks.onBuffer?.({
        data: "retained-after-exit",
        offset: 16,
        reset: false,
        truncated: false,
      }),
    );
    const exitReplayWrite = mocks.terminal?.writes.at(-1);
    await act(async () => exitReplayWrite?.callback?.());
    await act(async () => mocks.onData?.("live-after-exit"));
    expect(getTerminalOutputActivitySnapshot("term-1").recentOutput).toBe(true);
    await act(async () => mocks.onStatus?.("disconnected"));
    expect(getTerminalOutputActivitySnapshot("term-1")).toEqual({
      recentOutput: false,
      streamReady: false,
    });
    await act(async () => mocks.onData?.("late-after-disconnect"));
    expect(getTerminalOutputActivitySnapshot("term-1").recentOutput).toBe(
      false,
    );

    const attachCallsBeforeReconnect =
      mocks.transport.terminalAttach.mock.calls.length;
    await act(async () => mocks.onStatus?.("connected"));
    expect(mocks.transport.terminalAttach).toHaveBeenCalledTimes(
      attachCallsBeforeReconnect + 1,
    );

    await act(async () =>
      mocks.onBuffer?.({
        data: "retained-again",
        offset: 16,
        reset: false,
        truncated: false,
      }),
    );
    const replayWrite = mocks.terminal?.writes.at(-1);
    await act(async () => replayWrite?.callback?.());
    await act(async () => mocks.onData?.("live-again"));
    expect(getTerminalOutputActivitySnapshot("term-1").recentOutput).toBe(true);

    await act(async () =>
      mocks.onExitEnhanced?.({ exitCode: 0, willRestart: false }),
    );
    expect(getTerminalOutputActivitySnapshot("term-1")).toEqual({
      recentOutput: false,
      streamReady: false,
    });
    expect(mocks.terminal?.writes.at(-1)?.data).toContain("Process exited");
    await act(async () => mocks.onData?.(""));
    await act(async () => mocks.onData?.("late-after-enhanced-exit"));
    expect(getTerminalOutputActivitySnapshot("term-1").recentOutput).toBe(
      false,
    );
  });

  it("sends the immutable worktree target when recovery creates a session", async () => {
    mocks.transport.invoke.mockImplementation((method: string) =>
      method === "terminal:listDetailed"
        ? Promise.resolve([])
        : Promise.resolve(undefined),
    );

    await act(async () => {
      root.render(
        <TerminalPanel
          sessionId="terminal:feature:_:1"
          project="web"
          command="bash"
          cwd="/workspace/web-feature"
          worktreePath="/workspace/web-feature"
        />,
      );
    });

    await vi.waitFor(() => {
      expect(mocks.transport.invoke).toHaveBeenCalledWith(
        "terminal:create",
        expect.objectContaining({
          project: "web",
          cwd: "/workspace/web-feature",
          worktreePath: "/workspace/web-feature",
        }),
      );
    });
  });

  it("updates live xterm font size and schedules the existing fit path", async () => {
    await act(async () => {
      root.render(
        <TerminalPanel sessionId="term-1" project="web" command="bash" />,
      );
    });

    expect(mocks.terminal?.options.fontSize).toBe(13);
    mocks.settings.terminalFontSize = 16;

    await act(async () => {
      root.render(
        <TerminalPanel sessionId="term-1" project="web" command="bash" />,
      );
    });

    expect(mocks.terminal?.options.fontSize).toBe(16);
    expect(mocks.scheduleTerminalFit).toHaveBeenCalledWith(expect.any(Object), {
      focus: false,
    });
  });

  it("uses xterm's installed key handler without forwarding font shortcuts", async () => {
    await act(async () => {
      root.render(
        <TerminalPanel sessionId="term-1" project="web" command="bash" />,
      );
    });

    const handler =
      mocks.terminal?.attachCustomKeyEventHandler.mock.calls[0]?.[0];
    const event = {
      type: "keydown",
      key: "+",
      code: "Equal",
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
      metaKey: false,
      repeat: false,
      isComposing: false,
      preventDefault: vi.fn(),
    };

    expect(handler?.(event)).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(mocks.settings.saveDebounced).toHaveBeenCalledWith({
      terminalFontSize: 14,
    });
    expect(mocks.transport.terminalWrite).not.toHaveBeenCalled();
  });
});
