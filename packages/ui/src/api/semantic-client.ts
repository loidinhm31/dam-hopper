/**
 * SemanticClient — owner-bound WebSocket JSON-RPC client for /ws/semantic/v1.
 *
 * Implements:
 * - Subprotocol dam-hopper.semantic.lsp.v1.
 * - Strict lifecycle: attachTarget -> initialize -> initialized -> model replay -> ready.
 * - Single-kind adaptive sync using server-negotiated UTF-8 byte threshold.
 * - Exact UTF-8 post-edit threshold accounting and monotonic document versions.
 * - Filtered-profile navigation with damHopperDocumentVersion fence.
 * - Cancellation via $/cancelRequest and request timeout boundaries.
 * - Server configuration replies ([{}, ...]).
 * - Clean teardown and model unbinding on disconnect/invalidation.
 */

import {
  detectLanguageDescriptor,
  parseSemanticWireUri,
  type SemanticModelRegistry,
  defaultSemanticModelRegistry,
  type SemanticProvenance,
  captureSemanticProvenance,
  matchesSemanticProvenance,
  computeUtf8Sha256Hex,
  computeUtf8Sha256HexSync,
  normalizeSemanticServerUrl,
  projectSemanticText,
  projectMaterializedText,
} from "@/lib/semantic-model-uri.js";

export {
  type SemanticProvenance,
  captureSemanticProvenance,
  matchesSemanticProvenance,
  computeUtf8Sha256Hex,
  computeUtf8Sha256HexSync,
};

export const SEMANTIC_SUBPROTOCOL = "dam-hopper.semantic.lsp.v1";
const INERT_PREHANDSHAKE_POLICY: SemanticNegotiatedPolicy = Object.freeze({
  version: "",
  adaptiveSyncThresholdBytes: 0,
  maxDocumentBytes: 0,
  maxOpenDocuments: 0,
  maxSessionOverlayBytes: 0,
  maxInFlightRequests: 0,
});
export const HANDSHAKE_TIMEOUT_MS = 15000;
export const NAVIGATION_TIMEOUT_MS = 5000;

export type SemanticClientStatus =
  | "disconnected"
  | "connecting"
  | "attaching"
  | "initializing"
  | "replaying"
  | "ready"
  | "error"
  | "unsupported";

export interface SemanticNegotiatedPolicy {
  readonly version: string;
  readonly adaptiveSyncThresholdBytes: number;
  readonly maxDocumentBytes: number;
  readonly maxOpenDocuments: number;
  readonly maxSessionOverlayBytes: number;
  readonly maxInFlightRequests: number;
}

export interface SemanticLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  damHopperDestinationContentSha256?: string;
  damHopperDestinationVersion?: number | null;
  damHopperDestinationIncarnation?: number | null;
}

export interface SemanticLocationLink {
  targetUri: string;
  targetRange: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  targetSelectionRange: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  originSelectionRange?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  damHopperDestinationContentSha256?: string;
  damHopperDestinationVersion?: number | null;
  damHopperDestinationIncarnation?: number | null;
}

export interface SemanticNavigationResult {
  locations: SemanticLocation[];
  outsideTarget?: boolean;
}

export interface SemanticClientOptions {
  wsUrl: string;
  serverUrl?: string;
  token?: string | null;
  profileId: string;
  project: string;
  worktreePath?: string | null;
  targetKey: string;
  connectionGeneration: number;
  targetGeneration: number;
  sessionGeneration?: number;
  provenance?: SemanticProvenance | null;
  getModelText?: (tabKey: string) => string | undefined;
  registry?: SemanticModelRegistry;
  onStatusChange?: (status: SemanticClientStatus, error?: string) => void;
  onSyncInvalidated?: (tabKey: string) => void;
  isProfileEnabled?: () => boolean;
  hasActiveRef?: () => boolean;
}

type TimeoutHandle = number | NodeJS.Timeout;

interface PendingRequest {
  id: number | string;
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: TimeoutHandle;
}

interface ReservationEntry {
  readonly id: number;
  readonly tabKey: string;
  readonly bytes: number;
}

interface SocketAttempt {
  readonly attemptId: number;
  readonly ws: WebSocket;
  readonly sessionGeneration: number;
  targetId: string | null;
  negotiatedPolicy: SemanticNegotiatedPolicy | null;
  retired: boolean;
  settled: boolean;
  connectPromise: Promise<void>;
  resolveConnect: () => void;
  rejectConnect: (reason: unknown) => void;
  lastError?: string | null;
  readonly pendingRequests: Map<number | string, PendingRequest>;
  readonly openDocumentBytes: Map<string, number>;
  readonly activeReservations: Map<number, ReservationEntry>;
}

function isPositiveSafeInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseAttachNegotiatedPolicy(raw: unknown): SemanticNegotiatedPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      "Invalid attachTarget response: missing or malformed resource policy",
    );
  }
  if ("version" in raw || "thresholdBytes" in raw) {
    throw new Error(
      "Invalid attachTarget response: unexpected policy field alias",
    );
  }

  const version =
    "resourcePolicyVersion" in raw ? raw.resourcePolicyVersion : undefined;
  const adaptiveSyncThresholdBytes =
    "adaptiveSyncThresholdBytes" in raw
      ? raw.adaptiveSyncThresholdBytes
      : undefined;
  const maxDocumentBytes =
    "maxDocumentBytes" in raw ? raw.maxDocumentBytes : undefined;
  const maxOpenDocuments =
    "maxOpenDocuments" in raw ? raw.maxOpenDocuments : undefined;
  const maxSessionOverlayBytes =
    "maxSessionOverlayBytes" in raw ? raw.maxSessionOverlayBytes : undefined;
  const maxInFlightRequests =
    "maxInFlightRequests" in raw ? raw.maxInFlightRequests : undefined;

  if (
    !isNonEmptyString(version) ||
    !isPositiveSafeInt(adaptiveSyncThresholdBytes) ||
    !isPositiveSafeInt(maxDocumentBytes) ||
    !isPositiveSafeInt(maxOpenDocuments) ||
    !isPositiveSafeInt(maxSessionOverlayBytes) ||
    !isPositiveSafeInt(maxInFlightRequests)
  ) {
    throw new Error(
      "Invalid attachTarget response: missing or malformed resource policy",
    );
  }

  return Object.freeze({
    version: version.trim(),
    adaptiveSyncThresholdBytes,
    maxDocumentBytes,
    maxOpenDocuments,
    maxSessionOverlayBytes,
    maxInFlightRequests,
  });
}

function parseInitializeNegotiatedPolicy(
  raw: unknown,
): SemanticNegotiatedPolicy {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    !("capabilities" in raw)
  ) {
    throw new Error(
      "Invalid initialize response: missing capabilities object",
    );
  }
  const caps = raw.capabilities;
  if (
    !caps ||
    typeof caps !== "object" ||
    Array.isArray(caps) ||
    !("experimental" in caps)
  ) {
    throw new Error(
      "Invalid initialize response: missing experimental.damHopperAdaptiveSync policy",
    );
  }
  const exp = caps.experimental;
  if (
    !exp ||
    typeof exp !== "object" ||
    Array.isArray(exp) ||
    !("damHopperAdaptiveSync" in exp)
  ) {
    throw new Error(
      "Invalid initialize response: missing experimental.damHopperAdaptiveSync policy",
    );
  }
  const syncPolicy = exp.damHopperAdaptiveSync;
  if (
    !syncPolicy ||
    typeof syncPolicy !== "object" ||
    Array.isArray(syncPolicy)
  ) {
    throw new Error(
      "Invalid initialize response: malformed experimental.damHopperAdaptiveSync policy",
    );
  }
  if (
    "adaptiveSyncThresholdBytes" in syncPolicy ||
    "resourcePolicyVersion" in syncPolicy
  ) {
    throw new Error(
      "Invalid initialize response: unexpected damHopperAdaptiveSync field alias",
    );
  }

  const version = "version" in syncPolicy ? syncPolicy.version : undefined;
  const thresholdBytes =
    "thresholdBytes" in syncPolicy ? syncPolicy.thresholdBytes : undefined;
  const maxDocumentBytes =
    "maxDocumentBytes" in syncPolicy ? syncPolicy.maxDocumentBytes : undefined;
  const maxOpenDocuments =
    "maxOpenDocuments" in syncPolicy ? syncPolicy.maxOpenDocuments : undefined;
  const maxSessionOverlayBytes =
    "maxSessionOverlayBytes" in syncPolicy
      ? syncPolicy.maxSessionOverlayBytes
      : undefined;
  const maxInFlightRequests =
    "maxInFlightRequests" in syncPolicy
      ? syncPolicy.maxInFlightRequests
      : undefined;

  if (
    !isNonEmptyString(version) ||
    !isPositiveSafeInt(thresholdBytes) ||
    !isPositiveSafeInt(maxDocumentBytes) ||
    !isPositiveSafeInt(maxOpenDocuments) ||
    !isPositiveSafeInt(maxSessionOverlayBytes) ||
    !isPositiveSafeInt(maxInFlightRequests)
  ) {
    throw new Error(
      "Invalid initialize response: missing or malformed damHopperAdaptiveSync policy",
    );
  }

  return Object.freeze({
    version: version.trim(),
    adaptiveSyncThresholdBytes: thresholdBytes,
    maxDocumentBytes,
    maxOpenDocuments,
    maxSessionOverlayBytes,
    maxInFlightRequests,
  });
}

function negotiatedPoliciesEqual(
  a: SemanticNegotiatedPolicy,
  b: SemanticNegotiatedPolicy,
): boolean {
  return (
    a.version === b.version &&
    a.adaptiveSyncThresholdBytes === b.adaptiveSyncThresholdBytes &&
    a.maxDocumentBytes === b.maxDocumentBytes &&
    a.maxOpenDocuments === b.maxOpenDocuments &&
    a.maxSessionOverlayBytes === b.maxSessionOverlayBytes &&
    a.maxInFlightRequests === b.maxInFlightRequests
  );
}

function isRangeLike(value: unknown): value is SemanticLocation["range"] {
  if (!value || typeof value !== "object") return false;
  if (!("start" in value) || !("end" in value)) return false;
  const start = value.start;
  const end = value.end;
  return (
    Boolean(start && typeof start === "object") &&
    Boolean(end && typeof end === "object")
  );
}

export class SemanticClient {
  private ws: WebSocket | null = null;
  private currentAttempt: SocketAttempt | null = null;
  private status: SemanticClientStatus = "disconnected";
  private targetId: string | null = null;
  private sessionGeneration = 0;
  private nextAttemptId = 1;
  private nextRequestId = 1;
  private readonly registry: SemanticModelRegistry;
  private readonly documentQueues = new Map<string, Promise<void>>();
  private readonly provenance: SemanticProvenance | null;
  private negotiatedPolicy: SemanticNegotiatedPolicy = INERT_PREHANDSHAKE_POLICY;
  private textEncoder = new TextEncoder();
  private reconnectTimer: TimeoutHandle | undefined = undefined;
  private nextReservationId = 0;
  private readonly lastQueuedVersion = new Map<string, number>();
  private nextInvalidationGeneration = 0;

  constructor(private readonly options: SemanticClientOptions) {
    this.registry = options.registry ?? defaultSemanticModelRegistry;
    if (options.sessionGeneration && options.sessionGeneration > 0) {
      this.sessionGeneration = options.sessionGeneration - 1;
    }
    if (options.provenance !== undefined) {
      this.provenance = options.provenance
        ? {
            serverUrl: normalizeSemanticServerUrl(options.provenance.serverUrl),
            configuredRoot: options.provenance.configuredRoot ?? "",
            actor: options.provenance.actor,
          }
        : null;
    } else {
      this.provenance = captureSemanticProvenance(
        {
          profileId: options.profileId,
          project: options.project,
          worktreePath: options.worktreePath,
        },
      );
    }
  }

  getStatus(): SemanticClientStatus {
    return this.status;
  }

  getTargetId(): string | null {
    return this.targetId;
  }

  getProvenance(): SemanticProvenance | null {
    return this.provenance;
  }

  getNegotiatedPolicy(): SemanticNegotiatedPolicy {
    return this.negotiatedPolicy;
  }

  getAdaptiveSyncThresholdBytes(): number {
    return this.negotiatedPolicy.adaptiveSyncThresholdBytes;
  }

  hasScheduledReconnect(): boolean {
    return this.reconnectTimer !== undefined;
  }

  /**
   * Validate whether this client is authorized to read, open, replay, edit, or query
   * the registered model for `tabKey`. Fails closed on missing or mismatched provenance.
   */
  canAccessModel(tabKey: string): boolean {
    if (!this.provenance) return false;
    const model = this.registry.getByTabKey(tabKey);
    if (!model || !model.identity.provenance) return false;
    if (
      model.identity.profileId !== this.options.profileId ||
      model.identity.project !== this.options.project ||
      model.identity.targetKey !== this.options.targetKey
    ) {
      return false;
    }
    if (
      !matchesSemanticProvenance(model.identity.provenance, this.provenance)
    ) {
      return false;
    }
    const liveProvenance = captureSemanticProvenance(
      {
        profileId: this.options.profileId,
        project: this.options.project,
        worktreePath: this.options.worktreePath,
      },
    );
    if (!matchesSemanticProvenance(this.provenance, liveProvenance)) {
      return false;
    }
    return true;
  }

  private setStatus(status: SemanticClientStatus, error?: string): void {
    if (this.status !== status) {
      this.status = status;
      this.options.onStatusChange?.(status, error);
    }
  }

  private isCurrentAttempt(attempt: SocketAttempt): boolean {
    return (
      !attempt.retired &&
      this.currentAttempt === attempt &&
      this.ws === attempt.ws
    );
  }

  private setStatusForAttempt(
    attempt: SocketAttempt,
    status: SemanticClientStatus,
    error?: string,
  ): void {
    if (!this.isCurrentAttempt(attempt)) return;
    this.setStatus(status, error);
  }

  private resolveAttemptConnect(attempt: SocketAttempt): void {
    if (attempt.settled) return;
    attempt.settled = true;
    attempt.resolveConnect();
  }

  private rejectAttemptConnect(attempt: SocketAttempt, reason: unknown): void {
    if (attempt.settled) return;
    attempt.settled = true;
    attempt.rejectConnect(reason);
  }

  private retireAttempt(
    attempt: SocketAttempt,
    options: {
      rejectReason?: unknown;
      nextStatus?: SemanticClientStatus;
      statusError?: string;
      sendExit?: boolean;
      closeSocket?: boolean;
    } = {},
  ): void {
    const wasCurrent = this.currentAttempt === attempt;
    attempt.retired = true;
    attempt.negotiatedPolicy = null;
    if (!attempt.settled) {
      this.rejectAttemptConnect(
        attempt,
        options.rejectReason instanceof Error
          ? options.rejectReason
          : new Error(
              typeof options.rejectReason === "string"
                ? options.rejectReason
                : "Semantic connection closed before handshake completed",
            ),
      );
    }

    for (const [id, req] of attempt.pendingRequests) {
      clearTimeout(req.timer);
      req.reject(
        new Error(`Semantic connection closed before request ${id} completed`),
      );
    }
    attempt.pendingRequests.clear();
    attempt.openDocumentBytes.clear();
    attempt.activeReservations.clear();

    if (attempt.targetId) {
      this.registry.clearWireBindings(
        attempt.targetId,
        attempt.sessionGeneration,
      );
    }

    if (options.closeSocket !== false) {
      try {
        if (
          options.sendExit &&
          attempt.ws.readyState === WebSocket.OPEN &&
          wasCurrent &&
          this.status === "ready"
        ) {
          attempt.ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "exit",
              params: {},
            }),
          );
        }
        attempt.ws.close(1000, "Normal closure");
      } catch {
        // Ignore socket close errors
      }
    }

    if (wasCurrent) {
      this.currentAttempt = null;
      this.ws = null;
      this.targetId = null;
      this.negotiatedPolicy = INERT_PREHANDSHAKE_POLICY;
      this.documentQueues.clear();
      if (options.nextStatus) {
        this.setStatus(options.nextStatus, options.statusError);
      }
    }
  }

  /**
   * Connect and execute the handshake sequence.
   */
  async connect(): Promise<void> {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;

    if (
      this.currentAttempt &&
      !this.currentAttempt.retired &&
      (this.currentAttempt.ws.readyState === WebSocket.OPEN ||
        this.currentAttempt.ws.readyState === WebSocket.CONNECTING)
    ) {
      if (this.status === "ready") {
        return;
      }
      return this.currentAttempt.connectPromise;
    }

    if (this.currentAttempt) {
      this.retireAttempt(this.currentAttempt, {
        rejectReason: new Error("Semantic connection attempt superseded"),
        closeSocket: true,
      });
    }

    this.setStatus("connecting");

    let urlString = this.options.wsUrl;
    if (this.options.token) {
      const sep = urlString.includes("?") ? "&" : "?";
      urlString += `${sep}token=${encodeURIComponent(this.options.token)}`;
    }

    let resolveConnect!: () => void;
    let rejectConnect!: (reason: unknown) => void;
    const connectPromise = new Promise<void>((resolve, reject) => {
      resolveConnect = resolve;
      rejectConnect = reject;
    });

    try {
      const ws = new WebSocket(urlString, [SEMANTIC_SUBPROTOCOL]);
      this.sessionGeneration += 1;
      const attempt: SocketAttempt = {
        attemptId: this.nextAttemptId++,
        ws,
        sessionGeneration: this.sessionGeneration,
        targetId: null,
        negotiatedPolicy: null,
        retired: false,
        settled: false,
        connectPromise,
        resolveConnect,
        rejectConnect,
        pendingRequests: new Map<number | string, PendingRequest>(),
        openDocumentBytes: new Map<string, number>(),
        activeReservations: new Map<number, ReservationEntry>(),
      };
      this.currentAttempt = attempt;
      this.ws = ws;
      this.targetId = null;
      this.negotiatedPolicy = INERT_PREHANDSHAKE_POLICY;
      ws.onopen = async () => {
        if (!this.isCurrentAttempt(attempt)) {
          this.rejectAttemptConnect(
            attempt,
            new Error("Semantic connection attempt superseded"),
          );
          return;
        }
        try {
          await this.performHandshake(attempt);
          if (!this.isCurrentAttempt(attempt)) {
            this.rejectAttemptConnect(
              attempt,
              new Error("Semantic connection attempt superseded"),
            );
            return;
          }
          this.resolveAttemptConnect(attempt);
        } catch (e) {
          this.rejectAttemptConnect(attempt, e);
        }
      };

      ws.onmessage = (event) => {
        if (!this.isCurrentAttempt(attempt)) return;
        this.handleMessage(attempt, event.data);
      };

      ws.onerror = () => {
        attempt.lastError = "WebSocket connection error";
      };

      ws.onclose = (ev: CloseEvent | { code?: number; reason?: string }) => {
        const code = ev?.code ?? 1006;
        const reason = ev?.reason || attempt.lastError || "WebSocket closed";
        this.rejectAttemptConnect(
          attempt,
          new Error(`WebSocket closed (${code}): ${reason}`),
        );
        if (!this.isCurrentAttempt(attempt)) return;
        const isTerminal = code === 1008 || code === 4401 || code === 4403 || code === 1000;
        this.retireAttempt(attempt, {
          rejectReason: new Error(`WebSocket closed (${code}): ${reason}`),
          nextStatus: isTerminal && (code === 4401 || code === 4403) ? "error" : "disconnected",
          statusError: isTerminal && (code === 4401 || code === 4403) ? reason : undefined,
          closeSocket: false,
        });

        if (!isTerminal) {
          this.scheduleReconnect();
        }
      };
    } catch (e) {
      this.setStatus("error", String(e));
      rejectConnect(e);
    }

    return connectPromise;
  }


  private async performHandshake(attempt: SocketAttempt): Promise<void> {
    try {
      if (!this.isCurrentAttempt(attempt)) {
        throw new Error("Semantic connection attempt superseded");
      }

      // 1. Attach target (strictly using target.worktreePath, no worktree alias)
      this.setStatusForAttempt(attempt, "attaching");
      const normalizedWorktreePath =
        typeof this.options.worktreePath === "string" &&
        this.options.worktreePath.trim().length > 0
          ? this.options.worktreePath.trim()
          : undefined;

      const attachRes = await this.sendRequestForAttempt(
        attempt,
        "damHopper/attachTarget",
        {
          target: {
            project: this.options.project,
            ...(normalizedWorktreePath
              ? { worktreePath: normalizedWorktreePath }
              : {}),
          },
          descriptor: "typescript",
        },
        HANDSHAKE_TIMEOUT_MS,
      );

      if (!this.isCurrentAttempt(attempt)) {
        throw new Error("Semantic connection attempt superseded");
      }

      const attachedTargetId =
        attachRes &&
        typeof attachRes === "object" &&
        "targetId" in attachRes &&
        typeof attachRes.targetId === "string" &&
        attachRes.targetId.length > 0
          ? attachRes.targetId
          : null;

      if (!attachedTargetId) {
        throw new Error("Invalid attachTarget response: missing targetId");
      }

      const attachPolicy = parseAttachNegotiatedPolicy(attachRes);
      attempt.targetId = attachedTargetId;
      this.targetId = attachedTargetId;

      // 2. Initialize
      this.setStatusForAttempt(attempt, "initializing");
      const initRes = await this.sendRequestForAttempt(
        attempt,
        "initialize",
        {
          capabilities: {
            textDocument: {
              synchronization: {
                dynamicRegistration: false,
                willSave: false,
                willSaveWaitUntil: false,
                didSave: false,
              },
              definition: { dynamicRegistration: false, linkSupport: true },
              implementation: { dynamicRegistration: false, linkSupport: true },
            },
          },
        },
        HANDSHAKE_TIMEOUT_MS,
      );

      if (!this.isCurrentAttempt(attempt)) {
        throw new Error("Semantic connection attempt superseded");
      }

      const initPolicy = parseInitializeNegotiatedPolicy(initRes);
      if (!negotiatedPoliciesEqual(attachPolicy, initPolicy)) {
        throw new Error(
          "Invalid initialize response: damHopperAdaptiveSync policy disagrees with attachTarget policy",
        );
      }
      attempt.negotiatedPolicy = attachPolicy;
      this.negotiatedPolicy = attachPolicy;
      // 3. Initialized notification
      this.sendNotificationForAttempt(attempt, "initialized", {});

      // 4. Model replay barrier
      this.setStatusForAttempt(attempt, "replaying");
      await this.replayMatchingModels(attempt);

      if (!this.isCurrentAttempt(attempt)) {
        throw new Error("Semantic connection attempt superseded");
      }

      // 5. Ready
      this.setStatusForAttempt(attempt, "ready");
    } catch (e) {
      this.rejectAttemptConnect(attempt, e);
      if (this.isCurrentAttempt(attempt)) {
        this.retireAttempt(attempt, {
          rejectReason: e,
          nextStatus: "error",
          statusError: String(e),
          closeSocket: true,
        });
      } else {
        // Attempt was already superseded; close only its own socket and bindings without touching replacement
        attempt.retired = true;
        attempt.negotiatedPolicy = null;
        for (const [, req] of attempt.pendingRequests) {
          clearTimeout(req.timer);
        }
        attempt.pendingRequests.clear();
        if (attempt.targetId) {
          this.registry.clearWireBindings(
            attempt.targetId,
            attempt.sessionGeneration,
          );
        }
        try {
          attempt.ws.close();
        } catch {
          // Ignore close errors
        }
      }
      throw e;
    }
  }

  private calculateSessionBytes(
    attempt: SocketAttempt,
    excludeTabKey?: string,
  ): number {
    const allTabs = new Set<string>();
    for (const tab of attempt.openDocumentBytes.keys()) allTabs.add(tab);
    for (const res of attempt.activeReservations.values()) allTabs.add(res.tabKey);

    let total = 0;
    for (const tab of allTabs) {
      if (tab === excludeTabKey) continue;
      const serverBytes = attempt.openDocumentBytes.get(tab) ?? 0;
      let maxPending = 0;
      for (const res of attempt.activeReservations.values()) {
        if (res.tabKey === tab && res.bytes > maxPending) {
          maxPending = res.bytes;
        }
      }
      total += Math.max(serverBytes, maxPending);
    }
    return total;
  }

  private canAdmitOverlayBytes(
    attempt: SocketAttempt,
    tabKey: string,
    nextBytes: number,
  ): boolean {
    const policy = attempt.negotiatedPolicy;
    if (
      !policy ||
      policy.maxDocumentBytes <= 0 ||
      policy.maxOpenDocuments <= 0 ||
      policy.maxSessionOverlayBytes <= 0 ||
      policy.adaptiveSyncThresholdBytes <= 0
    ) {
      return false;
    }
    if (nextBytes > policy.maxDocumentBytes) {
      return false;
    }
    const hasExistingServer = attempt.openDocumentBytes.has(tabKey);
    let hasExistingPending = false;
    for (const res of attempt.activeReservations.values()) {
      if (res.tabKey === tabKey) {
        hasExistingPending = true;
        break;
      }
    }
    if (
      !hasExistingServer &&
      !hasExistingPending &&
      attempt.openDocumentBytes.size >= policy.maxOpenDocuments
    ) {
      return false;
    }

    const otherBytes = this.calculateSessionBytes(attempt, tabKey);
    return otherBytes + nextBytes <= policy.maxSessionOverlayBytes;
  }

  private async replayMatchingModels(attempt: SocketAttempt): Promise<void> {
    if (
      !this.isCurrentAttempt(attempt) ||
      !attempt.targetId ||
      !attempt.negotiatedPolicy
    ) {
      return;
    }

    const allRegistered = this.registry.getAllRegistered();
    for (const model of allRegistered) {
      if (!this.isCurrentAttempt(attempt)) return;
      const tabKey = model.identity.tabKey;
      if (!this.canAccessModel(tabKey)) {
        continue;
      }

      const lang = detectLanguageDescriptor(model.identity.relativePath);
      if (!lang) continue;

      const rawText = this.options.getModelText
        ? this.options.getModelText(tabKey)
        : "";
      if (typeof rawText !== "string") {
        continue;
      }
      const text = projectSemanticText(rawText);
      const byteLength = this.textEncoder.encode(text).length;
      if (!this.canAdmitOverlayBytes(attempt, tabKey, byteLength)) {
        if (model.wireBinding) {
          model.wireBinding.unsynchronized = true;
        }
        continue;
      }

      const binding = this.registry.bindWire(tabKey, {
        targetId: attempt.targetId,
        connectionGeneration: this.options.connectionGeneration,
        targetGeneration: this.options.targetGeneration,
        sessionGeneration: attempt.sessionGeneration,
        languageDescriptor: lang,
        initialWireVersion: 1,
      });

      if (!binding) continue;
      attempt.openDocumentBytes.set(tabKey, byteLength);

      this.sendNotificationForAttempt(attempt, "textDocument/didOpen", {
        textDocument: {
          uri: binding.wireUri,
          languageId: lang,
          version: 1,
          text,
        },
      });
    }
  }

  /**
   * Synchronize document open.
   */
  async notifyDidOpen(
    tabKey: string,
    text: string,
    forceResync = false,
  ): Promise<void> {
    const attempt = this.currentAttempt;
    if (
      this.status !== "ready" ||
      !attempt ||
      !this.isCurrentAttempt(attempt) ||
      !attempt.targetId ||
      !attempt.negotiatedPolicy
    ) {
      return;
    }
    if (!this.canAccessModel(tabKey)) return;

    const model = this.registry.getByTabKey(tabKey);
    if (!model) return;

    const lang = detectLanguageDescriptor(model.identity.relativePath);
    if (!lang) return;

    const byteLength = this.textEncoder.encode(text).length;
    if (!this.canAdmitOverlayBytes(attempt, tabKey, byteLength)) {
      if (model.wireBinding) {
        model.wireBinding.unsynchronized = true;
      }
      return;
    }

    let binding = model.wireBinding;
    const isAlreadyBound =
      binding &&
      binding.targetId === attempt.targetId &&
      binding.sessionGeneration === attempt.sessionGeneration;

    if (isAlreadyBound && !forceResync) {
      return;
    }

    binding = this.registry.bindWire(tabKey, {
      targetId: attempt.targetId,
      connectionGeneration: this.options.connectionGeneration,
      targetGeneration: this.options.targetGeneration,
      sessionGeneration: attempt.sessionGeneration,
      languageDescriptor: lang,
      initialWireVersion: 1,
    });

    if (!binding) return;
    binding.wireVersion = 1;
    attempt.openDocumentBytes.set(tabKey, byteLength);

    this.sendNotificationForAttempt(attempt, "textDocument/didOpen", {
      textDocument: {
        uri: binding.wireUri,
        languageId: lang,
        version: 1,
        text,
      },
    });
  }

  /**
   * Synchronize document change with single-kind adaptive sync using server-negotiated threshold:
   * - < adaptiveSyncThresholdBytes post-edit UTF-8 size: full text replacement { text: newFullContent }
   * - >= adaptiveSyncThresholdBytes post-edit UTF-8 size: incremental edit { range, rangeLength, text }
   */
  async notifyDidChange(
    tabKey: string,
    newFullContent: string,
    incrementalChanges?:
      | Array<{
          range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
          };
          rangeLength?: number;
          text: string;
        }>
      | {
          range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
          };
          rangeLength?: number;
          text: string;
        },
  ): Promise<number> {
    const attempt = this.currentAttempt;
    if (
      this.status !== "ready" ||
      !attempt ||
      !this.isCurrentAttempt(attempt) ||
      !attempt.targetId ||
      !attempt.negotiatedPolicy
    ) {
      return 0;
    }
    if (!this.canAccessModel(tabKey)) return 0;

    const model = this.registry.getByTabKey(tabKey);
    if (
      !model ||
      !model.wireBinding ||
      model.wireBinding.targetId !== attempt.targetId ||
      model.wireBinding.sessionGeneration !== attempt.sessionGeneration
    ) {
      return 0;
    }

    const binding = model.wireBinding;
    const byteLength = this.textEncoder.encode(newFullContent).length;
    if (!this.canAdmitOverlayBytes(attempt, tabKey, byteLength)) {
      binding.unsynchronized = true;
      binding.invalidationGen = ++this.nextInvalidationGeneration;
      this.options.onSyncInvalidated?.(tabKey);
      return 0;
    }

    const reservationId = ++this.nextReservationId;
    attempt.activeReservations.set(reservationId, {
      id: reservationId,
      tabKey,
      bytes: byteLength,
    });
    const taskInvalidationGen = binding.invalidationGen ?? 0;
    const newVersion = this.registry.bumpWireVersion(tabKey);
    this.lastQueuedVersion.set(tabKey, newVersion);
    const prevQueue = this.documentQueues.get(tabKey) ?? Promise.resolve();
    const nextTask = prevQueue
      .then(() => {
        const activePolicy = attempt.negotiatedPolicy;
        if (
          !this.isCurrentAttempt(attempt) ||
          !activePolicy ||
          activePolicy.adaptiveSyncThresholdBytes <= 0 ||
          !this.canAccessModel(tabKey) ||
          model.wireBinding !== binding
        ) {
          attempt.activeReservations.delete(reservationId);
          return;
        }
        const wasUnsynchronized = binding.unsynchronized === true;
        const thresholdBytes = activePolicy.adaptiveSyncThresholdBytes;
        const changesList = Array.isArray(incrementalChanges)
          ? incrementalChanges
          : incrementalChanges
            ? [incrementalChanges]
            : [];

        let contentChanges: unknown[];
        if (wasUnsynchronized || byteLength < thresholdBytes || changesList.length === 0) {
          contentChanges = [{ text: newFullContent }];
        } else {
          contentChanges = changesList.map((c) => {
            const item: { range: typeof c.range; text: string; rangeLength?: number } = {
              range: c.range,
              text: c.text,
            };
            if (typeof c.rangeLength === "number") {
              item.rangeLength = c.rangeLength;
            }
            return item;
          });
        }

        this.sendNotificationForAttempt(attempt, "textDocument/didChange", {
          textDocument: {
            uri: binding.wireUri,
            version: newVersion,
          },
          contentChanges,
        });
        if (
          this.lastQueuedVersion.get(tabKey) === newVersion &&
          (binding.invalidationGen ?? 0) === taskInvalidationGen
        ) {
          binding.unsynchronized = false;
        }
        attempt.openDocumentBytes.set(tabKey, byteLength);
        attempt.activeReservations.delete(reservationId);
      })
      .catch((e) => {
        attempt.activeReservations.delete(reservationId);
        binding.unsynchronized = true;
        binding.invalidationGen = ++this.nextInvalidationGeneration;
        if (!this.isCurrentAttempt(attempt) || !this.canAccessModel(tabKey)) {
          return;
        }
        console.warn("Incremental didChange failed; marked unsynchronized:", e);
      });

    this.documentQueues.set(tabKey, nextTask);
    await nextTask;
    return newVersion;
  }

  /**
   * Synchronize document close.
   */
  notifyDidClose(tabKey: string): void {
    const model = this.registry.getByTabKey(tabKey);
    if (!model || !model.wireBinding) return;

    const wireUri = model.wireBinding.wireUri;
    const attempt = this.currentAttempt;
    if (
      attempt &&
      this.isCurrentAttempt(attempt) &&
      model.wireBinding.targetId === attempt.targetId &&
      model.wireBinding.sessionGeneration === attempt.sessionGeneration
    ) {
      attempt.openDocumentBytes.delete(tabKey);
      for (const [id, res] of attempt.activeReservations) {
        if (res.tabKey === tabKey) {
          attempt.activeReservations.delete(id);
        }
      }
      this.sendNotificationForAttempt(attempt, "textDocument/didClose", {
        textDocument: { uri: wireUri },
      });
    }

    this.registry.unbindWire(tabKey);
    this.documentQueues.delete(tabKey);
  }

  /**
   * Validate G5 destination association metadata against destination tab/model state.
   */
  async validateDestination(
    location: SemanticLocation,
    destinationTabKey: string,
    content: string,
  ): Promise<boolean> {
    const attempt = this.currentAttempt;
    if (
      this.status !== "ready" ||
      !attempt ||
      !this.isCurrentAttempt(attempt) ||
      !attempt.targetId
    ) {
      return false;
    }
    const parsed = parseSemanticWireUri(location.uri, attempt.targetId);
    if (!parsed) {
      return false;
    }
    if (
      typeof location.damHopperDestinationContentSha256 !== "string" ||
      !/^[0-9a-f]{64}$/i.test(location.damHopperDestinationContentSha256)
    ) {
      return false;
    }
    const model = this.registry.getByTabKey(destinationTabKey);
    if (location.damHopperDestinationVersion != null) {
      if (
        !model ||
        !this.canAccessModel(destinationTabKey) ||
        !model.wireBinding ||
        model.wireBinding.targetId !== attempt.targetId ||
        model.wireBinding.sessionGeneration !== attempt.sessionGeneration ||
        model.wireBinding.wireVersion !== location.damHopperDestinationVersion
      ) {
        return false;
      }
    } else if (model && !this.canAccessModel(destinationTabKey)) {
      return false;
    }
    const actualHash = await computeUtf8Sha256Hex(projectSemanticText(content));
    return (
      actualHash.toLowerCase() ===
      location.damHopperDestinationContentSha256.toLowerCase()
    );
  }

  /**
   * Query Definition for position in document.
   */
  async getDefinition(
    tabKey: string,
    position: { line: number; character: number },
    cancellationToken?: {
      isCancellationRequested: boolean;
      onCancellationRequested: (cb: () => void) => void;
    },
  ): Promise<SemanticNavigationResult> {
    return this.queryNavigation(
      "textDocument/definition",
      tabKey,
      position,
      cancellationToken,
    );
  }

  /**
   * Query Implementation for position in document.
   */
  async getImplementation(
    tabKey: string,
    position: { line: number; character: number },
    cancellationToken?: {
      isCancellationRequested: boolean;
      onCancellationRequested: (cb: () => void) => void;
    },
  ): Promise<SemanticNavigationResult> {
    return this.queryNavigation(
      "textDocument/implementation",
      tabKey,
      position,
      cancellationToken,
    );
  }

  private async queryNavigation(
    method: "textDocument/definition" | "textDocument/implementation",
    tabKey: string,
    position: { line: number; character: number },
    cancellationToken?: {
      isCancellationRequested: boolean;
      onCancellationRequested: (cb: () => void) => void;
    },
  ): Promise<SemanticNavigationResult> {
    const queue = this.documentQueues.get(tabKey);
    if (queue) {
      await queue;
    }

    const attempt = this.currentAttempt;
    if (
      this.status !== "ready" ||
      !attempt ||
      !this.isCurrentAttempt(attempt) ||
      !attempt.targetId ||
      !attempt.negotiatedPolicy
    ) {
      return { locations: [] };
    }
    if (!this.canAccessModel(tabKey)) {
      return { locations: [] };
    }
    if (
      attempt.negotiatedPolicy.maxInFlightRequests <= 0 ||
      attempt.pendingRequests.size >=
        attempt.negotiatedPolicy.maxInFlightRequests
    ) {
      return { locations: [] };
    }

    const model = this.registry.getByTabKey(tabKey);
    if (
      !model ||
      !model.wireBinding ||
      model.wireBinding.targetId !== attempt.targetId ||
      model.wireBinding.sessionGeneration !== attempt.sessionGeneration ||
      model.wireBinding.unsynchronized
    ) {
      return { locations: [] };
    }

    const wireBinding = model.wireBinding;
    const documentVersion = wireBinding.wireVersion;
    const requestIncarnation = model.identity.incarnation;
    const requestSessionGen = attempt.sessionGeneration;
    const requestWireVersion = wireBinding.wireVersion;

    const reqId = this.nextRequestId++;
    const params = {
      textDocument: { uri: wireBinding.wireUri },
      position,
      damHopperDocumentVersion: documentVersion,
    };

    if (cancellationToken?.isCancellationRequested) {
      return { locations: [] };
    }

    const reqPromise = this.sendRequestWithIdForAttempt(
      attempt,
      reqId,
      method,
      params,
      NAVIGATION_TIMEOUT_MS,
    );

    if (cancellationToken) {
      cancellationToken.onCancellationRequested(() => {
        this.cancelRequestForAttempt(attempt, reqId);
      });
    }

    try {
      const raw = await reqPromise;

      // Post-await fences
      if (!this.isCurrentAttempt(attempt) || !this.canAccessModel(tabKey)) {
        return { locations: [] };
      }
      const currentModel = this.registry.getByTabKey(tabKey);
      if (
        !currentModel ||
        currentModel.identity.incarnation !== requestIncarnation ||
        !currentModel.wireBinding ||
        currentModel.wireBinding.sessionGeneration !== requestSessionGen ||
        currentModel.wireBinding.wireVersion !== requestWireVersion ||
        currentModel.wireBinding.unsynchronized
      ) {
        return { locations: [] };
      }

      return this.normalizeNavigationResult(raw);
    } catch (e) {
      if (e && typeof e === "object" && "code" in e) {
        if (e.code === -32800) {
          return { locations: [] };
        }
        if (e.code === -32003) {
          if (this.isCurrentAttempt(attempt)) {
            void this.resyncDocument(tabKey);
          }
          return { locations: [] };
        }
        if (e.code === -32005) {
          this.handleServerInvalidation(attempt);
          return { locations: [] };
        }
      }
      return { locations: [] };
    }
  }

  private scheduleReconnect(): void {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.status !== "disconnected") return;
      if (typeof this.options.isProfileEnabled === "function" && !this.options.isProfileEnabled()) {
        return;
      }
      if (typeof this.options.hasActiveRef === "function" && !this.options.hasActiveRef()) {
        return;
      }
      void this.connect().catch((err) => {
        console.warn("Semantic auto-reconnect failed:", err);
      });
    }, 1000);
  }

  private handleServerInvalidation(attempt: SocketAttempt): void {
    if (!this.isCurrentAttempt(attempt)) return;
    this.retireAttempt(attempt, {
      rejectReason: new Error("Semantic session invalidated (-32005)"),
      nextStatus: "disconnected",
      closeSocket: true,
    });
    this.scheduleReconnect();
  }
  /**
   * Perform full resync of an open document when version divergence is detected.
   */
  async resyncDocument(tabKey: string): Promise<void> {
    const attempt = this.currentAttempt;
    if (
      this.status !== "ready" ||
      !attempt ||
      !this.isCurrentAttempt(attempt) ||
      !attempt.targetId ||
      !attempt.negotiatedPolicy
    ) {
      return;
    }
    if (!this.canAccessModel(tabKey)) return;

    const model = this.registry.getByTabKey(tabKey);
    if (
      !model ||
      !model.wireBinding ||
      model.wireBinding.targetId !== attempt.targetId ||
      model.wireBinding.sessionGeneration !== attempt.sessionGeneration
    ) {
      return;
    }

    const rawText = this.options.getModelText?.(tabKey);
    if (typeof rawText !== "string") return;
    const fullText = projectSemanticText(rawText);

    const byteLength = this.textEncoder.encode(fullText).length;
    if (!this.canAdmitOverlayBytes(attempt, tabKey, byteLength)) {
      model.wireBinding.unsynchronized = true;
      return;
    }
    attempt.openDocumentBytes.set(tabKey, byteLength);

    const resyncVersion = this.registry.bumpWireVersion(tabKey);
    this.lastQueuedVersion.set(tabKey, resyncVersion);
    this.sendNotificationForAttempt(attempt, "textDocument/didChange", {
      textDocument: {
        uri: model.wireBinding.wireUri,
        version: resyncVersion,
      },
      contentChanges: [{ text: fullText }],
    });
    model.wireBinding.unsynchronized = false;
  }

  private cancelRequestForAttempt(
    attempt: SocketAttempt,
    id: number | string,
  ): void {
    const pending = attempt.pendingRequests.get(id);
    if (!pending) return;

    attempt.pendingRequests.delete(id);
    clearTimeout(pending.timer);
    pending.reject({ code: -32800, message: "Request cancelled" });

    if (this.isCurrentAttempt(attempt)) {
      this.sendNotificationForAttempt(attempt, "$/cancelRequest", { id });
    }
  }

  private extractDestinationMetadata(
    item: object,
  ): Pick<
    SemanticLocation,
    | "damHopperDestinationContentSha256"
    | "damHopperDestinationVersion"
    | "damHopperDestinationIncarnation"
  > {
    const meta: Pick<
      SemanticLocation,
      | "damHopperDestinationContentSha256"
      | "damHopperDestinationVersion"
      | "damHopperDestinationIncarnation"
    > = {};
    if (
      "damHopperDestinationContentSha256" in item &&
      typeof item.damHopperDestinationContentSha256 === "string"
    ) {
      meta.damHopperDestinationContentSha256 =
        item.damHopperDestinationContentSha256;
    }
    if (
      "damHopperDestinationVersion" in item &&
      (typeof item.damHopperDestinationVersion === "number" ||
        item.damHopperDestinationVersion === null)
    ) {
      meta.damHopperDestinationVersion = item.damHopperDestinationVersion;
    }
    if (
      "damHopperDestinationIncarnation" in item &&
      (typeof item.damHopperDestinationIncarnation === "number" ||
        item.damHopperDestinationIncarnation === null)
    ) {
      meta.damHopperDestinationIncarnation =
        item.damHopperDestinationIncarnation;
    }
    return meta;
  }

  private normalizeLocationItem(item: unknown): SemanticLocation | null {
    if (!item || typeof item !== "object") return null;
    if (
      "uri" in item &&
      typeof item.uri === "string" &&
      "range" in item &&
      isRangeLike(item.range)
    ) {
      return {
        uri: item.uri,
        range: item.range,
        ...this.extractDestinationMetadata(item),
      };
    }
    if (
      "targetUri" in item &&
      typeof item.targetUri === "string" &&
      "targetRange" in item &&
      isRangeLike(item.targetRange)
    ) {
      const selectionRange =
        "targetSelectionRange" in item && isRangeLike(item.targetSelectionRange)
          ? item.targetSelectionRange
          : item.targetRange;
      return {
        uri: item.targetUri,
        range: selectionRange,
        ...this.extractDestinationMetadata(item),
      };
    }
    return null;
  }

  private normalizeNavigationResult(raw: unknown): SemanticNavigationResult {
    if (!raw) {
      return { locations: [] };
    }

    if (
      typeof raw === "object" &&
      raw !== null &&
      "outsideTarget" in raw &&
      raw.outsideTarget === true
    ) {
      return { locations: [], outsideTarget: true };
    }

    const locations: SemanticLocation[] = [];

    if (Array.isArray(raw)) {
      for (const item of raw) {
        const loc = this.normalizeLocationItem(item);
        if (loc) {
          locations.push(loc);
        }
      }
    } else if (typeof raw === "object") {
      const loc = this.normalizeLocationItem(raw);
      if (loc) {
        locations.push(loc);
      }
    }

    return { locations };
  }

  private handleMessage(attempt: SocketAttempt, data: unknown): void {
    if (!this.isCurrentAttempt(attempt) || typeof data !== "string") return;

    try {
      const msg: unknown = JSON.parse(data);
      if (!msg || typeof msg !== "object") return;

      // 1. Response to our pending request
      if (
        "id" in msg &&
        (typeof msg.id === "number" || typeof msg.id === "string") &&
        ("result" in msg || "error" in msg)
      ) {
        const pending = attempt.pendingRequests.get(msg.id);
        if (pending) {
          attempt.pendingRequests.delete(msg.id);
          clearTimeout(pending.timer);
          if ("error" in msg && msg.error !== undefined) {
            pending.reject(msg.error);
          } else {
            pending.resolve("result" in msg ? msg.result : undefined);
          }
        }
        return;
      }

      // 2. Server request to us
      if (
        "id" in msg &&
        msg.id !== undefined &&
        "method" in msg &&
        typeof msg.method === "string"
      ) {
        if (msg.method === "workspace/configuration") {
          let count = 1;
          if (
            "params" in msg &&
            msg.params &&
            typeof msg.params === "object" &&
            "items" in msg.params &&
            Array.isArray(msg.params.items)
          ) {
            count = msg.params.items.length;
          }
          const replies = Array.from({ length: count }, () => ({}));
          this.sendRawForAttempt(attempt, {
            jsonrpc: "2.0",
            id: msg.id,
            result: replies,
          });
        } else {
          this.sendRawForAttempt(attempt, {
            jsonrpc: "2.0",
            id: msg.id,
            result: null,
          });
        }
        return;
      }
    } catch {
      // Ignore unparseable frames
    }
  }

  private sendRequestForAttempt(
    attempt: SocketAttempt,
    method: string,
    params: unknown,
    timeoutMs = HANDSHAKE_TIMEOUT_MS,
  ): Promise<unknown> {
    const id = this.nextRequestId++;
    return this.sendRequestWithIdForAttempt(
      attempt,
      id,
      method,
      params,
      timeoutMs,
    );
  }

  private sendRequestWithIdForAttempt(
    attempt: SocketAttempt,
    id: number | string,
    method: string,
    params: unknown,
    timeoutMs = NAVIGATION_TIMEOUT_MS,
  ): Promise<unknown> {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    if (
      !this.isCurrentAttempt(attempt) ||
      attempt.ws.readyState !== WebSocket.OPEN
    ) {
      reject(new Error("Semantic WebSocket is not open"));
      return promise;
    }

    const timer = setTimeout(() => {
      attempt.pendingRequests.delete(id);
      if (
        this.isCurrentAttempt(attempt) &&
        method !== "initialize" &&
        method !== "damHopper/attachTarget"
      ) {
        this.sendNotificationForAttempt(attempt, "$/cancelRequest", { id });
      }
      reject(
        new Error(
          `Semantic request ${method} (id ${id}) timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    attempt.pendingRequests.set(id, { id, method, resolve, reject, timer });

    this.sendRawForAttempt(attempt, {
      jsonrpc: "2.0",
      id,
      method,
      params,
    });
    return promise;
  }

  private sendNotificationForAttempt(
    attempt: SocketAttempt,
    method: string,
    params: unknown,
  ): void {
    this.sendRawForAttempt(attempt, {
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  private sendRawForAttempt(attempt: SocketAttempt, obj: unknown): void {
    if (
      !this.isCurrentAttempt(attempt) ||
      attempt.ws.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    attempt.ws.send(JSON.stringify(obj));
  }

  /**
   * Graceful disconnect and teardown.
   */
  disconnect(): void {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const attempt = this.currentAttempt;
    if (attempt) {
      this.retireAttempt(attempt, {
        rejectReason: new Error("Semantic client disconnected"),
        nextStatus: "disconnected",
        sendExit: true,
        closeSocket: true,
      });
    } else {
      this.setStatus("disconnected");
    }
  }
  /**
   * For qualification testing: forcefully closes the active WebSocket connection
   * without clearing the reconnect timer, triggering automatic reconnection.
   */
  forceSocketLoss(): void {
    if (this.currentAttempt?.ws) {
      try {
        this.currentAttempt.ws.close(4000, "Forced socket loss for qualification");
      } catch {
        // Ignore close errors
      }
    }
  }
}
