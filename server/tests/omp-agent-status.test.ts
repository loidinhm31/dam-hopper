import { describe, expect, it } from "bun:test";
import damHopperAgentStatusExtension, {
  classifyStopReason,
  OmpAgentStatusAdapter,
  sanitizeSessionId,
  validateLoopbackWsUrl,
  type ReporterReport,
  type ServerMessage,
} from "../src/agent_status/assets/omp-agent-status";

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

// ============================================================================
// Mock WebSocket Implementation for Testing
// ============================================================================

class MockWebSocket {
  public url: string;
  public headers: Record<string, string>;
  public readyState = 1; // OPEN
  public sent: string[] = [];

  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;

  constructor(url: string, headers: Record<string, string>) {
    this.url = url;
    this.headers = headers;
    queueMicrotask(() => {
      this.onopen?.();
    });
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  // Test helpers
  public receive(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  public getParsedSent(): ReporterReport[] {
    return this.sent
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter((item): item is ReporterReport => item !== null && item.kind === "report");
  }
}

// ============================================================================
// Unit Tests: Pure Validation and Classification
// ============================================================================

describe("OMP Adapter - Pure Validation & Classification", () => {
  it("validates loopback WebSocket URLs correctly", () => {
    // Valid cases
    expect(validateLoopbackWsUrl("ws://127.0.0.1:4801/v1/agent-status")).not.toBeNull();
    expect(validateLoopbackWsUrl("ws://localhost:1234/v1/agent-status")).not.toBeNull();
    expect(validateLoopbackWsUrl("ws://[::1]:9999/v1/agent-status")).not.toBeNull();

    // Invalid: non-loopback host
    expect(validateLoopbackWsUrl("ws://192.168.1.50:4801/v1/agent-status")).toBeNull();
    expect(validateLoopbackWsUrl("ws://example.com/v1/agent-status")).toBeNull();

    // Invalid: wrong protocol
    expect(validateLoopbackWsUrl("http://127.0.0.1:4801/v1/agent-status")).toBeNull();

    // Invalid: wrong path
    expect(validateLoopbackWsUrl("ws://127.0.0.1:4801/v1/wrong-path")).toBeNull();
    expect(validateLoopbackWsUrl("ws://127.0.0.1:4801/ws")).toBeNull();

    // Invalid: credentials in URL
    expect(validateLoopbackWsUrl("ws://user:pass@127.0.0.1:4801/v1/agent-status")).toBeNull();

    // Invalid: query parameters
    expect(validateLoopbackWsUrl("ws://127.0.0.1:4801/v1/agent-status?token=secret")).toBeNull();
  });

  it("sanitizes session IDs and strips filesystem paths", () => {
    expect(sanitizeSessionId("session-1234")).toBe("session-1234");
    expect(sanitizeSessionId("/home/user/.omp/sessions/my-session.json")).toBe("my-session.json");
    expect(sanitizeSessionId("C:\\Users\\dev\\.omp\\session.json")).toBe("session.json");
    expect(sanitizeSessionId("")).toBe("session-unknown");
    expect(sanitizeSessionId(undefined)).toBe("session-unknown");

    // Caps at 128 characters
    const longId = "a".repeat(200);
    expect(sanitizeSessionId(longId).length).toBe(128);
  });

  it("classifies stop reasons accurately according to specification", () => {
    expect(classifyStopReason("stop")).toEqual({ outcome: "ended", state: "idle" });
    expect(classifyStopReason("aborted")).toEqual({ outcome: "interrupted", state: "idle" });
    expect(classifyStopReason("error")).toEqual({ outcome: "error", state: "blocked", reason: "error" });

    // Undefined, length, toolUse, or unknown without documented normal finish => unknown
    expect(classifyStopReason("length")).toEqual({ outcome: "unknown", state: "unknown" });
    expect(classifyStopReason("toolUse")).toEqual({ outcome: "unknown", state: "unknown" });
    expect(classifyStopReason(undefined)).toEqual({ outcome: "unknown", state: "unknown" });
    expect(classifyStopReason("unrecognized")).toEqual({ outcome: "unknown", state: "unknown" });
  });
});

// ============================================================================
// Unit Tests: Adapter State Machine and Protocol Invariants
// ============================================================================

describe("OMP Agent Status Adapter State Machine", () => {
  function createTestHarness(settleDelayMs = 10) {
    let mockWs: MockWebSocket | null = null;
    const adapter = new OmpAgentStatusAdapter({
      wsUrl: "ws://127.0.0.1:4801/v1/agent-status",
      token: "valid-bearer-token",
      settleDelayMs,
      heartbeatMs: 1000,
      webSocketFactory: (url, headers) => {
        mockWs = new MockWebSocket(url, headers);
        return mockWs as unknown as WebSocket;
      },
    });

    adapter.connect();

    return {
      adapter,
      getWs: () => mockWs!,
      admit: () => {
        mockWs!.receive({
          kind: "accepted",
          serverEpoch: 1,
          reporterEpoch: 1,
          heartbeatMs: 1000,
          leaseMs: 3000,
        });
      },
    };
  }

  it("initiates connection, sends hello, and emits snapshot on admit", async () => {
    const { adapter, getWs, admit } = createTestHarness();
    await delay(5);

    const ws = getWs();
    expect(ws.headers.Authorization).toBe("Bearer valid-bearer-token");

    // Hello sent immediately
    const hello = JSON.parse(ws.sent[0]);
    expect(hello.version).toBe(1);
    expect(hello.agentKind).toBe("omp");
    expect(hello.adapterVersion).toBe("1.0.0");

    // Server admits reporter
    admit();

    // Adapter responds with initial snapshot report
    const reports = ws.getParsedSent();
    expect(reports.length).toBe(1);
    expect(reports[0].event).toBe("snapshot");
    expect(reports[0].seq).toBe(1);
    expect(reports[0].state).toBe("unknown");
    expect(adapter.getIsAdmitted()).toBe(true);
  });

  it("handles normal turn lifecycle: start -> settle -> turn-ended", async () => {
    const { adapter, getWs, admit } = createTestHarness(10);
    await delay(5);
    admit();

    adapter.onSessionStart("sess-1", true);
    expect(adapter.getState()).toBe("idle");

    // Turn starts
    adapter.onAgentStart();
    expect(adapter.getState()).toBe("working");
    expect(adapter.getCurrentTurnId()).toBeDefined();

    const ws = getWs();
    const reportsAfterStart = ws.getParsedSent();
    const startReport = reportsAfterStart.find((r) => r.event === "turn-started");
    expect(startReport).toBeDefined();
    expect(startReport?.state).toBe("working");
    expect(startReport?.turnId).toBe(adapter.getCurrentTurnId());

    // Agent ends with stopReason "stop"
    adapter.onAgentEnd({
      willContinue: false,
      messages: [{ role: "assistant", stopReason: "stop" }],
    });

    // Before settle timer fires: still working
    expect(adapter.getState()).toBe("working");

    // Wait for settle timer (10ms)
    await delay(25);

    expect(adapter.getState()).toBe("idle");
    const endReport = ws.getParsedSent().find((r) => r.event === "turn-ended");
    expect(endReport).toBeDefined();
    expect(endReport?.state).toBe("idle");
    expect(endReport?.outcome).toBe("ended");
    expect(adapter.getCurrentTurnId()).toBeUndefined();
  });

  it("ignores agent_end with willContinue: true (never reports terminal settle)", async () => {
    const { adapter, getWs, admit } = createTestHarness(10);
    await delay(5);
    admit();

    adapter.onSessionStart("sess-1", true);
    adapter.onAgentStart();
    expect(adapter.getState()).toBe("working");

    // Non-terminal continuation end
    adapter.onAgentEnd({ willContinue: true });

    // Wait past settle window
    await delay(25);

    // Remains working, no turn-ended event emitted
    expect(adapter.getState()).toBe("working");
    const endReport = getWs().getParsedSent().find((r) => r.event === "turn-ended");
    expect(endReport).toBeUndefined();
  });

  it("settles aborted assistant as interrupted turn", async () => {
    const { adapter, getWs, admit } = createTestHarness(10);
    await delay(5);
    admit();

    adapter.onSessionStart("sess-1", true);
    adapter.onAgentStart();

    adapter.onAgentEnd({
      willContinue: false,
      messages: [{ role: "assistant", stopReason: "aborted" }],
    });

    await delay(25);

    expect(adapter.getState()).toBe("idle");
    const endReport = getWs().getParsedSent().find((r) => r.event === "turn-ended");
    expect(endReport?.outcome).toBe("interrupted");
    expect(endReport?.state).toBe("idle");
  });

  it("settles error assistant as blocked with error reason", async () => {
    const { adapter, getWs, admit } = createTestHarness(10);
    await delay(5);
    admit();

    adapter.onSessionStart("sess-1", true);
    adapter.onAgentStart();

    adapter.onAgentEnd({
      willContinue: false,
      messages: [{ role: "assistant", stopReason: "error" }],
    });

    await delay(25);

    expect(adapter.getState()).toBe("blocked");
    expect(adapter.getBlockedReason()).toBe("error");

    const endReport = getWs().getParsedSent().find((r) => r.event === "turn-ended");
    expect(endReport?.outcome).toBe("error");
    expect(endReport?.state).toBe("blocked");
    expect(endReport?.blockedReason).toBe("error");
  });

  it("manages keyed tool approval blockers", async () => {
    const { adapter, getWs, admit } = createTestHarness();
    await delay(5);
    admit();

    adapter.onSessionStart("sess-1", true);
    adapter.onAgentStart();

    // Approval requested
    adapter.onToolApprovalRequested("call-1", "bash");
    expect(adapter.getState()).toBe("blocked");
    expect(adapter.getBlockedReason()).toBe("approval");
    expect(adapter.getBlockerCount()).toBe(1);

    // Duplicate requested is idempotent
    adapter.onToolApprovalRequested("call-1", "bash");
    expect(adapter.getBlockerCount()).toBe(1);

    // Second approval requested
    adapter.onToolApprovalRequested("call-2", "edit");
    expect(adapter.getBlockerCount()).toBe(2);

    // Resolve first
    adapter.onToolApprovalResolved("call-1", "bash");
    expect(adapter.getBlockerCount()).toBe(1);
    expect(adapter.getState()).toBe("blocked");

    // Resolve second -> returns to working
    adapter.onToolApprovalResolved("call-2", "edit");
    expect(adapter.getBlockerCount()).toBe(0);
    expect(adapter.getState()).toBe("working");
    expect(adapter.getBlockedReason()).toBeUndefined();
  });

  it("manages tool execution ask blocker", async () => {
    const { adapter, getWs, admit } = createTestHarness();
    await delay(5);
    admit();

    adapter.onSessionStart("sess-1", true);
    adapter.onAgentStart();

    // Non-ask tool execution does not block
    adapter.onToolExecutionStart("call-10", "read");
    expect(adapter.getState()).toBe("working");
    adapter.onToolExecutionEnd("call-10", "read");
    expect(adapter.getState()).toBe("working");

    // Ask tool execution blocks with question reason
    adapter.onToolExecutionStart("call-11", "ask");
    expect(adapter.getState()).toBe("blocked");
    expect(adapter.getBlockedReason()).toBe("question");

    // End ask tool execution -> unblocks back to working
    adapter.onToolExecutionEnd("call-11", "ask");
    expect(adapter.getState()).toBe("working");
    expect(adapter.getBlockedReason()).toBeUndefined();
  });

  it("cancels settle timer and maintains working state on auto-retry or compaction", async () => {
    const { adapter, admit } = createTestHarness(20);
    await delay(5);
    admit();

    adapter.onSessionStart("sess-1", true);
    adapter.onAgentStart();

    // Agent end triggers settle debounce
    adapter.onAgentEnd({
      willContinue: false,
      messages: [{ role: "assistant", stopReason: "stop" }],
    });

    // Auto-retry starts within debounce window
    await delay(5);
    adapter.onAutoRetryStart();

    // Wait past initial settle delay
    await delay(30);

    // Must remain working because retry is active
    expect(adapter.getState()).toBe("working");

    // Retry ends successfully
    adapter.onAutoRetryEnd(true);
  });

  it("clears turn and blockers on session switch without completing previous turn", async () => {
    const { adapter, getWs, admit } = createTestHarness();
    await delay(5);
    admit();

    adapter.onSessionStart("sess-1", true);
    adapter.onAgentStart();
    adapter.onToolApprovalRequested("call-1", "bash");
    expect(adapter.getState()).toBe("blocked");

    // Switch session
    adapter.onSessionSwitch("sess-2", true);
    expect(adapter.getState()).toBe("idle");
    expect(adapter.getBlockerCount()).toBe(0);
    expect(adapter.getCurrentTurnId()).toBeUndefined();
    expect(adapter.getAgentSessionId()).toBe("sess-2");

    const sessionReport = getWs().getParsedSent().find((r) => r.event === "session-changed");
    expect(sessionReport).toBeDefined();
    expect(sessionReport?.agentSessionId).toBe("sess-2");
  });

  it("sends release event on shutdown", async () => {
    const { adapter, getWs, admit } = createTestHarness();
    await delay(5);
    admit();

    adapter.onSessionStart("sess-1", true);
    adapter.disconnect();

    const ws = getWs();
    const releaseReport = ws.getParsedSent().find((r) => r.event === "release");
    expect(releaseReport).toBeDefined();
    expect(releaseReport?.state).toBe("unknown");
  });
});

// ============================================================================
// Unit Tests: Extension Factory Entry Point Guards
// ============================================================================

describe("OMP Extension Factory Guards", () => {
  const originalEnv = { ...process.env };

  function mockPi() {
    const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
    return {
      handlers,
      on: (event: string, handler: (event: unknown, ctx: unknown) => void) => {
        handlers.set(event, handler);
      },
    };
  }

  it("remains dormant when environment variables are missing", () => {
    delete process.env.DAM_HOPPER_AGENT_STATUS_URL;
    delete process.env.DAM_HOPPER_AGENT_STATUS_TOKEN;

    const pi = mockPi();
    damHopperAgentStatusExtension(pi);

    expect(pi.handlers.size).toBe(0);
  });

  it("remains dormant when OMPCODE=1 (subagent)", () => {
    process.env.DAM_HOPPER_AGENT_STATUS_URL = "ws://127.0.0.1:4801/v1/agent-status";
    process.env.DAM_HOPPER_AGENT_STATUS_TOKEN = "valid-token";
    process.env.OMPCODE = "1";

    const pi = mockPi();
    damHopperAgentStatusExtension(pi);

    expect(pi.handlers.size).toBe(0);
  });

  it("remains dormant when URL is non-loopback", () => {
    delete process.env.OMPCODE;
    process.env.DAM_HOPPER_AGENT_STATUS_URL = "ws://192.168.1.100:4801/v1/agent-status";
    process.env.DAM_HOPPER_AGENT_STATUS_TOKEN = "valid-token";

    const pi = mockPi();
    damHopperAgentStatusExtension(pi);

    expect(pi.handlers.size).toBe(0);
  });

  it("registers handlers when environment is valid, but ignores non-UI or subagent sessions", () => {
    delete process.env.OMPCODE;
    process.env.DAM_HOPPER_AGENT_STATUS_URL = "ws://127.0.0.1:4801/v1/agent-status";
    process.env.DAM_HOPPER_AGENT_STATUS_TOKEN = "valid-token";

    const pi = mockPi();
    damHopperAgentStatusExtension(pi);

    expect(pi.handlers.size).toBeGreaterThan(0);
    const sessionStart = pi.handlers.get("session_start");
    expect(sessionStart).toBeDefined();

    // Trigger session_start with hasUI: false -> should not activate
    sessionStart?.({}, { hasUI: false, agent: { kind: "main" } });

    // Trigger session_start with subagent -> should not activate
    sessionStart?.({}, { hasUI: true, agent: { kind: "sub" } });
  });

  // Restore env
  Object.assign(process.env, originalEnv);
});
