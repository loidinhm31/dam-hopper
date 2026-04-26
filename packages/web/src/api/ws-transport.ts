/**
 * WsTransport — WebSocket + REST transport for browser/web mode.
 *
 * - Request/response: fetch() to /api/* endpoints (absolute URL via baseUrl)
 * - Terminal I/O + push events: single persistent WebSocket to /ws
 * - Auth: Authorization: Bearer header on all fetch calls; ?token= on WS URL
 * - Auto-reconnect with exponential backoff (1s → 2s → 4s → max 30s)
 * - Exposes WsStatus for connection state UI
 *
 * WS envelope: hard cut to {kind: "..."} format (server phase-02).
 * No legacy {type: "..."} support.
 */

import type { Transport } from "./transport.js";
import { buildAuthHeaders, getAuthToken, getServerUrl } from "./server-config.js";
import type { FsOpResult, FsUploadResult, ServerTreeNode, FsEventDto } from "./fs-types.js";

type Callback = (...args: unknown[]) => void;

export type WsStatus = "connecting" | "connected" | "disconnected" | "error";

const FS_REQ_TIMEOUT_MS = 15_000;
const WRITE_CHUNK_SIZE = 128 * 1024; // 128 KB per chunk

export interface FsReadResult {
  ok: true;
  content: string;       // base64-encoded
  binary: boolean;
  mime?: string;
  mtime: number;
  size: number;
}

export interface FsReadTooLarge {
  ok: false;
  code: "TOO_LARGE";
  binary: boolean;
  mime?: string;
  mtime: number;
  size: number;
}

export interface FsReadError {
  ok: false;
  code: string;
  message?: string;
}

export type FsReadResponse = FsReadResult | FsReadTooLarge | FsReadError;

export interface FsWriteResult {
  ok: true;
  newMtime: number;
}

export interface FsWriteConflict {
  ok: false;
  conflict: true;
}

export interface FsWriteError {
  ok: false;
  conflict: false;
  error: string;
}

export type FsWriteResponse = FsWriteResult | FsWriteConflict | FsWriteError;

/** IPC channel → REST endpoint mapping. */
function channelToEndpoint(channel: string, data: unknown): { method: string; url: string; body?: unknown } {
  switch (channel) {
    // Workspace
    case "workspace:status":   return { method: "GET", url: "/api/workspace/status" };
    case "workspace:get":      return { method: "GET", url: "/api/workspace" };
    case "workspace:init":     return { method: "POST", url: "/api/workspace/init", body: { path: data } };
    case "workspace:switch":   return { method: "POST", url: "/api/workspace/switch", body: { path: data } };
    case "workspace:discover": return { method: "GET", url: `/api/workspace/discover?path=${encodeURIComponent(data as string)}` };
    case "workspace:known":    return { method: "GET", url: "/api/workspace/known" };
    case "workspace:addKnown": return { method: "POST", url: "/api/workspace/known", body: { path: data } };
    case "workspace:removeKnown": return { method: "DELETE", url: "/api/workspace/known", body: { path: data } };
    // Global config
    case "globalConfig:get": return { method: "GET", url: "/api/global-config" };
    case "globalConfig:updateDefaults": return { method: "POST", url: "/api/global-config/defaults", body: { defaults: data } };
    case "globalConfig:updateUi": return { method: "POST", url: "/api/global-config/ui", body: { ui: data } };

    // Projects
    case "projects:list": return { method: "GET", url: "/api/projects" };
    case "projects:get":    return { method: "GET", url: `/api/projects/${encodeURIComponent(data as string)}` };
    case "projects:status": return { method: "GET", url: `/api/projects/${encodeURIComponent(data as string)}/status` };

    // Git
    case "git:fetch": return { method: "POST", url: "/api/git/fetch", body: { projects: data } };
    case "git:pull":  return { method: "POST", url: "/api/git/pull", body: { projects: data } };
    case "git:push":  return { method: "POST", url: "/api/git/push", body: { project: data } };
    case "git:worktrees": return { method: "GET", url: `/api/git/${encodeURIComponent(data as string)}/worktrees` };
    case "git:addWorktree": {
      const d = data as { project: string; options: unknown };
      return { method: "POST", url: `/api/git/${encodeURIComponent(d.project)}/worktrees`, body: d.options };
    }
    case "git:removeWorktree": {
      const d = data as { project: string; path: string };
      return { method: "DELETE", url: `/api/git/${encodeURIComponent(d.project)}/worktrees`, body: { path: d.path } };
    }
    case "git:branches": return { method: "GET", url: `/api/git/${encodeURIComponent(data as string)}/branches` };
    case "git:updateBranch": {
      const d = data as { project: string; branch?: string };
      return { method: "POST", url: `/api/git/${encodeURIComponent(d.project)}/branches/update`, body: { branch: d.branch } };
    }
    case "git:log": {
      const d = data as { project: string; limit?: number };
      const qs = d.limit ? `?limit=${d.limit}` : "";
      return { method: "GET", url: `/api/git/${encodeURIComponent(d.project)}/log${qs}` };
    }

    // Config
    case "config:get":    return { method: "GET", url: "/api/config" };
    case "config:update": return { method: "PUT", url: "/api/config", body: data };
    case "config:updateProject": {
      const d = data as { name: string; patch: unknown };
      return { method: "PATCH", url: `/api/config/projects/${encodeURIComponent(d.name)}`, body: d.patch };
    }

    // Settings
    case "cache:clear":     return { method: "POST", url: "/api/settings/cache-clear" };
    case "workspace:reset": return { method: "POST", url: "/api/settings/reset" };
    case "settings:export": return { method: "GET", url: "/api/settings/export" };
    case "settings:import": return { method: "POST", url: "/api/settings/import", body: data };

    // Commands
    case "commands:search": {
      const d = data as { query: string; projectType?: string; limit?: number };
      const params = new URLSearchParams({ query: d.query });
      if (d.projectType) params.set("projectType", d.projectType);
      if (d.limit) params.set("limit", String(d.limit));
      return { method: "GET", url: `/api/commands/search?${params}` };
    }
    case "commands:list": {
      const d = data as { projectType: string };
      return { method: "GET", url: `/api/commands?projectType=${encodeURIComponent(d.projectType)}` };
    }

    // Terminal
    case "terminal:create": return { method: "POST", url: "/api/terminal", body: data };
    case "terminal:list": return { method: "GET", url: "/api/terminal" };
    case "terminal:listDetailed": return { method: "GET", url: "/api/terminal/detailed" };
    case "terminal:buffer": return { method: "GET", url: `/api/terminal/${encodeURIComponent(data as string)}/buffer` };
    case "terminal:kill": return { method: "DELETE", url: `/api/terminal/${encodeURIComponent(data as string)}` };
    case "terminal:remove": return { method: "DELETE", url: `/api/terminal/${encodeURIComponent(data as string)}/remove` };

    // Health
    case "health:get": return { method: "GET", url: "/api/health" };

    // FS (REST for list/stat; subscribe/unsubscribe go over WS)
    case "fs:list": {
      const d = data as { project: string; path: string };
      const params = new URLSearchParams({ project: d.project, path: d.path });
      return { method: "GET", url: `/api/fs/list?${params}` };
    }
    case "fs:search": {
      const d = data as { project?: string; q: string; case?: boolean; max?: number; scope?: "project" | "workspace" };
      const params = new URLSearchParams({ q: d.q });
      if (d.project) params.set("project", d.project);
      if (d.case) params.set("case", "true");
      if (d.max) params.set("max", String(d.max));
      if (d.scope === "workspace") params.set("scope", "workspace");
      return { method: "GET", url: `/api/fs/search?${params}` };
    }

    // Agent Store
    case "agent-store:list": {
      const d = data as { category?: string } | undefined;
      const url = d?.category ? `/api/agent-store?category=${encodeURIComponent(d.category)}` : "/api/agent-store";
      return { method: "GET", url };
    }
    case "agent-store:get": {
      const d = data as { name: string; category: string };
      return { method: "GET", url: `/api/agent-store/${d.category}/${encodeURIComponent(d.name)}` };
    }
    case "agent-store:getContent": {
      const d = data as { name: string; category: string; fileName?: string };
      const qs = d.fileName ? `?fileName=${encodeURIComponent(d.fileName)}` : "";
      return { method: "GET", url: `/api/agent-store/${d.category}/${encodeURIComponent(d.name)}/content${qs}` };
    }
    case "agent-store:remove": {
      const d = data as { name: string; category: string };
      return { method: "DELETE", url: `/api/agent-store/${d.category}/${encodeURIComponent(d.name)}` };
    }
    case "agent-store:ship":     return { method: "POST", url: "/api/agent-store/ship", body: data };
    case "agent-store:unship":   return { method: "POST", url: "/api/agent-store/unship", body: data };
    case "agent-store:absorb":   return { method: "POST", url: "/api/agent-store/absorb", body: data };
    case "agent-store:bulkShip": return { method: "POST", url: "/api/agent-store/bulk-ship", body: data };
    case "agent-store:matrix":   return { method: "GET", url: "/api/agent-store/matrix" };
    case "agent-store:scan":     return { method: "GET", url: "/api/agent-store/scan" };
    case "agent-store:health":   return { method: "GET", url: "/api/agent-store/health" };

    // Agent Memory
    case "agent-memory:list": {
      const d = data as { projectName: string };
      return { method: "GET", url: `/api/agent-memory/${encodeURIComponent(d.projectName)}` };
    }
    case "agent-memory:get": {
      const d = data as { projectName: string; agent: string };
      return { method: "GET", url: `/api/agent-memory/${encodeURIComponent(d.projectName)}/${d.agent}` };
    }
    case "agent-memory:update": {
      const d = data as { projectName: string; agent: string; content: string };
      return { method: "PUT", url: `/api/agent-memory/${encodeURIComponent(d.projectName)}/${d.agent}`, body: { content: d.content } };
    }
    case "agent-memory:templates": return { method: "GET", url: "/api/agent-memory/templates" };
    case "agent-memory:apply":     return { method: "POST", url: "/api/agent-memory/apply", body: data };

    // Agent Import
    case "agent-store:importScan":      return { method: "POST", url: "/api/agent-import/scan", body: data };
    case "agent-store:importScanLocal": return { method: "POST", url: "/api/agent-import/scan-local", body: data };
    case "agent-store:importConfirm":   return { method: "POST", url: "/api/agent-import/confirm", body: data };

    // SSH credentials
    case "ssh:listKeys":  return { method: "GET", url: "/api/ssh/keys" };
    case "ssh:checkAgent": return { method: "GET", url: "/api/ssh/agent" };
    case "ssh:addKey":    return { method: "POST", url: "/api/ssh/keys/load", body: data };

    // Git diff / change management
    case "git:diff": {
      const d = data as { project: string };
      return { method: "GET", url: `/api/git/${encodeURIComponent(d.project)}/diff` };
    }
    case "git:untrackedFiles": {
      const d = data as { project: string; offset: number; limit: number };
      const params = new URLSearchParams({ offset: String(d.offset), limit: String(d.limit) });
      return { method: "GET", url: `/api/git/${encodeURIComponent(d.project)}/untracked?${params}` };
    }
    case "git:fileDiff": {
      const d = data as { project: string; path: string };
      const params = new URLSearchParams({ path: d.path });
      return { method: "GET", url: `/api/git/${encodeURIComponent(d.project)}/diff/file?${params}` };
    }
    case "git:stage": {
      const d = data as { project: string; paths: string[] };
      return { method: "POST", url: `/api/git/${encodeURIComponent(d.project)}/stage`, body: { paths: d.paths } };
    }
    case "git:unstage": {
      const d = data as { project: string; paths: string[] };
      return { method: "POST", url: `/api/git/${encodeURIComponent(d.project)}/unstage`, body: { paths: d.paths } };
    }
    case "git:discard": {
      const d = data as { project: string; path: string };
      return { method: "POST", url: `/api/git/${encodeURIComponent(d.project)}/discard`, body: { path: d.path } };
    }
    case "git:discardHunk": {
      const d = data as { project: string; path: string; hunkIndex: number };
      return { method: "POST", url: `/api/git/${encodeURIComponent(d.project)}/discard-hunk`, body: { path: d.path, hunkIndex: d.hunkIndex } };
    }
    case "git:conflicts": {
      const d = data as { project: string };
      return { method: "GET", url: `/api/git/${encodeURIComponent(d.project)}/conflicts` };
    }
    case "git:resolve": {
      const d = data as { project: string; path: string; content: string };
      return { method: "POST", url: `/api/git/${encodeURIComponent(d.project)}/resolve`, body: { path: d.path, content: d.content } };
    }
    case "git:commit": {
      const d = data as { project: string; message: string };
      return { method: "POST", url: `/api/git/${encodeURIComponent(d.project)}/commit`, body: { message: d.message } };
    }

    // Ports
    case "port:list":     return { method: "GET",  url: "/api/ports" };

    // Tunnels
    case "tunnel:install:status": return { method: "GET", url: "/api/tunnels/install" };
    case "tunnel:install": return { method: "POST", url: "/api/tunnels/install" };
    case "tunnel:create": return { method: "POST", url: "/api/tunnels", body: data };
    case "tunnel:list":   return { method: "GET",  url: "/api/tunnels" };
    case "tunnel:stop": {
      const d = data as { id: string };
      return { method: "DELETE", url: `/api/tunnels/${encodeURIComponent(d.id)}` };
    }

    default:
      throw new Error(`Unknown channel for WsTransport: ${channel}`);
  }
}

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
// OPAQUE rounds involve Wasm crypto — longer timeout than FS ops to handle slow devices.
const AUTH_TIMEOUT_MS = 30_000;

export class WsTransport implements Transport {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private closed = false;

  private wsStatus: WsStatus = "connecting";
  private statusListeners = new Set<(status: WsStatus) => void>();

  /** channel → callbacks */
  private eventListeners = new Map<string, Set<Callback>>();
  /** sessionId → data callbacks */
  private dataListeners = new Map<string, Set<(data: string) => void>>();
  /** sessionId → exit callbacks (basic: exitCode only) */
  private exitListeners = new Map<string, Set<(exitCode: number | null) => void>>();
  /** sessionId → enhanced exit callbacks (includes restart metadata) */
  private exitEnhancedListeners = new Map<string, Set<(exit: {
    exitCode: number | null;
    willRestart: boolean;
    restartIn?: number;
    restartCount?: number;
  }) => void>>();
  /** sessionId → restart callbacks */
  private restartListeners = new Map<string, Set<(restart: {
    restartCount: number;
    previousExitCode: number | null;
  }) => void>>();
  /** sessionId → buffer callbacks (for terminal:attach response) */
  private bufferListeners = new Map<string, Set<(buffer: {
    data: string;
    offset: number;
  }) => void>>();
  /** sub_id → overflow callbacks */
  private fsOverflowListeners = new Map<number, Set<(message: string) => void>>();

  // ── FS subscription state ─────────────────────────────────────────────────
  private nextReqId = 1;
  private pendingFsReqs = new Map<number, {
    resolve: (v: { sub_id: number; nodes: ServerTreeNode[] }) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  /** sub_id → set of event callbacks */
  private fsEventListeners = new Map<number, Set<(ev: FsEventDto) => void>>();

  // ── FS read state ─────────────────────────────────────────────────────────
  private pendingFsReads = new Map<number, {
    resolve: (v: FsReadResponse) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  // ── FS write state ────────────────────────────────────────────────────────
  /** write_id → resolve/reject for write_begin response */
  private pendingWriteBegin = new Map<number, {
    resolve: (writeId: number) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  /** `${write_id}:${seq}` → resolve for chunk ack */
  private pendingWriteChunks = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  /** write_id → resolve/reject for commit result */
  private pendingWriteCommit = new Map<number, {
    resolve: (v: FsWriteResponse) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  // ── FS op state ───────────────────────────────────────────────────────────
  private pendingFsOps = new Map<number, {
    resolve: (v: FsOpResult) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  // ── FS upload state ───────────────────────────────────────────────────────
  private pendingUploadBegin = new Map<string, {
    resolve: () => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private pendingUploadChunks = new Map<string, {
    resolve: () => void;
    reject: (e: Error) => void;
  }>();
  private pendingUploadCommit = new Map<string, {
    resolve: (v: FsUploadResult) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  // ── OPAQUE auth state ─────────────────────────────────────────────────────
  private pendingOpaqueRegStart = new Map<number, {
    resolve: (data: string) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private pendingOpaqueRegFinish = new Map<number, {
    resolve: () => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private pendingOpaqueLoginStart = new Map<number, {
    resolve: (v: { session_id: string; data: string }) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private pendingOpaqueLoginFinish = new Map<number, {
    resolve: () => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(private readonly baseUrl: string = getServerUrl()) {
    this.connect();
  }

  private setStatus(status: WsStatus): void {
    this.wsStatus = status;
    this.statusListeners.forEach((cb) => cb(status));
  }

  getStatus(): WsStatus {
    return this.wsStatus;
  }

  onStatusChange(cb: (status: WsStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  destroy(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.statusListeners.clear();
    this.eventListeners.clear();
    this.dataListeners.clear();
    this.exitListeners.clear();
    this.exitEnhancedListeners.clear();
    this.restartListeners.clear();
    this.fsOverflowListeners.clear();
    for (const p of this.pendingFsReqs.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("transport destroyed"));
    }
    this.pendingFsReqs.clear();
    this.fsEventListeners.clear();
    for (const p of this.pendingFsReads.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("transport destroyed"));
    }
    this.pendingFsReads.clear();
    for (const p of this.pendingWriteBegin.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("transport destroyed"));
    }
    this.pendingWriteBegin.clear();
    for (const p of this.pendingWriteChunks.values()) {
      p.reject(new Error("transport destroyed"));
    }
    this.pendingWriteChunks.clear();
    for (const p of this.pendingWriteCommit.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("transport destroyed"));
    }
    this.pendingWriteCommit.clear();
    for (const p of this.pendingFsOps.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("transport destroyed"));
    }
    this.pendingFsOps.clear();
    for (const p of this.pendingUploadBegin.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("transport destroyed"));
    }
    this.pendingUploadBegin.clear();
    for (const p of this.pendingUploadChunks.values()) {
      p.reject(new Error("transport destroyed"));
    }
    this.pendingUploadChunks.clear();
    for (const p of this.pendingUploadCommit.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("transport destroyed"));
    }
    this.pendingUploadCommit.clear();
    for (const p of this.pendingOpaqueRegStart.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("transport destroyed"));
    }
    this.pendingOpaqueRegStart.clear();
    for (const p of this.pendingOpaqueRegFinish.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("transport destroyed"));
    }
    this.pendingOpaqueRegFinish.clear();
    for (const p of this.pendingOpaqueLoginStart.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("transport destroyed"));
    }
    this.pendingOpaqueLoginStart.clear();
    for (const p of this.pendingOpaqueLoginFinish.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("transport destroyed"));
    }
    this.pendingOpaqueLoginFinish.clear();
  }

  private connect(): void {
    if (this.closed) return;
    this.setStatus("connecting");

    let wsProto: string;
    let host: string;
    try {
      const parsed = new URL(this.baseUrl);
      wsProto = parsed.protocol === "https:" ? "wss:" : "ws:";
      host = parsed.host;
    } catch {
      wsProto = location.protocol === "https:" ? "wss:" : "ws:";
      host = location.host;
    }

    const token = getAuthToken();
    const wsUrl = token
      ? `${wsProto}//${host}/ws?token=${encodeURIComponent(token)}`
      : `${wsProto}//${host}/ws`;

    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      console.log("[WsTransport] Connected to", this.baseUrl);
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.setStatus("connected");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          kind: string;
          id?: string;
          data?: string;
          offset?: number;
          exitCode?: number | null;
          willRestart?: boolean;
          restartIn?: number;
          restartCount?: number;
          previousExitCode?: number | null;
          payload?: unknown;
          req_id?: number;
          sub_id?: number;
          nodes?: ServerTreeNode[];
          event?: FsEventDto;
          code?: string;
          message?: string;
          // read result
          ok?: boolean;
          mime?: string;
          binary?: boolean;
          mtime?: number;
          size?: number;
          // write
          write_id?: number;
          seq?: number;
          new_mtime?: number;
          conflict?: boolean;
          error?: string;
          // OPAQUE auth
          session_id?: string;
        };

        switch (msg.kind) {
          case "terminal:output":
            if (msg.id) this.dataListeners.get(msg.id)?.forEach((cb) => cb(msg.data ?? ""));
            break;

          case "terminal:buffer":
            if (msg.id) {
              this.bufferListeners.get(msg.id)?.forEach((cb) => cb({
                data: msg.data ?? "",
                offset: msg.offset ?? 0,
              }));
            }
            break;

          case "terminal:exit":
            if (msg.id) {
              const code = msg.exitCode !== undefined ? msg.exitCode : null;
              // Basic exit listener (backward-compatible)
              this.exitListeners.get(msg.id)?.forEach((cb) => cb(code));
              // Enhanced exit listener (includes restart metadata)
              this.exitEnhancedListeners.get(msg.id)?.forEach((cb) => cb({
                exitCode: code,
                willRestart: msg.willRestart ?? false,
                restartIn: msg.restartIn,
                restartCount: msg.restartCount,
              }));
            }
            break;

          case "process:restarted":
            if (msg.id) {
              this.restartListeners.get(msg.id)?.forEach((cb) => cb({
                restartCount: msg.restartCount ?? 0,
                previousExitCode: msg.previousExitCode !== undefined ? msg.previousExitCode : null,
              }));
            }
            // Fire generic terminal:changed for dashboard refresh
            this.eventListeners.get("terminal:changed")?.forEach((cb) => cb({}));
            break;

          case "fs:overflow":
            if (msg.sub_id !== undefined) {
              this.fsOverflowListeners.get(msg.sub_id)?.forEach((cb) => cb(msg.message ?? "FS event buffer overflow"));
            }
            break;

          case "fs:tree_snapshot": {
            const p = msg.req_id !== undefined ? this.pendingFsReqs.get(msg.req_id) : undefined;
            if (p) {
              clearTimeout(p.timer);
              this.pendingFsReqs.delete(msg.req_id!);
              p.resolve({ sub_id: msg.sub_id!, nodes: (msg.nodes ?? []) as ServerTreeNode[] });
            }
            break;
          }

          case "fs:error": {
            // Could be a read error or subscribe error
            const reqId = msg.req_id;
            if (reqId !== undefined) {
              const subscribeP = this.pendingFsReqs.get(reqId);
              if (subscribeP) {
                clearTimeout(subscribeP.timer);
                this.pendingFsReqs.delete(reqId);
                subscribeP.reject(new Error(`${msg.code ?? "FS_ERROR"}: ${msg.message ?? "unknown"}`));
                break;
              }
              const readP = this.pendingFsReads.get(reqId);
              if (readP) {
                clearTimeout(readP.timer);
                this.pendingFsReads.delete(reqId);
                readP.resolve({ ok: false, code: msg.code ?? "FS_ERROR", message: msg.message });
                break;
              }
            }
            break;
          }

          case "fs:event":
            if (msg.sub_id !== undefined && msg.event) {
              this.fsEventListeners.get(msg.sub_id)?.forEach((cb) => cb(msg.event!));
            }
            break;

          case "fs:read_result": {
            const reqId = msg.req_id;
            if (reqId === undefined) break;
            const p = this.pendingFsReads.get(reqId);
            if (!p) break;
            clearTimeout(p.timer);
            this.pendingFsReads.delete(reqId);

            if (msg.ok) {
              p.resolve({
                ok: true,
                content: msg.data ?? "",
                binary: msg.binary ?? false,
                mime: msg.mime,
                mtime: msg.mtime ?? 0,
                size: msg.size ?? 0,
              });
            } else if (msg.code === "TOO_LARGE") {
              p.resolve({
                ok: false,
                code: "TOO_LARGE",
                binary: msg.binary ?? false,
                mime: msg.mime,
                mtime: msg.mtime ?? 0,
                size: msg.size ?? 0,
              });
            } else {
              p.resolve({ ok: false, code: msg.code ?? "FS_ERROR", message: msg.message });
            }
            break;
          }

          case "fs:write_ack": {
            const reqId = msg.req_id;
            if (reqId === undefined) break;
            const p = this.pendingWriteBegin.get(reqId);
            if (!p) break;
            clearTimeout(p.timer);
            this.pendingWriteBegin.delete(reqId);
            p.resolve(msg.write_id!);
            break;
          }

          case "fs:write_chunk_ack": {
            const key = `${msg.write_id}:${msg.seq}`;
            const p = this.pendingWriteChunks.get(key);
            if (!p) break;
            this.pendingWriteChunks.delete(key);
            p.resolve();
            break;
          }

          case "fs:write_result": {
            const writeId = msg.write_id;
            if (writeId === undefined) break;
            const p = this.pendingWriteCommit.get(writeId);
            if (!p) break;
            clearTimeout(p.timer);
            this.pendingWriteCommit.delete(writeId);

            if (msg.ok) {
              p.resolve({ ok: true, newMtime: msg.new_mtime! });
            } else if (msg.conflict) {
              p.resolve({ ok: false, conflict: true });
            } else {
              p.resolve({ ok: false, conflict: false, error: msg.error ?? "write failed" });
            }
            break;
          }

          case "fs:op_result": {
            const reqId = msg.req_id;
            if (reqId === undefined) break;
            const p = this.pendingFsOps.get(reqId);
            if (!p) break;
            clearTimeout(p.timer);
            this.pendingFsOps.delete(reqId);
            p.resolve({ ok: msg.ok ?? false, error: msg.error });
            break;
          }

          case "fs:upload_begin_ok": {
            const uploadId = (msg as unknown as { upload_id: string }).upload_id;
            const p = uploadId ? this.pendingUploadBegin.get(uploadId) : undefined;
            if (!p) break;
            clearTimeout(p.timer);
            this.pendingUploadBegin.delete(uploadId);
            p.resolve();
            break;
          }

          case "fs:upload_chunk_ack": {
            const uploadId = (msg as unknown as { upload_id: string }).upload_id;
            const seq = (msg as unknown as { seq: number }).seq;
            const key = `${uploadId}:${seq}`;
            const p = this.pendingUploadChunks.get(key);
            if (!p) break;
            this.pendingUploadChunks.delete(key);
            p.resolve();
            break;
          }

          case "fs:upload_result": {
            const uploadId = (msg as unknown as { upload_id: string }).upload_id;
            const p = uploadId ? this.pendingUploadCommit.get(uploadId) : undefined;
            if (!p) break;
            clearTimeout(p.timer);
            this.pendingUploadCommit.delete(uploadId);
            p.resolve({
              ok: msg.ok ?? false,
              newMtime: msg.new_mtime,
              error: msg.error,
            });
            break;
          }

          case "auth:register_start_response": {
            const reqId = msg.req_id;
            if (reqId === undefined) break;
            const p = this.pendingOpaqueRegStart.get(reqId);
            if (!p) break;
            clearTimeout(p.timer);
            this.pendingOpaqueRegStart.delete(reqId);
            if (msg.ok && msg.data) p.resolve(msg.data);
            else p.reject(new Error(msg.error ?? "OPAQUE register_start failed"));
            break;
          }

          case "auth:register_finish_response": {
            const reqId = msg.req_id;
            if (reqId === undefined) break;
            const p = this.pendingOpaqueRegFinish.get(reqId);
            if (!p) break;
            clearTimeout(p.timer);
            this.pendingOpaqueRegFinish.delete(reqId);
            if (msg.ok) p.resolve();
            else p.reject(new Error(msg.error ?? "OPAQUE register_finish failed"));
            break;
          }

          case "auth:login_start_response": {
            const reqId = msg.req_id;
            if (reqId === undefined) break;
            const p = this.pendingOpaqueLoginStart.get(reqId);
            if (!p) break;
            clearTimeout(p.timer);
            this.pendingOpaqueLoginStart.delete(reqId);
            if (msg.ok && msg.session_id && msg.data) {
              p.resolve({ session_id: msg.session_id, data: msg.data });
            } else {
              p.reject(new Error(msg.error ?? "OPAQUE login_start failed"));
            }
            break;
          }

          case "auth:login_finish_response": {
            const reqId = msg.req_id;
            if (reqId === undefined) break;
            const p = this.pendingOpaqueLoginFinish.get(reqId);
            if (!p) break;
            clearTimeout(p.timer);
            this.pendingOpaqueLoginFinish.delete(reqId);
            if (msg.ok) p.resolve();
            else p.reject(new Error(msg.error ?? "OPAQUE login_finish failed"));
            break;
          }

          default: {
            const payload = msg.payload ?? msg;
            this.eventListeners.get(msg.kind)?.forEach((cb) => cb(payload));
          }
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (this.closed) return;
      console.log(`[WsTransport] Disconnected — reconnecting in ${this.backoffMs}ms`);
      this.setStatus("disconnected");
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      this.setStatus("error");
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.connect();
    }, this.backoffMs);
  }

  async invoke<T>(channel: string, data?: unknown, timeoutMs = 30000): Promise<T> {
    const { method, url: relativeUrl, body } = channelToEndpoint(channel, data);

    const fullUrl = relativeUrl.startsWith("/")
      ? `${this.baseUrl}${relativeUrl}`
      : relativeUrl;

    const headers: Record<string, string> = {
      ...buildAuthHeaders(),
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const init: RequestInit = {
      method,
      headers,
      credentials: "include",
      signal: controller.signal,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(fullUrl, init);
      clearTimeout(timeout);
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
        throw new Error(err.error ?? `HTTP ${response.status}`);
      }
      const ct = response.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        return response.json() as Promise<T>;
      }
      return response.text() as unknown as T;
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    }
  }

  onTerminalData(id: string, cb: (data: string) => void): () => void {
    if (!this.dataListeners.has(id)) this.dataListeners.set(id, new Set());
    this.dataListeners.get(id)!.add(cb);
    return () => this.dataListeners.get(id)?.delete(cb);
  }

  onTerminalExit(id: string, cb: (exitCode: number | null) => void): () => void {
    if (!this.exitListeners.has(id)) this.exitListeners.set(id, new Set());
    this.exitListeners.get(id)!.add(cb);
    return () => this.exitListeners.get(id)?.delete(cb);
  }

  onTerminalExitEnhanced(id: string, cb: (exit: {
    exitCode: number | null;
    willRestart: boolean;
    restartIn?: number;
    restartCount?: number;
  }) => void): () => void {
    if (!this.exitEnhancedListeners.has(id)) this.exitEnhancedListeners.set(id, new Set());
    this.exitEnhancedListeners.get(id)!.add(cb);
    return () => this.exitEnhancedListeners.get(id)?.delete(cb);
  }

  onProcessRestarted(id: string, cb: (restart: {
    restartCount: number;
    previousExitCode: number | null;
  }) => void): () => void {
    if (!this.restartListeners.has(id)) this.restartListeners.set(id, new Set());
    this.restartListeners.get(id)!.add(cb);
    return () => this.restartListeners.get(id)?.delete(cb);
  }

  onFsOverflow(sub_id: number, cb: (message: string) => void): () => void {
    if (!this.fsOverflowListeners.has(sub_id)) this.fsOverflowListeners.set(sub_id, new Set());
    this.fsOverflowListeners.get(sub_id)!.add(cb);
    return () => this.fsOverflowListeners.get(sub_id)?.delete(cb);
  }

  onEvent(channel: string, cb: (payload: unknown) => void): () => void {
    if (!this.eventListeners.has(channel)) this.eventListeners.set(channel, new Set());
    this.eventListeners.get(channel)!.add(cb as Callback);
    return () => this.eventListeners.get(channel)?.delete(cb as Callback);
  }

  terminalWrite(id: string, data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ kind: "terminal:write", id, data }));
    }
  }

  terminalResize(id: string, cols: number, rows: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ kind: "terminal:resize", id, cols, rows }));
    }
  }

  terminalAttach(id: string, fromOffset?: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        kind: "terminal:attach",
        id,
        from_offset: fromOffset ?? null,
      }));
    }
  }

  onTerminalBuffer(id: string, cb: (buffer: { data: string; offset: number }) => void): () => void {
    if (!this.bufferListeners.has(id)) this.bufferListeners.set(id, new Set());
    this.bufferListeners.get(id)!.add(cb);
    return () => this.bufferListeners.get(id)?.delete(cb);
  }

  // ── FS subscription methods ───────────────────────────────────────────────

  fsSubscribeTree(project: string, path: string): Promise<{ sub_id: number; nodes: ServerTreeNode[] }> {
    return new Promise((resolve, reject) => {
      const req_id = this.nextReqId++;
      const timer = setTimeout(() => {
        this.pendingFsReqs.delete(req_id);
        reject(new Error(`fs:subscribe_tree timeout (req_id=${req_id})`));
      }, FS_REQ_TIMEOUT_MS);
      this.pendingFsReqs.set(req_id, { resolve, reject, timer });
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ kind: "fs:subscribe_tree", req_id, project, path }));
      } else {
        clearTimeout(timer);
        this.pendingFsReqs.delete(req_id);
        reject(new Error("WebSocket not connected"));
      }
    });
  }

  fsUnsubscribeTree(sub_id: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ kind: "fs:unsubscribe_tree", sub_id }));
    }
    this.fsEventListeners.delete(sub_id);
  }

  onFsEvent(sub_id: number, cb: (ev: FsEventDto) => void): () => void {
    if (!this.fsEventListeners.has(sub_id)) this.fsEventListeners.set(sub_id, new Set());
    this.fsEventListeners.get(sub_id)!.add(cb);
    return () => this.fsEventListeners.get(sub_id)?.delete(cb);
  }

  // ── FS read ───────────────────────────────────────────────────────────────

  fsRead(
    project: string,
    path: string,
    opts?: { offset?: number; len?: number },
  ): Promise<FsReadResponse> {
    return new Promise((resolve, reject) => {
      const req_id = this.nextReqId++;
      const timer = setTimeout(() => {
        this.pendingFsReads.delete(req_id);
        reject(new Error(`fs:read timeout (req_id=${req_id})`));
      }, FS_REQ_TIMEOUT_MS);
      this.pendingFsReads.set(req_id, { resolve, reject, timer });
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          kind: "fs:read",
          req_id,
          project,
          path,
          offset: opts?.offset,
          len: opts?.len,
        }));
      } else {
        clearTimeout(timer);
        this.pendingFsReads.delete(req_id);
        reject(new Error("WebSocket not connected"));
      }
    });
  }

  // ── FS write ──────────────────────────────────────────────────────────────

  /**
   * Write a file atomically via the WS write protocol:
   * write_begin → chunk* → write_commit.
   *
   * `content` is the UTF-8 string to write. `expectedMtime` is the mtime
   * the client last observed (Unix seconds); the server rejects if stale.
   */
  async fsWriteFile(
    project: string,
    path: string,
    content: string,
    expectedMtime: number,
  ): Promise<FsWriteResponse> {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    const size = bytes.length;

    // 1. write_begin → get write_id (using binary encoding)
    const writeId = await this.sendWriteBegin(project, path, expectedMtime, size, "binary");

    // 2. Chunk the content and send each chunk as binary
    let seq = 0;
    let offset = 0;
    const inFlight: Array<Promise<void>> = [];
    const WINDOW_SIZE = 4;

    while (offset < bytes.length) {
      const chunk = bytes.slice(offset, offset + WRITE_CHUNK_SIZE);
      offset += chunk.length;

      const ack = this.sendWriteChunkBinary(writeId, seq, chunk);
      inFlight.push(ack);
      seq++;

      if (inFlight.length >= WINDOW_SIZE) {
        await inFlight.shift()!;
      }
    }

    // Handle empty file edge case
    if (bytes.length === 0) {
      await this.sendWriteChunkBinary(writeId, 0, new Uint8Array(0));
    }

    await Promise.all(inFlight);

    // 3. Commit
    return this.sendWriteCommit(writeId);
  }

  private sendWriteBegin(
    project: string,
    path: string,
    expectedMtime: number,
    size: number,
    encoding?: "base64" | "binary",
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const req_id = this.nextReqId++;
      const timer = setTimeout(() => {
        this.pendingWriteBegin.delete(req_id);
        reject(new Error("fs:write_begin timeout"));
      }, FS_REQ_TIMEOUT_MS);
      this.pendingWriteBegin.set(req_id, { resolve, reject, timer });
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          kind: "fs:write_begin",
          req_id,
          project,
          path,
          expected_mtime: expectedMtime,
          size,
          encoding,
        }));
      } else {
        clearTimeout(timer);
        this.pendingWriteBegin.delete(req_id);
        reject(new Error("WebSocket not connected"));
      }
    });
  }

  private sendWriteChunk(
    writeId: number,
    seq: number,
    eof: boolean,
    data: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const key = `${writeId}:${seq}`;
      const timer = setTimeout(() => {
        this.pendingWriteChunks.delete(key);
        reject(new Error(`chunk ack timeout (write_id=${writeId}, seq=${seq})`));
      }, 30_000);
      this.pendingWriteChunks.set(key, {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ kind: "fs:write_chunk", write_id: writeId, seq, eof, data }));
      } else {
        clearTimeout(timer);
        this.pendingWriteChunks.delete(key);
        reject(new Error("WebSocket not connected"));
      }
    });
  }

  private sendWriteChunkBinary(
    writeId: number,
    seq: number,
    data: Uint8Array,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const key = `${writeId}:${seq}`;
      const timer = setTimeout(() => {
        this.pendingWriteChunks.delete(key);
        reject(new Error(`binary chunk ack timeout (write_id=${writeId}, seq=${seq})`));
      }, 30_000);
      this.pendingWriteChunks.set(key, {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      if (this.ws?.readyState === WebSocket.OPEN) {
        // JSON header first, then binary frame
        this.ws.send(JSON.stringify({ kind: "fs:write_chunk_binary", write_id: writeId, seq }));
        this.ws.send(data.buffer);
      } else {
        clearTimeout(timer);
        this.pendingWriteChunks.delete(key);
        reject(new Error("WebSocket not connected"));
      }
    });
  }

  private sendWriteCommit(writeId: number): Promise<FsWriteResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingWriteCommit.delete(writeId);
        reject(new Error("fs:write_commit timeout"));
      }, 30_000); // longer timeout for commit (fsync may be slow)
      this.pendingWriteCommit.set(writeId, { resolve, reject, timer });
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ kind: "fs:write_commit", write_id: writeId }));
      } else {
        clearTimeout(timer);
        this.pendingWriteCommit.delete(writeId);
        reject(new Error("WebSocket not connected"));
      }
    });
  }

  // ── FS op ─────────────────────────────────────────────────────────────────

  fsOp(
    op: "create_file" | "create_dir" | "rename" | "delete" | "move",
    params: { project: string; path: string; newPath?: string; forceGit?: boolean },
  ): Promise<FsOpResult> {
    return new Promise((resolve, reject) => {
      const req_id = this.nextReqId++;
      const timer = setTimeout(() => {
        this.pendingFsOps.delete(req_id);
        reject(new Error(`fs:op timeout (${op})`));
      }, FS_REQ_TIMEOUT_MS);
      this.pendingFsOps.set(req_id, { resolve, reject, timer });
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          kind: "fs:op",
          req_id,
          op,
          project: params.project,
          path: params.path,
          new_path: params.newPath,
          force_git: params.forceGit ?? false,
        }));
      } else {
        clearTimeout(timer);
        this.pendingFsOps.delete(req_id);
        reject(new Error("WebSocket not connected"));
      }
    });
  }

  // ── FS upload ─────────────────────────────────────────────────────────────

  /**
   * Upload a File via WS binary frames with ack-per-seq backpressure.
   *
   * Protocol: upload_begin → (upload_chunk JSON + Binary frame)* → upload_commit.
   * In-flight window of 4: up to 4 chunk acks can be outstanding simultaneously.
   */
  async fsUploadFile(
    project: string,
    dir: string,
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<FsUploadResult> {
    const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const CHUNK_SIZE = 128 * 1024; // 128 KB
    const IN_FLIGHT = 4;

    // 1. Begin
    await this.sendUploadBegin(uploadId, project, dir, file.name, file.size);

    // 2. Chunk loop
    const reader = file.stream().getReader();
    let seq = 0;
    let bytesSent = 0;
    const inFlight: Array<Promise<void>> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Slice into CHUNK_SIZE pieces
      let offset = 0;
      while (offset < value.byteLength) {
        const slice = value.slice(offset, offset + CHUNK_SIZE);
        offset += slice.byteLength;
        const currentSeq = seq++;

        const ack = this.sendUploadChunk(uploadId, currentSeq, slice);
        inFlight.push(ack);
        bytesSent += slice.byteLength;
        onProgress?.(file.size > 0 ? Math.min(99, Math.round((bytesSent / file.size) * 100)) : 50);

        if (inFlight.length >= IN_FLIGHT) {
          await inFlight.shift()!;
        }
      }
    }

    await Promise.all(inFlight);

    // 3. Commit
    const req_id = this.nextReqId++;
    const result = await this.sendUploadCommit(req_id, uploadId);
    onProgress?.(100);
    return result;
  }

  private sendUploadBegin(
    uploadId: string,
    project: string,
    dir: string,
    filename: string,
    len: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const req_id = this.nextReqId++;
      const timer = setTimeout(() => {
        this.pendingUploadBegin.delete(uploadId);
        reject(new Error("fs:upload_begin timeout"));
      }, FS_REQ_TIMEOUT_MS);
      this.pendingUploadBegin.set(uploadId, { resolve, reject, timer });
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          kind: "fs:upload_begin",
          req_id,
          upload_id: uploadId,
          project,
          dir,
          filename,
          len,
        }));
      } else {
        clearTimeout(timer);
        this.pendingUploadBegin.delete(uploadId);
        reject(new Error("WebSocket not connected"));
      }
    });
  }

  private sendUploadChunk(uploadId: string, seq: number, data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const key = `${uploadId}:${seq}`;
      const timer = setTimeout(() => {
        this.pendingUploadChunks.delete(key);
        reject(new Error(`upload chunk ack timeout (upload_id=${uploadId}, seq=${seq})`));
      }, 30_000);
      this.pendingUploadChunks.set(key, {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      if (this.ws?.readyState === WebSocket.OPEN) {
        // JSON header first, then binary frame
        this.ws.send(JSON.stringify({ kind: "fs:upload_chunk", upload_id: uploadId, seq }));
        this.ws.send(data.buffer);
      } else {
        clearTimeout(timer);
        this.pendingUploadChunks.delete(key);
        reject(new Error("WebSocket not connected"));
      }
    });
  }

  private sendUploadCommit(req_id: number, uploadId: string): Promise<FsUploadResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingUploadCommit.delete(uploadId);
        reject(new Error("fs:upload_commit timeout"));
      }, 60_000);
      this.pendingUploadCommit.set(uploadId, { resolve, reject, timer });
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ kind: "fs:upload_commit", req_id, upload_id: uploadId }));
      } else {
        clearTimeout(timer);
        this.pendingUploadCommit.delete(uploadId);
        reject(new Error("WebSocket not connected"));
      }
    });
  }

  // ── OPAQUE auth ───────────────────────────────────────────────────────────

  /** Send auth:register_start and return the server's RegistrationResponse data (base64). */
  authRegisterStart(identifier: string, data: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req_id = this.nextReqId++;
      const timer = setTimeout(() => {
        this.pendingOpaqueRegStart.delete(req_id);
        reject(new Error("auth:register_start timeout"));
      }, AUTH_TIMEOUT_MS);
      this.pendingOpaqueRegStart.set(req_id, { resolve, reject, timer });
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ kind: "auth:register_start", req_id, identifier, data }));
      } else {
        clearTimeout(timer);
        this.pendingOpaqueRegStart.delete(req_id);
        reject(new Error("WebSocket not connected"));
      }
    });
  }

  /** Send auth:register_finish to complete OPAQUE registration.
   *  Pass overwrite=true to allow re-registration (in-memory ephemeral model). */
  authRegisterFinish(identifier: string, data: string, overwrite = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const req_id = this.nextReqId++;
      const timer = setTimeout(() => {
        this.pendingOpaqueRegFinish.delete(req_id);
        reject(new Error("auth:register_finish timeout"));
      }, AUTH_TIMEOUT_MS);
      this.pendingOpaqueRegFinish.set(req_id, { resolve, reject, timer });
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ kind: "auth:register_finish", req_id, identifier, data, overwrite }));
      } else {
        clearTimeout(timer);
        this.pendingOpaqueRegFinish.delete(req_id);
        reject(new Error("WebSocket not connected"));
      }
    });
  }

  /** Send auth:login_start and return { session_id, data } (CredentialResponse base64). */
  authLoginStart(identifier: string, data: string): Promise<{ session_id: string; data: string }> {
    return new Promise((resolve, reject) => {
      const req_id = this.nextReqId++;
      const timer = setTimeout(() => {
        this.pendingOpaqueLoginStart.delete(req_id);
        reject(new Error("auth:login_start timeout"));
      }, AUTH_TIMEOUT_MS);
      this.pendingOpaqueLoginStart.set(req_id, { resolve, reject, timer });
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ kind: "auth:login_start", req_id, identifier, data }));
      } else {
        clearTimeout(timer);
        this.pendingOpaqueLoginStart.delete(req_id);
        reject(new Error("WebSocket not connected"));
      }
    });
  }

  /**
   * Send auth:login_finish to finalize OPAQUE login.
   * session_id is the server-assigned login session (from auth:login_start_response),
   * not a req_id — the server correlates login_finish via session_id, not req_id.
   * req_id is still sent for client-side pending-map lookup only.
   */
  authLoginFinish(session_id: string, data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req_id = this.nextReqId++;
      const timer = setTimeout(() => {
        this.pendingOpaqueLoginFinish.delete(req_id);
        reject(new Error("auth:login_finish timeout"));
      }, AUTH_TIMEOUT_MS);
      this.pendingOpaqueLoginFinish.set(req_id, { resolve, reject, timer });
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ kind: "auth:login_finish", req_id, session_id, data }));
      } else {
        clearTimeout(timer);
        this.pendingOpaqueLoginFinish.delete(req_id);
        reject(new Error("WebSocket not connected"));
      }
    });
  }
}
