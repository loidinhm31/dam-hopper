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

export type SupportedLanguageDescriptor = "typescript" | "javascript";

export interface StableModelIdentity {
  readonly profileId: string;
  readonly project: string;
  readonly targetKey: string;
  readonly relativePath: string;
  readonly tabKey: string;
  readonly localModelUri: string;
  readonly incarnation: number;
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

  /**
   * Register a local model. If already registered, increments incarnation
   * and preserves or clears wire binding as instructed.
   */
  registerModel(params: {
    tabKey: string;
    profileId: string;
    project: string;
    targetKey: string;
    relativePath: string;
  }): RegisteredModel {
    const normPath = normalizeRelativePath(params.relativePath);
    if (!normPath) {
      throw new Error(
        `Cannot register model with invalid relative path: ${params.relativePath}`,
      );
    }

    const existing = this.models.get(params.tabKey);
    if (existing) {
      return existing;
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
    };

    const registered: RegisteredModel = {
      identity,
      wireBinding: null,
    };

    this.models.set(params.tabKey, registered);
    this.localModelUriIndex.set(localModelUri, params.tabKey);
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
    return wireBinding;
  }

  /** Unbind wire session without unregistering local model (e.g. disconnect). */
  unbindWire(tabKey: string): void {
    const model = this.models.get(tabKey);
    if (!model || !model.wireBinding) return;
    this.wireUriIndex.delete(model.wireBinding.wireUri);
    model.wireBinding = null;
  }

  /** Clear all wire bindings (e.g. server disconnect or target switch). */
  clearWireBindings(targetId: string): void {
    if (!targetId) return;
    for (const model of this.models.values()) {
      if (model.wireBinding && model.wireBinding.targetId === targetId) {
        this.wireUriIndex.delete(model.wireBinding.wireUri);
        model.wireBinding = null;
      }
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
    this.models.clear();
    this.wireUriIndex.clear();
    this.localModelUriIndex.clear();
    this.incarnationCounters.clear();
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
