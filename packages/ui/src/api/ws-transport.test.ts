import { afterEach, describe, expect, it, vi } from "vitest";
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
  vi.unstubAllGlobals();
});

describe("WsTransport terminalAttach", () => {
  it("sends from_offset when provided", () => {
    installMockWebSocket();
    const transport = new WsTransport("http://localhost:4800");
    const socket = sockets[0];

    transport.terminalAttach("session-1", 42);

    expect(JSON.parse(socket.sent[0])).toEqual({
      kind: "terminal:attach",
      id: "session-1",
      from_offset: 42,
    });
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
