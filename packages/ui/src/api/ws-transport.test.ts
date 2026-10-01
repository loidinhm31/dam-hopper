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
        incarnation: 0,
      }),
    });

    expect(received).toEqual([
      {
        data: "tail",
        offset: 1024,
        reset: true,
        truncated: true,
        incarnation: 0,
      },
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
describe("WsTransport git:log endpoint", () => {
  it("serializes log options and encodes query parameters safely", async () => {
    installMockWebSocket();
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    // 1. With all options and search query containing special characters
    await transport.invoke("git:log", {
      project: "my-project",
      worktreePath: "/tmp/worktree",
      limit: 200,
      offset: 0,
      ref: "refs/heads/main",
      root: "sub/root",
      messageQuery: " fix(auth): bug #123 & + % ? ",
    });

    const url1 = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url1.pathname).toBe("/api/git/my-project/log");
    expect(url1.searchParams.get("limit")).toBe("200");
    expect(url1.searchParams.get("offset")).toBe("0");
    expect(url1.searchParams.get("ref")).toBe("refs/heads/main");
    expect(url1.searchParams.get("worktreePath")).toBe("/tmp/worktree");
    expect(url1.searchParams.get("root")).toBe("sub/root");
    expect(url1.searchParams.get("messageQuery")).toBe("fix(auth): bug #123 & + % ?");

    // 2. Omits empty or whitespace-only messageQuery
    await transport.invoke("git:log", {
      project: "my-project",
      limit: 100,
      messageQuery: "   ",
    });
    const url2 = new URL(fetchMock.mock.calls[1][0] as string);
    expect(url2.pathname).toBe("/api/git/my-project/log");
    expect(url2.searchParams.get("limit")).toBe("100");
    expect(url2.searchParams.has("messageQuery")).toBe(false);

    // 3. Omits undefined messageQuery
    await transport.invoke("git:log", {
      project: "my-project",
    });
    const url3 = new URL(fetchMock.mock.calls[2][0] as string);
    expect(url3.pathname).toBe("/api/git/my-project/log");
    expect(url3.searchParams.has("messageQuery")).toBe(false);

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
        offset: 4,
        incarnation: 0,
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

    firstSocket.onmessage?.({
      data: JSON.stringify({
        kind: "terminal:output",
        id: "session-1",
        data: "tail",
        offset: 4,
        incarnation: 0,
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
        new Response(JSON.stringify({ workspace: { id: "ws1", name: "ws" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
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

  it("sanitizes target in workflow item and session requests by stripping profileId", async () => {
    installMockWebSocket();
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Response(
          JSON.stringify({
            resource: { id: "item-1" },
            replayed: false,
            eventId: "ev-1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    // Create item with profileId in target
    await transport.invoke("workflow:createItem", {
      requestId: "r1",
      target: {
        profileId: "66246e88-132d-4371-ba90-8dd10a9b0e4c",
        project: "evcrate",
      },
      kind: "plan",
      title: "New Plan",
      status: "backlog",
      parentId: null,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:4800/api/workflow/items",
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      requestId: "r1",
      target: { project: "evcrate" },
      kind: "plan",
      title: "New Plan",
      status: "backlog",
      parentId: null,
    });

    // Patch item with profileId and worktreePath in target
    await transport.invoke("workflow:patchItem", {
      id: "item/1",
      requestId: "r2",
      updatedAt: "2026-09-02T10:00:00.000Z",
      target: {
        profileId: "66246e88-132d-4371-ba90-8dd10a9b0e4c",
        project: "evcrate",
        worktreePath: "/worktrees/feat",
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      requestId: "r2",
      updatedAt: "2026-09-02T10:00:00.000Z",
      target: { project: "evcrate", worktreePath: "/worktrees/feat" },
    });

    // Create session with profileId in target
    await transport.invoke("workflow:createSession", {
      requestId: "r3",
      target: {
        profileId: "66246e88-132d-4371-ba90-8dd10a9b0e4c",
        project: "evcrate",
      },
      startedAt: "2026-09-02T10:00:00.000Z",
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      requestId: "r3",
      target: { project: "evcrate" },
      startedAt: "2026-09-02T10:00:00.000Z",
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
describe("WsTransport idle suspend endpoints", () => {
  it("maps status and updateTiming requests to versioned system API", async () => {
    installMockWebSocket();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version: 1, statusRevision: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version: 1, changed: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WsTransport("http://localhost:4800");

    await transport.invoke("system:idleSuspendStatus");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:4800/api/system/idle-suspend/v1/status",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "GET",
    });

    await transport.invoke("system:updateIdleSuspendTiming", {
      quietPeriodSeconds: 300,
      wakeAfterSeconds: 600,
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "http://localhost:4800/api/system/idle-suspend/v1/timing",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({
        quietPeriodSeconds: 300,
        wakeAfterSeconds: 600,
      }),
    });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          version: 1,
          requestId: "req-1",
          statusRevision: 5,
          state: "handedOff",
          wakeAfterSeconds: 0,
          forced: false,
          fleetSnapshot: {
            generation: 1,
            liveCount: 0,
            creatingCount: 0,
            restartPendingCount: 0,
            disposing: false,
            closing: false,
            handoffActive: true,
          },
        }),
        {
          status: 202,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await transport.invoke("system:forceSuspend", {
      wakeAfterSeconds: 0,
      force: false,
    });
    expect(fetchMock.mock.calls[2][0]).toBe(
      "http://localhost:4800/api/system/idle-suspend/v1/force-suspend",
    );
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        wakeAfterSeconds: 0,
        force: false,
      }),
    });
    expect(result).toMatchObject({
      version: 1,
      state: "handedOff",
      wakeAfterSeconds: 0,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "active fleet confirmation required",
          code: "idleSuspendActiveFleetConfirmationRequired",
          activeSessionCount: 2,
          fleetSnapshot: {
            generation: 2,
            liveCount: 2,
            creatingCount: 0,
            restartPendingCount: 0,
            disposing: false,
            closing: false,
            handoffActive: false,
          },
        }),
        {
          status: 409,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await expect(
      transport.invoke("system:forceSuspend", {
        wakeAfterSeconds: 0,
        force: false,
      }),
    ).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 409,
      code: "idleSuspendActiveFleetConfirmationRequired",
      details: {
        activeSessionCount: 2,
      },
    });
    transport.destroy();
  });
});

describe("WsTransport settings export/import", () => {
  it("requests workspace TOML export and receives raw text", async () => {
    const transport = new WsTransport("http://localhost:4800");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('[workspace]\nname = "ws"\n', {
        status: 200,
        headers: {
          "content-type": "application/toml; charset=utf-8",
          "content-disposition": 'attachment; filename="dam-hopper.toml"',
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await transport.invoke<string>("settings:export");
    expect(result).toBe('[workspace]\nname = "ws"\n');
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4800/api/settings/export/workspace.toml",
      expect.objectContaining({
        method: "GET",
      }),
    );
    transport.destroy();
  });

  it("posts raw TOML import with application/toml content type", async () => {
    const transport = new WsTransport("http://localhost:4800");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          imported: true,
          fileName: "dam-hopper.toml",
          backupFileName: "dam-hopper.toml.bak.123",
          workspaceName: "ws",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await transport.invoke<{ imported: boolean }>(
      "settings:import",
      '[workspace]\nname = "ws"\n',
    );
    expect(result).toEqual({
      imported: true,
      fileName: "dam-hopper.toml",
      backupFileName: "dam-hopper.toml.bak.123",
      workspaceName: "ws",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4800/api/settings/import/workspace.toml",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/toml; charset=utf-8",
        }),
        body: '[workspace]\nname = "ws"\n',
      }),
    );
    transport.destroy();
  });
});

describe("WsTransport terminal output and authoritative offsets", () => {
  it("dispatches live terminal data, authoritative offset, and incarnation to subscribers", () => {
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const socket = sockets[0];
    socket.onopen?.();

    const received: Array<{
      data: string;
      offset: number;
      incarnation: number;
    }> = [];
    const unsub = transport.onTerminalData(
      "term-1",
      (data, offset, incarnation) => {
        received.push({ data, offset, incarnation });
      },
    );

    socket.onmessage?.({
      data: JSON.stringify({
        kind: "terminal:output",
        id: "term-1",
        data: "chunk-1",
        offset: 7,
        incarnation: 1,
      }),
    });

    socket.onmessage?.({
      data: JSON.stringify({
        kind: "terminal:output",
        id: "term-1",
        data: "chunk-2",
        offset: 14,
        incarnation: 1,
      }),
    });

    expect(received).toEqual([
      { data: "chunk-1", offset: 7, incarnation: 1 },
      { data: "chunk-2", offset: 14, incarnation: 1 },
    ]);

    unsub();
    socket.onmessage?.({
      data: JSON.stringify({
        kind: "terminal:output",
        id: "term-1",
        data: "chunk-3",
        offset: 21,
        incarnation: 1,
      }),
    });
    expect(received).toHaveLength(2);
    transport.destroy();
  });

  it("strictly validates offset and incarnation in terminal:output", () => {
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const socket = sockets[0];
    socket.onopen?.();

    const received: Array<{ data: string; offset: number }> = [];
    transport.onTerminalData("term-strict", (data, offset) => {
      received.push({ data, offset });
    });

    diagCalls.length = 0;

    // Missing offset
    socket.onmessage?.({
      data: JSON.stringify({
        kind: "terminal:output",
        id: "term-strict",
        data: "no-offset",
        incarnation: 0,
      }),
    });

    expect(received).toHaveLength(0);
    expect(
      diagCalls.some(
        (c) =>
          c.message === "ws.dispatch_error" &&
          c.metadata?.kind === "terminal:output",
      ),
    ).toBe(true);

    diagCalls.length = 0;

    // Negative offset
    socket.onmessage?.({
      data: JSON.stringify({
        kind: "terminal:output",
        id: "term-strict",
        data: "negative",
        offset: -1,
        incarnation: 0,
      }),
    });

    expect(received).toHaveLength(0);
    expect(
      diagCalls.some(
        (c) =>
          c.message === "ws.dispatch_error" &&
          c.metadata?.kind === "terminal:output",
      ),
    ).toBe(true);

    diagCalls.length = 0;

    // Missing incarnation
    socket.onmessage?.({
      data: JSON.stringify({
        kind: "terminal:output",
        id: "term-strict",
        data: "no-incarnation",
        offset: 14,
      }),
    });

    expect(received).toHaveLength(0);
    expect(
      diagCalls.some(
        (c) =>
          c.message === "ws.dispatch_error" &&
          c.metadata?.kind === "terminal:output",
      ),
    ).toBe(true);

    diagCalls.length = 0;

    // Offset less than chunk byte length triggers terminal:lagged invalidation
    const laggedEvents: unknown[] = [];
    transport.onEvent("terminal:lagged", (payload) =>
      laggedEvents.push(payload),
    );

    socket.onmessage?.({
      data: JSON.stringify({
        kind: "terminal:output",
        id: "term-strict",
        data: "five!", // 5 bytes
        offset: 2, // invalid: offset < 5
        incarnation: 0,
      }),
    });

    expect(received).toHaveLength(0);
    expect(laggedEvents).toHaveLength(1);
    expect(laggedEvents[0]).toMatchObject({
      kind: "terminal:lagged",
      id: "term-strict",
      reason: "invalid_output_frame",
    });
    expect(
      diagCalls.some(
        (c) =>
          c.message === "ws.dispatch_error" &&
          c.metadata?.kind === "terminal:output",
      ),
    ).toBe(true);

    transport.destroy();
  });

  it("dispatches terminal:buffer with incarnation and strictly validates buffer incarnation", () => {
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const socket = sockets[0];
    socket.onopen?.();

    const buffers: Array<{
      data: string;
      offset: number;
      reset: boolean;
      truncated: boolean;
      incarnation: number;
    }> = [];
    transport.onTerminalBuffer!("term-buf", (buffer) => {
      buffers.push(buffer);
    });

    socket.onmessage?.({
      data: JSON.stringify({
        kind: "terminal:buffer",
        id: "term-buf",
        data: "snapshot-content",
        offset: 16,
        reset: true,
        truncated: false,
        incarnation: 3,
      }),
    });

    expect(buffers).toEqual([
      expect.objectContaining({
        data: "snapshot-content",
        offset: 16,
        incarnation: 3,
      }),
    ]);

    // Missing buffer incarnation triggers terminal:lagged invalidation
    const laggedEvents: unknown[] = [];
    transport.onEvent("terminal:lagged", (payload) =>
      laggedEvents.push(payload),
    );

    socket.onmessage?.({
      data: JSON.stringify({
        kind: "terminal:buffer",
        id: "term-buf",
        data: "corrupt-snapshot",
        offset: 16,
        reset: true,
        truncated: false,
      }),
    });

    expect(laggedEvents).toHaveLength(1);
    expect(laggedEvents[0]).toMatchObject({
      kind: "terminal:lagged",
      id: "term-buf",
      reason: "invalid_buffer_frame",
    });

    transport.destroy();
  });

  it("dispatches server terminal:lagged broadcast event via onEvent", () => {
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const socket = sockets[0];
    socket.onopen?.();

    const laggedEvents: unknown[] = [];
    transport.onEvent("terminal:lagged", (payload) =>
      laggedEvents.push(payload),
    );

    socket.onmessage?.({
      data: JSON.stringify({
        kind: "terminal:lagged",
        dropped: 42,
      }),
    });

    expect(laggedEvents).toEqual([{ kind: "terminal:lagged", dropped: 42 }]);
    transport.destroy();
  });
});

describe("WsTransport host-resource streaming (03-T)", () => {
  it("detects streaming capability on bound instance", () => {
    const transport = new WsTransport("http://localhost:4800");
    expect(transport.supportsHostResourceStreaming()).toBe(true);
    expect(transport.hasHostResourceStreamingCapability()).toBe(true);
    transport.destroy();
  });

  it("returns kind: stream on 200 with readable stream and close() cancels reader and aborts fetch", async () => {
    let cancelCalled = false;
    let fetchSignal: AbortSignal | undefined;

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": ping\n\n"));
      },
      cancel() {
        cancelCalled = true;
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        fetchSignal = init?.signal as AbortSignal;
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );

    const transport = new WsTransport({
      baseUrl: "http://localhost:4800",
      authToken: "test-token",
    });

    const result = await transport.openHostResourceEvents();
    expect(result.kind).toBe("stream");
    if (result.kind === "stream") {
      expect(result.response.status).toBe(200);
      expect(result.reader).toBeDefined();
      const chunk = await result.reader.read();
      expect(chunk.done).toBe(false);
      result.close();
      expect(cancelCalled).toBe(true);
      expect(fetchSignal?.aborted).toBe(true);
    }
    transport.destroy();
  });

  it("returns kind: unsupported when 200 response body is null or not readable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const resp = new Response(null, { status: 200 });
        Object.defineProperty(resp, "body", { value: null });
        return resp;
      }),
    );

    const transport = new WsTransport("http://localhost:4800");
    const result = await transport.openHostResourceEvents();
    expect(result.kind).toBe("unsupported");
    transport.destroy();
  });

  it("returns kind: finite on non-200 with parsed code and retry-after and bounds body to 4 KiB", async () => {
    const oversizePayload = JSON.stringify({
      code: "FRAME_TOO_LARGE",
      error: "X".repeat(5000),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(oversizePayload, {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "15",
          },
        });
      }),
    );

    const transport = new WsTransport("http://localhost:4800");
    const result = await transport.openHostResourceEvents();
    expect(result.kind).toBe("finite");
    if (result.kind === "finite") {
      expect(result.status).toBe(503);
      expect(result.code).toBe("FRAME_TOO_LARGE");
      expect(result.retryAfter).toBe("15");
    }
    transport.destroy();
  });

  it("triggers onDrop with 4403 for 401 MFA_REQUIRED on finite response", async () => {
    const drops: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ code: "MFA_REQUIRED" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const transport = new WsTransport({
      baseUrl: "http://localhost:4800",
      onDrop: (_t, info) => drops.push(info),
    });

    const result = await transport.openHostResourceEvents();
    expect(result.kind).toBe("finite");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({
      code: 4403,
      authCode: "MFA_REQUIRED",
      source: "sse",
    });
    transport.destroy();
  });

  it("triggers onDrop with 4401 for 401 AUTH_REQUIRED on finite response", async () => {
    const drops: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ code: "AUTH_REQUIRED" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const transport = new WsTransport({
      baseUrl: "http://localhost:4800",
      onDrop: (_t, info) => drops.push(info),
    });

    const result = await transport.openHostResourceEvents();
    expect(result.kind).toBe("finite");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({
      code: 4401,
      authCode: "AUTH_REQUIRED",
      source: "sse",
    });
    transport.destroy();
  });

  it("does NOT trigger onDrop on unknown 401 or 403", async () => {
    const drops: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ code: "UNKNOWN_REASON" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const transport = new WsTransport({
      baseUrl: "http://localhost:4800",
      onDrop: (_t, info) => drops.push(info),
    });

    const result = await transport.openHostResourceEvents();
    expect(result.kind).toBe("finite");
    expect(drops).toHaveLength(0);
    transport.destroy();
  });

  it("reportHostResourceErrorControl triggers onDrop and deduplicates", () => {
    const drops: unknown[] = [];
    const transport = new WsTransport({
      baseUrl: "http://localhost:4800",
      onDrop: (_t, info) => drops.push(info),
    });

    transport.reportHostResourceErrorControl("MFA_REQUIRED");
    transport.reportHostResourceErrorControl("MFA_REQUIRED");
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({
      code: 4403,
      authCode: "MFA_REQUIRED",
      source: "sse",
    });
    transport.destroy();
  });
});
