import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SemanticTransport } from "./semantic-transport.js";

class MockSemanticWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readonly sent: string[] = [];
  readonly url: string;
  readyState = MockSemanticWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  send(value: string): void {
    this.sent.push(value);
  }

  close(): void {
    this.readyState = MockSemanticWebSocket.CLOSED;
  }

  open(): void {
    this.readyState = MockSemanticWebSocket.OPEN;
    this.onopen?.();
  }

  message(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }

  disconnect(): void {
    this.readyState = MockSemanticWebSocket.CLOSED;
    this.onclose?.();
  }
}

const sockets: MockSemanticWebSocket[] = [];
const trust = {
  projectId: "project",
  trust: "trusted",
  canTransition: true,
  policyRevision: 1,
} as const;
const availability = [
  { descriptorId: "rust-analyzer", language: "rust", state: "ready" },
] as const;

function projectAck() {
  return {
    kind: "semantic:project",
    projectId: "project",
    workspaceGeneration: 1,
    trust,
    availability,
  };
}

function navigationRequest() {
  return {
    requestId: "request-1",
    documentVersion: 1,
    operation: "definition" as const,
    uri: {
      profileId: "profile",
      projectId: "project",
      path: "src/main.rs",
      language: "rust" as const,
    },
    position: { line: 0, character: 0 },
  };
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", MockSemanticWebSocket);
});

afterEach(() => {
  sockets.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SemanticTransport acknowledgement and reconnect fencing", () => {
  it("queues semantic work until project acknowledgement, then preserves order", () => {
    const transport = new SemanticTransport({
      baseUrl: "http://localhost:4800",
      profileId: "profile",
      token: "token",
    });
    const socket = sockets[0];
    transport.selectProject("project");
    socket.open();

    expect(JSON.parse(socket.sent[0]).kind).toBe("semantic:project");
    expect(transport.navigate(navigationRequest())).toBe(true);
    expect(transport.prewarm("project", "rust", 2)).toBe(true);
    expect(transport.resync("project")).toBe(true);
    expect(socket.sent).toHaveLength(1);

    socket.message(projectAck());

    expect(socket.sent.map((value) => JSON.parse(value).kind)).toEqual([
      "semantic:project",
      "semantic:navigate",
      "semantic:prewarm",
      "semantic:resync",
    ]);
    transport.destroy();
  });

  it("removes a cancelled queued navigation before reconnect flush", () => {
    const transport = new SemanticTransport({
      baseUrl: "http://localhost:4800",
      profileId: "profile",
      token: "token",
    });
    const socket = sockets[0];
    transport.selectProject("project");
    socket.open();
    expect(transport.navigate(navigationRequest())).toBe(true);
    expect(
      transport.cancel({ requestId: "request-1", documentVersion: 1 }),
    ).toBe(true);

    socket.message(projectAck());

    expect(socket.sent.map((value) => JSON.parse(value).kind)).toEqual([
      "semantic:project",
    ]);
    transport.destroy();
  });

  it("queues resync until acknowledgement when replay is requested early", () => {
    const transport = new SemanticTransport({
      baseUrl: "http://localhost:4800",
      profileId: "profile",
      token: "token",
    });
    const socket = sockets[0];
    transport.selectProject("project");
    socket.open();
    expect(transport.replayDocuments("project")).toBe(true);
    expect(socket.sent).toHaveLength(1);
    socket.message(projectAck());
    expect(socket.sent.map((value) => JSON.parse(value).kind)).toEqual([
      "semantic:project",
      "semantic:resync",
    ]);
    transport.destroy();
  });

  it("reopens queued documents after reconnect and a fresh project acknowledgement", () => {
    vi.useFakeTimers();
    const transport = new SemanticTransport({
      baseUrl: "http://localhost:4800",
      profileId: "profile",
      token: "token",
    });
    const first = sockets[0];
    transport.selectProject("project");
    first.open();
    first.message(projectAck());
    expect(
      transport.openDocument({
        kind: "semantic:document_open",
        uri: {
          profileId: "profile",
          projectId: "project",
          path: "src/main.rs",
          language: "rust",
        },
        documentVersion: 1,
        text: "fn main() {}",
      }),
    ).toBe(true);

    first.disconnect();
    expect(
      transport.openDocument({
        kind: "semantic:document_open",
        uri: {
          profileId: "profile",
          projectId: "project",
          path: "src/main.rs",
          language: "rust",
        },
        documentVersion: 2,
        text: 'fn main() { println!("x"); }',
      }),
    ).toBe(true);
    vi.advanceTimersByTime(1_000);

    const second = sockets[1];
    second.open();
    second.message(projectAck());

    expect(second.sent.map((value) => JSON.parse(value).kind)).toEqual([
      "semantic:project",
      "semantic:document_open",
    ]);
    expect(JSON.parse(second.sent[1]).documentVersion).toBe(2);
    transport.destroy();
  });
});
