import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { ApiClient } from "./client.js";
import { createApiClient } from "./client.js";
import { type Transport, reconfigureTransport } from "./transport.js";
import { IdleTransport } from "./idle-transport.js";
import { WsTransport } from "./ws-transport.js";
import {
  type ConnectionRef,
  type ProfileId,
  ConnectionOwnerError,
  connectionKey,
} from "./ownership.js";
import {
  getProfiles,
  getAuthToken,
  isSameOriginProfile,
  getActiveProfileId,
} from "./server-config.js";
import {
  installTransportBridge,
  removeProfileListeners,
} from "../hooks/use-sse.js";

import { generateUUID } from "../lib/utils.js";
let registryQueryClient: QueryClient | null = null;

export function setConnectionRegistryQueryClient(
  queryClient: QueryClient | null,
): void {
  registryQueryClient = queryClient;
}

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "login-required"
  | "offline"
  | "unsupported";

export interface ConnectionSnapshot {
  readonly owner: ConnectionRef;
  readonly status: ConnectionStatus;
  readonly intent: boolean;
  readonly serverUrl: string;
  readonly error: string | null;
}

interface ConnectionEntry {
  profileId: ProfileId;
  generation: number;
  status: ConnectionStatus;
  intent: boolean;
  serverUrl: string;
  error: string | null;
  transport: Transport | null;
  api: ApiClient | null;
  unsubBridge?: (() => void) | null;
  backoffMs: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  settleConnect?: () => void;
  snapshot: ConnectionSnapshot;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

const entries = new Map<ProfileId, ConnectionEntry>();
const tombstones = new Set<ProfileId>();
const inFlightConnects = new Map<ProfileId, Promise<void>>();
const listeners = new Set<() => void>();
const mediaClientIdsByOwner = new Map<string, string>();
function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function freezeSnapshot(
  entry: Omit<ConnectionEntry, "snapshot">,
): ConnectionSnapshot {
  return Object.freeze({
    owner: Object.freeze({
      profileId: entry.profileId,
      generation: entry.generation,
    }),
    status: entry.status,
    intent: entry.intent,
    serverUrl: entry.serverUrl,
    error: entry.error,
  });
}

function getOrCreateEntry(
  profileId: ProfileId,
  serverUrl = "",
): ConnectionEntry {
  let entry = entries.get(profileId);
  if (!entry) {
    const base = {
      profileId,
      generation: 1,
      status: "disconnected" as ConnectionStatus,
      intent: false,
      serverUrl,
      error: null,
      transport: null,
      api: null,
      backoffMs: INITIAL_BACKOFF_MS,
      reconnectTimer: null,
    };
    entry = {
      ...base,
      snapshot: freezeSnapshot(base),
    };
    entries.set(profileId, entry);
  }
  return entry;
}

function updateSnapshot(
  profileId: ProfileId,
  patch: Partial<
    Pick<ConnectionEntry, "status" | "intent" | "serverUrl" | "error">
  >,
): void {
  const entry = entries.get(profileId);
  if (!entry) return;

  if (patch.status !== undefined) entry.status = patch.status;
  if (patch.intent !== undefined) entry.intent = patch.intent;
  if (patch.serverUrl !== undefined) entry.serverUrl = patch.serverUrl;
  if (patch.error !== undefined) entry.error = patch.error;

  entry.snapshot = freezeSnapshot(entry);
  notifyListeners();
}

function clearReconnectTimer(entry: ConnectionEntry): void {
  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }
}

function isStale(profileId: ProfileId, generation: number): boolean {
  if (tombstones.has(profileId)) return true;
  const current = entries.get(profileId);
  return !current || current.generation !== generation;
}

function scheduleReconnect(profileId: ProfileId): void {
  const entry = entries.get(profileId);
  if (
    !entry ||
    !entry.intent ||
    entry.reconnectTimer ||
    tombstones.has(profileId)
  ) {
    return;
  }
  const delay = entry.backoffMs;
  entry.backoffMs = Math.min(entry.backoffMs * 2, MAX_BACKOFF_MS);
  entry.reconnectTimer = setTimeout(() => {
    entry.reconnectTimer = null;
    if (entry.intent && !tombstones.has(profileId)) {
      void connectProfile(profileId);
    }
  }, delay);
}

function handleDrop(profileId: ProfileId, generation: number): void {
  const entry = entries.get(profileId);
  if (!entry || entry.generation !== generation || tombstones.has(profileId)) {
    return;
  }

  entry.settleConnect?.();
  entry.unsubBridge?.();
  entry.generation += 1;
  entry.unsubBridge = null;
  entry.transport?.destroy?.();
  entry.transport = null;
  entry.api = null;
  if (entry.intent) {
    updateSnapshot(profileId, {
      status: "offline",
      error: "Connection lost; reconnecting...",
    });
    scheduleReconnect(profileId);
  } else {
    updateSnapshot(profileId, {
      status: "disconnected",
      error: null,
    });
  }
}

export function getConnectionSnapshot(
  profileId: ProfileId,
): ConnectionSnapshot | null {
  if (tombstones.has(profileId)) return null;
  const entry = entries.get(profileId);
  return entry ? entry.snapshot : null;
}

export function getAllConnectionSnapshots(): ConnectionSnapshot[] {
  const result: ConnectionSnapshot[] = [];
  for (const [id, entry] of entries) {
    if (!tombstones.has(id)) {
      result.push(entry.snapshot);
    }
  }
  return result;
}

export function connectProfile(profileId: ProfileId): Promise<void> {
  if (tombstones.has(profileId)) {
    return Promise.reject(
      new ConnectionOwnerError(
        `Profile ${profileId} has been removed (tombstone)`,
        "unavailable",
      ),
    );
  }

  const existing = entries.get(profileId);
  if (
    existing?.status === "connected" &&
    existing.intent &&
    existing.transport
  ) {
    return Promise.resolve();
  }

  const inFlight = inFlightConnects.get(profileId);
  if (inFlight) return inFlight;

  const promise = performConnectProfile(profileId).finally(() => {
    if (inFlightConnects.get(profileId) === promise) {
      inFlightConnects.delete(profileId);
    }
  });

  inFlightConnects.set(profileId, promise);
  return promise;
}
async function performConnectProfile(profileId: ProfileId): Promise<void> {
  const profiles = getProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) {
    const fallbackEntry = getOrCreateEntry(profileId);
    clearReconnectTimer(fallbackEntry);
    fallbackEntry.generation += 1;
    updateSnapshot(profileId, {
      status: "offline",
      error: `Profile ${profileId} not found`,
    });
    return;
  }

  const cleanUrl = profile.url.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(cleanUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    if (!isSameOriginProfile(profile)) {
      const entry = getOrCreateEntry(profileId, cleanUrl);
      clearReconnectTimer(entry);
      entry.generation += 1;
      updateSnapshot(profileId, {
        status: "unsupported",
        intent: false,
        serverUrl: profile.url,
        error:
          "Remote connections are supported only on Browser and Windows desktop.",
      });
      return;
    }
  } catch {
    const entry = getOrCreateEntry(profileId, cleanUrl);
    clearReconnectTimer(entry);
    entry.generation += 1;
    updateSnapshot(profileId, {
      status: "unsupported",
      intent: false,
      serverUrl: profile.url,
      error: "Invalid server URL. Please provide a valid http or https URL.",
    });
    return;
  }

  const entry = getOrCreateEntry(profileId, cleanUrl);
  clearReconnectTimer(entry);
  entry.settleConnect?.();
  entry.unsubBridge?.();
  entry.unsubBridge = null;
  entry.transport?.destroy?.();
  entry.transport = null;
  entry.api = null;

  const nextGen = entry.generation + 1;
  entry.generation = nextGen;
  updateSnapshot(profileId, {
    status: "connecting",
    intent: true,
    serverUrl: cleanUrl,
    error: null,
  });

  const token = getAuthToken(profileId);
  if (profile.authType === "basic" && !token) {
    updateSnapshot(profileId, {
      status: "login-required",
      error: "Login required for this profile",
    });
    return;
  }

  try {
    const statusHeaders: Record<string, string> = {
      Accept: "application/json",
    };
    if (token) {
      statusHeaders["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${cleanUrl}/api/auth/status`, {
      method: "GET",
      headers: statusHeaders,
      credentials: "omit",
    });

    if (isStale(profileId, nextGen)) return;

    if (res.status === 401 || res.status === 403) {
      updateSnapshot(profileId, {
        status: "login-required",
        error: "Authentication failed. Please log in again.",
      });
      return;
    }

    if (!res.ok) {
      updateSnapshot(profileId, {
        status: "offline",
        error: `Server responded with HTTP ${res.status}`,
      });
      scheduleReconnect(profileId);
      return;
    }

    const data = (await res.json()) as {
      authenticated?: boolean;
      workbenchProtocol?: unknown;
    };
    if (isStale(profileId, nextGen)) return;

    if (data.workbenchProtocol !== 2) {
      updateSnapshot(profileId, {
        status: "unsupported",
        intent: false,
        error:
          "Unsupported server protocol. DamHopper workbench protocol 2 is required; please update dam-hopper-server.",
      });
      return;
    }
  } catch (fetchErr) {
    if (isStale(profileId, nextGen)) return;
    updateSnapshot(profileId, {
      status: "offline",
      error:
        fetchErr instanceof Error ? fetchErr.message : "Server unreachable",
    });
    scheduleReconnect(profileId);
    return;
  }

  if (isStale(profileId, nextGen)) return;

  const owner: ConnectionRef = Object.freeze({
    profileId,
    generation: nextGen,
  });
  const transport = new WsTransport({
    baseUrl: cleanUrl,
    profileId,
    authToken: token,
    generation: nextGen,
    onDrop: () => {
      handleDrop(profileId, nextGen);
    },
  });

  entry.transport = transport;
  entry.unsubBridge = installTransportBridge(
    owner,
    transport,
    registryQueryClient ?? undefined,
  );
  const client = createApiClient(owner, transport);
  entry.api = client;

  const { promise: wsConnectedPromise, resolve: resolveWsConnected } =
    createDeferred<void>();

  let settled = false;
  const connectTimeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    if (!isStale(profileId, nextGen) && entry.status === "connecting") {
      handleDrop(profileId, nextGen);
    }
    resolveWsConnected();
  }, 10_000);

  const settle = () => {
    if (!settled) {
      settled = true;
      clearTimeout(connectTimeout);
      resolveWsConnected();
    }
  };
  entry.settleConnect = settle;

  transport.onStatusChange((wsStatus) => {
    if (isStale(profileId, nextGen)) return;
    if (wsStatus === "connected") {
      entry.backoffMs = INITIAL_BACKOFF_MS;
      updateSnapshot(profileId, {
        status: "connected",
        error: null,
      });
      const activeId = getActiveProfileId();
      if (!activeId || activeId === profileId) {
        reconfigureTransport(transport);
      }
      settle();
    } else if (wsStatus === "disconnected" || wsStatus === "error") {
      handleDrop(profileId, nextGen);
      settle();
    }
  });

  if (transport.getStatus() === "connected") {
    entry.backoffMs = INITIAL_BACKOFF_MS;
    updateSnapshot(profileId, {
      status: "connected",
      error: null,
    });
    const activeId = getActiveProfileId();
    if (!activeId || activeId === profileId) {
      reconfigureTransport(transport);
    }
    settle();
  }
  await wsConnectedPromise;
}

export function disconnectProfile(profileId: ProfileId): void {
  const entry = entries.get(profileId);
  if (!entry) return;

  entry.settleConnect?.();
  entry.intent = false;
  entry.generation += 1;
  inFlightConnects.delete(profileId);
  clearReconnectTimer(entry);
  entry.unsubBridge?.();
  entry.unsubBridge = null;
  entry.transport?.destroy?.();
  entry.transport = null;
  entry.api = null;
  entry.backoffMs = INITIAL_BACKOFF_MS;

  const activeId = getActiveProfileId();
  if (!activeId || activeId === profileId) {
    reconfigureTransport(new IdleTransport());
  }
  updateSnapshot(profileId, {
    status: "disconnected",
    intent: false,
    error: null,
  });
}

export function captureConnection(profileId: ProfileId): ConnectionRef {
  const snapshot = getConnectionSnapshot(profileId);
  if (!snapshot || snapshot.status !== "connected") {
    throw new ConnectionOwnerError(
      `No active connection for profile ${profileId} (status: ${snapshot?.status ?? "none"})`,
      "unavailable",
    );
  }
  return snapshot.owner;
}

export function isCurrentConnection(owner: ConnectionRef): boolean {
  if (tombstones.has(owner.profileId)) return false;
  const entry = entries.get(owner.profileId);
  if (!entry) return false;
  return entry.generation === owner.generation && entry.status === "connected";
}

export function getTransport(owner: ConnectionRef): Transport {
  if (!isCurrentConnection(owner)) {
    throw new ConnectionOwnerError(
      `Connection is stale or not connected: ${owner.profileId}@${owner.generation}`,
      "stale",
    );
  }
  const entry = entries.get(owner.profileId);
  if (!entry?.transport) {
    throw new ConnectionOwnerError(
      `Transport unavailable for ${owner.profileId}@${owner.generation}`,
      "unavailable",
    );
  }
  return entry.transport;
}

export function getApi(owner: ConnectionRef): ApiClient {
  if (!isCurrentConnection(owner)) {
    throw new ConnectionOwnerError(
      `Connection is stale or not connected: ${owner.profileId}@${owner.generation}`,
      "stale",
    );
  }
  const entry = entries.get(owner.profileId);
  if (!entry?.api) {
    throw new ConnectionOwnerError(
      `ApiClient unavailable for ${owner.profileId}@${owner.generation}`,
      "unavailable",
    );
  }
  return entry.api;
}

/** Returns the in-memory random UUIDv4 mediaClientId bound to this ConnectionRef. */
export function getMediaClientId(owner: ConnectionRef): string {
  const key = connectionKey(owner);
  const existing = mediaClientIdsByOwner.get(key);
  if (existing) return existing;
  const created = generateUUID();
  mediaClientIdsByOwner.set(key, created);
  return created;
}

/** Returns the active mediaClientId for a profile, generating a stable one if disconnected. */
export function getMediaClientIdForProfile(
  profileId: ProfileId,
): string {
  const snap = getConnectionSnapshot(profileId);
  const owner: ConnectionRef = snap?.owner ?? { profileId, generation: 1 };
  return getMediaClientId(owner);
}
export function subscribeConnections(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function removeProfileConnection(profileId: ProfileId): void {
  const entry = entries.get(profileId);
  if (entry) {
    entry.intent = false;
    entry.settleConnect?.();
    entry.generation += 1;
    clearReconnectTimer(entry);
    entry.unsubBridge?.();
    entry.unsubBridge = null;
    entry.transport?.destroy?.();
    entry.transport = null;
    entry.api = null;
    entries.delete(profileId);
  }
  for (const [key] of mediaClientIdsByOwner) {
    try {
      const parsed = JSON.parse(key);
      if (Array.isArray(parsed) && parsed[0] === profileId) {
        mediaClientIdsByOwner.delete(key);
      }
    } catch {
      // ignore malformed keys
    }
  }
  removeProfileListeners(profileId);
  inFlightConnects.delete(profileId);
  tombstones.add(profileId);
  notifyListeners();
}

export function resetConnections(): void {
  for (const entry of entries.values()) {
    entry.intent = false;
    entry.settleConnect?.();
    entry.generation += 1;
    clearReconnectTimer(entry);
    entry.unsubBridge?.();
    entry.unsubBridge = null;
    entry.transport?.destroy?.();
  }
  for (const id of entries.keys()) {
    removeProfileListeners(id);
  }
  for (const t of tombstones) {
    removeProfileListeners(t);
  }
  entries.clear();
  tombstones.clear();
  inFlightConnects.clear();
  listeners.clear();
  mediaClientIdsByOwner.clear();
}

export function useConnectionSnapshot(
  profileId: ProfileId,
): ConnectionSnapshot | null {
  return useSyncExternalStore(
    subscribeConnections,
    () => getConnectionSnapshot(profileId),
    () => null,
  );
}

export function syncActiveProfileConnection(
  activeProfileId: ProfileId | null,
): void {
  if (activeProfileId) {
    const entry = entries.get(activeProfileId);
    if (entry?.transport && entry.status === "connected") {
      reconfigureTransport(entry.transport);
    } else {
      reconfigureTransport(new IdleTransport());
    }
  } else {
    reconfigureTransport(new IdleTransport());
  }
}
