/**
 * WsTransport — WebSocket + REST transport for browser/web mode.
 *
 * - Request/response: fetch() to /api/* endpoints (absolute URL via baseUrl)
 * - Terminal I/O + push events: single persistent WebSocket to /ws
 * - Auth: Authorization: Bearer header on all fetch calls; ?token= on WS URL
 * - Auto-reconnect with exponential backoff (1s → 2s → 4s → max 30s)
 * - Exposes WsStatus for connection state UI
 */

import type { Transport } from "./transport.js";
import { buildAuthHeaders, getAuthToken, getServerUrl } from "./server-config.js";

type Callback = (...args: unknown[]) => void;

export type WsStatus = "connecting" | "connected" | "disconnected" | "error";

/** IPC channel → REST endpoint mapping. */
function channelToEndpoint(channel: string, data: unknown): { method: string; url: string; body?: unknown } {
  switch (channel) {
    // Workspace
    case "workspace:status":   return { method: "GET", url: "/api/workspace/status" };
    case "workspace:get":      return { method: "GET", url: "/api/workspace" };
    case "workspace:init":     return { method: "POST", url: "/api/workspace/init", body: { path: data } };
    case "workspace:switch":   return { method: "POST", url: "/api/workspace/switch", body: { path: data } };
    case "workspace:known":    return { method: "GET", url: "/api/workspace/known" };
    case "workspace:addKnown": return { method: "POST", url: "/api/workspace/known", body: { path: data } };
    case "workspace:removeKnown": return { method: "DELETE", url: "/api/workspace/known", body: { path: data } };
    // Global config
    case "globalConfig:get": return { method: "GET", url: "/api/global-config" };
    case "globalConfig:updateDefaults": return { method: "POST", url: "/api/global-config/defaults", body: { defaults: data } };

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
    case "agent-store:add":
      return { method: "GET", url: "/api/agent-store/_no_add" };
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

    default:
      throw new Error(`Unknown channel for WsTransport: ${channel}`);
  }
}

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

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
  /** sessionId → exit callbacks */
  private exitListeners = new Map<string, Set<(exitCode: number | null) => void>>();

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

  /** Teardown: close WS, cancel reconnect timer, clear all listeners. */
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
      // baseUrl may be a relative path on same origin
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
          type: string;
          id?: string;
          data?: string;
          exitCode?: number | null;
          payload?: unknown;
        };

        if (msg.type === "terminal:data" && msg.id) {
          this.dataListeners.get(msg.id)?.forEach((cb) => cb(msg.data ?? ""));
        } else if (msg.type === "terminal:exit" && msg.id) {
          const code = msg.exitCode !== undefined ? msg.exitCode : null;
          this.exitListeners.get(msg.id)?.forEach((cb) => cb(code));
        } else {
          const payload = msg.payload ?? msg;
          this.eventListeners.get(msg.type)?.forEach((cb) => cb(payload));
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

  async invoke<T>(channel: string, data?: unknown): Promise<T> {
    const { method, url: relativeUrl, body } = channelToEndpoint(channel, data);

    // Build absolute URL — baseUrl may be cross-origin
    const fullUrl = relativeUrl.startsWith("/")
      ? `${this.baseUrl}${relativeUrl}`
      : relativeUrl;

    const headers: Record<string, string> = {
      ...buildAuthHeaders(),
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const init: RequestInit = {
      method,
      headers,
      credentials: "include", // send cookies for same-origin; ignored cross-origin without CORS allow-credentials
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(fullUrl, init);
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
      throw new Error(err.error ?? `HTTP ${response.status}`);
    }
    const ct = response.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      return response.json() as Promise<T>;
    }
    return response.text() as unknown as T;
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

  onEvent(channel: string, cb: (payload: unknown) => void): () => void {
    if (!this.eventListeners.has(channel)) this.eventListeners.set(channel, new Set());
    this.eventListeners.get(channel)!.add(cb as Callback);
    return () => this.eventListeners.get(channel)?.delete(cb as Callback);
  }

  terminalWrite(id: string, data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "terminal:write", id, data }));
    }
  }

  terminalResize(id: string, cols: number, rows: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "terminal:resize", id, cols, rows }));
    }
  }
}
