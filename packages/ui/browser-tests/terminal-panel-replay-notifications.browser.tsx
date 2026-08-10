import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class FakeTerminal {
    readonly cols = 120;
    readonly rows = 30;
    readonly textarea = document.createElement("textarea");
    readonly unicode = { activeVersion: "" };
    element: HTMLElement | undefined;
    readonly writes: Array<{ data: string; callback?: () => void }> = [];

    options = { disableStdin: false };
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
    onBuffer: null as
      | ((replay: {
          data: string;
          offset: number;
          reset: boolean;
          truncated: boolean;
        }) => void)
      | null,
    onData: null as ((data: string) => void) | null,
    setReplayActive: vi.fn(),
    onOutput: vi.fn(),
    handleOutput: vi.fn(),
    handleReplay: vi.fn(),
  };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: class extends mocks.FakeTerminal {
    constructor() {
      super();
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
  getTransportGeneration: () => 0,
  subscribeTransportChanges: () => () => {},
  getTransport: () => ({
    invoke: vi.fn().mockResolvedValue([{ id: "term-1", alive: true }]),
    terminalAttach: vi.fn(() => true),
    terminalWrite: vi.fn(),
    terminalResize: vi.fn(),
    onTerminalData: vi.fn((_id: string, callback: (data: string) => void) => {
      mocks.onData = callback;
      return () => {};
    }),
    onTerminalExit: vi.fn(() => () => {}),
    onTerminalBuffer: vi.fn((_id: string, callback: typeof mocks.onBuffer) => {
      mocks.onBuffer = callback;
      return () => {};
    }),
  }),
}));
vi.mock("@/lib/terminal-registry.js", () => ({
  registerTerminal: () => ({}),
  removeTerminal: vi.fn(),
  terminalRegistry: new Map(),
}));
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
  scheduleTerminalFit: vi.fn(),
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
vi.mock("@/lib/terminal-keyboard-shortcuts.js", () => ({
  handleSharedTerminalKeyEvent: () => true,
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
  useSettingsStore: Object.assign(() => ({}), { getState: () => ({}) }),
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

describe("TerminalPanel replay lifecycle in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.terminal = null;
    mocks.onBuffer = null;
    mocks.onData = null;
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
  });
});
