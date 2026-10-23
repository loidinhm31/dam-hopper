import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SemanticClient,
  ADAPTIVE_SYNC_THRESHOLD_BYTES,
} from "./semantic-client.js";
import { SemanticModelRegistry } from "@/lib/semantic-model-uri.js";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.CONNECTING;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  sent: string[] = [];

  constructor(
    public url: string,
    public protocols?: string[],
  ) {
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1; // OPEN
      this.onopen?.();
    });
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  // Test helper to simulate receiving a message from server
  receive(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }

  // Find last sent message matching method
  lastSent(method: string) {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const msg = JSON.parse(this.sent[i]);
      if (msg.method === method) return msg;
    }
    return undefined;
  }
}

describe("SemanticClient", () => {
  let originalWebSocket: typeof WebSocket;
  let registry: SemanticModelRegistry;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    MockWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket =
      MockWebSocket as unknown as typeof WebSocket;
    registry = new SemanticModelRegistry();
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("completes full handshake lifecycle (attachTarget -> initialize -> initialized -> ready)", async () => {
    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      token: "test-token",
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      connectionGeneration: 1,
      targetGeneration: 1,
      registry,
    });

    const connectPromise = client.connect();

    // Wait for ws instance
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];

    // Wait for attachTarget request
    await vi.waitFor(() => {
      const attachMsg = ws.lastSent("damHopper/attachTarget");
      expect(attachMsg).toBeDefined();
      expect(attachMsg?.params.target.project).toBe("my-project");
      expect(attachMsg?.params.descriptor).toBe("typescript");
    });

    const attachReq = ws.lastSent("damHopper/attachTarget")!;
    ws.receive({
      jsonrpc: "2.0",
      id: attachReq.id,
      result: { targetId: "target-42", descriptor: "typescript" },
    });

    // Wait for initialize request
    await vi.waitFor(() => {
      const initMsg = ws.lastSent("initialize");
      expect(initMsg).toBeDefined();
    });

    const initReq = ws.lastSent("initialize")!;
    ws.receive({
      jsonrpc: "2.0",
      id: initReq.id,
      result: { capabilities: { textDocumentSync: 2 } },
    });

    // Wait for initialized notification
    await vi.waitFor(() => {
      const initializedNotif = ws.lastSent("initialized");
      expect(initializedNotif).toBeDefined();
    });

    await connectPromise;

    expect(client.getStatus()).toBe("ready");
    expect(client.getTargetId()).toBe("target-42");
  });

  it("handles single-kind adaptive sync (<64KB full vs >=64KB incremental)", async () => {
    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      connectionGeneration: 1,
      targetGeneration: 1,
      registry,
    });

    const connectPromise = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];

    // Auto-respond to handshake
    await vi.waitFor(() =>
      expect(ws.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("damHopper/attachTarget")!.id,
      result: { targetId: "target-42" },
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: { capabilities: {} },
    });
    await connectPromise;

    // Register a model
    const tabKey = "tab-editor-1";
    registry.registerModel({
      tabKey,
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      relativePath: "src/main.ts",
    });

    // Open document
    await client.notifyDidOpen(tabKey, "const x = 1;\n");
    const didOpenMsg = ws.lastSent("textDocument/didOpen");
    expect(didOpenMsg).toBeDefined();
    expect(didOpenMsg?.params.textDocument.uri).toBe(
      "dam-hopper://semantic/target-42/src/main.ts",
    );
    expect(didOpenMsg?.params.textDocument.version).toBe(1);

    // Edit 1: Small edit (< 64 KiB) -> range-less full replacement
    const smallContent = "const x = 2;\n";
    await client.notifyDidChange(tabKey, smallContent, {
      range: {
        start: { line: 0, character: 10 },
        end: { line: 0, character: 11 },
      },
      rangeLength: 1,
      text: "2",
    });

    const change1 = ws.lastSent("textDocument/didChange");
    expect(change1?.params.textDocument.version).toBe(2);
    expect(change1?.params.contentChanges).toEqual([{ text: smallContent }]);

    // Edit 2: Large edit (>= 64 KiB) -> incremental edit with range
    const largeContent = "a".repeat(ADAPTIVE_SYNC_THRESHOLD_BYTES + 100);
    await client.notifyDidChange(tabKey, largeContent, {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      rangeLength: 1,
      text: "b",
    });

    const change2 = ws.lastSent("textDocument/didChange");
    expect(change2?.params.textDocument.version).toBe(3);
    expect(change2?.params.contentChanges).toEqual([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        rangeLength: 1,
        text: "b",
      },
    ]);
  });

  it("sends definition query with damHopperDocumentVersion and normalizes result", async () => {
    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      connectionGeneration: 1,
      targetGeneration: 1,
      registry,
    });

    const connectPromise = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];

    await vi.waitFor(() =>
      expect(ws.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("damHopper/attachTarget")!.id,
      result: { targetId: "target-42" },
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: { capabilities: {} },
    });
    await connectPromise;

    const tabKey = "tab-editor-1";
    registry.registerModel({
      tabKey,
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      relativePath: "src/main.ts",
    });

    await client.notifyDidOpen(tabKey, "const a = 10;");

    const defPromise = client.getDefinition(tabKey, { line: 0, character: 6 });

    await vi.waitFor(() =>
      expect(ws.lastSent("textDocument/definition")).toBeDefined(),
    );
    const defReq = ws.lastSent("textDocument/definition")!;
    expect(defReq.params.damHopperDocumentVersion).toBe(1);
    expect(defReq.params.position).toEqual({ line: 0, character: 6 });

    // Respond with location
    ws.receive({
      jsonrpc: "2.0",
      id: defReq.id,
      result: [
        {
          uri: "dam-hopper://semantic/target-42/src/other.ts",
          range: {
            start: { line: 5, character: 0 },
            end: { line: 5, character: 10 },
          },
        },
      ],
    });

    const result = await defPromise;
    expect(result.locations.length).toBe(1);
    expect(result.locations[0].uri).toBe(
      "dam-hopper://semantic/target-42/src/other.ts",
    );
    expect(result.outsideTarget).toBeUndefined();
  });

  it("handles cancellation via $/cancelRequest", async () => {
    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      connectionGeneration: 1,
      targetGeneration: 1,
      registry,
    });

    const connectPromise = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];

    await vi.waitFor(() =>
      expect(ws.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("damHopper/attachTarget")!.id,
      result: { targetId: "target-42" },
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: { capabilities: {} },
    });
    await connectPromise;

    const tabKey = "tab-editor-1";
    registry.registerModel({
      tabKey,
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      relativePath: "src/main.ts",
    });
    await client.notifyDidOpen(tabKey, "const a = 10;");

    let cancelCb: (() => void) | null = null;
    const cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: (cb: () => void) => {
        cancelCb = cb;
      },
    };

    const defPromise = client.getDefinition(
      tabKey,
      { line: 0, character: 6 },
      cancellationToken,
    );

    await vi.waitFor(() =>
      expect(ws.lastSent("textDocument/definition")).toBeDefined(),
    );
    const defReq = ws.lastSent("textDocument/definition")!;

    // Trigger cancellation
    cancelCb?.();

    await vi.waitFor(() => {
      const cancelNotif = ws.lastSent("$/cancelRequest");
      expect(cancelNotif).toBeDefined();
      expect(cancelNotif?.params.id).toBe(defReq.id);
    });

    // Server responds with -32800 cancelled
    ws.receive({
      jsonrpc: "2.0",
      id: defReq.id,
      error: { code: -32800, message: "Request cancelled" },
    });

    const res = await defPromise;
    expect(res.locations).toEqual([]);
  });

  it("auto-replies to workspace/configuration server requests", async () => {
    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      connectionGeneration: 1,
      targetGeneration: 1,
      registry,
    });

    const connectPromise = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];

    await vi.waitFor(() =>
      expect(ws.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("damHopper/attachTarget")!.id,
      result: { targetId: "target-42" },
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: { capabilities: {} },
    });
    await connectPromise;

    // Server sends workspace/configuration with 2 items
    ws.receive({
      jsonrpc: "2.0",
      id: 999,
      method: "workspace/configuration",
      params: { items: [{ section: "typescript" }, { section: "javascript" }] },
    });

    await vi.waitFor(() => {
      const reply = ws.sent.map((s) => JSON.parse(s)).find((m) => m.id === 999);
      expect(reply).toBeDefined();
      expect(reply?.result).toEqual([{}, {}]);
    });
  });
  it("cancels pending navigation locally and sends $/cancelRequest", async () => {
    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      connectionGeneration: 1,
      targetGeneration: 1,
      registry,
    });

    const connectPromise = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];

    await vi.waitFor(() =>
      expect(ws.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("damHopper/attachTarget")!.id,
      result: { targetId: "target-42" },
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: { capabilities: {} },
    });
    await connectPromise;

    const tabKey = "tab-editor-cancel";
    registry.registerModel({
      tabKey,
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      relativePath: "src/cancel.ts",
    });
    await client.notifyDidOpen(tabKey, "const x = 1;");

    let cancelCb: (() => void) | null = null;
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: (cb: () => void) => {
        cancelCb = cb;
      },
    };

    const queryPromise = client.getDefinition(
      tabKey,
      { line: 0, character: 6 },
      token,
    );

    await vi.waitFor(() =>
      expect(ws.lastSent("textDocument/definition")).toBeDefined(),
    );
    const reqId = ws.lastSent("textDocument/definition")!.id;

    // Trigger cancellation
    cancelCb?.();

    // Query resolves immediately with empty locations
    const res = await queryPromise;
    expect(res).toEqual({ locations: [] });

    // $/cancelRequest was sent
    const cancelNotif = ws.lastSent("$/cancelRequest");
    expect(cancelNotif?.params).toEqual({ id: reqId });

    // Late response arriving after cancellation does not throw or mutate
    ws.receive({
      jsonrpc: "2.0",
      id: reqId,
      result: [{ uri: "dam-hopper://semantic/target-42/src/cancel.ts", range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } } }],
    });
  });

  it("triggers full resync on version divergence (RPC error -32003)", async () => {
    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      connectionGeneration: 1,
      targetGeneration: 1,
      getModelText: () => "const full = 'recovered';",
      registry,
    });

    const connectPromise = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];

    await vi.waitFor(() =>
      expect(ws.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("damHopper/attachTarget")!.id,
      result: { targetId: "target-42" },
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: { capabilities: {} },
    });
    await connectPromise;

    const tabKey = "tab-resync-1";
    registry.registerModel({
      tabKey,
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      relativePath: "src/resync.ts",
    });
    await client.notifyDidOpen(tabKey, "const initial = 1;");

    const queryPromise = client.getDefinition(tabKey, { line: 0, character: 6 });
    await vi.waitFor(() =>
      expect(ws.lastSent("textDocument/definition")).toBeDefined(),
    );
    const reqId = ws.lastSent("textDocument/definition")!.id;

    // Server answers with -32003 (StaleDocumentVersion / Version divergence)
    ws.receive({
      jsonrpc: "2.0",
      id: reqId,
      error: { code: -32003, message: "Stale document version" },
    });

    const result = await queryPromise;
    expect(result).toEqual({ locations: [] });

    // Verify client sent full didChange resync
    await vi.waitFor(() => {
      const didChange = ws.lastSent("textDocument/didChange");
      expect(didChange).toBeDefined();
      expect(didChange?.params.contentChanges).toEqual([
        { text: "const full = 'recovered';" },
      ]);
    });

    // Query again post-resync to prove navigation remains alive (C-1 fix)
    const query2Promise = client.getDefinition(tabKey, { line: 0, character: 6 });
    await vi.waitFor(() => {
      const defMsg = ws.lastSent("textDocument/definition");
      expect(defMsg?.id).not.toBe(reqId);
    });
    const req2Id = ws.lastSent("textDocument/definition")!.id;
    ws.receive({
      jsonrpc: "2.0",
      id: req2Id,
      result: [
        {
          uri: "dam-hopper://semantic/target-42/src/resync.ts",
          range: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 10 },
          },
        },
      ],
    });
    const result2 = await query2Promise;
    expect(result2.locations.length).toBe(1);
  });

  it("handles server admission invalidation (-32005) by resetting connection state (C-2)", async () => {
    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      connectionGeneration: 1,
      targetGeneration: 1,
      registry,
    });

    const connectPromise = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];

    await vi.waitFor(() =>
      expect(ws.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("damHopper/attachTarget")!.id,
      result: { targetId: "target-42" },
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: { capabilities: {} },
    });
    await connectPromise;

    const tabKey = "tab-inval-1";
    registry.registerModel({
      tabKey,
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      relativePath: "src/inval.ts",
    });
    await client.notifyDidOpen(tabKey, "const a = 1;");

    const queryPromise = client.getDefinition(tabKey, { line: 0, character: 6 });
    await vi.waitFor(() =>
      expect(ws.lastSent("textDocument/definition")).toBeDefined(),
    );
    const reqId = ws.lastSent("textDocument/definition")!.id;

    // Server returns -32005 (auth / admission invalidated)
    ws.receive({
      jsonrpc: "2.0",
      id: reqId,
      error: { code: -32005, message: "Admission epoch invalidated" },
    });

    const result = await queryPromise;
    expect(result).toEqual({ locations: [] });
    expect(client.getStatus()).toBe("disconnected");
    client.disconnect();
  });
});
