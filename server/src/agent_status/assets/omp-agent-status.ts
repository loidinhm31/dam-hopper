/**
 * DamHopper agent status adapter for Oh My Pi (OMP).
 *
 * Standalone TypeScript extension running inside OMP (Bun runtime).
 * Connects to the server's private loopback collector and reports
 * authoritative agent state and turn outcomes.
 */

// ============================================================================
// Types and Wire Protocol (v1)
// ============================================================================

export const AGENT_STATUS_PROTOCOL_VERSION = 1;
export const ADAPTER_VERSION = "1.0.0";
export const DEFAULT_SETTLE_DELAY_MS = 250;
export const DEFAULT_HEARTBEAT_MS = 5000;
export const DEFAULT_RECONNECT_DELAYS = [250, 500, 1000, 2000, 5000];

export type AgentKind = "omp";
export type AgentState = "unknown" | "idle" | "working" | "blocked";
export type BlockedReason = "approval" | "question" | "error";
export type TurnOutcome = "ended" | "interrupted" | "error" | "unknown";
export type ReporterEventKind =
  | "snapshot"
  | "turn-started"
  | "state-changed"
  | "turn-ended"
  | "session-changed"
  | "heartbeat"
  | "release";

export interface ReporterHello {
  version: number;
  agentKind: AgentKind;
  reporterId: string;
  agentSessionId: string;
  adapterVersion: string;
}

export interface ReporterAccepted {
  kind: "accepted";
  serverEpoch: number;
  reporterEpoch: number;
  heartbeatMs: number;
  leaseMs: number;
}

export interface ReporterRejected {
  kind: "rejected";
  reason: string;
}

export interface ReporterAck {
  kind: "ack";
  seq: number;
}

export interface ReporterReport {
  kind: "report";
  seq: number;
  event: ReporterEventKind;
  state: AgentState;
  agentSessionId: string;
  turnId?: string;
  outcome?: TurnOutcome;
  blockedReason?: BlockedReason;
}

export type ServerMessage = ReporterAccepted | ReporterRejected | ReporterAck;

export interface LoggerFacade {
  debug?: (msg: string, ...args: unknown[]) => void;
  warn?: (msg: string, ...args: unknown[]) => void;
  error?: (msg: string, ...args: unknown[]) => void;
}

export interface OmpExtensionContext {
  hasUI?: boolean;
  agent?: { kind?: "main" | "sub" | string; id?: string };
  sessionManager?: { getSessionId?: () => string };
  isIdle?: () => boolean;
}

export interface OmpExtensionAPI {
  logger?: LoggerFacade;
  on(event: string, handler: (event: unknown, ctx: unknown) => void): void;
}

export interface AssistantMessageSnapshot {
  role?: string;
  stopReason?: string;
}

export interface AgentEndEventPayload {
  willContinue?: boolean;
  messages?: AssistantMessageSnapshot[];
}

export interface ToolApprovalEventPayload {
  toolCallId?: string;
  toolName?: string;
}

export interface ToolExecutionEventPayload {
  toolCallId?: string;
  toolName?: string;
}

export interface AutoRetryEndEventPayload {
  success?: boolean;
}

// Timer handle type avoiding ReturnType<typeof setTimeout>
export type TimerToken = number | object | null;

// ============================================================================
// Pure Validation and Classification Helpers
// ============================================================================

export function validateLoopbackWsUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      return null;
    }
    const host = parsed.hostname;
    const isLoopback =
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "::1" ||
      host === "[::1]";
    if (!isLoopback) {
      return null;
    }
    if (parsed.pathname !== "/v1/agent-status") {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    if (parsed.search || parsed.searchParams.size > 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function sanitizeSessionId(rawId: unknown): string {
  if (typeof rawId !== "string" || !rawId.trim()) {
    return "session-unknown";
  }
  let candidate = rawId.trim();
  if (candidate.includes("/") || candidate.includes("\\")) {
    const parts = candidate.split(/[/\\]+/).filter(Boolean);
    candidate = parts[parts.length - 1] || "session-unknown";
  }
  const clean = candidate.replace(/[^\x21-\x7E]/g, "_").slice(0, 128);
  return clean || "session-unknown";
}

export function classifyStopReason(stopReason: string | undefined): {
  outcome: TurnOutcome;
  state: AgentState;
  reason?: BlockedReason;
} {
  switch (stopReason) {
    case "stop":
      return { outcome: "ended", state: "idle" };
    case "aborted":
      return { outcome: "interrupted", state: "idle" };
    case "error":
      return { outcome: "error", state: "blocked", reason: "error" };
    default:
      return { outcome: "unknown", state: "unknown" };
  }
}

// ============================================================================
// Adapter State Machine & Transport Controller
// ============================================================================

export interface AdapterOptions {
  wsUrl: string;
  token: string;
  reporterId?: string;
  adapterVersion?: string;
  settleDelayMs?: number;
  heartbeatMs?: number;
  reconnectDelays?: number[];
  webSocketFactory?: (url: string, headers: Record<string, string>) => WebSocket;
  logger?: LoggerFacade;
}

export class OmpAgentStatusAdapter {
  private readonly wsUrl: string;
  private readonly token: string;
  private readonly reporterId: string;
  private readonly adapterVersion: string;
  private readonly settleDelayMs: number;
  private readonly reconnectDelays: number[];
  private readonly webSocketFactory: (
    url: string,
    headers: Record<string, string>,
  ) => WebSocket;
  private readonly logger?: LoggerFacade;

  private ws: WebSocket | null = null;
  private isConnected = false;
  private isAdmitted = false;
  private isShuttingDown = false;
  private reconnectAttempt = 0;
  private reconnectTimer: TimerToken = null;
  private heartbeatTimer: TimerToken = null;
  private heartbeatIntervalMs: number;
  private seq = 0;

  private state: AgentState = "unknown";
  private agentSessionId = "session-unknown";
  private currentTurnId?: string;
  private blockedReason?: BlockedReason;
  private lastOutcome?: TurnOutcome;

  private readonly blockers = new Map<
    string,
    { kind: "approval" | "question"; toolCallId: string }
  >();

  private isTurnActive = false;
  private isRetrying = false;
  private isCompacting = false;
  private settleTimer: TimerToken = null;

  public lastSentReport: ReporterReport | null = null;

  constructor(options: AdapterOptions) {
    this.wsUrl = options.wsUrl;
    this.token = options.token;
    this.reporterId = options.reporterId || crypto.randomUUID();
    this.adapterVersion = options.adapterVersion || ADAPTER_VERSION;
    this.settleDelayMs = options.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;
    this.heartbeatIntervalMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.reconnectDelays = options.reconnectDelays ?? DEFAULT_RECONNECT_DELAYS;
    this.logger = options.logger;

    this.webSocketFactory =
      options.webSocketFactory ||
      ((url, headers) => {
        const globalScope = globalThis as unknown as {
          WebSocket: new (
            url: string,
            protocolsOrOptions?: unknown,
          ) => WebSocket;
        };
        return new globalScope.WebSocket(url, { headers });
      });
  }

  public connect(): void {
    if (this.isShuttingDown || this.ws) return;

    try {
      const headers = { Authorization: `Bearer ${this.token}` };
      const socket = this.webSocketFactory(this.wsUrl, headers);
      this.ws = socket;

      socket.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempt = 0;
        this.sendHello();
      };

      socket.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data);
      };

      socket.onclose = () => {
        this.cleanupConnection();
        this.scheduleReconnect();
      };

      socket.onerror = (err: Event) => {
        this.logger?.debug?.("Agent status reporter socket error", err);
      };
    } catch (e) {
      this.logger?.warn?.("Failed to establish reporter connection", e);
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    this.isShuttingDown = true;
    this.clearAllTimers();
    if (this.ws && this.isAdmitted) {
      try {
        this.sendReportDirect("release", {
          state: "unknown",
          blockedReason: undefined,
          turnId: undefined,
        });
      } catch {
        // best-effort release notice
      }
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore close error
      }
      this.ws = null;
    }
    this.cleanupConnection();
  }

  public onSessionStart(sessionId: string | undefined, isIdle: boolean): void {
    this.agentSessionId = sanitizeSessionId(sessionId);
    this.blockers.clear();
    this.blockedReason = undefined;
    this.cancelSettle();
    this.isTurnActive = false;
    this.isRetrying = false;
    this.isCompacting = false;
    this.currentTurnId = undefined;
    this.state = isIdle ? "idle" : "working";

    if (this.isAdmitted) {
      this.sendReport("snapshot", {
        state: this.state,
        blockedReason: this.blockedReason,
        turnId: this.currentTurnId,
      });
    }
  }

  public onSessionSwitch(newSessionId: string | undefined, isIdle: boolean): void {
    this.agentSessionId = sanitizeSessionId(newSessionId);
    this.blockers.clear();
    this.blockedReason = undefined;
    this.cancelSettle();
    this.isTurnActive = false;
    this.isRetrying = false;
    this.isCompacting = false;
    this.currentTurnId = undefined;
    this.lastOutcome = undefined;
    this.state = isIdle ? "idle" : "working";

    if (this.isAdmitted) {
      this.sendReport("session-changed", {
        state: this.state,
        blockedReason: this.blockedReason,
        turnId: undefined,
      });
    }
  }

  public onAgentStart(): void {
    this.cancelSettle();
    this.isTurnActive = true;
    if (!this.currentTurnId) {
      this.currentTurnId = crypto.randomUUID();
    }
    if (this.blockers.size === 0) {
      this.state = "working";
      this.blockedReason = undefined;
      this.sendReport("turn-started", {
        state: "working",
        turnId: this.currentTurnId,
      });
    }
  }

  public onAgentEnd(event: AgentEndEventPayload): void {
    if (!this.isTurnActive && !this.currentTurnId) {
      return;
    }

    if (event.willContinue === true) {
      this.cancelSettle();
      return;
    }

    this.cancelSettle();
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.handleSettledEnd(event.messages);
    }, this.settleDelayMs);
  }

  public onToolApprovalRequested(toolCallId: string, _toolName?: string): void {
    if (!toolCallId) return;
    const key = `${this.agentSessionId}:approval:${toolCallId}`;
    this.blockers.set(key, { kind: "approval", toolCallId });
    this.updateBlockedState();
  }

  public onToolApprovalResolved(toolCallId: string, _toolName?: string): void {
    if (!toolCallId) return;
    const key = `${this.agentSessionId}:approval:${toolCallId}`;
    if (this.blockers.delete(key)) {
      this.updateBlockedState();
    }
  }

  public onToolExecutionStart(toolCallId: string, toolName: string): void {
    if (toolName === "ask" && toolCallId) {
      const key = `${this.agentSessionId}:ask:${toolCallId}`;
      this.blockers.set(key, { kind: "question", toolCallId });
      this.updateBlockedState();
    }
  }

  public onToolExecutionEnd(toolCallId: string, toolName: string): void {
    if (toolName === "ask" && toolCallId) {
      const key = `${this.agentSessionId}:ask:${toolCallId}`;
      if (this.blockers.delete(key)) {
        this.updateBlockedState();
      }
    }
  }

  public onAutoRetryStart(): void {
    this.cancelSettle();
    this.isRetrying = true;
    if (this.blockers.size === 0 && this.state !== "working") {
      this.state = "working";
      this.sendReport("state-changed", { state: "working" });
    }
  }

  public onAutoRetryEnd(_success: boolean): void {
    this.isRetrying = false;
  }

  public onAutoCompactionStart(): void {
    this.cancelSettle();
    this.isCompacting = true;
    if (this.blockers.size === 0 && this.state !== "working") {
      this.state = "working";
      this.sendReport("state-changed", { state: "working" });
    }
  }

  public onAutoCompactionEnd(): void {
    this.isCompacting = false;
  }

  public onSessionShutdown(): void {
    this.disconnect();
  }

  private handleSettledEnd(messages?: AssistantMessageSnapshot[]): void {
    if (this.isRetrying || this.isCompacting) {
      return;
    }
    if (!this.isTurnActive && !this.currentTurnId) {
      return;
    }
    let lastStopReason: string | undefined;
    if (Array.isArray(messages)) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg && msg.role === "assistant") {
          lastStopReason = msg.stopReason;
          break;
        }
      }
    }

    const { outcome, state, reason } = classifyStopReason(lastStopReason);
    const turnId = this.currentTurnId || crypto.randomUUID();

    this.isTurnActive = false;
    this.currentTurnId = undefined;
    this.lastOutcome = outcome;
    this.state = state;
    this.blockedReason = reason;

    this.sendReport("turn-ended", {
      event: "turn-ended",
      state: this.state,
      turnId,
      outcome,
      blockedReason: this.blockedReason,
    });
  }

  private updateBlockedState(): void {
    if (this.blockers.size > 0) {
      let hasApproval = false;
      let hasQuestion = false;
      for (const item of this.blockers.values()) {
        if (item.kind === "approval") hasApproval = true;
        if (item.kind === "question") hasQuestion = true;
      }

      const reason: BlockedReason = hasApproval
        ? "approval"
        : hasQuestion
          ? "question"
          : "error";

      this.state = "blocked";
      this.blockedReason = reason;

      this.sendReport("state-changed", {
        state: "blocked",
        blockedReason: reason,
      });
    } else {
      this.blockedReason = undefined;
      const targetState: AgentState =
        this.isTurnActive || this.isRetrying || this.isCompacting
          ? "working"
          : "idle";
      this.state = targetState;

      this.sendReport("state-changed", {
        state: targetState,
        blockedReason: undefined,
      });
    }
  }

  private cancelSettle(): void {
    clearTimeout(this.settleTimer as unknown as number);
    this.settleTimer = null;
  }

  private clearAllTimers(): void {
    this.cancelSettle();
    clearTimeout(this.reconnectTimer as unknown as number);
    this.reconnectTimer = null;
    clearInterval(this.heartbeatTimer as unknown as number);
    this.heartbeatTimer = null;
  }

  private cleanupConnection(): void {
    this.isConnected = false;
    this.isAdmitted = false;
    clearInterval(this.heartbeatTimer as unknown as number);
    this.heartbeatTimer = null;
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.isShuttingDown || this.reconnectTimer !== null) return;

    const delayIndex = Math.min(
      this.reconnectAttempt,
      this.reconnectDelays.length - 1,
    );
    const delay = this.reconnectDelays[delayIndex];
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private sendHello(): void {
    if (!this.ws || !this.isConnected) return;
    const hello: ReporterHello = {
      version: AGENT_STATUS_PROTOCOL_VERSION,
      agentKind: "omp",
      reporterId: this.reporterId,
      agentSessionId: this.agentSessionId,
      adapterVersion: this.adapterVersion,
    };
    try {
      this.ws.send(JSON.stringify(hello));
    } catch (e) {
      this.logger?.warn?.("Failed to send hello", e);
    }
  }

  private handleMessage(rawData: unknown): void {
    if (typeof rawData !== "string") return;
    try {
      const msg = JSON.parse(rawData) as ServerMessage;
      if (msg.kind === "accepted") {
        this.isAdmitted = true;
        this.seq = 0;
        this.heartbeatIntervalMs = msg.heartbeatMs || DEFAULT_HEARTBEAT_MS;
        this.startHeartbeat();

        this.sendReport("snapshot", {
          state: this.state,
          blockedReason: this.blockedReason,
          turnId: this.currentTurnId,
          outcome: this.lastOutcome,
        });
      } else if (msg.kind === "rejected") {
        this.logger?.warn?.("Reporter rejected by server", msg.reason);
        this.isAdmitted = false;
        this.isShuttingDown = true;
        this.clearAllTimers();
        if (this.ws) {
          try {
            this.ws.close();
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      this.logger?.debug?.("Malformed server message", e);
    }
  }

  private startHeartbeat(): void {
    clearInterval(this.heartbeatTimer as unknown as number);
    this.heartbeatTimer = setInterval(() => {
      if (this.isAdmitted && this.ws && this.isConnected) {
        this.sendReport("heartbeat", {
          state: this.state,
          blockedReason: this.blockedReason,
        });
      }
    }, this.heartbeatIntervalMs);
  }

  public sendReport(
    event: ReporterEventKind,
    fields?: Partial<ReporterReport>,
  ): void {
    if (!this.isAdmitted || !this.ws || !this.isConnected) {
      return;
    }
    this.sendReportDirect(event, fields);
  }

  private sendReportDirect(
    event: ReporterEventKind,
    fields?: Partial<ReporterReport>,
  ): void {
    if (!this.ws) return;

    this.seq++;
    const report: ReporterReport = {
      kind: "report",
      seq: this.seq,
      event,
      state: fields?.state ?? this.state,
      agentSessionId: this.agentSessionId,
      turnId: fields?.turnId ?? (event === "turn-started" ? this.currentTurnId : undefined),
      outcome: fields?.outcome,
      blockedReason: fields?.blockedReason ?? (this.state === "blocked" ? this.blockedReason : undefined),
      ...fields,
    };

    if (report.state !== "blocked") {
      delete report.blockedReason;
    }
    if (event !== "turn-ended" && event !== "snapshot") {
      delete report.outcome;
    }
    if (event !== "turn-started" && event !== "turn-ended" && event !== "snapshot") {
      delete report.turnId;
    }

    this.lastSentReport = report;

    try {
      this.ws.send(JSON.stringify(report));
    } catch (e) {
      this.logger?.warn?.("Failed to send report", e);
    }
  }

  public getState(): AgentState {
    return this.state;
  }

  public getBlockedReason(): BlockedReason | undefined {
    return this.blockedReason;
  }

  public getCurrentTurnId(): string | undefined {
    return this.currentTurnId;
  }

  public getReporterId(): string {
    return this.reporterId;
  }

  public getAgentSessionId(): string {
    return this.agentSessionId;
  }

  public getBlockerCount(): number {
    return this.blockers.size;
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public getIsAdmitted(): boolean {
    return this.isAdmitted;
  }
}

// ============================================================================
// OMP Standalone Extension Factory (Default Export)
// ============================================================================

export default function damHopperAgentStatusExtension(pi: OmpExtensionAPI): void {
  const rawUrl = process.env.DAM_HOPPER_AGENT_STATUS_URL;
  const token = process.env.DAM_HOPPER_AGENT_STATUS_TOKEN;
  if (!rawUrl || !token) {
    return;
  }

  if (process.env.OMPCODE === "1") {
    return;
  }

  const validUrl = validateLoopbackWsUrl(rawUrl);
  if (!validUrl) {
    return;
  }

  if (token.length > 128 || !/^[\x21-\x7E]+$/.test(token)) {
    return;
  }

  let adapter: OmpAgentStatusAdapter | null = null;

  pi.on("session_start", (_event: unknown, ctxUnknown: unknown) => {
    const ctx = ctxUnknown as OmpExtensionContext | undefined;
    if (!ctx || ctx.hasUI !== true) {
      return;
    }
    if (ctx.agent && ctx.agent.kind && ctx.agent.kind !== "main") {
      return;
    }

    if (!adapter) {
      adapter = new OmpAgentStatusAdapter({
        wsUrl: validUrl.toString(),
        token,
        logger: pi.logger,
      });
      adapter.connect();
    }

    const sessionId = ctx.sessionManager?.getSessionId?.();
    const isIdle = typeof ctx.isIdle === "function" ? ctx.isIdle() : true;
    adapter.onSessionStart(sessionId, isIdle);
  });

  pi.on("session_switch", (_event: unknown, ctxUnknown: unknown) => {
    if (!adapter) return;
    const ctx = ctxUnknown as OmpExtensionContext | undefined;
    const sessionId = ctx?.sessionManager?.getSessionId?.();
    const isIdle = typeof ctx?.isIdle === "function" ? ctx.isIdle() : true;
    adapter.onSessionSwitch(sessionId, isIdle);
  });

  pi.on("agent_start", () => {
    adapter?.onAgentStart();
  });

  pi.on("agent_end", (eventUnknown: unknown) => {
    const event = (eventUnknown as AgentEndEventPayload) || {};
    adapter?.onAgentEnd(event);
  });

  pi.on("tool_approval_requested", (eventUnknown: unknown) => {
    const event = eventUnknown as ToolApprovalEventPayload | undefined;
    if (event?.toolCallId) {
      adapter?.onToolApprovalRequested(event.toolCallId, event.toolName);
    }
  });

  pi.on("tool_approval_resolved", (eventUnknown: unknown) => {
    const event = eventUnknown as ToolApprovalEventPayload | undefined;
    if (event?.toolCallId) {
      adapter?.onToolApprovalResolved(event.toolCallId, event.toolName);
    }
  });

  pi.on("tool_execution_start", (eventUnknown: unknown) => {
    const event = eventUnknown as ToolExecutionEventPayload | undefined;
    if (event?.toolCallId && event?.toolName) {
      adapter?.onToolExecutionStart(event.toolCallId, event.toolName);
    }
  });

  pi.on("tool_execution_end", (eventUnknown: unknown) => {
    const event = eventUnknown as ToolExecutionEventPayload | undefined;
    if (event?.toolCallId && event?.toolName) {
      adapter?.onToolExecutionEnd(event.toolCallId, event.toolName);
    }
  });

  pi.on("auto_retry_start", () => {
    adapter?.onAutoRetryStart();
  });

  pi.on("auto_retry_end", (eventUnknown: unknown) => {
    const event = eventUnknown as AutoRetryEndEventPayload | undefined;
    adapter?.onAutoRetryEnd(event?.success ?? false);
  });

  pi.on("auto_compaction_start", () => {
    adapter?.onAutoCompactionStart();
  });

  pi.on("auto_compaction_end", () => {
    adapter?.onAutoCompactionEnd();
  });

  pi.on("session_shutdown", () => {
    adapter?.onSessionShutdown();
    adapter = null;
  });
}
