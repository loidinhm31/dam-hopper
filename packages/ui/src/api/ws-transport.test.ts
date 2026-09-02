import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "./client.js";
import { WsTransport } from "./ws-transport.js";
import { setActiveProfile, setAuthToken } from "./server-config.js";

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

describe("WsTransport terminal rename", () => {
  it("maps rename requests to the protected terminal PATCH route", async () => {
    installMockWebSocket();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "session/1", name: "Build" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    await transport.invoke("terminal:rename", {
      id: "session/1",
      name: "Build",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:4800/api/terminal/session%2F1",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ name: "Build" }),
    });
    transport.destroy();
  });

  it("preserves null when clearing a terminal name", async () => {
    installMockWebSocket();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "session-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    await transport.invoke("terminal:rename", {
      id: "session-1",
      name: null,
    });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ name: null }),
    });
    transport.destroy();
  });
});

describe("WsTransport usage setup endpoints", () => {
  it("maps setup status and configuration to protected usage routes", async () => {
    installMockWebSocket();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ enabled: false }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ enabled: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    await transport.invoke("usage:setupStatus");
    await transport.invoke("usage:configure", { enabled: true });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:4800/api/usage/setup",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ enabled: true }),
    });
    transport.destroy();
  });
});

describe("WsTransport bulk Git targets", () => {
  it("serializes selected worktrees separately from project names", async () => {
    installMockWebSocket();
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    await transport.invoke("git:fetch", [
      "demo",
      { project: "feature-project", worktreePath: "/tmp/feature" },
    ]);
    await transport.invoke("git:pull", [
      { project: "feature-project", worktreePath: "/tmp/feature" },
    ]);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:4800/api/git/fetch",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        targets: [
          { project: "demo" },
          { project: "feature-project", worktreePath: "/tmp/feature" },
        ],
      }),
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        targets: [{ project: "feature-project", worktreePath: "/tmp/feature" }],
      }),
    });
    transport.destroy();
  });
});

describe("WsTransport explorer language scan endpoint", () => {
  it("maps a project name to the protected language-files route", async () => {
    installMockWebSocket();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ files: [], truncated: false, limit: 20_000 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    await transport.invoke("fs:languageFiles", { project: "demo project" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:4800/api/fs/language-files?project=demo+project",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET" });
    transport.destroy();
  });

  it("adds the selected worktree to filesystem REST queries", async () => {
    installMockWebSocket();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ files: [], truncated: false, limit: 20_000 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    await transport.invoke("fs:languageFiles", {
      project: "demo",
      worktreePath: "/tmp/demo-worktree",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:4800/api/fs/language-files?project=demo&worktreePath=%2Ftmp%2Fdemo-worktree",
    );
    transport.destroy();
  });
});

describe("WsTransport filesystem targets", () => {
  it("serializes a worktree target and keeps root-only payloads compatible", async () => {
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const socket = sockets[0];

    const targeted = transport.fsSubscribeTree(
      { project: "demo", worktreePath: "/tmp/demo-worktree" },
      "src",
    );
    const targetedMessage = JSON.parse(socket.sent[0]);
    expect(targetedMessage).toMatchObject({
      kind: "fs:subscribe_tree",
      project: "demo",
      worktree_path: "/tmp/demo-worktree",
      path: "src",
    });
    socket.onmessage?.({
      data: JSON.stringify({
        kind: "fs:tree_snapshot",
        req_id: targetedMessage.req_id,
        sub_id: 41,
        nodes: [],
      }),
    });
    await expect(targeted).resolves.toEqual({ sub_id: 41, nodes: [] });

    const root = transport.fsSubscribeTree("demo", "");
    const rootMessage = JSON.parse(socket.sent[1]);
    expect(rootMessage).not.toHaveProperty("worktree_path");
    socket.onmessage?.({
      data: JSON.stringify({
        kind: "fs:tree_snapshot",
        req_id: rootMessage.req_id,
        sub_id: 42,
        nodes: [],
      }),
    });
    await expect(root).resolves.toEqual({ sub_id: 42, nodes: [] });
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

describe("WsTransport typed API errors", () => {
  it("preserves status and code from a JSON error response", async () => {
    installMockWebSocket();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "Git is not initialized for this project",
            code: "GIT_NOT_INITIALIZED",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const transport = new WsTransport("http://localhost:4800");

    await expect(transport.invoke("git:roots", "demo")).rejects.toMatchObject({
      name: "ApiRequestError",
      message: "Git is not initialized for this project",
      status: 409,
      code: "GIT_NOT_INITIALIZED",
    } satisfies Partial<ApiRequestError>);
    transport.destroy();
  });

  it("does not send removed terminal-shaped setup fields", async () => {
    installMockWebSocket();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    await expect(
      transport.invoke("usage:configure", {
        enabled: true,
        terminalCorrelationEnabled: true,
      }),
    ).rejects.toThrow(
      "Unsupported usage setup field: terminalCorrelationEnabled",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    transport.destroy();
  });
});

describe("WsTransport profile credentials", () => {
  it("keeps the URL and token bound to its captured profile", async () => {
    installMockWebSocket();
    const createStorage = () => {
      const values = new Map<string, string>();
      return {
        get length() {
          return values.size;
        },
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      } as Storage;
    };
    vi.stubGlobal("localStorage", createStorage());
    vi.stubGlobal("sessionStorage", createStorage());
    setAuthToken("token-a", "profile-a");
    const transport = new WsTransport("http://a.test", "profile-a");
    setActiveProfile("profile-b");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await transport.invoke("workspace:status");

    expect(sockets[0].url).toContain("token-a");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://a.test/api/workspace/status",
      expect.objectContaining({
        headers: { Authorization: "Bearer token-a" },
      }),
    );
    transport.destroy();
  });
});

describe("WsTransport usage session endpoints", () => {
  it("maps list filters and encoded detail IDs to protected usage routes", async () => {
    installMockWebSocket();
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ sessions: [], nodes: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    await transport.invoke("usage:sessions", {
      from: 10,
      to: 20,
      model: "gpt-5.6-sol",
      limit: 50,
    });
    await transport.invoke("usage:session", { id: "session/id" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:4800/api/usage/sessions?from=10&to=20&model=gpt-5.6-sol&limit=50",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "http://localhost:4800/api/usage/sessions/session%2Fid",
    );
    transport.destroy();
  });

  it("rejects removed session filters before making a request", async () => {
    installMockWebSocket();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    await expect(
      transport.invoke("usage:sessions", { terminal: "legacy" }),
    ).rejects.toThrow("Unsupported usage session field: terminal");
    expect(fetchMock).not.toHaveBeenCalled();
    transport.destroy();
  });

  it("rejects stale detail and deletion fields before making a request", async () => {
    installMockWebSocket();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    await expect(
      transport.invoke("usage:session", {
        id: "session-id",
        terminal: "legacy",
      } as never),
    ).rejects.toThrow("Unsupported usage session detail field: terminal");
    await expect(
      transport.invoke("usage:deleteAll", {
        confirmation: "delete-usage-data",
        project: "legacy",
      } as never),
    ).rejects.toThrow("Unsupported usage deletion field: project");
    expect(fetchMock).not.toHaveBeenCalled();
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

describe("WsTransport workflow operations", () => {
  it("maps workflow:overview to GET /api/workflow/overview", async () => {
    installMockWebSocket();
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Response(
          JSON.stringify({ workspace: { id: "ws1", name: "ws" } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    await transport.invoke("workflow:overview");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:4800/api/workflow/overview",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET" });
    transport.destroy();
  });

  it("maps workflow:events with and without query params", async () => {
    installMockWebSocket();
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Response(JSON.stringify({ events: [], nextCursor: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    await transport.invoke("workflow:events");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:4800/api/workflow/events",
    );

    await transport.invoke("workflow:events", {
      cursor: "cur/sor",
      limit: 25,
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "http://localhost:4800/api/workflow/events?cursor=cur%2Fsor&limit=25",
    );
    transport.destroy();
  });

  it("maps workflow item operations (create, patch, delete)", async () => {
    installMockWebSocket();
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Response(
          JSON.stringify({
            resource: {},
            replayed: false,
            eventId: "e1",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    // Create
    await transport.invoke("workflow:createItem", {
      requestId: "r1",
      target: { project: "p1" },
      kind: "task",
      title: "Task 1",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:4800/api/workflow/items",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        requestId: "r1",
        target: { project: "p1" },
        kind: "task",
        title: "Task 1",
      }),
    });

    // Patch
    await transport.invoke("workflow:patchItem", {
      id: "item/1",
      requestId: "r2",
      updatedAt: "2026-09-02T10:00:00.000Z",
      title: "Updated",
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "http://localhost:4800/api/workflow/items/item%2F1",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({
        requestId: "r2",
        updatedAt: "2026-09-02T10:00:00.000Z",
        title: "Updated",
      }),
    });

    // Delete
    await transport.invoke("workflow:deleteItem", {
      id: "item/1",
      requestId: "r3",
      updatedAt: "2026-09-02T10:00:00.000Z",
    });
    expect(fetchMock.mock.calls[2][0]).toBe(
      "http://localhost:4800/api/workflow/items/item%2F1",
    );
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({
        requestId: "r3",
        updatedAt: "2026-09-02T10:00:00.000Z",
      }),
    });
    transport.destroy();
  });

  it("maps workflow session operations (create, end, abandon, link, unlink)", async () => {
    installMockWebSocket();
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Response(
          JSON.stringify({
            resource: {},
            replayed: false,
            eventId: "e1",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    // Create session
    await transport.invoke("workflow:createSession", {
      requestId: "r1",
      target: { project: "p1" },
      startedAt: "2026-09-02T10:00:00.000Z",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:4800/api/workflow/sessions",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });

    // End session
    await transport.invoke("workflow:endSession", {
      id: "sess/1",
      requestId: "r2",
      endedAt: "2026-09-02T11:00:00.000Z",
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "http://localhost:4800/api/workflow/sessions/sess%2F1/end",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        requestId: "r2",
        endedAt: "2026-09-02T11:00:00.000Z",
      }),
    });

    // Abandon session
    await transport.invoke("workflow:abandonSession", {
      id: "sess/1",
      requestId: "r3",
    });
    expect(fetchMock.mock.calls[2][0]).toBe(
      "http://localhost:4800/api/workflow/sessions/sess%2F1/abandon",
    );
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ requestId: "r3" }),
    });

    // Link resource
    await transport.invoke("workflow:linkResource", {
      sessionId: "sess/1",
      requestId: "r4",
      resourceType: "terminal",
      externalId: "term-1",
    });
    expect(fetchMock.mock.calls[3][0]).toBe(
      "http://localhost:4800/api/workflow/sessions/sess%2F1/links",
    );
    expect(fetchMock.mock.calls[3][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        requestId: "r4",
        resourceType: "terminal",
        externalId: "term-1",
      }),
    });

    // Unlink resource
    await transport.invoke("workflow:unlinkResource", {
      sessionId: "sess/1",
      requestId: "r5",
      updatedAt: "2026-09-02T10:00:00.000Z",
      resourceType: "terminal",
      externalId: "term-1",
    });
    expect(fetchMock.mock.calls[4][0]).toBe(
      "http://localhost:4800/api/workflow/sessions/sess%2F1/links",
    );
    expect(fetchMock.mock.calls[4][1]).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({
        requestId: "r5",
        updatedAt: "2026-09-02T10:00:00.000Z",
        resourceType: "terminal",
        externalId: "term-1",
      }),
    });
    transport.destroy();
  });

  it("maps workflow notes and purge operations", async () => {
    installMockWebSocket();
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Response(
          JSON.stringify({
            resource: {},
            replayed: false,
            eventId: "e1",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    // Create note
    await transport.invoke("workflow:createNote", {
      requestId: "r1",
      body: "My note",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:4800/api/workflow/notes",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ requestId: "r1", body: "My note" }),
    });

    // Delete note
    await transport.invoke("workflow:deleteNote", {
      id: "note/1",
      requestId: "r2",
      updatedAt: "2026-09-02T10:00:00.000Z",
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "http://localhost:4800/api/workflow/notes/note%2F1",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({
        requestId: "r2",
        updatedAt: "2026-09-02T10:00:00.000Z",
      }),
    });

    // Purge history
    await transport.invoke("workflow:purgeHistory", {
      requestId: "r3",
      before: "2026-09-02T10:00:00.000Z",
    });
    expect(fetchMock.mock.calls[2][0]).toBe(
      "http://localhost:4800/api/workflow/history",
    );
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({
        requestId: "r3",
        before: "2026-09-02T10:00:00.000Z",
      }),
    });
    transport.destroy();
  });
});
