/**
 * SemanticClient — owner-bound WebSocket JSON-RPC client for /ws/semantic/v1.
 *
 * Implements:
 * - Subprotocol dam-hopper.semantic.lsp.v1.
 * - Strict lifecycle: attachTarget -> initialize -> initialized -> model replay -> ready.
 * - Single-kind adaptive sync (range-less full <64 KiB, incremental >=64 KiB).
 * - Exact UTF-8 post-edit threshold accounting and monotonic document versions.
 * - Filtered-profile navigation with damHopperDocumentVersion fence.
 * - Cancellation via $/cancelRequest and request timeout boundaries.
 * - Server configuration replies ([{}, ...]).
 * - Clean teardown and model unbinding on disconnect/invalidation.
 */

import {
  formatSemanticWireUri,
  detectLanguageDescriptor,
  type SemanticModelRegistry,
  defaultSemanticModelRegistry,
  type RegisteredModel,
} from "@/lib/semantic-model-uri.js";

export const SEMANTIC_SUBPROTOCOL = "dam-hopper.semantic.lsp.v1";
export const ADAPTIVE_SYNC_THRESHOLD_BYTES = 64 * 1024; // 64 KiB UTF-8 byte threshold
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

export interface SemanticLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
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
  worktree?: string | null;
  targetKey: string;
  connectionGeneration: number;
  targetGeneration: number;
  sessionGeneration?: number;
  getModelText?: (tabKey: string) => string | undefined;
  registry?: SemanticModelRegistry;
  onStatusChange?: (status: SemanticClientStatus, error?: string) => void;
}

interface PendingRequest {
  id: number | string;
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: number | NodeJS.Timeout;
}

export class SemanticClient {
  private ws: WebSocket | null = null;
  private status: SemanticClientStatus = "disconnected";
  private targetId: string | null = null;
  private sessionGeneration = 1;
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<number | string, PendingRequest>();
  private readonly registry: SemanticModelRegistry;
  private readonly documentQueues = new Map<string, Promise<void>>();
  private textEncoder = new TextEncoder();

  constructor(private readonly options: SemanticClientOptions) {
    this.registry = options.registry ?? defaultSemanticModelRegistry;
  }

  getStatus(): SemanticClientStatus {
    return this.status;
  }

  getTargetId(): string | null {
    return this.targetId;
  }

  private setStatus(status: SemanticClientStatus, error?: string): void {
    if (this.status !== status) {
      this.status = status;
      this.options.onStatusChange?.(status, error);
    }
  }

  /**
   * Connect and execute the handshake sequence.
   */
  async connect(): Promise<void> {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.setStatus("connecting");

    let urlString = this.options.wsUrl;
    if (this.options.token) {
      const sep = urlString.includes("?") ? "&" : "?";
      urlString += `${sep}token=${encodeURIComponent(this.options.token)}`;
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      try {
        const ws = new WebSocket(urlString, [SEMANTIC_SUBPROTOCOL]);
        this.ws = ws;

        ws.onopen = async () => {
          try {
            await this.performHandshake();
            settled = true;
            resolve();
          } catch (e) {
            if (!settled) {
              settled = true;
              reject(e);
            }
          }
        };

        ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        ws.onerror = (event) => {
          const errText = "WebSocket connection error";
          this.setStatus("error", errText);
          if (!settled) {
            settled = true;
            reject(new Error(errText));
          }
        };

        ws.onclose = () => {
          this.handleClose();
          if (!settled) {
            settled = true;
            reject(new Error("WebSocket closed before handshake completed"));
          }
        };
      } catch (e) {
        this.setStatus("error", String(e));
        reject(e);
      }
    });
  }

  private async performHandshake(): Promise<void> {
    try {
      // 1. Attach target
      this.setStatus("attaching");
      const attachRes = (await this.sendRequest("damHopper/attachTarget", {
        target: {
          project: this.options.project,
          worktree: this.options.worktree ?? undefined,
        },
        descriptor: "typescript",
      })) as { targetId: string; descriptor: string };

      if (!attachRes || !attachRes.targetId) {
        throw new Error("Invalid attachTarget response: missing targetId");
      }

      this.targetId = attachRes.targetId;

      // 2. Initialize
      this.setStatus("initializing");
      await this.sendRequest("initialize", {
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
      });

      // 3. Initialized notification
      this.sendNotification("initialized", {});

      // 4. Model replay barrier
      this.setStatus("replaying");
      await this.replayMatchingModels();

      // 5. Ready
      this.setStatus("ready");
    } catch (e) {
      this.setStatus("error", String(e));
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          // Ignore close errors
        }
        this.ws = null;
      }
      this.handleClose();
      throw e;
    }
  }

  private async replayMatchingModels(): Promise<void> {
    if (!this.targetId) return;

    const allRegistered = this.registry.getAllRegistered();
    for (const model of allRegistered) {
      if (
        model.identity.profileId !== this.options.profileId ||
        model.identity.project !== this.options.project ||
        model.identity.targetKey !== this.options.targetKey
      ) {
        continue;
      }

      const lang = detectLanguageDescriptor(model.identity.relativePath);
      if (!lang) continue;

      const binding = this.registry.bindWire(model.identity.tabKey, {
        targetId: this.targetId,
        connectionGeneration: this.options.connectionGeneration,
        targetGeneration: this.options.targetGeneration,
        sessionGeneration: this.sessionGeneration,
        languageDescriptor: lang,
        initialWireVersion: 1,
      });

      if (!binding) continue;

      const text = this.options.getModelText?.(model.identity.tabKey) ?? "";

      this.sendNotification("textDocument/didOpen", {
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
    if (this.status !== "ready" || !this.targetId) return;

    const model = this.registry.getByTabKey(tabKey);
    if (!model) return;

    const lang = detectLanguageDescriptor(model.identity.relativePath);
    if (!lang) return;

    let binding = model.wireBinding;
    const isAlreadyBound =
      binding &&
      binding.targetId === this.targetId &&
      binding.sessionGeneration === this.sessionGeneration;

    if (isAlreadyBound && !forceResync) {
      return;
    }

    binding = this.registry.bindWire(tabKey, {
      targetId: this.targetId,
      connectionGeneration: this.options.connectionGeneration,
      targetGeneration: this.options.targetGeneration,
      sessionGeneration: this.sessionGeneration,
      languageDescriptor: lang,
      initialWireVersion: 1,
    });

    if (!binding) return;
    binding.wireVersion = 1;

    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: binding.wireUri,
        languageId: lang,
        version: 1,
        text,
      },
    });
  }

  /**
   * Synchronize document change with single-kind adaptive sync:
   * - < 64 KiB post-edit size: full text replacement { text: newFullContent }
   * - >= 64 KiB post-edit size: incremental edit { range, rangeLength, text }
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
    if (this.status !== "ready" || !this.targetId) return 0;

    const model = this.registry.getByTabKey(tabKey);
    if (!model || !model.wireBinding) return 0;

    const binding = model.wireBinding;
    const newVersion = this.registry.bumpWireVersion(tabKey);

    const prevQueue = this.documentQueues.get(tabKey) ?? Promise.resolve();
    const nextTask = prevQueue
      .then(() => {
        const byteLength = this.textEncoder.encode(newFullContent).length;

        const changesList = Array.isArray(incrementalChanges)
          ? incrementalChanges
          : incrementalChanges
            ? [incrementalChanges]
            : [];

        let contentChanges: unknown[];
        if (
          byteLength < ADAPTIVE_SYNC_THRESHOLD_BYTES ||
          changesList.length === 0
        ) {
          contentChanges = [{ text: newFullContent }];
        } else {
          contentChanges = changesList.map((c) => ({
            range: c.range,
            rangeLength: c.rangeLength,
            text: c.text,
          }));
        }

        this.sendNotification("textDocument/didChange", {
          textDocument: {
            uri: binding.wireUri,
            version: newVersion,
          },
          contentChanges,
        });
      })
      .catch((e) => {
        console.warn(
          "Incremental didChange failed; sending full didChange resync:",
          e,
        );
        const resyncVersion = this.registry.bumpWireVersion(tabKey);
        this.sendNotification("textDocument/didChange", {
          textDocument: {
            uri: binding.wireUri,
            version: resyncVersion,
          },
          contentChanges: [{ text: newFullContent }],
        });
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
    this.sendNotification("textDocument/didClose", {
      textDocument: { uri: wireUri },
    });

    this.registry.unbindWire(tabKey);
    this.documentQueues.delete(tabKey);
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
    if (this.status !== "ready" || !this.targetId) {
      return { locations: [] };
    }

    const model = this.registry.getByTabKey(tabKey);
    if (!model || !model.wireBinding) {
      return { locations: [] };
    }

    const wireBinding = model.wireBinding;
    const documentVersion = wireBinding.wireVersion;
    const requestIncarnation = model.identity.incarnation;
    const requestSessionGen = this.sessionGeneration;
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

    const reqPromise = this.sendRequestWithId(reqId, method, params);

    if (cancellationToken) {
      cancellationToken.onCancellationRequested(() => {
        this.cancelRequest(reqId);
      });
    }

    try {
      const raw = await reqPromise;

      // Post-await fences
      const currentModel = this.registry.getByTabKey(tabKey);
      if (
        !currentModel ||
        currentModel.identity.incarnation !== requestIncarnation ||
        !currentModel.wireBinding ||
        currentModel.wireBinding.sessionGeneration !== requestSessionGen ||
        currentModel.wireBinding.wireVersion !== requestWireVersion
      ) {
        return { locations: [] };
      }

      return this.normalizeNavigationResult(raw);
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && e.code === -32800) {
        return { locations: [] };
      }
      return { locations: [] };
    }
  }

  private cancelRequest(id: number | string): void {
    const pending = this.pendingRequests.get(id);
    if (!pending) return;

    this.sendNotification("$/cancelRequest", { id });
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
        if (!item || typeof item !== "object") continue;
        if ("uri" in item && "range" in item) {
          locations.push(item as SemanticLocation);
        } else if ("targetUri" in item && "targetRange" in item) {
          locations.push({
            uri: (item as SemanticLocationLink).targetUri,
            range:
              (item as SemanticLocationLink).targetSelectionRange ??
              (item as SemanticLocationLink).targetRange,
          });
        }
      }
    } else if (typeof raw === "object") {
      if ("uri" in raw && "range" in raw) {
        locations.push(raw as SemanticLocation);
      }
    }

    return { locations };
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;

    try {
      const msg = JSON.parse(data);

      // 1. Response to our pending request
      if (
        typeof msg.id !== "undefined" &&
        (typeof msg.result !== "undefined" || typeof msg.error !== "undefined")
      ) {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          clearTimeout(pending.timer);
          if (msg.error) {
            pending.reject(msg.error);
          } else {
            pending.resolve(msg.result);
          }
        }
        return;
      }

      // 2. Server request to us
      if (typeof msg.id !== "undefined" && typeof msg.method === "string") {
        if (msg.method === "workspace/configuration") {
          const items = msg.params?.items;
          const count = Array.isArray(items) ? items.length : 1;
          const replies = Array.from({ length: count }, () => ({}));
          this.sendRaw({
            jsonrpc: "2.0",
            id: msg.id,
            result: replies,
          });
        } else {
          this.sendRaw({
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

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = this.nextRequestId++;
    return this.sendRequestWithId(id, method, params);
  }

  private sendRequestWithId(
    id: number | string,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Semantic WebSocket is not open"));
        return;
      }

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(
            `Semantic request ${method} (id ${id}) timed out after ${NAVIGATION_TIMEOUT_MS}ms`,
          ),
        );
      }, NAVIGATION_TIMEOUT_MS);

      this.pendingRequests.set(id, { id, method, resolve, reject, timer });

      this.sendRaw({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });
    });
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.sendRaw({
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  private sendRaw(obj: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  private handleClose(): void {
    this.setStatus("disconnected");
    const currentTargetId = this.targetId;
    this.targetId = null;

    // Reject all pending requests
    for (const [id, req] of this.pendingRequests) {
      clearTimeout(req.timer);
      req.reject(
        new Error(`Semantic connection closed before request ${id} completed`),
      );
    }
    this.pendingRequests.clear();
    this.documentQueues.clear();

    // Clear wire bindings only for this client's target!
    if (currentTargetId) {
      this.registry.clearWireBindings(currentTargetId);
    }
  }

  /**
   * Graceful disconnect and teardown.
   */
  disconnect(): void {
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN && this.status === "ready") {
          this.sendNotification("exit", {});
        }
        this.ws.close(1000, "Normal closure");
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
    this.handleClose();
  }
}
