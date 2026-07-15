import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WsTransport } from "./ws-transport.js";

class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }
}

const sockets: MockWebSocket[] = [];

function installMockWebSocket() {
  vi.stubGlobal(
    "WebSocket",
    class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    },
  );
}

afterEach(() => {
  sockets.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("WsTransport terminalAttach", () => {
  it("sends from_offset when provided", () => {
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const socket = sockets[0];

    expect(transport.terminalAttach("session-1", 42)).toBe(true);

    expect(JSON.parse(socket.sent[0])).toEqual({
      kind: "terminal:attach",
      id: "session-1",
      from_offset: 42,
    });
    transport.destroy();
  });

  it("returns false without sending when websocket is not open", () => {
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const socket = sockets[0];
    socket.readyState = 0;

    expect(transport.terminalAttach("session-1", 42)).toBe(false);
    expect(socket.sent).toEqual([]);

    transport.destroy();
  });

  it("passes reset and truncated metadata to buffer listeners", () => {
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const received: unknown[] = [];
    transport.onTerminalBuffer("session-1", (buffer) => received.push(buffer));

    sockets[0].onmessage?.({
      data: JSON.stringify({
        kind: "terminal:buffer",
        id: "session-1",
        data: "tail",
        offset: 1024,
        reset: true,
        truncated: true,
      }),
    });

    expect(received).toEqual([
      { data: "tail", offset: 1024, reset: true, truncated: true },
    ]);
    transport.destroy();
  });
});

describe("WsTransport terminal lifecycle", () => {
  it("delivers validated snapshots only to the matching session", () => {
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const received: unknown[] = [];
    transport.onTerminalLifecycle("session-1", (event) => received.push(event));

    sockets[0].onmessage?.({
      data: JSON.stringify({
        kind: "terminal:lifecycle",
        id: "session-1",
        lifecycle: "submitted",
        generation: 3,
        command: "git status",
      }),
    });
    sockets[0].onmessage?.({
      data: JSON.stringify({
        kind: "terminal:lifecycle",
        id: "session-1",
        lifecycle: "editing",
        generation: 3,
        command: "must not be exposed",
      }),
    });

    expect(received).toEqual([
      {
        id: "session-1",
        lifecycle: "submitted",
        generation: 3,
        command: "git status",
      },
    ]);
    transport.destroy();
  });
});

describe("WsTransport commit message endpoints", () => {
  it("loads and edits the full commit message with root scope", async () => {
    installMockWebSocket();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "subject\n\nbody" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    await transport.invoke("git:commitMessage", {
      project: "demo",
      hash: "abc123",
      root: "modules/child",
    });
    await transport.invoke("git:editCommitMessage", {
      project: "demo",
      hash: "abc123",
      message: "subject\n\nbody",
      root: "modules/child",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:4800/api/git/demo/commit/abc123/message?root=modules%2Fchild",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        message: "subject\n\nbody",
        root: "modules/child",
      }),
    });
    transport.destroy();
  });
});

describe("WsTransport diagnostics export endpoint", () => {
  it("posts the diagnostics export request to the protected API route", async () => {
    installMockWebSocket();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          diagnosticSchemaVersion: 1,
          generatedAt: 1,
          scope: {
            windowMinutes: 60,
            includeTerminalOutput: true,
            terminalTailBytes: 65536,
            terminalIds: null,
          },
          manifest: {
            backendEventCount: 0,
            terminalSessionCount: 0,
            retentionMinutes: 60,
            storage: "localConfigJsonl",
            droppedPersistEvents: 0,
            persistErrorCount: 0,
          },
          frontend: {},
          backend: { events: [] },
          terminals: { sessions: [], tails: [] },
          system: {
            sampledAt: 1,
            uptimeSeconds: 1,
            cpu: { usagePercent: 0, logicalCoreCount: 1 },
            memory: {
              totalBytes: 1,
              usedBytes: 1,
              availableBytes: 0,
              usagePercent: 100,
            },
            disk: {
              name: "/",
              mountPoint: "/",
              totalBytes: 1,
              availableBytes: 0,
              usedBytes: 1,
              usagePercent: 100,
            },
            disks: [
              {
                name: "/",
                mountPoint: "/",
                totalBytes: 1,
                availableBytes: 0,
                usedBytes: 1,
                usagePercent: 100,
              },
            ],
            temperatures: [],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    await transport.invoke("diagnostics:export", {
      windowMinutes: 15,
      frontend: { logs: [] },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4800/api/diagnostics/export",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          windowMinutes: 15,
          frontend: { logs: [] },
        }),
      }),
    );
    transport.destroy();
  });
});

const diagCalls: Array<{
  type: string;
  scope: string;
  message: string;
  metadata?: unknown;
}> = [];

vi.mock("@/lib/diagnostics-client.js", () => ({
  recordClientDiagnostic: (
    type: string,
    scope: string,
    message: string,
    metadata?: unknown,
  ) => {
    diagCalls.push({ type, scope, message, metadata });
  },
}));

describe("WsTransport diagnostics", () => {
  beforeEach(() => {
    diagCalls.length = 0;
  });

  it("records status change on connect", () => {
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const socket = sockets[0];

    // Simulate open
    socket.onopen?.();

    const statusEvents = diagCalls.filter((c) =>
      c.message.startsWith("status:"),
    );
    expect(statusEvents.length).toBeGreaterThan(0);
    expect(statusEvents.some((e) => e.message === "status:connected")).toBe(
      true,
    );
    transport.destroy();
  });

  it("records reconnect backoff on disconnect", () => {
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const socket = sockets[0];

    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        kind: "terminal:output",
        id: "session-1",
        data: "tail",
      }),
    });
    diagCalls.length = 0; // reset after connect
    socket.onclose?.();

    const disconnectedStatus = diagCalls.find(
      (c) => c.message === "status:disconnected",
    );
    const reconnectEvents = diagCalls.filter(
      (c) => c.message === "reconnect_scheduled",
    );
    expect(disconnectedStatus?.metadata).toMatchObject({
      messageKindCounts: { "terminal:output": 1 },
    });
    expect(reconnectEvents.length).toBe(1);
    expect(reconnectEvents[0].metadata).toMatchObject({ backoffMs: 1000 });
    transport.destroy();
  });

  it("records parse error on malformed message", () => {
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const socket = sockets[0];

    socket.onopen?.();
    diagCalls.length = 0;
    // Send malformed JSON
    socket.onmessage?.({ data: "not-json" });

    const parseErrors = diagCalls.filter((c) => c.message === "ws.parse_error");
    expect(parseErrors.length).toBe(1);
    transport.destroy();
  });

  it("records websocket errors with aggregated message counts", () => {
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const socket = sockets[0];

    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        kind: "terminal:buffer",
        id: "session-1",
        data: "",
        offset: 0,
        reset: false,
        truncated: false,
      }),
    });
    diagCalls.length = 0;
    socket.onerror?.();

    const errorEvent = diagCalls.find((c) => c.message === "ws.error");
    expect(errorEvent?.metadata).toMatchObject({
      messageKindCounts: { "terminal:buffer": 1 },
    });
    transport.destroy();
  });

  it("resets message counts after reconnect", () => {
    vi.useFakeTimers();
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const firstSocket = sockets[0];

    firstSocket.onopen?.();
    firstSocket.onmessage?.({
      data: JSON.stringify({
        kind: "terminal:output",
        id: "session-1",
        data: "tail",
      }),
    });
    firstSocket.onclose?.();

    diagCalls.length = 0;
    vi.advanceTimersByTime(1000);

    const secondSocket = sockets[1];
    const connectingStatus = diagCalls.find(
      (c) => c.message === "status:connecting",
    );
    secondSocket.onopen?.();

    const connectedStatus = diagCalls.find(
      (c) => c.message === "status:connected",
    );
    expect(connectingStatus?.metadata).toMatchObject({ messageKindCounts: {} });
    expect(connectedStatus?.metadata).toMatchObject({ messageKindCounts: {} });
    transport.destroy();
  });

  it("records dispatch errors separately from parse errors", () => {
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const socket = sockets[0];

    transport.onTerminalBuffer("session-1", () => {
      throw new Error("listener boom");
    });

    socket.onopen?.();
    diagCalls.length = 0;
    socket.onmessage?.({
      data: JSON.stringify({
        kind: "terminal:buffer",
        id: "session-1",
        data: "",
        offset: 0,
        reset: false,
        truncated: false,
      }),
    });

    expect(
      diagCalls.filter((c) => c.message === "ws.parse_error"),
    ).toHaveLength(0);
    const dispatchErrors = diagCalls.filter(
      (c) => c.message === "ws.dispatch_error",
    );
    expect(dispatchErrors).toHaveLength(1);
    expect(dispatchErrors[0].metadata).toMatchObject({
      kind: "terminal:buffer",
    });
    transport.destroy();
  });
});
