import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextOpenResult } from "@/api/client.js";
import {
  FrameSession,
  type ExactRequestFrameSessionBackend,
} from "./bridge-host.js";
import {
  ADVISOR_WORKSPACE_EXTENSION_V1,
  UI_BRIDGE_VERSION,
  type AdvisorWorkspaceContext,
} from "./bridge-validators.js";

class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: unknown[] = [];
  closed = false;

  postMessage(value: unknown) {
    this.posted.push(value);
  }

  start() {}

  close() {
    this.closed = true;
  }

  emit(value: unknown) {
    this.onmessage?.({ data: value });
  }
}

class FakeMessageChannel {
  static latest: FakeMessageChannel | null = null;
  port1 = new FakePort();
  port2 = new FakePort();

  constructor() {
    FakeMessageChannel.latest = this;
  }
}

function readyEvent(session: FrameSession, frame: Window): MessageEvent {
  const channel = new FakeMessageChannel();
  return {
    source: frame,
    origin: "null",
    data: ready(session),
    ports: [channel.port1 as unknown as MessagePort],
  } as unknown as MessageEvent;
}

function ready(session: FrameSession) {
  return {
    type: "frame.ready",
    bridgeVersion: UI_BRIDGE_VERSION,
    frameSession: session.frameSession,
    activationGeneration: session.activationGeneration,
  };
}

function ack(session: FrameSession) {
  return {
    type: "frame.portAck",
    bridgeVersion: UI_BRIDGE_VERSION,
    frameSession: session.frameSession,
    activationGeneration: session.activationGeneration,
    nonce: session.nonce,
  };
}

describe("FrameSession", () => {
  const originalMessageChannel = globalThis.MessageChannel;

  beforeEach(() => {
    FakeMessageChannel.latest = null;
    Object.defineProperty(globalThis, "MessageChannel", {
      configurable: true,
      value: FakeMessageChannel,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "MessageChannel", {
      configurable: true,
      value: originalMessageChannel,
    });
  });

  it("requires opaque fenced ready and portAck before opening context", async () => {
    const opened: ContextOpenResult = {
      contextId: "ctx-1",
      bindingRevision: 1,
      grantRevision: 1,
      activationGeneration: 7,
      expiresAt: Date.now() + 60_000,
    };
    const backend: ExactRequestFrameSessionBackend = {
      requestCorrelation: "exact",
      getEpoch: vi.fn().mockResolvedValue(42),
      openContext: vi.fn().mockResolvedValue(opened),
      closeContext: vi.fn().mockResolvedValue(undefined),
      invoke: vi.fn().mockResolvedValue({ result: { ok: true } }),
      cancel: vi.fn().mockResolvedValue({ outcome: "accepted" }),
      onContextRevoked: () => () => {},
      onOwnerInvalidated: () => () => {},
    };
    const session = new FrameSession({
      installationId: "advisor",
      activationGeneration: 7,
      target: { project: "demo" },
      allowedOperations: ["history.summary"],
      backend,
    });
    const postMessage = vi.fn();
    const frame = { postMessage } as unknown as Window;
    session.bindFrame(frame);

    expect(session.handleWindowMessage(readyEvent(session, frame))).toBe(true);
    expect(postMessage).not.toHaveBeenCalled();
    expect(backend.openContext).not.toHaveBeenCalled();

    FakeMessageChannel.latest!.port1.emit(ack(session));
    await Promise.resolve();
    await Promise.resolve();
    expect(backend.openContext).toHaveBeenCalledWith({
      epoch: 42,
      installationId: "advisor",
      target: { project: "demo" },
      allowedOperations: ["history.summary"],
    });
    expect(session.state).toBe("Ready");
  });

  it("preserves one browser requestId through invoke and idempotent cancel", async () => {
    const invocation = Promise.withResolvers<{ result: unknown }>();
    const backend: ExactRequestFrameSessionBackend = {
      requestCorrelation: "exact",
      getEpoch: vi.fn().mockResolvedValue(42),
      openContext: vi.fn().mockResolvedValue({
        contextId: "ctx-1",
        bindingRevision: 1,
        grantRevision: 1,
        activationGeneration: 7,
        expiresAt: Date.now() + 60_000,
      }),
      closeContext: vi.fn().mockResolvedValue(undefined),
      invoke: vi.fn(() => invocation.promise),
      cancel: vi.fn().mockResolvedValue({ outcome: "accepted" }),
      onContextRevoked: () => () => {},
      onOwnerInvalidated: () => () => {},
    };
    const session = new FrameSession({
      installationId: "advisor",
      activationGeneration: 7,
      target: { project: "demo" },
      allowedOperations: ["history.summary"],
      backend,
    });
    const frame = { postMessage: vi.fn() } as unknown as Window;
    session.bindFrame(frame);
    session.handleWindowMessage(readyEvent(session, frame));
    const port = FakeMessageChannel.latest!.port1;
    port.emit(ack(session));
    await Promise.resolve();
    await Promise.resolve();

    const request = {
      type: "request",
      bridgeVersion: UI_BRIDGE_VERSION,
      frameSession: session.frameSession,
      activationGeneration: 7,
      requestId: "request-1",
      operation: "history.summary",
      payload: { scope: "all" },
    };
    port.emit(request);
    await Promise.resolve();
    expect(backend.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "request-1",
        payload: request.payload,
      }),
    );

    const cancel = {
      type: "cancel",
      bridgeVersion: UI_BRIDGE_VERSION,
      frameSession: session.frameSession,
      activationGeneration: 7,
      requestId: "request-1",
    };
    port.emit(cancel);
    port.emit(cancel);
    expect(backend.cancel).toHaveBeenCalledTimes(1);
    expect(backend.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "request-1" }),
    );

    invocation.resolve({ result: { stale: false } });
    await Promise.resolve();
    await Promise.resolve();
    const responses = port.posted.filter(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        (value as { type?: string }).type === "response",
    );
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      requestId: "request-1",
      error: { code: "CANCELLED" },
    });
  });

  it("drops a late result after idempotent revocation", async () => {
    const invocation = Promise.withResolvers<{ result: unknown }>();
    const backend: ExactRequestFrameSessionBackend = {
      requestCorrelation: "exact",
      getEpoch: vi.fn().mockResolvedValue(42),
      openContext: vi.fn().mockResolvedValue({
        contextId: "ctx-1",
        bindingRevision: 1,
        grantRevision: 1,
        activationGeneration: 7,
        expiresAt: Date.now() + 60_000,
      }),
      closeContext: vi.fn().mockResolvedValue(undefined),
      invoke: vi.fn(() => invocation.promise),
      cancel: vi.fn().mockResolvedValue({ outcome: "accepted" }),
      onContextRevoked: () => () => {},
      onOwnerInvalidated: () => () => {},
    };
    const session = new FrameSession({
      installationId: "advisor",
      activationGeneration: 7,
      target: { project: "demo" },
      allowedOperations: ["history.summary"],
      backend,
    });
    const frame = { postMessage: vi.fn() } as unknown as Window;
    session.bindFrame(frame);
    session.handleWindowMessage(readyEvent(session, frame));
    const port = FakeMessageChannel.latest!.port1;
    port.emit(ack(session));
    await Promise.resolve();
    await Promise.resolve();
    port.emit({
      type: "request",
      bridgeVersion: UI_BRIDGE_VERSION,
      frameSession: session.frameSession,
      activationGeneration: 7,
      requestId: "request-2",
      operation: "history.summary",
      payload: {},
    });
    await Promise.resolve();
    session.revoke("target changed");
    session.revoke("duplicate teardown");
    const countAtRevoke = port.posted.length;
    invocation.resolve({ result: { shouldNotCrossFence: true } });
    await Promise.resolve();
    await Promise.resolve();
    expect(port.posted).toHaveLength(countAtRevoke);
    expect(backend.closeContext).toHaveBeenCalledTimes(1);
  });
  it("advertises extension in bootstrap and posts host.contextReady on context open", async () => {
    const opened: ContextOpenResult = {
      contextId: "ctx-1",
      bindingRevision: 1,
      grantRevision: 1,
      activationGeneration: 7,
      scopeKind: "history-root",
      expiresAt: Date.now() + 60_000,
    };
    const backend: ExactRequestFrameSessionBackend = {
      requestCorrelation: "exact",
      getEpoch: vi.fn().mockResolvedValue(42),
      openContext: vi.fn().mockResolvedValue(opened),
      closeContext: vi.fn().mockResolvedValue(undefined),
      invoke: vi.fn().mockResolvedValue({ result: { ok: true } }),
      cancel: vi.fn().mockResolvedValue({ outcome: "accepted" }),
      onContextRevoked: () => () => {},
      onOwnerInvalidated: () => () => {},
    };
    const workspaceContext: AdvisorWorkspaceContext = {
      revision: 1,
      authorityKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      project: {
        projectId: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        label: "Test Project",
      },
      historyScope: "history-root",
      contextScope: "history-root",
      allowedOperations: ["history.summary"],
    };
    const onUiIntent = vi.fn();
    const session = new FrameSession({
      installationId: "evcrate.advisor",
      activationGeneration: 7,
      target: { project: "demo" },
      allowedOperations: ["history.summary"],
      backend,
      extension: ADVISOR_WORKSPACE_EXTENSION_V1,
      workspaceContext,
      expectedContextScope: "history-root",
      onUiIntent,
    });
    const frame = { postMessage: vi.fn() } as unknown as Window;
    session.bindFrame(frame);
    session.handleWindowMessage(readyEvent(session, frame));

    const port = FakeMessageChannel.latest!.port1;
    expect(port.posted).toHaveLength(1);
    const bootstrap = port.posted[0] as Record<string, unknown>;
    expect(bootstrap.type).toBe("host.bootstrap");
    expect(bootstrap.extensions).toEqual([ADVISOR_WORKSPACE_EXTENSION_V1]);
    expect(bootstrap.workspaceContext).toEqual(workspaceContext);

    port.emit(ack(session));
    await Promise.resolve();
    await Promise.resolve();

    expect(session.state).toBe("Ready");
    expect(port.posted).toHaveLength(2); // bootstrap + host.contextReady
    const contextReady = port.posted[1] as Record<string, unknown>;
    expect(contextReady.type).toBe("host.contextReady");
    expect(contextReady.workspaceContext).toEqual(workspaceContext);

    // Update workspace context with same authorityKey and incremented revision
    const nextContext: AdvisorWorkspaceContext = {
      ...workspaceContext,
      revision: 2,
      project: {
        projectId: "1111111111111111111111111111111111111111111111111111111111111111",
        label: "Second Project",
      },
    };
    const updated = session.updateWorkspaceContext(nextContext);
    expect(updated).toBe(true);
    expect(port.posted).toHaveLength(3);
    const workspaceChanged = port.posted[2] as Record<string, unknown>;
    expect(workspaceChanged.type).toBe("host.workspaceChanged");
    expect(workspaceChanged.workspaceContext).toEqual(nextContext);

    // Stale revision or mismatched authority rejected
    expect(session.updateWorkspaceContext({ ...nextContext, revision: 2 })).toBe(false);
    expect(session.updateWorkspaceContext({ ...nextContext, authorityKey: "bad-key-000000000000000000000000000000000000000000000000000000000000" })).toBe(false);

    // Frame UI intent
    port.emit({
      type: "frame.uiIntent",
      bridgeVersion: UI_BRIDGE_VERSION,
      frameSession: session.frameSession,
      activationGeneration: 7,
      intent: "activate",
    });
    expect(onUiIntent).toHaveBeenCalledWith("activate");

    // Invisible frame rejects uiIntent
    session.setVisible(false);
    port.emit({
      type: "frame.uiIntent",
      bridgeVersion: UI_BRIDGE_VERSION,
      frameSession: session.frameSession,
      activationGeneration: 7,
      intent: "dismiss",
    });
    expect(session.state).toBe("Revoked");
  });

  it("revokes when context scope mismatches expectedContextScope", async () => {
    const opened: ContextOpenResult = {
      contextId: "ctx-1",
      bindingRevision: 1,
      grantRevision: 1,
      activationGeneration: 7,
      scopeKind: "project", // Mismatch: expected history-root
      expiresAt: Date.now() + 60_000,
    };
    const backend: ExactRequestFrameSessionBackend = {
      requestCorrelation: "exact",
      getEpoch: vi.fn().mockResolvedValue(42),
      openContext: vi.fn().mockResolvedValue(opened),
      closeContext: vi.fn().mockResolvedValue(undefined),
      invoke: vi.fn().mockResolvedValue({ result: { ok: true } }),
      cancel: vi.fn().mockResolvedValue({ outcome: "accepted" }),
      onContextRevoked: () => () => {},
      onOwnerInvalidated: () => () => {},
    };
    const session = new FrameSession({
      installationId: "evcrate.advisor",
      activationGeneration: 7,
      target: { project: "demo" },
      allowedOperations: ["history.summary"],
      backend,
      expectedContextScope: "history-root",
    });
    const frame = { postMessage: vi.fn() } as unknown as Window;
    session.bindFrame(frame);
    session.handleWindowMessage(readyEvent(session, frame));
    FakeMessageChannel.latest!.port1.emit(ack(session));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(session.state).toBe("Revoked");
    expect(backend.closeContext).toHaveBeenCalledWith({
      epoch: 42,
      contextId: "ctx-1",
    });
  });
  it("revokes when context scope is missing (undefined) while expectedContextScope is set", async () => {
    const opened: ContextOpenResult = {
      contextId: "ctx-1",
      bindingRevision: 1,
      grantRevision: 1,
      activationGeneration: 7,
      // scopeKind omitted / undefined
      expiresAt: Date.now() + 60_000,
    };
    const backend: ExactRequestFrameSessionBackend = {
      requestCorrelation: "exact",
      getEpoch: vi.fn().mockResolvedValue(42),
      openContext: vi.fn().mockResolvedValue(opened),
      closeContext: vi.fn().mockResolvedValue(undefined),
      invoke: vi.fn().mockResolvedValue({ result: { ok: true } }),
      cancel: vi.fn().mockResolvedValue({ outcome: "accepted" }),
      onContextRevoked: () => () => {},
      onOwnerInvalidated: () => () => {},
    };
    const session = new FrameSession({
      installationId: "evcrate.advisor",
      activationGeneration: 7,
      target: { project: "demo" },
      allowedOperations: ["history.summary"],
      backend,
      expectedContextScope: "history-root",
    });
    const frame = { postMessage: vi.fn() } as unknown as Window;
    session.bindFrame(frame);
    session.handleWindowMessage(readyEvent(session, frame));
    FakeMessageChannel.latest!.port1.emit(ack(session));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(session.state).toBe("Revoked");
    expect(backend.closeContext).toHaveBeenCalledWith({
      epoch: 42,
      contextId: "ctx-1",
    });
  });
});
