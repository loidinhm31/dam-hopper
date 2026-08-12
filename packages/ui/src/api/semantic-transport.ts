import { logger } from "@dam-hopper/shared/logger";
import {
  parseSemanticServerMessage,
  serializeSemanticClientMessage,
  type SemanticClientMessage,
  type SemanticServerMessage,
  type SemanticNavigationRequest,
  type SemanticNavigationCancellation,
  type SemanticLanguage,
} from "@dam-hopper/shared";
import {
  getActiveProfileId,
  getAuthToken,
  getServerUrl,
} from "./server-config.js";

export type SemanticTransportStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

type StatusListener = (status: SemanticTransportStatus) => void;
type MessageListener = (message: SemanticServerMessage) => void;

export interface SemanticTransportOptions {
  baseUrl?: string;
  profileId?: string;
  token?: string | null;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_PENDING_MESSAGES = 64;

/** Dedicated typed socket; primary terminal/file transport stays independent. */
export class SemanticTransport {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private closed = false;
  private status: SemanticTransportStatus = "disconnected";
  private selectedProject: string | null = null;
  private projectSent = false;
  private projectReady = false;
  private connectionGeneration = 0;
  private pendingMessages: SemanticClientMessage[] = [];
  private readonly statusListeners = new Set<StatusListener>();
  private readonly messageListeners = new Set<MessageListener>();
  private readonly bufferedMessages: SemanticServerMessage[] = [];
  private readonly baseUrl: string;
  private readonly profileId: string | undefined;
  private readonly token: string | null;

  constructor(options: SemanticTransportOptions = {}) {
    this.baseUrl = options.baseUrl ?? getServerUrl();
    this.profileId = options.profileId ?? getActiveProfileId() ?? undefined;
    this.token = options.token ?? getAuthToken(this.profileId);
    this.connect();
  }

  getStatus(): SemanticTransportStatus {
    return this.status;
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    const buffered = this.bufferedMessages.splice(0);
    buffered.forEach(listener);
    if (this.projectReady) this.flushPendingMessages();
    return () => this.messageListeners.delete(listener);
  }

  isProjectReady(): boolean {
    return this.projectReady;
  }

  isProjectSelected(projectId: string): boolean {
    return this.selectedProject === projectId;
  }

  selectProject(projectId: string): boolean {
    const changed = this.selectedProject !== projectId;
    this.selectedProject = projectId;
    if (changed) {
      this.projectSent = false;
      this.projectReady = false;
      this.pendingMessages.length = 0;
    }
    return this.sendProjectIfReady();
  }

  prewarm(
    projectId: string,
    language: SemanticLanguage,
    tabGeneration: number,
  ): boolean {
    return this.send({
      kind: "semantic:prewarm",
      projectId,
      language,
      tabGeneration,
    });
  }

  openDocument(
    message: Extract<SemanticClientMessage, { kind: "semantic:document_open" }>,
  ): boolean {
    return this.send(message);
  }

  changeDocument(
    message: Extract<
      SemanticClientMessage,
      { kind: "semantic:document_change" }
    >,
  ): boolean {
    return this.send(message);
  }

  closeDocument(
    message: Extract<
      SemanticClientMessage,
      { kind: "semantic:document_close" }
    >,
  ): boolean {
    return this.send(message);
  }

  resync(projectId: string): boolean {
    return this.send({ kind: "semantic:resync", projectId });
  }

  replayDocuments(projectId: string): boolean {
    return this.resync(projectId);
  }

  dropPendingResync(): void {
    this.removePendingResync();
  }

  dropPendingDocuments(projectId: string): void {
    this.pendingMessages = this.pendingMessages.filter(
      (message) =>
        !(
          (message.kind === "semantic:document_open" ||
            message.kind === "semantic:document_change" ||
            message.kind === "semantic:document_close") &&
          message.uri.projectId === projectId
        ),
    );
  }

  /** Fences a server-invalidated selection and re-sends it only on an open socket. */
  invalidateSelection(): boolean {
    this.projectSent = false;
    this.projectReady = false;
    this.pendingMessages.length = 0;
    this.bufferedMessages.length = 0;
    this.connectionGeneration += 1;
    this.setStatus("disconnected");
    const socket = this.socket;
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
    ) {
      try {
        socket.close(1012, "semantic context invalidated");
      } catch {
        // The close event schedules the normal reconnect path.
      }
    }
    return false;
  }

  navigate(request: SemanticNavigationRequest): boolean {
    return this.send({ kind: "semantic:navigate", ...request });
  }

  cancel(request: SemanticNavigationCancellation): boolean {
    return this.send({ kind: "semantic:cancel", ...request });
  }

  destroy(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.statusListeners.clear();
    this.messageListeners.clear();
    this.pendingMessages.length = 0;
    this.bufferedMessages.length = 0;
  }

  private connect(): void {
    if (this.closed) return;
    this.setStatus("connecting");
    let url: string;
    try {
      url = buildSemanticWebSocketUrl(this.baseUrl, this.token);
    } catch {
      this.setStatus("error");
      this.scheduleReconnect();
      return;
    }

    const generation = ++this.connectionGeneration;
    const socket = new WebSocket(url);
    this.socket = socket;
    this.projectSent = false;
    this.projectReady = false;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.backoffMs = INITIAL_BACKOFF_MS;
      const selected = this.sendProjectIfReady();
      if (selected || !this.selectedProject) this.setStatus("connected");
    };
    socket.onmessage = (event) => this.handleMessage(event.data, generation);
    socket.onerror = () => {
      if (this.socket === socket) this.setStatus("error");
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.projectSent = false;
      this.projectReady = false;
      if (!this.closed) {
        this.setStatus("disconnected");
        this.scheduleReconnect();
      }
    };
  }

  private sendProjectIfReady(): boolean {
    if (!this.selectedProject || this.projectSent) return false;
    if (
      !this.send({
        kind: "semantic:project",
        profileId: this.profileId ?? "profile",
        projectId: this.selectedProject,
      })
    )
      return false;
    this.projectSent = true;
    this.projectReady = false;
    return true;
  }

  private send(message: SemanticClientMessage): boolean {
    if (message.kind === "semantic:navigate") {
      this.removePendingNavigation(message.requestId);
    } else if (message.kind === "semantic:resync") {
      this.removePendingResync();
    }
    if (message.kind === "semantic:cancel") {
      this.removePendingNavigation(message.requestId);
      if (this.socket?.readyState !== WebSocket.OPEN || !this.projectReady)
        return true;
      try {
        this.socket.send(serializeSemanticClientMessage(message));
      } catch {
        // Cancellation is best effort; the local request is already resolved.
      }
      return true;
    }
    if (
      this.socket?.readyState !== WebSocket.OPEN ||
      (message.kind !== "semantic:project" &&
        (!this.projectSent || !this.projectReady))
    ) {
      return this.enqueuePendingMessage(message);
    }
    try {
      this.socket.send(serializeSemanticClientMessage(message));
      if (
        message.kind === "semantic:document_open" ||
        message.kind === "semantic:document_change" ||
        message.kind === "semantic:document_close"
      ) {
        this.removePendingDocument(message);
      }
      return true;
    } catch (error) {
      logger.warn("SemanticTransport", "message rejected", {
        error: error instanceof Error ? error.name : "unknown",
      });
      return false;
    }
  }

  private handleMessage(raw: unknown, generation: number): void {
    if (generation !== this.connectionGeneration || typeof raw !== "string")
      return;
    try {
      const message = parseSemanticServerMessage(JSON.parse(raw));
      if (
        message.kind === "semantic:project" &&
        message.projectId === this.selectedProject
      ) {
        this.projectReady = true;
      }
      if (this.messageListeners.size === 0) {
        if (this.bufferedMessages.length >= 32) this.bufferedMessages.shift();
        this.bufferedMessages.push(message);
      } else {
        this.messageListeners.forEach((listener) => listener(message));
      }
      if (message.kind === "semantic:project" && this.projectReady) {
        this.flushPendingMessages();
      }
    } catch (error) {
      logger.warn("SemanticTransport", "server message rejected", {
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  private enqueuePendingMessage(message: SemanticClientMessage): boolean {
    if (!this.selectedProject || message.kind === "semantic:project")
      return false;
    if (message.kind === "semantic:cancel") return true;
    const projectId = messageProjectId(message);
    if (projectId !== this.selectedProject) return false;
    if (message.kind === "semantic:resync") {
      this.pendingMessages.splice(
        0,
        this.pendingMessages.length,
        ...this.pendingMessages.filter(
          (item) => item.kind !== "semantic:resync",
        ),
      );
    }
    if (
      message.kind === "semantic:document_open" ||
      message.kind === "semantic:document_change"
    ) {
      const previous = this.pendingMessages.find(
        (item) =>
          (item.kind === "semantic:document_open" ||
            item.kind === "semantic:document_change") &&
          sameDocument(item.uri, message.uri),
      );
      this.removePendingDocument(message);
      const queuedMessage =
        previous?.kind === "semantic:document_open" ||
        message.kind === "semantic:document_open"
          ? { ...message, kind: "semantic:document_open" as const }
          : message;
      if (
        this.pendingMessages.length >= MAX_PENDING_MESSAGES &&
        !this.evictPendingNonNavigation()
      )
        return false;
      this.pendingMessages.push(queuedMessage);
      return true;
    }
    if (message.kind === "semantic:document_close") {
      this.removePendingDocument(message);
      if (
        this.pendingMessages.length >= MAX_PENDING_MESSAGES &&
        !this.evictPendingNonNavigation()
      )
        return false;
      this.pendingMessages.push(message);
      return true;
    }
    if (message.kind === "semantic:prewarm") {
      this.pendingMessages.splice(
        0,
        this.pendingMessages.length,
        ...this.pendingMessages.filter(
          (item) =>
            !(
              item.kind === "semantic:prewarm" &&
              item.projectId === message.projectId &&
              item.language === message.language
            ),
        ),
      );
    }
    if (message.kind === "semantic:navigate") {
      this.removePendingNavigation(message.requestId);
    }
    if (
      this.pendingMessages.length >= MAX_PENDING_MESSAGES &&
      !this.evictPendingNonNavigation()
    )
      return false;
    this.pendingMessages.push(message);
    return true;
  }

  private evictPendingNonNavigation(): boolean {
    const evictIndex = this.pendingMessages.findIndex(
      (item) => item.kind !== "semantic:navigate",
    );
    if (evictIndex < 0) return false;
    this.pendingMessages.splice(evictIndex, 1);
    return true;
  }

  private removePendingNavigation(requestId: string): void {
    this.pendingMessages = this.pendingMessages.filter(
      (message) =>
        message.kind !== "semantic:navigate" || message.requestId !== requestId,
    );
  }

  private removePendingDocument(
    message: Extract<
      SemanticClientMessage,
      {
        kind:
          | "semantic:document_open"
          | "semantic:document_change"
          | "semantic:document_close";
      }
    >,
  ): void {
    this.pendingMessages = this.pendingMessages.filter(
      (pending) =>
        !(
          (pending.kind === "semantic:document_open" ||
            pending.kind === "semantic:document_change" ||
            pending.kind === "semantic:document_close") &&
          sameDocument(pending.uri, message.uri)
        ),
    );
  }

  private removePendingResync(): void {
    this.pendingMessages = this.pendingMessages.filter(
      (message) => message.kind !== "semantic:resync",
    );
  }

  private flushPendingMessages(): void {
    if (!this.projectReady || this.socket?.readyState !== WebSocket.OPEN)
      return;
    const pending = this.pendingMessages.splice(0);
    for (let index = 0; index < pending.length; index += 1) {
      if (!this.send(pending[index])) {
        this.pendingMessages.unshift(...pending.slice(index));
        break;
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private setStatus(status: SemanticTransportStatus): void {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }
}

function sameDocument(
  left: Extract<
    SemanticClientMessage,
    {
      kind:
        | "semantic:document_open"
        | "semantic:document_change"
        | "semantic:document_close";
    }
  >["uri"],
  right: Extract<
    SemanticClientMessage,
    {
      kind:
        | "semantic:document_open"
        | "semantic:document_change"
        | "semantic:document_close";
    }
  >["uri"],
): boolean {
  return (
    left.profileId === right.profileId &&
    left.projectId === right.projectId &&
    left.path === right.path &&
    left.language === right.language
  );
}

function messageProjectId(message: SemanticClientMessage): string | null {
  switch (message.kind) {
    case "semantic:project":
    case "semantic:prewarm":
    case "semantic:resync":
      return message.projectId;
    case "semantic:document_open":
    case "semantic:document_change":
    case "semantic:document_close":
    case "semantic:navigate":
      return message.uri.projectId;
    case "semantic:cancel":
      return null;
  }
}

function buildSemanticWebSocketUrl(
  baseUrl: string,
  token: string | null,
): string {
  const fallback =
    typeof location === "undefined" ? "http://localhost" : location.origin;
  const parsed = new URL(baseUrl, fallback);
  const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  const prefix = parsed.pathname.replace(/\/$/, "");
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${protocol}//${parsed.host}${prefix}/ws/semantic${query}`;
}
