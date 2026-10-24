/**
 * Stable local model identity, replaceable wire bindings, and model registry
 * for TypeScript / JavaScript LSP Semantic Navigation.
 *
 * Invariants:
 * - Local model identity is stable across reconnects and target shifts.
 * - Local Monaco model URI uses inmemory://dam-hopper/${encodeURIComponent(tabKey)}.
 * - Wire URI uses dam-hopper://semantic/${targetId}/${relativePath} (RFC 3986).
 * - Incarnations fence late callbacks, revealing intents, and closed document updates.
 * - Reconnect updates wire bindings without rekeying or recreating dirty Monaco models.
 */

import type { ResourceBinding } from "@/api/ownership.js";
import * as connectionsModule from "@/api/connections.js";
import * as serverConfigModule from "@/api/server-config.js";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { profileQueryKey } from "@/api/query-client.js";

export type SupportedLanguageDescriptor = "typescript" | "javascript";

/**
 * Immutable endpoint, configured project root, and authenticated actor provenance
 * captured on authorized file load or semantic client initialization.
 */
export interface SemanticProvenance extends ResourceBinding {
  readonly serverUrl: string;
  readonly configuredRoot: string;
  readonly actor: string;
}

export interface StableModelIdentity {
  readonly profileId: string;
  readonly project: string;
  readonly targetKey: string;
  readonly relativePath: string;
  readonly tabKey: string;
  readonly localModelUri: string;
  readonly incarnation: number;
  readonly provenance: SemanticProvenance | null;
}

export interface SemanticWireBinding {
  readonly targetId: string;
  readonly relativePath: string;
  readonly wireUri: string;
  readonly connectionGeneration: number;
  readonly targetGeneration: number;
  readonly sessionGeneration: number;
  readonly languageDescriptor: SupportedLanguageDescriptor;
  wireVersion: number;
}

export interface RegisteredModel {
  readonly identity: StableModelIdentity;
  wireBinding: SemanticWireBinding | null;
}

/** Normalize HTTP/WS server URL for endpoint provenance comparison. */
export function normalizeSemanticServerUrl(rawUrl: string): string {
  if (typeof rawUrl !== "string") return "";
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  const httpUrl = trimmed
    .replace(/^wss:\/\//i, "https://")
    .replace(/^ws:\/\//i, "http://")
    .replace(/\/ws\/semantic\/v1(?:\?.*)?$/i, "")
    .replace(/\/+$/, "");
  if (typeof serverConfigModule.normalizeServerUrl === "function") {
    try {
      return serverConfigModule.normalizeServerUrl(httpUrl).replace(/\/+$/, "");
    } catch {
      return httpUrl;
    }
  }
  return httpUrl;
}

/** Capture only the current connected owner's endpoint, root, and credential identity. */
export function captureSemanticProvenance(target: {
  readonly profileId?: string | null;
  readonly project: string;
  readonly worktreePath?: string | null;
}): SemanticProvenance | null {
  if (!target.profileId || !target.project) return null;
  const snapshot = connectionsModule.getConnectionSnapshot(target.profileId);
  if (!snapshot || snapshot.status !== "connected" ||
      snapshot.owner.profileId !== target.profileId) return null;
  const profile = serverConfigModule.getProfiles().find((entry) => entry.id === target.profileId);
  if (!profile) return null;
  const serverUrl = normalizeSemanticServerUrl(snapshot.serverUrl);
  if (!serverUrl || normalizeSemanticServerUrl(profile.url) !== serverUrl) return null;
  let configuredRoot: string | null = null;
  const key = profileQueryKey(snapshot.owner, "projects");
  for (const queryClient of connectionsModule.getRegisteredQueryClients()) {
    if (queryClient.getQueryState(key)?.isInvalidated) continue;
    const data = queryClient.getQueryData<unknown>(key);
    if (!Array.isArray(data)) continue;
    const project = data.find((entry: unknown): entry is { name: string; path: string } =>
      typeof entry === "object" && entry !== null && "name" in entry &&
      entry.name === target.project && "path" in entry && typeof entry.path === "string");
    if (project?.path) {
      if (configuredRoot !== null && configuredRoot !== project.path) return null;
      configuredRoot = project.path;
    }
  }
  if (!configuredRoot) return null;
  const token = serverConfigModule.getAuthToken(target.profileId);
  if (profile.authType === "basic" && !token) return null;
  const actor = token ? `credential:${computeUtf8Sha256HexSync(token)}` :
    profile.authType === "none" ? "no-auth" : null;
  if (!actor) return null;
  return { serverUrl, configuredRoot, actor };
}

/**
 * Strict fail-closed provenance comparison across endpoint, configuredRoot, and actor.
 */
export function matchesSemanticProvenance(
  a: SemanticProvenance | null | undefined,
  b: SemanticProvenance | null | undefined,
): boolean {
  if (!a || !b) return false;
  const urlA = normalizeSemanticServerUrl(a.serverUrl);
  const urlB = normalizeSemanticServerUrl(b.serverUrl);
  if (!urlA || !urlB || urlA !== urlB) return false;
  if ((a.configuredRoot ?? "") !== (b.configuredRoot ?? "")) return false;
  if (!a.actor || !b.actor || a.actor !== b.actor) return false;
  return true;
}

const sharedTextEncoder = new TextEncoder();

/** SHA-256 of exact UTF-8 model content using the shared hashing dependency. */
export function computeUtf8Sha256HexSync(text: string): string {
  return bytesToHex(sha256(sharedTextEncoder.encode(text)));
}

/** Compute lowercase hex SHA-256 of UTF-8 text for G5 destination content verification. */
export async function computeUtf8Sha256Hex(text: string): Promise<string> {
  return computeUtf8Sha256HexSync(text);
}

/** Check if a relative path has a supported TypeScript/JavaScript extension. */
export function isSupportedSemanticPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx")
  );
}

/** Detect language descriptor from file path. */
export function detectLanguageDescriptor(
  path: string,
): SupportedLanguageDescriptor | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) {
    return "typescript";
  }
  if (lower.endsWith(".js") || lower.endsWith(".jsx")) {
    return "javascript";
  }
  return null;
}

/** Generate local in-memory URI matching MonacoHost conventions. */
export function buildLocalModelUri(tabKey: string): string {
  return `inmemory://dam-hopper/${encodeURIComponent(tabKey)}`;
}

/** Normalize relative path: forward slashes, no leading slash, no traversal. */
export function normalizeRelativePath(rawPath: string): string | null {
  if (!rawPath || rawPath.includes("\0")) return null;
  const replaced = rawPath.replace(/\\/g, "/");
  const stripped = replaced.startsWith("/") ? replaced.slice(1) : replaced;
  const segments = stripped.split("/");

  const normalized: string[] = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return null; // traversal rejected
    normalized.push(seg);
  }

  if (normalized.length === 0) return null;
  return normalized.join("/");
}

/** Format RFC 3986 dam-hopper://semantic/${targetId}/${relativePath} */
export function formatSemanticWireUri(
  targetId: string,
  relativePath: string,
): string {
  const norm = normalizeRelativePath(relativePath);
  if (!norm) {
    throw new Error(
      `Invalid relative path for semantic wire URI: ${relativePath}`,
    );
  }
  if (!targetId || targetId.includes("/") || targetId.includes("\\")) {
    throw new Error(`Invalid targetId for semantic wire URI: ${targetId}`);
  }

  const encodedSegments = norm
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  return `dam-hopper://semantic/${encodeURIComponent(targetId)}/${encodedSegments}`;
}

/**
 * Strict parse of virtual wire URI.
 * Rejects path traversal, encoded separators, query/fragments, and foreign schemes.
 */
export function parseSemanticWireUri(
  uriString: string,
  expectedTargetId?: string,
): { targetId: string; relativePath: string } | null {
  if (!uriString || typeof uriString !== "string") return null;

  try {
    const url = new URL(uriString);
    if (url.protocol !== "dam-hopper:") return null;
    if (url.hostname !== "semantic") return null;
    if (url.search || url.hash) return null;

    // Pathname starts with /<targetId>/<rest>
    const pathname = url.pathname;
    if (!pathname.startsWith("/")) return null;

    const segments = pathname.slice(1).split("/");
    if (segments.length < 2) return null;

    const rawTargetId = decodeURIComponent(segments[0]);
    if (expectedTargetId && rawTargetId !== expectedTargetId) {
      return null;
    }

    const pathSegments: string[] = [];
    for (let i = 1; i < segments.length; i++) {
      const rawSeg = segments[i];
      // Check for encoded separators %2f or %5c
      const lower = rawSeg.toLowerCase();
      if (lower.includes("%2f") || lower.includes("%5c")) {
        return null;
      }
      const decoded = decodeURIComponent(rawSeg);
      if (
        decoded === ".." ||
        decoded === "." ||
        decoded.includes("\0") ||
        decoded.includes("/")
      ) {
        return null;
      }
      pathSegments.push(decoded);
    }

    const relativePath = pathSegments.join("/");
    return { targetId: rawTargetId, relativePath };
  } catch {
    return null;
  }
}

/**
 * In-memory model registry maintaining separation between stable local identity
 * and replaceable session wire bindings.
 */
export class SemanticModelRegistry {
  private readonly models = new Map<string, RegisteredModel>();
  private readonly wireUriIndex = new Map<string, string>(); // wireUri -> tabKey
  private readonly localModelUriIndex = new Map<string, string>(); // localModelUri -> tabKey
  private incarnationCounters = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  /** Subscribe to model registration, wire bind/unbind, and unregister events. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Register a local model with immutable provenance.
   * If already registered with identical identity and provenance, returns existing idempotently.
   */
  registerModel(params: {
    tabKey: string;
    profileId: string;
    project: string;
    targetKey: string;
    relativePath: string;
    provenance?: SemanticProvenance | null;
  }): RegisteredModel {
    const normPath = normalizeRelativePath(params.relativePath);
    if (!normPath) {
      throw new Error(
        `Cannot register model with invalid relative path: ${params.relativePath}`,
      );
    }

    const nextProvenance: SemanticProvenance | null = params.provenance
      ? {
          serverUrl: normalizeSemanticServerUrl(params.provenance.serverUrl),
          configuredRoot: params.provenance.configuredRoot ?? "",
          actor: params.provenance.actor,
        }
      : null;

    const existing = this.models.get(params.tabKey);
    if (existing) {
      const sameIdentity =
        existing.identity.profileId === params.profileId &&
        existing.identity.project === params.project &&
        existing.identity.targetKey === params.targetKey &&
        existing.identity.relativePath === normPath;
      const sameProvenance =
        existing.identity.provenance === null && nextProvenance === null
          ? true
          : matchesSemanticProvenance(
              existing.identity.provenance,
              nextProvenance,
            );
      if (sameIdentity && sameProvenance) {
        return existing;
      }
      if (existing.wireBinding) {
        this.wireUriIndex.delete(existing.wireBinding.wireUri);
      }
    }

    const prevIncarnation = this.incarnationCounters.get(params.tabKey) ?? 0;
    const incarnation = prevIncarnation + 1;
    this.incarnationCounters.set(params.tabKey, incarnation);

    const localModelUri = buildLocalModelUri(params.tabKey);
    const identity: StableModelIdentity = {
      profileId: params.profileId,
      project: params.project,
      targetKey: params.targetKey,
      relativePath: normPath,
      tabKey: params.tabKey,
      localModelUri,
      incarnation,
      provenance: nextProvenance,
    };

    const registered: RegisteredModel = {
      identity,
      wireBinding: null,
    };

    this.models.set(params.tabKey, registered);
    this.localModelUriIndex.set(localModelUri, params.tabKey);
    this.notifyListeners();
    return registered;
  }

  /**
   * Bind a registered model to a live semantic session wire URI.
   */
  bindWire(
    tabKey: string,
    bindingParams: {
      targetId: string;
      connectionGeneration: number;
      targetGeneration: number;
      sessionGeneration: number;
      languageDescriptor: SupportedLanguageDescriptor;
      initialWireVersion?: number;
    },
  ): SemanticWireBinding | null {
    const model = this.models.get(tabKey);
    if (!model) return null;

    if (model.wireBinding) {
      this.wireUriIndex.delete(model.wireBinding.wireUri);
    }

    const wireUri = formatSemanticWireUri(
      bindingParams.targetId,
      model.identity.relativePath,
    );

    const wireBinding: SemanticWireBinding = {
      targetId: bindingParams.targetId,
      relativePath: model.identity.relativePath,
      wireUri,
      connectionGeneration: bindingParams.connectionGeneration,
      targetGeneration: bindingParams.targetGeneration,
      sessionGeneration: bindingParams.sessionGeneration,
      languageDescriptor: bindingParams.languageDescriptor,
      wireVersion: bindingParams.initialWireVersion ?? 1,
    };

    model.wireBinding = wireBinding;
    this.wireUriIndex.set(wireUri, tabKey);
    this.notifyListeners();
    return wireBinding;
  }

  /** Unbind wire session without unregistering local model (e.g. disconnect). */
  unbindWire(tabKey: string): void {
    const model = this.models.get(tabKey);
    if (!model || !model.wireBinding) return;
    this.wireUriIndex.delete(model.wireBinding.wireUri);
    model.wireBinding = null;
    this.notifyListeners();
  }

  /** Clear all wire bindings (e.g. server disconnect or target switch). */
  clearWireBindings(targetId: string, sessionGeneration?: number): void {
    if (!targetId) return;
    let changed = false;
    for (const model of this.models.values()) {
      if (
        model.wireBinding &&
        model.wireBinding.targetId === targetId &&
        (sessionGeneration === undefined ||
          model.wireBinding.sessionGeneration === sessionGeneration)
      ) {
        this.wireUriIndex.delete(model.wireBinding.wireUri);
        model.wireBinding = null;
        changed = true;
      }
    }
    if (changed) {
      this.notifyListeners();
    }
  }

  /** Unregister model completely on actual document close. */
  unregisterModel(tabKey: string): void {
    const model = this.models.get(tabKey);
    if (model) {
      if (model.wireBinding) {
        this.wireUriIndex.delete(model.wireBinding.wireUri);
      }
      this.localModelUriIndex.delete(model.identity.localModelUri);
      this.models.delete(tabKey);
      this.notifyListeners();
    }
  }

  /** Bump monotonic wire document version on change event. */
  bumpWireVersion(tabKey: string): number {
    const model = this.models.get(tabKey);
    if (!model?.wireBinding) return 0;
    model.wireBinding.wireVersion += 1;
    return model.wireBinding.wireVersion;
  }

  getByTabKey(tabKey: string): RegisteredModel | undefined {
    return this.models.get(tabKey);
  }

  getByWireUri(wireUri: string): RegisteredModel | undefined {
    const tabKey = this.wireUriIndex.get(wireUri);
    if (!tabKey) return undefined;
    return this.models.get(tabKey);
  }

  getByLocalModelUri(localModelUri: string): RegisteredModel | undefined {
    let tabKey = this.localModelUriIndex.get(localModelUri);
    if (!tabKey) {
      const prefix = "inmemory://dam-hopper/";
      if (localModelUri.startsWith(prefix)) {
        try {
          tabKey = decodeURIComponent(localModelUri.slice(prefix.length));
        } catch {
          // ignore malformed uri
        }
      }
    }
    if (!tabKey) return undefined;
    return this.models.get(tabKey);
  }

  getAllActiveForTarget(targetId: string): RegisteredModel[] {
    const results: RegisteredModel[] = [];
    for (const model of this.models.values()) {
      if (model.wireBinding && model.wireBinding.targetId === targetId) {
        results.push(model);
      }
    }
    return results;
  }

  getAllRegistered(): RegisteredModel[] {
    return Array.from(this.models.values());
  }

  clearAll(): void {
    const hadEntries =
      this.models.size > 0 ||
      this.wireUriIndex.size > 0 ||
      this.localModelUriIndex.size > 0;
    this.models.clear();
    this.wireUriIndex.clear();
    this.localModelUriIndex.clear();
    this.incarnationCounters.clear();
    if (hadEntries) {
      this.notifyListeners();
    }
  }
}

/** Global shared instance for application UI lifecycle. */
export const defaultSemanticModelRegistry = new SemanticModelRegistry();

export interface MonacoPositionLike {
  lineNumber: number;
  column: number;
}

export interface MonacoRangeLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export function monacoPositionToLsp(pos: MonacoPositionLike): {
  line: number;
  character: number;
} {
  return {
    line: Math.max(0, pos.lineNumber - 1),
    character: Math.max(0, pos.column - 1),
  };
}

export function lspRangeToMonaco(range: {
  start: { line: number; character: number };
  end: { line: number; character: number };
}): MonacoRangeLike {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}
if (typeof window !== "undefined") {
  (window as unknown as { __dam_hopper_registry?: unknown }).__dam_hopper_registry = defaultSemanticModelRegistry;
}
