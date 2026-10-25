import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SemanticClient,
  computeUtf8Sha256HexSync,
  type SemanticNegotiatedPolicy,
  type SemanticProvenance,
} from "./semantic-client.js";
import { SemanticModelRegistry } from "@/lib/semantic-model-uri.js";

const authority = vi.hoisted(() => ({ current: {
  serverUrl: "http://127.0.0.1:4803", configuredRoot: "/fixture", actor: "no-auth",
} }));
vi.mock("@/lib/semantic-model-uri.js", async () => ({
  ...await vi.importActual<typeof import("@/lib/semantic-model-uri.js")>("@/lib/semantic-model-uri.js"),
  captureSemanticProvenance: () => authority.current,
}));

const TEST_PROVENANCE: SemanticProvenance = {
  serverUrl: "http://127.0.0.1:4803",
  configuredRoot: "/fixture",
  actor: "no-auth",
};

const WIRE_POLICY: SemanticNegotiatedPolicy = {
  version: "1.0.0",
  adaptiveSyncThresholdBytes: 65536,
  maxDocumentBytes: 1048576,
  maxOpenDocuments: 16,
  maxSessionOverlayBytes: 4194304,
  maxInFlightRequests: 8,
};

function makeAttachResult(
  targetId: string,
  policy: SemanticNegotiatedPolicy = WIRE_POLICY,
) {
  return {
    targetId,
    descriptor: "typescript",
    resourcePolicyVersion: policy.version,
    adaptiveSyncThresholdBytes: policy.adaptiveSyncThresholdBytes,
    maxDocumentBytes: policy.maxDocumentBytes,
    maxOpenDocuments: policy.maxOpenDocuments,
    maxSessionOverlayBytes: policy.maxSessionOverlayBytes,
    maxInFlightRequests: policy.maxInFlightRequests,
  };
}

function makeInitializeResult(
  policy: SemanticNegotiatedPolicy = WIRE_POLICY,
) {
  return {
    capabilities: {
      textDocumentSync: 2,
      definitionProvider: true,
      implementationProvider: true,
      experimental: {
        damHopperAdaptiveSync: {
          version: policy.version,
          thresholdBytes: policy.adaptiveSyncThresholdBytes,
          maxDocumentBytes: policy.maxDocumentBytes,
          maxOpenDocuments: policy.maxOpenDocuments,
          maxSessionOverlayBytes: policy.maxSessionOverlayBytes,
          maxInFlightRequests: policy.maxInFlightRequests,
        },
      },
    },
  };
}
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
  static deferClose = false;
  static deferOpen = false;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  sent: string[] = [];

  constructor(
    public url: string,
    public protocols?: string[],
  ) {
    MockWebSocket.instances.push(this);
    if (!MockWebSocket.deferOpen) {
      queueMicrotask(() => {
        this.readyState = 1; // OPEN
        this.onopen?.();
      });
    }
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    if (MockWebSocket.deferClose) {
      this.readyState = 2; // CLOSING
      return;
    }
    this.readyState = 3; // CLOSED
    this.onclose?.({ code, reason } as unknown as CloseEvent);
  }

  triggerOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  triggerClose() {
    this.readyState = 3;
    this.onclose?.();
  }

  triggerError(err: unknown = new Error("socket error")) {
    this.onerror?.(err);
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
    authority.current = { ...TEST_PROVENANCE };
    originalWebSocket = globalThis.WebSocket;
    MockWebSocket.instances = [];
    MockWebSocket.deferClose = false;
    MockWebSocket.deferOpen = false;
    Object.defineProperty(globalThis, "WebSocket", {
      value: MockWebSocket,
      configurable: true,
      writable: true,
    });
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
    expect(client.getNegotiatedPolicy()).toEqual({
      version: "",
      adaptiveSyncThresholdBytes: 0,
      maxDocumentBytes: 0,
      maxOpenDocuments: 0,
      maxSessionOverlayBytes: 0,
      maxInFlightRequests: 0,
    });
    expect(client.getAdaptiveSyncThresholdBytes()).toBe(0);

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
      result: makeAttachResult("target-42", WIRE_POLICY),
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
      result: makeInitializeResult(WIRE_POLICY),
    });

    // Wait for initialized notification
    await vi.waitFor(() => {
      const initializedNotif = ws.lastSent("initialized");
      expect(initializedNotif).toBeDefined();
    });

    await connectPromise;

    expect(client.getStatus()).toBe("ready");
    expect(client.getTargetId()).toBe("target-42");
    expect(client.getNegotiatedPolicy()).toEqual(WIRE_POLICY);
  });

  it("handles single-kind adaptive sync (< negotiated threshold full vs >= negotiated threshold incremental)", async () => {
    const negotiatedPolicy: SemanticNegotiatedPolicy = {
      ...WIRE_POLICY,
      adaptiveSyncThresholdBytes: 4096,
    };
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
      result: makeAttachResult("target-42", negotiatedPolicy),
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: makeInitializeResult(negotiatedPolicy),
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
      provenance: TEST_PROVENANCE,
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

    // Edit 2: Large edit (>= negotiated threshold) -> incremental edit with range
    const largeContent = "a".repeat(
      negotiatedPolicy.adaptiveSyncThresholdBytes + 100,
    );
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
      result: makeAttachResult("target-42"),
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: makeInitializeResult(),
    });
    await connectPromise;

    const tabKey = "tab-editor-1";
    registry.registerModel({
      tabKey,
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      relativePath: "src/main.ts",
      provenance: TEST_PROVENANCE,
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
      result: makeAttachResult("target-42"),
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: makeInitializeResult(),
    });
    await connectPromise;

    const tabKey = "tab-editor-1";
    registry.registerModel({
      tabKey,
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      relativePath: "src/main.ts",
      provenance: TEST_PROVENANCE,
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
      result: makeAttachResult("target-42"),
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: makeInitializeResult(),
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
      result: makeAttachResult("target-42"),
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: makeInitializeResult(),
    });
    await connectPromise;

    const tabKey = "tab-editor-cancel";
    registry.registerModel({
      tabKey,
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      relativePath: "src/cancel.ts",
      provenance: TEST_PROVENANCE,
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
      result: makeAttachResult("target-42"),
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: makeInitializeResult(),
    });
    await connectPromise;

    const tabKey = "tab-resync-1";
    registry.registerModel({
      tabKey,
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      relativePath: "src/resync.ts",
      provenance: TEST_PROVENANCE,
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
      result: makeAttachResult("target-42"),
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: makeInitializeResult(),
    });
    await connectPromise;

    const tabKey = "tab-inval-1";
    registry.registerModel({
      tabKey,
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      relativePath: "src/inval.ts",
      provenance: TEST_PROVENANCE,
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

  it("attaches worktree target using target.worktreePath without legacy worktree alias (R2)", async () => {
    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      profileId: "test-profile",
      project: "my-project",
      worktreePath: "worktrees/feat-branch",
      targetKey: "worktree:worktrees/feat-branch",
      connectionGeneration: 1,
      targetGeneration: 1,
      provenance: TEST_PROVENANCE,
      registry,
    });

    const connectPromise = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];

    await vi.waitFor(() =>
      expect(ws.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    const attachMsg = ws.lastSent("damHopper/attachTarget")!;
    expect(attachMsg.params.target).toEqual({
      project: "my-project",
      worktreePath: "worktrees/feat-branch",
    });
    expect("worktree" in attachMsg.params.target).toBe(false);

    ws.receive({
      jsonrpc: "2.0",
      id: attachMsg.id,
      result: makeAttachResult("worktree:worktrees/feat-branch"),
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: makeInitializeResult(),
    });
    await connectPromise;
    expect(client.getStatus()).toBe("ready");
  });

  it("settles rejected handshake deterministically under async browser close and isolates replacement attempt B from retired attempt A callbacks (W2)", async () => {
    MockWebSocket.deferClose = true;
    const statusHistory: string[] = [];
    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      profileId: "test-profile",
      project: "my-project",
      targetKey: "root",
      connectionGeneration: 1,
      targetGeneration: 1,
      provenance: TEST_PROVENANCE,
      registry,
      onStatusChange: (s) => statusHistory.push(s),
    });

    // 1. Handshake failure with async close must still settle (reject) connect()
    const connect1 = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws1 = MockWebSocket.instances[0];
    await vi.waitFor(() =>
      expect(ws1.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws1.receive({
      jsonrpc: "2.0",
      id: ws1.lastSent("damHopper/attachTarget")!.id,
      error: { code: -32001, message: "Target not found" },
    });

    await expect(connect1).rejects.toMatchObject({
      code: -32001,
      message: "Target not found",
    });
    expect(client.getStatus()).toBe("error");

    // Delayed browser onclose on ws1 must NOT overwrite "error" status
    ws1.triggerClose();
    expect(client.getStatus()).toBe("error");

    // 2. Start Attempt A, then supersede with disconnect() + Attempt B reaching ready
    const connectA = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(2));
    const wsA = MockWebSocket.instances[1];
    await vi.waitFor(() =>
      expect(wsA.lastSent("damHopper/attachTarget")).toBeDefined(),
    );

    // Retire Attempt A before attachTarget replies; connectA must reject immediately
    client.disconnect();
    await expect(connectA).rejects.toThrow(/disconnected|closed/i);

    // Start Attempt B and bring it to ready with a bound model
    const tabKey = "tab-w2";
    registry.registerModel({
      tabKey,
      profileId: "test-profile",
      project: "my-project",
      targetKey: "root",
      relativePath: "src/w2.ts",
      provenance: TEST_PROVENANCE,
    });

    const connectB = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(3));
    const wsB = MockWebSocket.instances[2];
    await vi.waitFor(() =>
      expect(wsB.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    wsB.receive({
      jsonrpc: "2.0",
      id: wsB.lastSent("damHopper/attachTarget")!.id,
      result: makeAttachResult("target-b"),
    });
    await vi.waitFor(() => expect(wsB.lastSent("initialize")).toBeDefined());
    wsB.receive({
      jsonrpc: "2.0",
      id: wsB.lastSent("initialize")!.id,
      result: makeInitializeResult(),
    });
    await connectB;
    expect(client.getStatus()).toBe("ready");
    expect(client.getTargetId()).toBe("target-b");
    expect(registry.getByTabKey(tabKey)?.wireBinding?.targetId).toBe("target-b");

    // Now fire delayed error/response/close callbacks on retired socket wsA
    wsA.receive({
      jsonrpc: "2.0",
      id: wsA.lastSent("damHopper/attachTarget")!.id,
      error: { code: -32000, message: "Delayed A error" },
    });
    wsA.triggerError(new Error("Delayed A socket error"));
    wsA.triggerClose();

    // Replacement Attempt B must remain ready, open, and bound!
    expect(client.getStatus()).toBe("ready");
    expect(client.getTargetId()).toBe("target-b");
    expect(wsB.readyState).toBe(MockWebSocket.OPEN);
    expect(registry.getByTabKey(tabKey)?.wireBinding?.targetId).toBe("target-b");
  });

  it("denies foreign endpoint/root/actor and labels-only models without reading draft text, while replaying matching provenance on reconnect (R1)", async () => {
    const baseProv: SemanticProvenance = {
      serverUrl: "http://127.0.0.1:4803",
      configuredRoot: "/workspace/proj-a",
      actor: "basic:alice:tok-alice",
    };
    authority.current = baseProv;

    // Register 5 models sharing identical profileId/project/targetKey labels:
    // 1. Matching provenance
    registry.registerModel({
      tabKey: "tab-matching",
      profileId: "prof-1",
      project: "proj-a",
      targetKey: "root",
      relativePath: "src/matching.ts",
      provenance: baseProv,
    });
    // 2. Labels-only (unknown provenance = null)
    registry.registerModel({
      tabKey: "tab-labels-only",
      profileId: "prof-1",
      project: "proj-a",
      targetKey: "root",
      relativePath: "src/labels-only.ts",
      provenance: null,
    });
    // 3. Different endpoint serverUrl
    registry.registerModel({
      tabKey: "tab-foreign-endpoint",
      profileId: "prof-1",
      project: "proj-a",
      targetKey: "root",
      relativePath: "src/foreign-endpoint.ts",
      provenance: { ...baseProv, serverUrl: "http://127.0.0.1:4899" },
    });
    // 4. Different configuredRoot
    registry.registerModel({
      tabKey: "tab-foreign-root",
      profileId: "prof-1",
      project: "proj-a",
      targetKey: "root",
      relativePath: "src/foreign-root.ts",
      provenance: { ...baseProv, configuredRoot: "/workspace/other-root" },
    });
    // 5. Different actor
    registry.registerModel({
      tabKey: "tab-foreign-actor",
      profileId: "prof-1",
      project: "proj-a",
      targetKey: "root",
      relativePath: "src/foreign-actor.ts",
      provenance: { ...baseProv, actor: "basic:bob:tok-bob" },
    });

    const readKeys: string[] = [];
    const getModelText = vi.fn((key: string) => {
      readKeys.push(key);
      return `// dirty content for ${key}`;
    });

    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      serverUrl: "http://127.0.0.1:4803",
      profileId: "prof-1",
      project: "proj-a",
      targetKey: "root",
      connectionGeneration: 1,
      targetGeneration: 1,
      provenance: baseProv,
      getModelText,
      registry,
    });

    expect(client.canAccessModel("tab-matching")).toBe(true);
    expect(client.canAccessModel("tab-labels-only")).toBe(false);
    expect(client.canAccessModel("tab-foreign-endpoint")).toBe(false);
    expect(client.canAccessModel("tab-foreign-root")).toBe(false);
    expect(client.canAccessModel("tab-foreign-actor")).toBe(false);

    // Connect Session 1
    const connect1 = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws1 = MockWebSocket.instances[0];
    await vi.waitFor(() =>
      expect(ws1.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws1.receive({
      jsonrpc: "2.0",
      id: ws1.lastSent("damHopper/attachTarget")!.id,
      result: makeAttachResult("target-s1"),
    });
    await vi.waitFor(() => expect(ws1.lastSent("initialize")).toBeDefined());
    ws1.receive({
      jsonrpc: "2.0",
      id: ws1.lastSent("initialize")!.id,
      result: makeInitializeResult(),
    });
    await connect1;

    // Only tab-matching was read and replayed! Foreign/labels-only drafts were NEVER read!
    expect(readKeys).toEqual(["tab-matching"]);
    const didOpens1 = ws1.sent
      .map((s) => JSON.parse(s))
      .filter((m) => m.method === "textDocument/didOpen");
    expect(didOpens1).toHaveLength(1);
    expect(didOpens1[0].params.textDocument.uri).toBe(
      "dam-hopper://semantic/target-s1/src/matching.ts",
    );
    expect(didOpens1[0].params.textDocument.text).toBe(
      "// dirty content for tab-matching",
    );

    // Direct notifyDidOpen / notifyDidChange on denied models are no-ops
    await client.notifyDidOpen("tab-foreign-endpoint", "secret");
    const ver = await client.notifyDidChange("tab-foreign-actor", "secret");
    expect(ver).toBe(0);
    expect(registry.getByTabKey("tab-foreign-endpoint")?.wireBinding).toBeNull();

    // Disconnect and reconnect same binding (Session 2 with new targetId):
    // Local model incarnation is preserved (1) and dirty text is replayed onto new wire URI
    client.disconnect();
    const connect2 = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(2));
    const ws2 = MockWebSocket.instances[1];
    await vi.waitFor(() =>
      expect(ws2.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws2.receive({
      jsonrpc: "2.0",
      id: ws2.lastSent("damHopper/attachTarget")!.id,
      result: makeAttachResult("target-s2"),
    });
    await vi.waitFor(() => expect(ws2.lastSent("initialize")).toBeDefined());
    ws2.receive({
      jsonrpc: "2.0",
      id: ws2.lastSent("initialize")!.id,
      result: makeInitializeResult(),
    });
    await connect2;

    const matchingModel = registry.getByTabKey("tab-matching")!;
    expect(matchingModel.identity.incarnation).toBe(1);
    expect(matchingModel.wireBinding?.targetId).toBe("target-s2");
    expect(matchingModel.wireBinding?.sessionGeneration).toBe(2);
    expect(readKeys).toEqual(["tab-matching", "tab-matching"]);
  });

  it("rejects missing, malformed, aliased, or disagreeing server policies before replay or admission", async () => {
    const tabKey = "tab-policy-guard";
    registry.registerModel({
      tabKey,
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      relativePath: "src/policy.ts",
      provenance: TEST_PROVENANCE,
    });
    const getModelText = vi.fn(() => "export const draft = 1;\n");

    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      connectionGeneration: 1,
      targetGeneration: 1,
      provenance: TEST_PROVENANCE,
      getModelText,
      registry,
    });

    // Pre-handshake defaults are bounded and inert (0), never 64 KiB
    expect(client.getNegotiatedPolicy()).toEqual({
      version: "",
      adaptiveSyncThresholdBytes: 0,
      maxDocumentBytes: 0,
      maxOpenDocuments: 0,
      maxSessionOverlayBytes: 0,
      maxInFlightRequests: 0,
    });
    await client.notifyDidOpen(tabKey, "");
    expect(await client.notifyDidChange(tabKey, "")).toBe(0);
    expect(registry.getByTabKey(tabKey)?.wireBinding).toBeNull();

    // 1. Missing attachTarget policy fields -> fails before initialize or replay
    const connectMissingAttach = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws1 = MockWebSocket.instances[0];
    await vi.waitFor(() =>
      expect(ws1.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws1.receive({
      jsonrpc: "2.0",
      id: ws1.lastSent("damHopper/attachTarget")!.id,
      result: { targetId: "target-42", descriptor: "typescript" },
    });
    await expect(connectMissingAttach).rejects.toThrow(
      /Invalid attachTarget response: missing or malformed resource policy/i,
    );
    expect(ws1.lastSent("initialize")).toBeUndefined();
    expect(ws1.lastSent("initialized")).toBeUndefined();
    expect(getModelText).not.toHaveBeenCalled();
    expect(client.getAdaptiveSyncThresholdBytes()).toBe(0);

    // 2. Malformed attachTarget policy (non-positive threshold) -> fails before initialize
    const connectBadAttach = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(2));
    const ws2 = MockWebSocket.instances[1];
    await vi.waitFor(() =>
      expect(ws2.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws2.receive({
      jsonrpc: "2.0",
      id: ws2.lastSent("damHopper/attachTarget")!.id,
      result: {
        ...makeAttachResult("target-42"),
        adaptiveSyncThresholdBytes: 0,
      },
    });
    await expect(connectBadAttach).rejects.toThrow(
      /Invalid attachTarget response: missing or malformed resource policy/i,
    );
    expect(ws2.lastSent("initialize")).toBeUndefined();
    expect(getModelText).not.toHaveBeenCalled();

    // 3. Obsolete alias on attachTarget (thresholdBytes instead of adaptiveSyncThresholdBytes) -> rejected
    const connectAliasAttach = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(3));
    const ws3 = MockWebSocket.instances[2];
    await vi.waitFor(() =>
      expect(ws3.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws3.receive({
      jsonrpc: "2.0",
      id: ws3.lastSent("damHopper/attachTarget")!.id,
      result: {
        ...makeAttachResult("target-42"),
        thresholdBytes: 65536,
      },
    });
    await expect(connectAliasAttach).rejects.toThrow(
      /Invalid attachTarget response: unexpected policy field alias/i,
    );
    expect(ws3.lastSent("initialize")).toBeUndefined();

    // 4. Missing experimental.damHopperAdaptiveSync on initialize -> fails before initialized/replay
    const connectMissingInit = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(4));
    const ws4 = MockWebSocket.instances[3];
    await vi.waitFor(() =>
      expect(ws4.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws4.receive({
      jsonrpc: "2.0",
      id: ws4.lastSent("damHopper/attachTarget")!.id,
      result: makeAttachResult("target-42"),
    });
    await vi.waitFor(() => expect(ws4.lastSent("initialize")).toBeDefined());
    ws4.receive({
      jsonrpc: "2.0",
      id: ws4.lastSent("initialize")!.id,
      result: { capabilities: { textDocumentSync: 2 } },
    });
    await expect(connectMissingInit).rejects.toThrow(
      /Invalid initialize response: missing experimental\.damHopperAdaptiveSync policy/i,
    );
    expect(ws4.lastSent("initialized")).toBeUndefined();
    expect(getModelText).not.toHaveBeenCalled();
    expect(client.getAdaptiveSyncThresholdBytes()).toBe(0);

    // 5. Obsolete alias adaptiveSyncThresholdBytes in initialize damHopperAdaptiveSync -> rejected
    const connectAliasInit = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(5));
    const ws5 = MockWebSocket.instances[4];
    await vi.waitFor(() =>
      expect(ws5.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws5.receive({
      jsonrpc: "2.0",
      id: ws5.lastSent("damHopper/attachTarget")!.id,
      result: makeAttachResult("target-42"),
    });
    await vi.waitFor(() => expect(ws5.lastSent("initialize")).toBeDefined());
    ws5.receive({
      jsonrpc: "2.0",
      id: ws5.lastSent("initialize")!.id,
      result: {
        capabilities: {
          textDocumentSync: 2,
          experimental: {
            damHopperAdaptiveSync: {
              version: "1.0.0",
              adaptiveSyncThresholdBytes: 65536,
              maxDocumentBytes: 1048576,
              maxOpenDocuments: 16,
              maxSessionOverlayBytes: 4194304,
              maxInFlightRequests: 8,
            },
          },
        },
      },
    });
    await expect(connectAliasInit).rejects.toThrow(
      /Invalid initialize response: unexpected damHopperAdaptiveSync field alias/i,
    );
    expect(ws5.lastSent("initialized")).toBeUndefined();
    expect(getModelText).not.toHaveBeenCalled();

    // 6. Initialize policy disagrees with attachTarget authoritative policy -> rejected before replay
    const connectDisagreeInit = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(6));
    const ws6 = MockWebSocket.instances[5];
    await vi.waitFor(() =>
      expect(ws6.lastSent("damHopper/attachTarget")).toBeDefined(),
    );
    ws6.receive({
      jsonrpc: "2.0",
      id: ws6.lastSent("damHopper/attachTarget")!.id,
      result: makeAttachResult("target-42", {
        ...WIRE_POLICY,
        adaptiveSyncThresholdBytes: 128,
      }),
    });
    await vi.waitFor(() => expect(ws6.lastSent("initialize")).toBeDefined());
    ws6.receive({
      jsonrpc: "2.0",
      id: ws6.lastSent("initialize")!.id,
      result: makeInitializeResult({
        ...WIRE_POLICY,
        adaptiveSyncThresholdBytes: 256,
      }),
    });
    await expect(connectDisagreeInit).rejects.toThrow(
      /damHopperAdaptiveSync policy disagrees with attachTarget policy/i,
    );
    expect(ws6.lastSent("initialized")).toBeUndefined();
    expect(getModelText).not.toHaveBeenCalled();
    expect(registry.getByTabKey(tabKey)?.wireBinding).toBeNull();
    expect(client.getAdaptiveSyncThresholdBytes()).toBe(0);
  });

  it("consumes server-negotiated adaptive sync threshold and handles exact boundary crossings and G5 destination validation", async () => {
    const customPolicy: SemanticNegotiatedPolicy = {
      version: "1.0.0",
      adaptiveSyncThresholdBytes: 128,
      maxDocumentBytes: 512,
      maxOpenDocuments: 2,
      maxSessionOverlayBytes: 768,
      maxInFlightRequests: 4,
    };

    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      connectionGeneration: 1,
      targetGeneration: 1,
      provenance: TEST_PROVENANCE,
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
      result: makeAttachResult("target-42", customPolicy),
    });
    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    ws.receive({
      jsonrpc: "2.0",
      id: ws.lastSent("initialize")!.id,
      result: makeInitializeResult(customPolicy),
    });
    await connectPromise;
    expect(client.getAdaptiveSyncThresholdBytes()).toBe(128);
    expect(client.getNegotiatedPolicy()).toEqual(customPolicy);

    const tabKey = "tab-threshold";
    registry.registerModel({
      tabKey,
      profileId: "test-profile",
      project: "my-project",
      targetKey: "target-1",
      relativePath: "src/threshold.ts",
      provenance: TEST_PROVENANCE,
    });
    await client.notifyDidOpen(tabKey, "x".repeat(50));

    const rangeChange = {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      rangeLength: 1,
      text: "y",
    };

    // 1. 127 bytes (< 128 threshold) -> range-less full text
    const below127 = "a".repeat(127);
    await client.notifyDidChange(tabKey, below127, rangeChange);
    expect(ws.lastSent("textDocument/didChange")?.params.contentChanges).toEqual([
      { text: below127 },
    ]);

    // 2. Exactly 128 bytes (== 128 threshold) -> incremental range change
    const exact128 = "a".repeat(128);
    await client.notifyDidChange(tabKey, exact128, rangeChange);
    expect(ws.lastSent("textDocument/didChange")?.params.contentChanges).toEqual([
      rangeChange,
    ]);

    // 3. 129 bytes (> 128 threshold) -> incremental range change
    const above129 = "a".repeat(129);
    await client.notifyDidChange(tabKey, above129, rangeChange);
    expect(ws.lastSent("textDocument/didChange")?.params.contentChanges).toEqual([
      rangeChange,
    ]);

    // 4. Cross downward to 127 bytes (< 128 threshold) -> range-less full text
    const down127 = "b".repeat(127);
    await client.notifyDidChange(tabKey, down127, rangeChange);
    expect(ws.lastSent("textDocument/didChange")?.params.contentChanges).toEqual([
      { text: down127 },
    ]);

    // 5. Multi-byte UTF-8 exact boundary crossing (63 * 2 + 1 = 127 UTF-8 bytes vs 64 * 2 = 128 UTF-8 bytes)
    const utf8Below127 = "é".repeat(63) + "a";
    await client.notifyDidChange(tabKey, utf8Below127, rangeChange);
    expect(ws.lastSent("textDocument/didChange")?.params.contentChanges).toEqual([
      { text: utf8Below127 },
    ]);

    const utf8Exact128 = "é".repeat(64);
    await client.notifyDidChange(tabKey, utf8Exact128, rangeChange);
    expect(ws.lastSent("textDocument/didChange")?.params.contentChanges).toEqual([
      rangeChange,
    ]);

    // 6. Negotiated maxDocumentBytes cap (512 bytes) rejects oversized edit (513 bytes)
    const oversized = "z".repeat(513);
    expect(await client.notifyDidChange(tabKey, oversized, rangeChange)).toBe(0);

    // 7. Disconnect resets negotiated policy to inert defaults
    const destText = "export function targetFn() {}\n";
    const destHash = computeUtf8Sha256HexSync(destText);
    const validLoc = {
      uri: "dam-hopper://semantic/target-42/src/dest.ts",
      range: {
        start: { line: 0, character: 16 },
        end: { line: 0, character: 24 },
      },
      damHopperDestinationContentSha256: destHash,
      damHopperDestinationVersion: null,
      damHopperDestinationIncarnation: null,
    };
    expect(
      await client.validateDestination(validLoc, "tab-dest", destText),
    ).toBe(true);
    expect(
      await client.validateDestination(
        validLoc,
        "tab-dest",
        "export function modifiedFn() {}\n",
      ),
    ).toBe(false);
    expect(
      await client.validateDestination(
        {
          uri: "dam-hopper://semantic/target-42/src/dest.ts",
          range: validLoc.range,
        },
        "tab-dest",
        destText,
      ),
    ).toBe(false);

    client.disconnect();
    expect(client.getAdaptiveSyncThresholdBytes()).toBe(0);
  });
  it("fences rejected over-cap overlay sync and suppresses queries until full resync (F6)", async () => {
    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      profileId: "profile-1",
      project: "proj-1",
      targetKey: "root",
      connectionGeneration: 1,
      targetGeneration: 1,
      provenance: TEST_PROVENANCE,
      registry,
    });

    const connectP = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];

    await vi.waitFor(() => expect(ws.lastSent("damHopper/attachTarget")).toBeDefined());
    const attachReq = ws.lastSent("damHopper/attachTarget")!;
    const customPolicy = {
      version: "1.0",
      maxDocumentBytes: 1024,
      maxSessionOverlayBytes: 2048,
      maxOpenDocuments: 10,
      adaptiveSyncThresholdBytes: 128,
      maxInFlightRequests: 8,
    };
    ws.receive({
      jsonrpc: "2.0",
      id: attachReq.id,
      result: makeAttachResult("target-f6", customPolicy),
    });

    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    const initReq = ws.lastSent("initialize")!;
    ws.receive({
      jsonrpc: "2.0",
      id: initReq.id,
      result: makeInitializeResult(customPolicy),
    });
    await connectP;
    expect(client.getStatus()).toBe("ready");

    // Register model 1
    const tabKey1 = '["file","proj-1","root","src/doc1.ts"]';
    registry.registerModel({
      tabKey: tabKey1,
      profileId: "profile-1",
      project: "proj-1",
      targetKey: "root",
      relativePath: "src/doc1.ts",
      provenance: TEST_PROVENANCE,
    });

    await client.notifyDidOpen(tabKey1, "const initial = 1;\n");
    const binding1 = registry.getByTabKey(tabKey1)!.wireBinding!;
    expect(binding1.unsynchronized).toBeFalsy();

    // 1. Oversized edit exceeding maxDocumentBytes (1100 > 1024)
    const oversized = "x".repeat(1100);
    const rejectResult = await client.notifyDidChange(tabKey1, oversized, {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      text: "x",
    });
    expect(rejectResult).toBe(0);
    expect(binding1.unsynchronized).toBe(true);

    // 2. Query navigation while unsynchronized is suppressed immediately without wire send
    const initialSentCount = ws.sent.length;
    const navResult = await client.getDefinition(tabKey1, { line: 0, character: 6 });
    expect(navResult).toEqual({ locations: [] });
    expect(ws.sent.length).toBe(initialSentCount); // No wire query sent!

    // 3. Re-entry with content within caps (70 bytes) sends full replacement didChange
    const smallText = "const trimmed = 2;\n";
    await client.notifyDidChange(tabKey1, smallText, {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      text: "c",
    });

    // Full replacement was forced because binding was unsynchronized
    expect(ws.lastSent("textDocument/didChange")?.params.contentChanges).toEqual([
      { text: smallText },
    ]);
    expect(binding1.unsynchronized).toBe(false);

    // 4. Subsequent queries now succeed on wire
    const defP = client.getDefinition(tabKey1, { line: 0, character: 6 });
    await vi.waitFor(() => expect(ws.lastSent("textDocument/definition")).toBeDefined());
    const defReq = ws.lastSent("textDocument/definition")!;
    ws.receive({
      jsonrpc: "2.0",
      id: defReq.id,
      result: [{ uri: binding1.wireUri, range: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } } }],
    });
    const res = await defP;
    expect(res.locations.length).toBe(1);

    client.disconnect();
  });

  it("enforces session aggregate cap across multiple documents and releases on close (F6)", async () => {
    const registry = new SemanticModelRegistry();
    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      profileId: "profile-1",
      project: "proj-1",
      targetKey: "root",
      connectionGeneration: 1,
      targetGeneration: 1,
      provenance: TEST_PROVENANCE,
      registry,
    });

    const connectP = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws = MockWebSocket.instances[0];

    await vi.waitFor(() => expect(ws.lastSent("damHopper/attachTarget")).toBeDefined());
    const attachReq = ws.lastSent("damHopper/attachTarget")!;
    const aggregatePolicy = {
      version: "1.0",
      maxDocumentBytes: 1024,
      maxSessionOverlayBytes: 1500, // Session cap is 1500
      maxOpenDocuments: 10,
      adaptiveSyncThresholdBytes: 128,
      maxInFlightRequests: 8,
    };
    ws.receive({
      jsonrpc: "2.0",
      id: attachReq.id,
      result: makeAttachResult("target-f6-agg", aggregatePolicy),
    });

    await vi.waitFor(() => expect(ws.lastSent("initialize")).toBeDefined());
    const initReq = ws.lastSent("initialize")!;
    ws.receive({
      jsonrpc: "2.0",
      id: initReq.id,
      result: makeInitializeResult(aggregatePolicy),
    });
    await connectP;

    const tab1 = '["file","proj-1","root","src/agg1.ts"]';
    const tab2 = '["file","proj-1","root","src/agg2.ts"]';
    registry.registerModel({ tabKey: tab1, profileId: "profile-1", project: "proj-1", targetKey: "root", relativePath: "src/agg1.ts", provenance: TEST_PROVENANCE });
    registry.registerModel({ tabKey: tab2, profileId: "profile-1", project: "proj-1", targetKey: "root", relativePath: "src/agg2.ts", provenance: TEST_PROVENANCE });

    await client.notifyDidOpen(tab1, "a".repeat(900)); // 900 bytes <= 1500
    const binding1 = registry.getByTabKey(tab1)!.wireBinding!;
    expect(binding1.unsynchronized).toBeFalsy();

    await client.notifyDidOpen(tab2, "b".repeat(500)); // 900 + 500 = 1400 <= 1500
    const binding2 = registry.getByTabKey(tab2)!.wireBinding!;
    expect(binding2.unsynchronized).toBeFalsy();

    // Tab 2 tries to expand to 700 bytes (900 + 700 = 1600 > 1500 session cap!)
    const rejectResult = await client.notifyDidChange(tab2, "b".repeat(700));
    expect(rejectResult).toBe(0);
    expect(binding2.unsynchronized).toBe(true);

    // Query on tab 2 is suppressed
    const queryRes = await client.getDefinition(tab2, { line: 0, character: 1 });
    expect(queryRes).toEqual({ locations: [] });

    // Closing tab 1 releases its 900 bytes from session
    client.notifyDidClose(tab1);

    // Now tab 2 can successfully sync 700 bytes (700 <= 1500)
    const okResult = await client.notifyDidChange(tab2, "b".repeat(700));
    expect(okResult).toBeGreaterThan(0);
    expect(binding2.unsynchronized).toBe(false);

    client.disconnect();
  });

  it("recovers retryable transport loss under current owner, replaying admissible buffers before ready (F5)", async () => {
    const registry = new SemanticModelRegistry();
    let profileEnabled = true;
    let activeRefs = 1;

    const client = new SemanticClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      profileId: "profile-1",
      project: "proj-1",
      targetKey: "root",
      connectionGeneration: 1,
      targetGeneration: 1,
      provenance: TEST_PROVENANCE,
      registry,
      isProfileEnabled: () => profileEnabled,
      hasActiveRef: () => activeRefs > 0,
      getModelText: () => "const dirty = true;\n",
    });

    // 1. Initial connect
    const connectP = client.connect();
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const ws1 = MockWebSocket.instances[0];

    await vi.waitFor(() => expect(ws1.lastSent("damHopper/attachTarget")).toBeDefined());
    ws1.receive({
      jsonrpc: "2.0",
      id: ws1.lastSent("damHopper/attachTarget")!.id,
      result: makeAttachResult("target-f5"),
    });

    await vi.waitFor(() => expect(ws1.lastSent("initialize")).toBeDefined());
    ws1.receive({
      jsonrpc: "2.0",
      id: ws1.lastSent("initialize")!.id,
      result: makeInitializeResult(),
    });
    await connectP;
    expect(client.getStatus()).toBe("ready");

    // Register open dirty tab
    const tabKey = '["file","proj-1","root","src/app.ts"]';
    registry.registerModel({
      tabKey,
      profileId: "profile-1",
      project: "proj-1",
      targetKey: "root",
      relativePath: "src/app.ts",
      provenance: TEST_PROVENANCE,
    });
    await client.notifyDidOpen(tabKey, "const dirty = true;\n");

    // 2. Unexpected retryable socket close (code 1006)
    ws1.close(1006, "Abnormal closure");
    expect(client.getStatus()).toBe("disconnected");

    // 3. Auto-reconnect schedules after 1,000 ms
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(2), { timeout: 3000 });
    const ws2 = MockWebSocket.instances[1];
    expect(ws2).not.toBe(ws1); // Distinct socket instance!

    await vi.waitFor(() => expect(ws2.lastSent("damHopper/attachTarget")).toBeDefined());
    ws2.receive({
      jsonrpc: "2.0",
      id: ws2.lastSent("damHopper/attachTarget")!.id,
      result: makeAttachResult("target-f5-reconnected"),
    });

    await vi.waitFor(() => expect(ws2.lastSent("initialize")).toBeDefined());
    ws2.receive({
      jsonrpc: "2.0",
      id: ws2.lastSent("initialize")!.id,
      result: makeInitializeResult(),
    });

    // Wait for replay of dirty buffer before Ready
    await vi.waitFor(() => expect(ws2.lastSent("textDocument/didOpen")).toBeDefined());
    expect(ws2.lastSent("textDocument/didOpen")?.params.textDocument.text).toBe("const dirty = true;\n");

    await vi.waitFor(() => expect(client.getStatus()).toBe("ready"));

    // 4. Terminal close code 4401 (login required) yields no reconnect
    ws2.close(4401, "Session expired");
    expect(client.getStatus()).toBe("error");
    expect(client.hasScheduledReconnect()).toBe(false);
    expect(MockWebSocket.instances.length).toBe(2);
    client.disconnect();
  });
});
