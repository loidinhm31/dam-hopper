import type {
  ApiClient,
  ContextOpenResult,
  InvokeResponse,
  RequestCancelResult,
  ServerProjectTarget,
} from "@/api/client.js";
import { onConnectionInvalidated } from "@/api/connections.js";
import {
  BridgeValidationError,
  UI_BRIDGE_VERSION,
  type FrameCancelMessage,
  type FrameRequestMessage,
  type HostBootstrapMessage,
  type HostContextRevokedMessage,
  type HostResponseError,
  type HostResponseMessage,
  validateCapabilities,
  validateFramePortMessage,
  validateFrameReady,
  validateHostResponse,
} from "./bridge-validators.js";

export type FrameSessionState =
  | "Fetching"
  | "LoadingInitialDocument"
  | "Bootstrapping"
  | "AwaitingPortAck"
  | "Ready"
  | "Revoked";

interface OpenFrameContextRequest {
  epoch: number;
  installationId: string;
  target: ServerProjectTarget;
  allowedOperations: string[];
  allowCurrentAccountPolicy?: boolean;
}

interface CloseFrameContextRequest {
  epoch: number;
  contextId: string;
}

interface ExactFrameInvokeRequest {
  epoch: number;
  contextId: string;
  requestId: string;
  operation: string;
  payload: unknown;
  deadlineMs?: number;
}

interface ExactFrameCancelRequest {
  epoch: number;
  contextId: string;
  requestId: string;
}

interface FrameSessionBackendBase {
  getEpoch: () => Promise<number>;
  openContext: (request: OpenFrameContextRequest) => Promise<ContextOpenResult>;
  closeContext: (request: CloseFrameContextRequest) => Promise<void>;
  onContextRevoked: (
    listener: (contextId: string, reason: string) => void,
  ) => () => void;
  onOwnerInvalidated: (listener: () => void) => () => void;
}

export interface ExactRequestFrameSessionBackend extends FrameSessionBackendBase {
  requestCorrelation: "exact";
  invoke: (request: ExactFrameInvokeRequest) => Promise<InvokeResponse>;
  cancel: (request: ExactFrameCancelRequest) => Promise<RequestCancelResult>;
}

export interface UnsupportedRequestFrameSessionBackend extends FrameSessionBackendBase {
  requestCorrelation: "unsupported";
}

export type FrameSessionBackend =
  | ExactRequestFrameSessionBackend
  | UnsupportedRequestFrameSessionBackend;

export interface FrameSessionOptions {
  installationId: string;
  activationGeneration: number;
  target: ServerProjectTarget;
  allowedOperations: string[];
  allowCurrentAccountPolicy?: boolean;
  backend: FrameSessionBackend;
  onStateChange?: (state: FrameSessionState, detail?: string) => void;
}

interface PendingRequest {
  cancelled: boolean;
  revision: number;
}

function randomOpaqueId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeError(error: unknown): HostResponseError {
  if (error instanceof BridgeValidationError) {
    return { code: "INVALID_INPUT", message: error.message };
  }
  const value = error as { code?: unknown; status?: unknown };
  if (typeof value?.code === "string") {
    const retryable = value.status === 429 || value.status === 503;
    return {
      code: value.code,
      message: "The plugin request could not be completed.",
      ...(retryable ? { retryable: true } : {}),
    };
  }
  return {
    code: "PLUGIN_UNAVAILABLE",
    message: "The plugin request could not be completed.",
    retryable: true,
  };
}

export function createApiFrameSessionBackend(
  api: ApiClient,
): ExactRequestFrameSessionBackend {
  return {
    requestCorrelation: "exact",
    getEpoch: async () => (await api.plugins.getEpoch()).epoch,
    openContext: (request) => api.plugins.openContext(request),
    closeContext: async (request) => {
      await api.plugins.closeContext(request);
    },
    invoke: (request) => api.plugins.invoke(request),
    cancel: (request) => api.plugins.cancel(request),
    onContextRevoked: (listener) =>
      api.plugins.onRevoked((event) => listener(event.contextId, event.reason)),
    onOwnerInvalidated: (listener) =>
      onConnectionInvalidated(api.owner, listener),
  };
}

export class FrameSession {
  readonly frameSession = randomOpaqueId();
  readonly nonce = randomOpaqueId();
  readonly activationGeneration: number;
  readonly installationId: string;

  private stateValue: FrameSessionState = "Fetching";
  private frameWindow: Window | null = null;
  private port: MessagePort | null = null;
  private initialLoadSeen = false;
  private readySeen = false;
  private acknowledgementSeen = false;
  private context: { epoch: number; contextId: string } | null = null;
  private contextOpening: Promise<void> | null = null;
  private revision = 0;
  private acknowledgementTimer: ReturnType<typeof setTimeout> | null = null;
  private closeStarted = false;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly settled = new Set<string>();
  private readonly settledOrder: string[] = [];
  private readonly cancellationStarted = new Set<string>();
  private readonly allowedOperations: Set<string>;
  private readonly capabilities: string[];
  private readonly unsubscribeContext: () => void;
  private readonly unsubscribeOwner: () => void;

  constructor(private readonly options: FrameSessionOptions) {
    this.installationId = options.installationId;
    this.activationGeneration = options.activationGeneration;
    this.capabilities = validateCapabilities(options.allowedOperations);
    this.allowedOperations = new Set(this.capabilities);
    this.unsubscribeContext = options.backend.onContextRevoked(
      (contextId, reason) => {
        if (contextId === this.context?.contextId) this.revoke(reason);
      },
    );
    this.unsubscribeOwner = options.backend.onOwnerInvalidated(() => {
      this.revoke("Connection changed");
    });
  }

  get state(): FrameSessionState {
    return this.stateValue;
  }

  bindFrame(frameWindow: Window): void {
    if (this.stateValue !== "Fetching" || this.frameWindow !== null) {
      throw new Error("Frame session can bind one frame window only");
    }
    this.frameWindow = frameWindow;
    this.transition("LoadingInitialDocument");
  }

  handleDocumentLoad(): void {
    if (this.stateValue === "Revoked") return;
    if (!this.initialLoadSeen) {
      this.initialLoadSeen = true;
      return;
    }
    this.revoke("Plugin document navigated or reloaded");
  }

  handleWindowMessage(event: MessageEvent): boolean {
    if (this.stateValue === "Revoked" || this.port !== null) {
      return false;
    }
    if (event.origin !== "null") {
      this.revoke("Plugin frame origin was not opaque");
      return false;
    }
    try {
      validateFrameReady(
        event.data,
        this.frameSession,
        this.activationGeneration,
      );
    } catch (error) {
      this.revoke(
        error instanceof Error ? error.message : "Invalid frame.ready",
      );
      return false;
    }
    const transferredPort = event.ports[0];
    if (
      this.readySeen ||
      !this.frameWindow ||
      event.ports.length !== 1 ||
      !transferredPort
    ) {
      this.revoke("Repeated, detached, or portless frame.ready");
      return false;
    }

    this.readySeen = true;
    this.transition("Bootstrapping");
    this.port = transferredPort;
    this.port.onmessage = (portEvent) => this.handlePortMessage(portEvent.data);
    this.port.onmessageerror = () => this.revoke("Invalid bridge message");
    this.port.start();
    const bootstrap: HostBootstrapMessage = {
      type: "host.bootstrap",
      bridgeVersion: UI_BRIDGE_VERSION,
      frameSession: this.frameSession,
      activationGeneration: this.activationGeneration,
      pluginId: this.installationId,
      nonce: this.nonce,
      capabilities: [...this.capabilities],
    };
    this.acknowledgementTimer = setTimeout(() => {
      this.acknowledgementTimer = null;
      this.revoke("Plugin frame acknowledgement timed out");
    }, 10_000);
    this.transition("AwaitingPortAck");
    this.port.postMessage(bootstrap);
    return true;
  }

  revoke(reason = "Plugin context revoked"): void {
    if (this.stateValue === "Revoked") return;
    this.revision += 1;
    this.transition("Revoked", reason);
    if (this.acknowledgementTimer) {
      clearTimeout(this.acknowledgementTimer);
      this.acknowledgementTimer = null;
    }
    this.unsubscribeContext();
    this.unsubscribeOwner();

    if (this.port && this.acknowledgementSeen) {
      const message: HostContextRevokedMessage = {
        type: "context.revoked",
        bridgeVersion: UI_BRIDGE_VERSION,
        frameSession: this.frameSession,
        activationGeneration: this.activationGeneration,
        reason: reason.slice(0, 256),
      };
      try {
        this.port.postMessage(message);
      } catch {
        // The opaque frame may already be gone.
      }
    }
    this.port?.close();
    this.port = null;

    for (const requestId of this.pending.keys()) {
      this.cancelPendingRequest(requestId);
    }
    this.pending.clear();
    void this.closeContextOnce();
  }

  private transition(state: FrameSessionState, detail?: string): void {
    this.stateValue = state;
    this.options.onStateChange?.(state, detail);
  }

  private handlePortMessage(data: unknown): void {
    if (this.stateValue === "Revoked") return;
    let message;
    try {
      message = validateFramePortMessage(
        data,
        this.frameSession,
        this.activationGeneration,
        this.nonce,
        this.allowedOperations,
      );
    } catch (error) {
      this.revoke(
        error instanceof Error ? error.message : "Invalid bridge message",
      );
      return;
    }

    if (message.type === "frame.portAck") {
      if (this.stateValue !== "AwaitingPortAck" || this.acknowledgementSeen) {
        this.revoke("Repeated or out-of-sequence frame.portAck");
        return;
      }
      this.acknowledgementSeen = true;
      if (this.acknowledgementTimer) {
        clearTimeout(this.acknowledgementTimer);
        this.acknowledgementTimer = null;
      }
      this.contextOpening = this.openContextAfterAcknowledgement();
      return;
    }
    if (!this.acknowledgementSeen) {
      this.revoke("Bridge data arrived before frame.portAck");
      return;
    }
    if (message.type === "request") {
      void this.handleRequest(message);
    } else {
      this.handleCancel(message);
    }
  }

  private async openContextAfterAcknowledgement(): Promise<void> {
    const revision = this.revision;
    try {
      const epoch = await this.options.backend.getEpoch();
      if (this.stateValue === "Revoked" || revision !== this.revision) return;
      const opened = await this.options.backend.openContext({
        epoch,
        installationId: this.installationId,
        target: this.options.target,
        allowedOperations: [...this.capabilities],
        ...(this.options.allowCurrentAccountPolicy
          ? { allowCurrentAccountPolicy: true }
          : {}),
      });
      if (
        revision !== this.revision ||
        opened.activationGeneration !== this.activationGeneration
      ) {
        await this.options.backend.closeContext({
          epoch,
          contextId: opened.contextId,
        });
        if (opened.activationGeneration !== this.activationGeneration) {
          this.revoke("Plugin activation changed");
        }
        return;
      }
      this.context = { epoch, contextId: opened.contextId };
      this.transition("Ready");
    } catch {
      this.revoke("Plugin context is unavailable");
    }
  }

  private async handleRequest(message: FrameRequestMessage): Promise<void> {
    if (
      this.pending.has(message.requestId) ||
      this.settled.has(message.requestId)
    ) {
      return;
    }
    const pending: PendingRequest = {
      cancelled: false,
      revision: this.revision,
    };
    this.pending.set(message.requestId, pending);
    await this.contextOpening;
    if (
      this.stateValue !== "Ready" ||
      !this.context ||
      this.pending.get(message.requestId) !== pending ||
      pending.revision !== this.revision
    ) {
      this.pending.delete(message.requestId);
      return;
    }
    if (pending.cancelled) {
      this.settleRequest(message.requestId, {
        code: "CANCELLED",
        message: "The plugin request was cancelled.",
      });
      return;
    }

    if (this.options.backend.requestCorrelation === "unsupported") {
      this.settleRequest(message.requestId, {
        code: "INCOMPATIBLE",
        message:
          "This server cannot preserve bridge request IDs for cancellation.",
      });
      return;
    }

    try {
      const response = await this.options.backend.invoke({
        epoch: this.context.epoch,
        contextId: this.context.contextId,
        requestId: message.requestId,
        operation: message.operation,
        payload: message.payload,
        ...(message.deadlineMs === undefined
          ? {}
          : { deadlineMs: message.deadlineMs }),
      });
      if (pending.cancelled) {
        this.settleRequest(message.requestId, {
          code: "CANCELLED",
          message: "The plugin request was cancelled.",
        });
      } else {
        this.settleRequest(message.requestId, undefined, response.result);
      }
    } catch (error) {
      this.settleRequest(message.requestId, safeError(error));
    }
  }

  private handleCancel(message: FrameCancelMessage): void {
    if (!this.pending.has(message.requestId)) return;
    this.cancelPendingRequest(message.requestId);
  }

  private cancelPendingRequest(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending || this.cancellationStarted.has(requestId)) return;
    pending.cancelled = true;
    this.cancellationStarted.add(requestId);
    if (this.options.backend.requestCorrelation === "exact" && this.context) {
      void this.options.backend
        .cancel({
          epoch: this.context.epoch,
          contextId: this.context.contextId,
          requestId,
        })
        .catch(() => undefined);
    }
  }

  private settleRequest(
    requestId: string,
    error?: HostResponseError,
    result?: unknown,
  ): void {
    const pending = this.pending.get(requestId);
    if (
      !pending ||
      pending.revision !== this.revision ||
      this.stateValue !== "Ready" ||
      !this.port
    ) {
      return;
    }
    this.pending.delete(requestId);
    this.cancellationStarted.delete(requestId);
    this.settled.add(requestId);
    this.settledOrder.push(requestId);
    if (this.settledOrder.length > 512) {
      this.settled.delete(this.settledOrder.shift()!);
    }
    let response: HostResponseMessage = {
      type: "response",
      bridgeVersion: UI_BRIDGE_VERSION,
      frameSession: this.frameSession,
      activationGeneration: this.activationGeneration,
      requestId,
      ...(error === undefined ? { result: result ?? null } : { error }),
    };
    try {
      validateHostResponse(response);
    } catch {
      response = {
        type: "response",
        bridgeVersion: UI_BRIDGE_VERSION,
        frameSession: this.frameSession,
        activationGeneration: this.activationGeneration,
        requestId,
        error: {
          code: "OVERLOADED",
          message: "The plugin response exceeded the bridge limit.",
        },
      };
    }
    this.port.postMessage(response);
  }

  private async closeContextOnce(): Promise<void> {
    if (this.closeStarted) return;
    this.closeStarted = true;
    await this.contextOpening?.catch(() => undefined);
    const context = this.context;
    this.context = null;
    if (!context) return;
    await this.options.backend.closeContext(context).catch(() => undefined);
  }
}
