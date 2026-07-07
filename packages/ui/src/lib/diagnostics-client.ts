import {
  addLoggerSink,
  redactLogMetadata,
  type LogEntry,
} from "@dam-hopper/shared/logger";
import { getActiveProfile } from "@/api/server-config.js";
import type { WsStatus } from "@/api/ws-transport.js";

const STORAGE_KEY = "damhopper_diagnostics_frontend_v1";
const DEFAULT_RETENTION_MS = 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 1_000;
const DEFAULT_MAX_STORAGE_BYTES = 512 * 1024;

type DiagnosticsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type DiagnosticsWindow = Pick<
  Window,
  "addEventListener" | "removeEventListener"
>;

export type ClientDiagnosticType =
  | "log"
  | "browser.error"
  | "browser.unhandledrejection"
  | "react.error"
  | "route"
  | "transport"
  | "custom";

export interface ClientDiagnosticEntry {
  timestamp: string;
  timestampMs: number;
  type: ClientDiagnosticType;
  scope: string;
  message: string;
  metadata?: unknown;
}

export interface ClientRouteSnapshot {
  path: string;
  search: string;
  hash: string;
  href?: string;
}

export interface ClientTransportSnapshot {
  status: WsStatus;
  updatedAt: string;
}

export interface ClientDiagnosticsSnapshot {
  manifest: {
    schemaVersion: 1;
    storageKey: string;
    retentionMinutes: number;
    maxEntries: number;
    maxStorageBytes: number;
    entryCount: number;
  };
  logs: ClientDiagnosticEntry[];
  browserErrors: ClientDiagnosticEntry[];
  currentRoute: ClientRouteSnapshot | null;
  profile: {
    id: string;
    name: string;
    origin: string;
    authType: "basic" | "none";
  } | null;
  transportStatus: ClientTransportSnapshot | null;
}

interface DiagnosticsClientOptions {
  storage?: DiagnosticsStorage | null;
  browserWindow?: DiagnosticsWindow | null;
  now?: () => number;
  retentionMs?: number;
  maxEntries?: number;
  maxStorageBytes?: number;
}

function getDefaultStorage(): DiagnosticsStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function getDefaultWindow(): DiagnosticsWindow | null {
  try {
    return globalThis.window ?? null;
  } catch {
    return null;
  }
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEntry(value: unknown): ClientDiagnosticEntry | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.timestamp !== "string" ||
    typeof value.timestampMs !== "number" ||
    typeof value.type !== "string" ||
    typeof value.scope !== "string" ||
    typeof value.message !== "string"
  ) {
    return null;
  }

  return {
    timestamp: value.timestamp,
    timestampMs: value.timestampMs,
    type: value.type as ClientDiagnosticType,
    scope: value.scope,
    message: value.message,
    metadata: value.metadata,
  };
}

function serializeUnknownError(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return value;
}

function toRouteSnapshot(route: ClientRouteSnapshot): ClientRouteSnapshot {
  const redacted = redactLogMetadata(route);
  if (!isRecord(redacted)) return route;
  return {
    path: typeof redacted.path === "string" ? redacted.path : route.path,
    search: typeof redacted.search === "string" ? redacted.search : "",
    hash: typeof redacted.hash === "string" ? redacted.hash : "",
    href: typeof redacted.href === "string" ? redacted.href : undefined,
  };
}

export class DiagnosticsClient {
  private readonly storage: DiagnosticsStorage | null;
  private readonly browserWindow: DiagnosticsWindow | null;
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly maxEntries: number;
  private readonly maxStorageBytes: number;
  private entries: ClientDiagnosticEntry[] = [];
  private currentRoute: ClientRouteSnapshot | null = null;
  private transportStatus: ClientTransportSnapshot | null = null;
  private removeLoggerSink: (() => void) | null = null;
  private initialized = false;

  public constructor(options: DiagnosticsClientOptions = {}) {
    this.storage =
      options.storage === undefined ? getDefaultStorage() : options.storage;
    this.browserWindow =
      options.browserWindow === undefined
        ? getDefaultWindow()
        : options.browserWindow;
    this.now = options.now ?? Date.now;
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxStorageBytes = options.maxStorageBytes ?? DEFAULT_MAX_STORAGE_BYTES;
    this.load();
  }

  public initialize(): () => void {
    if (this.initialized) {
      return () => {};
    }

    this.initialized = true;
    this.removeLoggerSink = addLoggerSink((entry) =>
      this.recordLogEntry(entry),
    );
    this.browserWindow?.addEventListener("error", this.handleBrowserError);
    this.browserWindow?.addEventListener(
      "unhandledrejection",
      this.handleUnhandledRejection,
    );

    return () => this.dispose();
  }

  public dispose(): void {
    if (!this.initialized) return;
    this.initialized = false;
    this.removeLoggerSink?.();
    this.removeLoggerSink = null;
    this.browserWindow?.removeEventListener("error", this.handleBrowserError);
    this.browserWindow?.removeEventListener(
      "unhandledrejection",
      this.handleUnhandledRejection,
    );
  }

  public record(
    type: ClientDiagnosticType,
    scope: string,
    message: string,
    metadata?: unknown,
  ): void {
    const timestampMs = this.now();
    this.entries.push({
      timestamp: new Date(timestampMs).toISOString(),
      timestampMs,
      type,
      scope,
      message,
      metadata:
        metadata === undefined ? undefined : redactLogMetadata(metadata),
    });
    this.pruneAndPersist();
  }

  public recordRoute(route: ClientRouteSnapshot): void {
    this.currentRoute = toRouteSnapshot(route);
    this.record("route", "router", "route changed", this.currentRoute);
  }

  public setTransportStatus(status: WsStatus): void {
    this.transportStatus = {
      status,
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.record("transport", "WsTransport", "status changed", {
      status,
    });
  }

  public snapshot(): ClientDiagnosticsSnapshot {
    this.pruneAndPersist();
    const logs = [...this.entries];
    return {
      manifest: {
        schemaVersion: 1,
        storageKey: STORAGE_KEY,
        retentionMinutes: Math.round(this.retentionMs / 60_000),
        maxEntries: this.maxEntries,
        maxStorageBytes: this.maxStorageBytes,
        entryCount: logs.length,
      },
      logs,
      browserErrors: logs.filter(
        (entry) =>
          entry.type === "browser.error" ||
          entry.type === "browser.unhandledrejection" ||
          entry.type === "react.error",
      ),
      currentRoute: this.currentRoute,
      profile: this.getProfileSnapshot(),
      transportStatus: this.transportStatus,
    };
  }

  public clear(): void {
    this.entries = [];
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures; diagnostics remain best-effort.
    }
  }

  private readonly handleBrowserError = (event: Event): void => {
    const errorEvent = event as ErrorEvent;
    this.record(
      "browser.error",
      "window",
      errorEvent.message || "browser error",
      {
        filename: errorEvent.filename,
        lineno: errorEvent.lineno,
        colno: errorEvent.colno,
        error: serializeUnknownError(errorEvent.error),
      },
    );
  };

  private readonly handleUnhandledRejection = (event: Event): void => {
    const rejectionEvent = event as PromiseRejectionEvent;
    const rawReason = rejectionEvent.reason;
    const reason = serializeUnknownError(rawReason);
    const message =
      rawReason instanceof Error
        ? rawReason.message
        : typeof rawReason === "string"
          ? rawReason
          : "unhandled promise rejection";
    this.record("browser.unhandledrejection", "window", message, { reason });
  };

  private recordLogEntry(entry: LogEntry): void {
    this.record("log", entry.scope, entry.message, {
      level: entry.level,
      metadata: entry.metadata,
    });
  }

  private load(): void {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        this.storage?.removeItem(STORAGE_KEY);
        return;
      }
      this.entries = parsed
        .map((entry) => normalizeEntry(entry))
        .filter((entry): entry is ClientDiagnosticEntry => entry !== null);
      this.pruneAndPersist();
    } catch {
      this.entries = [];
      try {
        this.storage?.removeItem(STORAGE_KEY);
      } catch {
        // Ignore storage failures; diagnostics remain best-effort.
      }
    }
  }

  private pruneAndPersist(): void {
    const cutoff = this.now() - this.retentionMs;
    this.entries = this.entries.filter((entry) => entry.timestampMs >= cutoff);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(this.entries.length - this.maxEntries);
    }
    this.trimToStorageBudget();
    this.persist();
  }

  private trimToStorageBudget(): void {
    while (this.entries.length > 0) {
      const serialized = JSON.stringify(this.entries);
      if (byteLength(serialized) <= this.maxStorageBytes) return;
      this.entries.shift();
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // Memory-only diagnostics are acceptable when localStorage is blocked/full.
    }
  }

  private getProfileSnapshot(): ClientDiagnosticsSnapshot["profile"] {
    try {
      const profile = getActiveProfile();
      if (!profile) return null;
      return {
        id: profile.id,
        name: profile.name,
        origin: new URL(profile.url).origin,
        authType: profile.authType,
      };
    } catch {
      return null;
    }
  }
}

const defaultDiagnosticsClient = new DiagnosticsClient();

export function initializeClientDiagnostics(): () => void {
  return defaultDiagnosticsClient.initialize();
}

export function recordClientDiagnostic(
  type: ClientDiagnosticType,
  scope: string,
  message: string,
  metadata?: unknown,
): void {
  defaultDiagnosticsClient.record(type, scope, message, metadata);
}

export function recordClientRoute(route: ClientRouteSnapshot): void {
  defaultDiagnosticsClient.recordRoute(route);
}

export function setClientTransportStatus(status: WsStatus): void {
  defaultDiagnosticsClient.setTransportStatus(status);
}

export function getClientDiagnosticsSnapshot(): ClientDiagnosticsSnapshot {
  return defaultDiagnosticsClient.snapshot();
}
