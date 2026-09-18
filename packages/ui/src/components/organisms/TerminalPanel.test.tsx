// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionRef } from "@/api/ownership.js";
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
  const data = new Set<(value: string) => void>();
  const buffers = new Set<(value: unknown) => void>();
  return {
    data, buffers,
    invoke: vi.fn(async (_channel: string) => [{ id: "shared", project: "shared", alive: true }]),
    terminalWrite: vi.fn(), terminalResize: vi.fn(), terminalAttach: vi.fn(() => true),
    onTerminalData: (_id: string, cb: (value: string) => void) => { data.add(cb); return () => data.delete(cb); },
    onTerminalBuffer: (_id: string, cb: (value: unknown) => void) => { buffers.add(cb); return () => buffers.delete(cb); },
    onTerminalExit: () => () => {}, onEvent: () => () => {},
  };
}

vi.mock("@/api/connections.js", () => ({
  getConnectionSnapshot: (id: string) => state.snapshots.get(id) ?? null,
  getTransport: (owner: ConnectionRef) => state.transports.get(`${owner.profileId}-${owner.generation}`),
  isCurrentConnection: (owner: ConnectionRef) => {
    const snapshot = state.snapshots.get(owner.profileId);
    return snapshot?.status === "connected" && snapshot.owner.generation === owner.generation;
  },
  subscribeConnections: (cb: () => void) => { state.listeners.add(cb); return () => state.listeners.delete(cb); },
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
    constructor() { state.terminals.push(this); }
    open(host: HTMLElement) { host.appendChild(this.element); }
    loadAddon() {}
    onData(cb: (data: string) => void) { this.input.add(cb); return { dispose: () => this.input.delete(cb) }; }
    onResize(cb: (size: { cols: number; rows: number }) => void) { this.resize.add(cb); return { dispose: () => this.resize.delete(cb) }; }
    onTitleChange() { return { dispose() {} }; }
    attachCustomKeyEventHandler() {}
    write(data: string) { this.output += data; }
    dispose() { this.disposed = true; }
    hasSelection() { return false; }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {} }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@/lib/terminal-registry.js", () => ({
  getTerminal: (key: string) => state.registry.get(key),
  registerTerminal: (key: string, terminal: unknown, fitAddon: unknown, findController: unknown, attachmentElement: HTMLElement) => {
    const entry = { terminal, fitAddon, findController, attachmentElement };
    state.registry.set(key, entry);
    return entry;
  },
  removeTerminal: (key: string) => state.registry.delete(key),
}));
vi.mock("@/lib/terminal-find-controller.js", () => ({ TerminalFindController: class {
  getSnapshot() { return { isOpen: false }; }
  subscribe() { return () => {}; }
  dispose() {}
} }));
vi.mock("@/lib/terminal-cursor-geometry-adapter.js", () => ({
  geometryEquals: () => true,
  TerminalCursorGeometryAdapter: class { invalidate() {} hide() {} dispose() {} },
}));
vi.mock("@/lib/terminal-fit-scheduler.js", () => ({ cancelScheduledTerminalFit() {}, scheduleTerminalFit() {} }));
vi.mock("@/lib/terminal-native-input-policy.js", () => ({ syncNativeKeyboardSuppression() {} }));
vi.mock("@/lib/terminal-touch-scroll.js", () => ({ bindTerminalTouchScroll: () => () => {} }));
vi.mock("@/lib/terminal-buffer-replay.js", () => ({
  applyTerminalBufferReplay: (_term: unknown, _replay: unknown, done: () => void) => { done(); return 0; },
  utf8ByteLength: (value: string) => value.length,
}));
vi.mock("@/lib/terminal-agent-notification-integration.js", () => ({ attachTerminalAgentNotifications: () => ({
  setReplayActive() {}, onOutput() {}, onUserInput() {}, onTitleChange() {}, dispose() {},
}) }));
vi.mock("@/hooks/use-terminal-suggestions.js", () => ({ useTerminalSuggestions: () => ({
  snapshot: { state: "unverified", rawInput: "" }, handleInput: (data: string) => ({ forward: true, data }),
  handleOutput() {}, handleReplay() {}, closeExplicitList() {},
}) }));
vi.mock("@/stores/settings.js", () => ({ useSettingsStore: Object.assign(
  (selector: (value: unknown) => unknown) => selector({ terminalFontSize: 14 }),
  { getState: () => ({}) },
) }));
vi.mock("@/hooks/use-coarse-pointer.js", () => ({ useCoarsePointer: () => false }));
vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({ useAndroidChromeInputPolicy: () => ({ isAndroidChromeNativeInputSuppressed: false }) }));
vi.mock("@/contexts/AppZoomContext.js", () => ({ useAppZoom: () => ({ level: 100 }) }));
vi.mock("@/components/organisms/TerminalHistoryList.js", () => ({ TerminalHistoryList: () => null }));
vi.mock("@/lib/diagnostics-client.js", () => ({ recordClientDiagnostic() {} }));

describe("TerminalPanel owned connections", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    state.snapshots.clear(); state.transports.clear(); state.registry.clear(); state.terminals.length = 0;
    state.listeners.clear();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

  async function connect(profileId: string, generation: number) {
    const transport = makeTransport();
    await act(async () => {
      state.transports.set(`${profileId}-${generation}`, transport);
      state.snapshots.set(profileId, { owner: { profileId, generation }, status: "connected" });
      state.listeners.forEach((listener) => listener());
    });
    return transport;
  }

  it("keeps same-ID peers live and preserves xterms while rebinding only the reconnecting owner", async () => {
    const a = await connect("a", 1);
    const b = await connect("b", 1);
    await act(async () => {
      root.render(createElement("div", null, ...["a", "b"].map((profileId) => createElement(TerminalPanel, {
        key: profileId, profileId, sessionId: "shared", project: "shared", command: "bash",
      }))));
    });
    const [termA, termB] = state.terminals;
    const staleData = [...a.data][0]!;
    await act(async () => {
      a.buffers.forEach((cb) => cb({ offset: 0 })); b.buffers.forEach((cb) => cb({ offset: 0 }));
      a.data.forEach((cb) => cb("only-A")); b.data.forEach((cb) => cb("only-B"));
      termA.input.forEach((cb: (value: string) => void) => cb("input-A"));
      termB.input.forEach((cb: (value: string) => void) => cb("input-B"));
      termA.resize.forEach((cb: (value: { cols: number; rows: number }) => void) => cb({ cols: 100, rows: 30 }));
    });
    expect(a.terminalWrite.mock.calls).toEqual([["shared", "input-A"]]);
    expect(b.terminalWrite.mock.calls).toEqual([["shared", "input-B"]]);
    expect(a.terminalResize.mock.calls).toEqual([["shared", 100, 30]]);
    expect(b.terminalResize).not.toHaveBeenCalled();
    await act(async () => {
      state.snapshots.set("a", { owner: { profileId: "a", generation: 2 }, status: "offline" });
      state.listeners.forEach((listener) => listener());
      staleData("stale-A");
      termA.input.forEach((cb: (value: string) => void) => cb("blocked"));
      b.data.forEach((cb) => cb("-still-B"));
    });
    expect(termA.options.disableStdin).toBe(true);
    expect(termA.output).toBe("only-A");
    expect(termB.output).toBe("only-B-still-B");
    const replacement = await connect("a", 3);
    await act(async () => {
      replacement.buffers.forEach((cb) => cb({ offset: 0 }));
      replacement.data.forEach((cb) => cb("-new-A"));
      termA.input.forEach((cb: (value: string) => void) => cb("new-input"));
    });
    expect(state.terminals).toEqual([termA, termB]);
    expect(termA.disposed).toBe(false);
    expect(termB.disposed).toBe(false);
    expect(termA.output).toBe("only-A-new-A");
    expect(replacement.terminalWrite.mock.calls).toEqual([["shared", "new-input"]]);
    expect(a.terminalWrite.mock.calls).toEqual([["shared", "input-A"]]);
    expect(b.terminalWrite.mock.calls).toEqual([["shared", "input-B"]]);
    expect(a.invoke.mock.calls.every(([channel]) => channel !== "terminal:create")).toBe(true);
  });
});
