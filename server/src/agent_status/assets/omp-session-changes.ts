/**
 * DamHopper Session Changes tool-event producer for Oh My Pi (OMP).
 *
 * Standalone TypeScript extension running inside OMP (Bun runtime).
 * Hooks tool_call and tool_result to capture pre-edit file baselines
 * lazily per-file with a strict 1.5s deadline and fail-open guarantees.
 */

// ============================================================================
// Constants and Wire Protocol Types (v1)
// ============================================================================

export const SESSION_CHANGES_PROTOCOL_VERSION = 1;
export const PRODUCER_VERSION = "1.0.0";
export const CAPTURE_TIMEOUT_MS = 1500;
export const MAX_RETAINED_ROOTS = 32;
export const MAX_PATHS_PER_ROOT = 500;
export const MAX_CHILD_ENTRIES = 128;
export const MAX_PENDING_CALLS = 128;
export const MAX_PENDING_INVALIDATIONS = 64;
export const MAX_CAPTURE_BODY_BYTES = 12 * 1024; // 12 KiB bound (server enforces 16 KiB)
export const MAX_RESPONSE_BYTES = 64 * 1024;

const textEncoder = new TextEncoder();

export interface LoggerFacade {
  debug?: (msg: string, ...args: unknown[]) => void;
  warn?: (msg: string, ...args: unknown[]) => void;
  error?: (msg: string, ...args: unknown[]) => void;
}

export interface ExtensionAgentIdentity {
  kind?: "main" | "sub" | string;
  id?: string;
  name?: string;
  depth?: number;
  parentId?: string;
}

export interface OmpExtensionContext {
  hasUI?: boolean;
  agent?: ExtensionAgentIdentity;
  sessionManager?: {
    getSessionId?: () => string;
    getEntries?: () => unknown[];
    getSessionFile?: () => string | null;
  };
  isIdle?: () => boolean;
  cwd?: string;
}

export interface OmpExtensionAPI {
  logger?: LoggerFacade;
  on(
    event: string,
    handler: (event: unknown, ctx: unknown) => void | Promise<unknown>,
  ): void;
}

export interface ToolCallEventPayload {
  type?: string;
  toolName?: string;
  toolCallId?: string;
  input?: Record<string, unknown>;
}

export interface ToolResultEventPayload {
  type?: string;
  toolName?: string;
  toolCallId?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  details?: unknown;
  isError?: boolean;
}

export interface AssistantMessageSnapshot {
  role?: string;
  stopReason?: string;
}

export interface AgentEndEventPayload {
  willContinue?: boolean;
  messages?: AssistantMessageSnapshot[];
  turnId?: string;
}

export interface RegisterRequest {
  version: number;
  ompSessionId: string;
  rootId: string;
  cwdHint: string | null;
}

export interface RegisterResponse {
  serverEpoch: string;
  terminalIncarnation: string;
  ompSessionId: string;
  rootId: string;
  baselineId: string;
}

export type CaptureMode = "preEdit" | "unproven";

export interface CaptureRequest {
  version: number;
  serverEpoch: string;
  terminalIncarnation: string;
  ompSessionId: string;
  rootId: string;
  baselineId: string;
  captureId: string;
  paths: string[];
  mode: CaptureMode;
}

export interface PathCaptureDisposition {
  path: string;
  fileId?: string;
  status: "captured" | "alreadyKnown" | "unknown" | "unproven";
  presence?: "present" | "absentAtFirstTouch" | "unknown";
  reason?: string;
}

export interface CaptureResponse {
  version?: number;
  captureId?: string;
  results?: PathCaptureDisposition[];
}

export interface SettledRequest {
  version: number;
  serverEpoch: string;
  terminalIncarnation: string;
  ompSessionId: string;
  rootId: string;
  baselineId: string;
  turnId: string;
  outcome: "completed" | "interrupted" | "error" | "unknown";
}

// ============================================================================
// Loopback URL & Session ID Validation
// ============================================================================

export function validateLoopbackWsUrl(rawUrl: string | undefined): URL | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.search || parsed.hash) return null;

    const hostname = parsed.hostname.toLowerCase();
    const isLoopback =
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "[::1]" ||
      hostname === "::1";
    if (!isLoopback) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function derivePrivateHttpUrl(wsUrl: string): string {
  const parsed = new URL(wsUrl);
  parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  parsed.pathname = "/private/session-changes/v1";
  return parsed.toString();
}

export function sanitizeSessionId(rawId: unknown): string {
  if (typeof rawId !== "string" || !rawId.trim()) return "session-unknown";
  let candidate = rawId.trim();
  if (candidate.includes("/") || candidate.includes("\\")) {
    const parts = candidate.split(/[/\\]+/).filter(Boolean);
    candidate = parts[parts.length - 1] || "session-unknown";
  }
  const clean = candidate.replace(/[^\x21-\x7E]/g, "_").slice(0, 128);
  return clean || "session-unknown";
}

export function mapSettledOutcome(
  outcome?: string,
  isError?: boolean,
): "completed" | "interrupted" | "error" | "unknown" {
  if (isError || outcome === "error") return "error";
  if (outcome === "interrupted" || outcome === "aborted") return "interrupted";
  if (outcome === "ended" || outcome === "completed" || outcome === "stop") return "completed";
  return "unknown";
}

// ============================================================================
// Path Normalization & Rebasing into Registered Root
// ============================================================================

/**
 * Normalizes and rebases a target file path relative to the registered root directory.
 * - Rejects non-filesystem or internal URLs (memory://, ssh://, http://, proc://, etc.).
 * - Rejects archive/database selectors (.zip:member, .sqlite:table, etc.).
 * - Supports Windows drive letters (C:/...) by normalizing into unified path.
 * - If target is absolute:
 *   Must reside strictly inside rootCwd. If outside rootCwd, returns null.
 * - If target is relative:
 *   Resolved against emitting agent's childCwd, then made relative to rootCwd.
 * - If result escapes root via .., returns null.
 * - Rejects directory targets (ending in /).
 */
export function rebasePathToRoot(
  rawPath: string | undefined,
  childCwd?: string,
  rootCwd?: string,
): string | null {
  if (!rawPath || typeof rawPath !== "string") return null;
  if (!rawPath) return null;

  // Reject internal or remote URLs
  if (rawPath.includes("://")) return null;

  // Reject archive/database selector syntax
  if (
    /\.(zip|tar|gz|tgz|db|sqlite|sqlite3|asar|rar|7z|iso|cab|deb|rpm|cpio|ar|lzh|arj|jar|xz):/i.test(
      rawPath,
    ) ||
    /\.(db|sqlite|sqlite3)\?/i.test(rawPath)
  ) {
    return null;
  }

  // Normalize backslashes to slashes
  let p = rawPath.replace(/\\/g, "/");

  // Normalize Windows drive letters, e.g. C:/path -> /c/path
  p = p.replace(/^([a-zA-Z]):/, (_, drive) => `/${drive.toLowerCase()}`);

  let normChildCwd = childCwd ? childCwd.replace(/\\/g, "/").replace(/\/+$/, "") : "";
  normChildCwd = normChildCwd.replace(/^([a-zA-Z]):/, (_, drive) => `/${drive.toLowerCase()}`);

  let normRootCwd = rootCwd ? rootCwd.replace(/\\/g, "/").replace(/\/+$/, "") : normChildCwd;
  normRootCwd = normRootCwd.replace(/^([a-zA-Z]):/, (_, drive) => `/${drive.toLowerCase()}`);

  // Determine effective absolute path
  let absPath: string;
  if (p.startsWith("/")) {
    absPath = p;
  } else if (normChildCwd) {
    absPath = `${normChildCwd}/${p}`;
  } else if (normRootCwd) {
    absPath = `${normRootCwd}/${p}`;
  } else {
    absPath = `/${p}`;
  }

  // Canonicalize absPath segments
  const segments = absPath.split("/").filter(Boolean);
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === ".") continue;
    if (seg === "..") {
      if (resolved.length === 0) return null;
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }

  const canonicalAbs = "/" + resolved.join("/");

  // Rebase against rootCwd if known
  if (normRootCwd) {
    const canonicalRoot = "/" + normRootCwd.split("/").filter(Boolean).join("/");
    if (canonicalAbs === canonicalRoot) {
      return null; // The directory itself, not a file target
    }
    if (!canonicalAbs.startsWith(canonicalRoot + "/")) {
      return null; // Strictly outside registered root directory!
    }
    const rel = canonicalAbs.slice(canonicalRoot.length + 1);
    if (!rel || rawPath.endsWith("/") || rawPath.endsWith("\\")) return null;
    return rel;
  }

  // Fallback if no rootCwd specified (pure relative path)
  const rel = resolved.join("/");
  if (!rel || rawPath.endsWith("/") || rawPath.endsWith("\\")) return null;
  return rel;
}

/**
 * Backward-compatible alias for single-cwd normalization.
 */
export function normalizeRelativePath(
  rawPath: string | undefined,
  cwd?: string,
): string | null {
  return rebasePathToRoot(rawPath, cwd, cwd);
}

/**
 * Parses Hashline edit patches to identify target file paths.
 * Extracts [path#TAG] headers (excluding lines starting with '+'),
 * MV destination paths (including quoted syntax), and REM targets.
 */
export function parseHashlineEdits(
  patchInput: string | undefined,
  childCwd?: string,
  rootCwd?: string,
): string[] {
  if (!patchInput || typeof patchInput !== "string") return [];
  const paths = new Set<string>();

  const lines = patchInput.split(/\r?\n/);
  let currentHeaderPath: string | null = null;

  for (const line of lines) {
    // Body lines in Hashline patches start with '+' or '-' (replacement body)
    if (line.startsWith("+") || line.startsWith("-")) {
      continue;
    }

    const trimmed = line.trim();
    // Block header: [path#TAG] where TAG is 4 hex digits
    const headerMatch = trimmed.match(/^\[([^#\]\r\n]+)#[0-9A-Fa-f]{4}\]$/);
    if (headerMatch) {
      const rawHeader = headerMatch[1];
      const norm = rebasePathToRoot(rawHeader, childCwd, rootCwd);
      if (norm) {
        paths.add(norm);
        currentHeaderPath = norm;
      } else {
        currentHeaderPath = null;
      }
      continue;
    }

    // Inside a block, check for rename operation: MV dest
    if (currentHeaderPath) {
      const mvMatch = line.match(
        /^\s*MV\s+(?:"([^"]+)"|'([^']+)'|([^\s\r\n]+))/,
      );
      if (mvMatch) {
        const dest = mvMatch[1] ?? mvMatch[2] ?? mvMatch[3];
        if (dest) {
          const normDest = rebasePathToRoot(dest, childCwd, rootCwd);
          if (normDest) {
            paths.add(normDest);
          }
        }
      }
    }
  }

  return Array.from(paths);
}

/**
 * Checks if a string contains glob wildcards.
 */
export function isGlobPattern(pathStr: string): boolean {
  return /[*?[\]{}]/.test(pathStr);
}

/**
 * Parses ast_edit tool input for literal concrete file candidates.
 * Globs, directories, and internal URLs are rejected for pre-edit capture.
 */
export function parseAstEditTargets(
  input: Record<string, unknown> | undefined,
  childCwd?: string,
  rootCwd?: string,
): string[] {
  if (!input) return [];
  const candidates: string[] = [];

  if (Array.isArray(input.paths)) {
    for (const item of input.paths) {
      if (typeof item === "string") candidates.push(item);
    }
  } else if (typeof input.path === "string") {
    candidates.push(input.path);
  }

  const concretePaths = new Set<string>();
  for (const candidate of candidates) {
    if (isGlobPattern(candidate)) continue;
    if (candidate.endsWith("/") || candidate.endsWith("\\")) continue;
    const norm = rebasePathToRoot(candidate, childCwd, rootCwd);
    if (norm) {
      concretePaths.add(norm);
    }
  }

  return Array.from(concretePaths);
}

/**
 * Splits paths into chunks bounded by maxBytes (default 12 KiB UTF-8)
 * so that no single capture request exceeds the server 16 KiB limit.
 */
export function chunkCapturePaths(
  basePayload: Omit<CaptureRequest, "paths">,
  paths: string[],
  maxBytes: number = MAX_CAPTURE_BODY_BYTES,
): string[][] {
  if (paths.length === 0) return [];
  const chunks: string[][] = [];
  let currentChunk: string[] = [];

  for (const p of paths) {
    const testChunk = [...currentChunk, p];
    const testBytes = textEncoder.encode(
      JSON.stringify({ ...basePayload, paths: testChunk }),
    ).length;

    if (testBytes > maxBytes && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [p];
    } else {
      currentChunk.push(p);
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  return chunks;
}

// ============================================================================
// Lineage & Session Registry
// ============================================================================

export interface TimedOutAttempt {
  captureId: string;
  paths: string[];
  timestamp: number;
}

export interface RootSessionRegistration {
  serverEpoch: string;
  terminalIncarnation: string;
  ompSessionId: string;
  rootId: string;
  baselineId: string;
  disabled: boolean;
  rootCwd?: string;
  knownPaths: Set<string>;
  unprovenPaths: Set<string>;
  reservedPaths: Set<string>;
  pendingInvalidations: TimedOutAttempt[];
}

export function createRootSessionRegistration(
  ompSessionId: string,
  serverEpoch: string = "epoch-1",
  terminalIncarnation: string = "1",
  baselineId: string = "base-1",
  rootCwd?: string,
): RootSessionRegistration {
  return {
    serverEpoch,
    terminalIncarnation,
    ompSessionId,
    rootId: ".",
    baselineId,
    disabled: false,
    rootCwd,
    knownPaths: new Set(),
    unprovenPaths: new Set(),
    reservedPaths: new Set(),
    pendingInvalidations: [],
  };
}

export interface PendingToolCall {
  toolCallId: string;
  agentId: string;
  ompSessionId: string;
  serverEpoch: string;
  terminalIncarnation: string;
  baselineId: string;
  rootCwd?: string;
  childCwd?: string;
  candidatePaths: string[];
  timestamp: number;
}

export class SessionChangesProducerRegistry {
  public readonly roots = new Map<string, RootSessionRegistration>();
  public readonly agentToRoot = new Map<string, string>();
  public readonly agentLineage = new Map<string, string>();

  // Shared process-level generation and active session tracking
  public activeSessionId: string | null = null;
  public globalGeneration = 0;
  public isPermanentlyDisabled = false;
  public readonly pendingCalls = new Map<string, PendingToolCall>();

  public registerRoot(
    agentId: string,
    root: RootSessionRegistration,
  ): void {
    if (this.roots.size >= MAX_RETAINED_ROOTS && !this.roots.has(root.ompSessionId)) {
      const oldestKey = this.roots.keys().next().value;
      if (oldestKey) this.removeRoot(oldestKey);
    }
    this.roots.set(root.ompSessionId, root);
    if (!this.activeSessionId) {
      this.activeSessionId = root.ompSessionId;
    }
    if (agentId) {
      this.setAgentRoot(agentId, root.ompSessionId);
    }
  }

  public recordChildAgent(agentId: string, parentId: string): void {
    if (!agentId || !parentId) return;
    if (this.agentLineage.size >= MAX_CHILD_ENTRIES && !this.agentLineage.has(agentId)) {
      const oldest = this.agentLineage.keys().next().value;
      if (oldest) this.agentLineage.delete(oldest);
    }
    this.agentLineage.set(agentId, parentId);
    const rootSessionId = this.resolveRootSessionId(parentId);
    if (rootSessionId) {
      this.setAgentRoot(agentId, rootSessionId);
    }
  }

  private setAgentRoot(agentId: string, rootSessionId: string): void {
    if (this.agentToRoot.size >= MAX_CHILD_ENTRIES && !this.agentToRoot.has(agentId)) {
      const oldest = this.agentToRoot.keys().next().value;
      if (oldest) this.agentToRoot.delete(oldest);
    }
    this.agentToRoot.set(agentId, rootSessionId);
  }

  public resolveRootSessionId(agentId: string): string | undefined {
    let curr: string | undefined = agentId;
    let depth = 0;
    while (curr && depth < 20) {
      const rootId = this.agentToRoot.get(curr);
      if (rootId) return rootId;
      curr = this.agentLineage.get(curr);
      depth++;
    }
    return undefined;
  }

  public resolveRoot(
    agent?: ExtensionAgentIdentity,
  ): RootSessionRegistration | undefined {
    if (!agent) {
      if (this.activeSessionId) return this.roots.get(this.activeSessionId);
      if (this.roots.size === 1) return this.roots.values().next().value;
      return undefined;
    }

    const agentId = agent.id || (agent.kind === "main" ? "main" : undefined);
    if (agentId) {
      const rootSessionId = this.resolveRootSessionId(agentId);
      if (rootSessionId) {
        return this.roots.get(rootSessionId);
      }
    }

    // If subagent parentId is available directly, resolve parent
    if (agent.parentId) {
      const rootSessionId = this.resolveRootSessionId(agent.parentId);
      if (rootSessionId) {
        if (agentId) {
          this.setAgentRoot(agentId, rootSessionId);
        }
        return this.roots.get(rootSessionId);
      }
    }

    // Fall back to active session if agent has no explicit lineage but activeSession exists
    if (this.activeSessionId) {
      return this.roots.get(this.activeSessionId);
    }

    // Sole root fallback
    if (agent.kind === "main" && this.roots.size === 1) {
      return this.roots.values().next().value;
    }

    return undefined;
  }

  public removeRoot(ompSessionId: string): void {
    this.roots.delete(ompSessionId);
    for (const [agentId, rootId] of this.agentToRoot.entries()) {
      if (rootId === ompSessionId) {
        this.agentToRoot.delete(agentId);
        this.agentLineage.delete(agentId);
      }
    }
  }

  public clear(): void {
    this.roots.clear();
    this.agentToRoot.clear();
    this.agentLineage.clear();
    this.pendingCalls.clear();
    this.activeSessionId = null;
    this.globalGeneration = 0;
    this.isPermanentlyDisabled = false;
  }
}

// Module-scoped in-process registry shared across rebound extension factories
export const moduleRegistry = new SessionChangesProducerRegistry();

// ============================================================================
// Producer Engine
// ============================================================================

export interface ProducerOptions {
  httpUrl: string;
  token: string;
  captureTimeoutMs?: number;
  logger?: LoggerFacade;
  fetchImpl?: typeof fetch;
  registry?: SessionChangesProducerRegistry;
}

export class SessionChangesProducer {
  public readonly httpUrl: string;
  public readonly token: string;
  public readonly captureTimeoutMs: number;
  public readonly logger?: LoggerFacade;
  public readonly fetchImpl: typeof fetch;
  public readonly registry: SessionChangesProducerRegistry;

  constructor(options: ProducerOptions) {
    this.httpUrl = options.httpUrl;
    this.token = options.token;
    this.captureTimeoutMs = options.captureTimeoutMs ?? CAPTURE_TIMEOUT_MS;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.registry = options.registry || moduleRegistry;
  }

  public get globalGeneration(): number {
    return this.registry.globalGeneration;
  }
  public set globalGeneration(val: number) {
    this.registry.globalGeneration = val;
  }

  public get activeSessionId(): string | null {
    return this.registry.activeSessionId;
  }
  public set activeSessionId(val: string | null) {
    this.registry.activeSessionId = val;
  }

  public get isPermanentlyDisabled(): boolean {
    return this.registry.isPermanentlyDisabled;
  }
  public set isPermanentlyDisabled(val: boolean) {
    this.registry.isPermanentlyDisabled = val;
  }

  public get pendingCalls(): Map<string, PendingToolCall> {
    return this.registry.pendingCalls;
  }

  public async postJson<T>(
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
    const url = `${this.httpUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: "error", // W6: Refuse redirects to ensure requests stay strictly on private loopback
      });

      if (res.status === 503) {
        this.isPermanentlyDisabled = true;
        return { ok: false, status: 503, error: "trackingDisabled" };
      }

      if (!res.ok) {
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      }

      let data: T;
      try {
        const text = await res.text();
        if (text.length > MAX_RESPONSE_BYTES) {
          return { ok: false, status: res.status, error: "responseTooLarge" };
        }
        data = JSON.parse(text) as T;
      } catch (parseErr) {
        return { ok: false, status: res.status, error: "invalidJson" };
      }

      return { ok: true, status: res.status, data };
    } catch (err: unknown) {
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" || err.message.includes("abort"));
      return {
        ok: false,
        status: isAbort ? 408 : 0,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async registerSession(
    ompSessionId: string,
    agentId: string,
    cwd?: string,
  ): Promise<RootSessionRegistration | null> {
    if (this.isPermanentlyDisabled) return null;

    const currentGen = ++this.globalGeneration;
    this.activeSessionId = ompSessionId;

    const req: RegisterRequest = {
      version: SESSION_CHANGES_PROTOCOL_VERSION,
      ompSessionId,
      rootId: ".",
      cwdHint: cwd || null,
    };

    const res = await this.postJson<RegisterResponse>("/register", req, this.captureTimeoutMs);

    // W1: Monotonic generation check — discard response if session switched or restarted
    if (this.globalGeneration !== currentGen || this.activeSessionId !== ompSessionId) {
      return null;
    }

    if (!res.ok || !res.data) {
      if (res.status === 503) {
        const disabledRoot: RootSessionRegistration = {
          serverEpoch: "",
          terminalIncarnation: "",
          ompSessionId,
          rootId: ".",
          baselineId: "",
          disabled: true,
          rootCwd: cwd,
          knownPaths: new Set(),
          unprovenPaths: new Set(),
          reservedPaths: new Set(),
          pendingInvalidations: [],
        };
        this.registry.registerRoot(agentId, disabledRoot);
        return disabledRoot;
      }
      return null;
    }

    const reg = res.data;
    // W4: Validate register response structure
    if (
      typeof reg.serverEpoch !== "string" ||
      !reg.serverEpoch ||
      typeof reg.terminalIncarnation !== "string" ||
      !reg.terminalIncarnation ||
      reg.ompSessionId !== ompSessionId ||
      typeof reg.baselineId !== "string" ||
      !reg.baselineId
    ) {
      return null;
    }

    const root: RootSessionRegistration = {
      serverEpoch: reg.serverEpoch,
      terminalIncarnation: reg.terminalIncarnation,
      ompSessionId: reg.ompSessionId,
      rootId: reg.rootId || ".",
      baselineId: reg.baselineId,
      disabled: false,
      rootCwd: cwd,
      knownPaths: new Set(),
      unprovenPaths: new Set(),
      reservedPaths: new Set(),
      pendingInvalidations: [],
    };

    this.registry.registerRoot(agentId, root);
    return root;
  }

  /**
   * Pre-edit capture hook before supported tool execution.
   * Bound by strict 1500 ms deadline; guaranteed fail-open on any error/timeout.
   */
  public async handleToolCall(
    toolName: string | undefined,
    input: Record<string, unknown> | undefined,
    ctx: OmpExtensionContext | undefined,
    toolCallId?: string,
  ): Promise<void> {
    try {
      if (this.isPermanentlyDisabled) return;
      if (!toolName) return;

      const captureStartTime = performance.now();

      const normalizedTool = toolName.toLowerCase().replace(/_/g, "-");
      const isSupported =
        normalizedTool === "write" ||
        normalizedTool === "edit" ||
        normalizedTool === "ast-edit" ||
        normalizedTool === "ast_edit";

      if (!isSupported) return;

      const agentId = ctx?.agent?.id || (ctx?.agent?.kind === "main" ? "main" : "sub");

      // Track subagent lineage if present
      if (ctx?.agent?.id && ctx?.agent?.parentId) {
        this.registry.recordChildAgent(ctx.agent.id, ctx.agent.parentId);
      }

      const root = this.registry.resolveRoot(ctx?.agent);
      if (!root || root.disabled) return;

      const rootCwd = root.rootCwd;
      const childCwd = ctx?.cwd || rootCwd;

      // Extract candidate paths based on tool, properly rebased to root
      let candidatePaths: string[] = [];

      if (normalizedTool === "write") {
        const rawPath = input?.path as string | undefined;
        const norm = rebasePathToRoot(rawPath, childCwd, rootCwd);
        if (norm) candidatePaths.push(norm);
      } else if (normalizedTool === "edit") {
        const patchInput = (input?.input ?? input?.patch) as string | undefined;
        candidatePaths = parseHashlineEdits(patchInput, childCwd, rootCwd);
      } else if (normalizedTool === "ast-edit" || normalizedTool === "ast_edit") {
        candidatePaths = parseAstEditTargets(input, childCwd, rootCwd);
      }

      // Always store pending call descriptor so tool_result knows the originating agent and root tuple!
      const callId = toolCallId || crypto.randomUUID();
      if (this.pendingCalls.size >= MAX_PENDING_CALLS) {
        const oldest = this.pendingCalls.keys().next().value;
        if (oldest) this.pendingCalls.delete(oldest);
      }
      this.pendingCalls.set(callId, {
        toolCallId: callId,
        agentId,
        ompSessionId: root.ompSessionId,
        serverEpoch: root.serverEpoch,
        terminalIncarnation: root.terminalIncarnation,
        baselineId: root.baselineId,
        rootCwd,
        childCwd,
        candidatePaths,
        timestamp: Date.now(),
      });

      if (candidatePaths.length === 0) return;

      if (!root.knownPaths) root.knownPaths = new Set();
      if (!root.unprovenPaths) root.unprovenPaths = new Set();
      if (!root.reservedPaths) root.reservedPaths = new Set();
      if (!root.pendingInvalidations) root.pendingInvalidations = [];
      // W3: Synchronous pre-allocation reservation check to prevent async race beyond 500 paths
      const currentTracked =
        root.knownPaths.size + root.unprovenPaths.size + root.reservedPaths.size;
      const availableSlots = Math.max(0, MAX_PATHS_PER_ROOT - currentTracked);
      if (availableSlots === 0) {
        return; // Session capacity full; fail-open immediately
      }

      // Filter out paths that are already known, unproven, or reserved
      const pathsToCapture: string[] = [];
      for (const p of candidatePaths) {
        if (
          !root.knownPaths.has(p) &&
          !root.unprovenPaths.has(p) &&
          !root.reservedPaths.has(p)
        ) {
          if (pathsToCapture.length < availableSlots) {
            pathsToCapture.push(p);
          }
        }
      }

      if (pathsToCapture.length === 0) return;

      // Synchronously reserve candidate slots
      for (const p of pathsToCapture) {
        root.reservedPaths.add(p);
      }

      const callGen = this.globalGeneration;
      const basePayload = {
        version: SESSION_CHANGES_PROTOCOL_VERSION,
        serverEpoch: root.serverEpoch,
        terminalIncarnation: root.terminalIncarnation,
        ompSessionId: root.ompSessionId,
        rootId: root.rootId,
        baselineId: root.baselineId,
        captureId: crypto.randomUUID(),
        mode: "preEdit" as CaptureMode,
      };

      // W3: Chunk capture paths to strictly stay below 16 KiB server limit (UTF-8 measured)
      const pathChunks = chunkCapturePaths(basePayload, pathsToCapture, MAX_CAPTURE_BODY_BYTES);

      try {
        for (let i = 0; i < pathChunks.length; i++) {
          const chunk = pathChunks[i];
          const elapsedMs = performance.now() - captureStartTime;
          const remainingTimeoutMs = this.captureTimeoutMs - elapsedMs;

          // W5: Strict deadline enforcement — if deadline exhausted, mark current and all subsequent chunks unproven
          if (remainingTimeoutMs <= 0) {
            for (let j = i; j < pathChunks.length; j++) {
              for (const p of pathChunks[j]) {
                root.reservedPaths.delete(p);
                root.unprovenPaths.add(p);
              }
              const timedOutId = crypto.randomUUID();
              this.recordTimedOutAttempt(root, timedOutId, pathChunks[j]);
            }
            break;
          }

          const captureId = crypto.randomUUID();
          const captureReq: CaptureRequest = {
            ...basePayload,
            captureId,
            paths: chunk,
          };

          const res = await this.postJson<CaptureResponse>(
            "/capture",
            captureReq,
            Math.max(10, Math.floor(remainingTimeoutMs)),
          );

          // Post-await generation check: if session switched or restarted while in flight, discard!
          if (
            this.globalGeneration !== callGen ||
            (this.activeSessionId !== null && this.activeSessionId !== root.ompSessionId)
          ) {
            for (const p of chunk) root.reservedPaths.delete(p);
            return;
          }

          if (res.status === 503) {
            root.disabled = true;
            this.isPermanentlyDisabled = true;
            for (const p of chunk) root.reservedPaths.delete(p);
            return;
          }

          // W4: Validate response correlation strictly: version, captureId, and requested paths
          const validResponse =
            res.ok &&
            res.data &&
            typeof res.data === "object" &&
            res.data.version === SESSION_CHANGES_PROTOCOL_VERSION &&
            res.data.captureId === captureReq.captureId &&
            Array.isArray(res.data.results);

          if (validResponse) {
            const acknowledged = new Set<string>();
            const allowedPaths = new Set(chunk);

            for (const item of res.data!.results!) {
              if (!item || typeof item !== "object" || typeof item.path !== "string") continue;
              if (!allowedPaths.has(item.path)) continue; // ignore unsolicited paths

              acknowledged.add(item.path);
              root.reservedPaths.delete(item.path);
              if (item.status === "captured" || item.status === "alreadyKnown") {
                root.knownPaths.add(item.path);
              } else {
                root.unprovenPaths.add(item.path);
              }
            }

            // Any requested path not acknowledged with captured/alreadyKnown becomes unproven
            for (const p of chunk) {
              if (!acknowledged.has(p)) {
                root.reservedPaths.delete(p);
                root.unprovenPaths.add(p);
              }
            }
          } else {
            // Timeout, network error, or invalid/mismatched captureId: fail-open!
            for (const p of chunk) {
              root.reservedPaths.delete(p);
              root.unprovenPaths.add(p);
            }

            // Retain original attempt ID in invalidations queue (W2)
            this.recordTimedOutAttempt(root, captureId, chunk);

            // Immediate fire-and-forget unproven invalidation notification with exact captureId
            void this.postJson(
              "/capture",
              {
                ...captureReq,
                mode: "unproven",
              },
              500,
            ).catch(() => {});
          }
        }
      } finally {
        // Guarantee clean reservation release on any thrown error or unhandled branch
        for (const p of pathsToCapture) {
          root.reservedPaths.delete(p);
        }
      }

      // Flush any pending invalidations using their preserved original capture IDs
      void this.flushPendingInvalidations(root).catch(() => {});
    } catch (err: unknown) {
      // W5: Guaranteed fail-open: never throw or block tool execution
      this.logger?.warn?.("SessionChanges tool_call fail-open error", err);
    }
  }

  private recordTimedOutAttempt(
    root: RootSessionRegistration,
    captureId: string,
    paths: string[],
  ): void {
    if (root.pendingInvalidations.length >= MAX_PENDING_INVALIDATIONS) {
      root.pendingInvalidations.shift();
    }
    root.pendingInvalidations.push({
      captureId,
      paths: [...paths],
      timestamp: Date.now(),
    });
  }

  /**
   * Post-execution hook to reconcile concrete touched paths
   * (AST edit globs/directories and Hashline edit rename results).
   */
  public async handleToolResult(
    toolName: string | undefined,
    details: unknown,
    ctx: OmpExtensionContext | undefined,
    toolCallId?: string,
  ): Promise<void> {
    try {
      if (this.isPermanentlyDisabled) return;
      if (!toolName) return;
      const normalizedTool = toolName.toLowerCase().replace(/_/g, "-");

      const resultStartTime = performance.now();
      const callGen = this.globalGeneration;

      // Look up exact root tuple from pending descriptor if available
      let root: RootSessionRegistration | undefined;
      let rootCwd: string | undefined;
      let childCwd = ctx?.cwd;

      if (toolCallId && this.pendingCalls.has(toolCallId)) {
        const pending = this.pendingCalls.get(toolCallId)!;
        this.pendingCalls.delete(toolCallId);
        root = this.registry.roots.get(pending.ompSessionId);
        if (
          root &&
          (root.serverEpoch !== pending.serverEpoch ||
            root.terminalIncarnation !== pending.terminalIncarnation)
        ) {
          // Stale call from prior epoch/incarnation
          return;
        }
        rootCwd = pending.rootCwd;
        childCwd = childCwd || pending.childCwd;
      } else {
        root = this.registry.resolveRoot(ctx?.agent);
        // Only accept if root matches current active session (no arbitrary adoption)
        if (root && this.activeSessionId !== null && root.ompSessionId !== this.activeSessionId) {
          return;
        }
        rootCwd = root?.rootCwd;
      }

      if (!root || root.disabled) return;

      const newlyDiscoveredPaths: string[] = [];

      if (normalizedTool === "ast-edit" || normalizedTool === "ast_edit") {
        const astDetails = details as { files?: string[]; cwd?: string } | undefined;
        if (Array.isArray(astDetails?.files)) {
          const effectiveChildCwd = astDetails?.cwd || childCwd;
          for (const f of astDetails.files) {
            const norm = rebasePathToRoot(f, effectiveChildCwd, rootCwd);
            if (norm && !root.knownPaths.has(norm) && !root.unprovenPaths.has(norm)) {
              if (
                root.knownPaths.size +
                  root.unprovenPaths.size +
                  newlyDiscoveredPaths.length <
                MAX_PATHS_PER_ROOT
              ) {
                newlyDiscoveredPaths.push(norm);
              }
            }
          }
        }
      } else if (normalizedTool === "edit") {
        // W8: Inspect path, sourcePath, and move (renames) from details and perFileResults
        const editDetails = details as {
          path?: string;
          sourcePath?: string;
          move?: string;
          perFileResults?: Array<{ path?: string; sourcePath?: string; move?: string }>;
        } | undefined;

        const touchedPaths: string[] = [];
        if (editDetails?.path) touchedPaths.push(editDetails.path);
        if (editDetails?.sourcePath) touchedPaths.push(editDetails.sourcePath);
        if (editDetails?.move) touchedPaths.push(editDetails.move);

        if (Array.isArray(editDetails?.perFileResults)) {
          for (const item of editDetails.perFileResults) {
            if (item?.path) touchedPaths.push(item.path);
            if (item?.sourcePath) touchedPaths.push(item.sourcePath);
            if (item?.move) touchedPaths.push(item.move);
          }
        }

        for (const raw of touchedPaths) {
          const norm = rebasePathToRoot(raw, childCwd, rootCwd);
          if (norm && !root.knownPaths.has(norm) && !root.unprovenPaths.has(norm)) {
            if (
              root.knownPaths.size +
                root.unprovenPaths.size +
                newlyDiscoveredPaths.length <
              MAX_PATHS_PER_ROOT
            ) {
              newlyDiscoveredPaths.push(norm);
            }
          }
        }
      }

      if (newlyDiscoveredPaths.length === 0) return;

      // Mark discovered paths as unproven
      for (const p of newlyDiscoveredPaths) {
        root.unprovenPaths.add(p);
      }

      const basePayload = {
        version: SESSION_CHANGES_PROTOCOL_VERSION,
        serverEpoch: root.serverEpoch,
        terminalIncarnation: root.terminalIncarnation,
        ompSessionId: root.ompSessionId,
        rootId: root.rootId,
        baselineId: root.baselineId,
        captureId: crypto.randomUUID(),
        mode: "unproven" as CaptureMode,
      };

      // W3: Chunk result-only discovery paths with total deadline
      const chunks = chunkCapturePaths(basePayload, newlyDiscoveredPaths, MAX_CAPTURE_BODY_BYTES);
      for (const chunk of chunks) {
        const remainingMs = this.captureTimeoutMs - (performance.now() - resultStartTime);
        if (remainingMs <= 0) break;

        const captureReq: CaptureRequest = {
          ...basePayload,
          captureId: crypto.randomUUID(),
          paths: chunk,
        };
        const res = await this.postJson<CaptureResponse>(
          "/capture",
          captureReq,
          Math.max(10, Math.floor(remainingMs)),
        );

        if (
          this.globalGeneration !== callGen ||
          (this.activeSessionId !== null && this.activeSessionId !== root.ompSessionId)
        ) {
          return;
        }

        if (res.status === 503) {
          root.disabled = true;
          this.isPermanentlyDisabled = true;
          break;
        }
      }
    } catch (err: unknown) {
      this.logger?.warn?.("SessionChanges tool_result error", err);
    }
  }

  /**
   * Dedicated flush helper: sends timed-out attempts with their EXACT original captureId (W2).
   */
  public async flushPendingInvalidations(root: RootSessionRegistration): Promise<void> {
    if (root.pendingInvalidations.length === 0 || root.disabled) return;
    const invalidations = [...root.pendingInvalidations];
    root.pendingInvalidations = [];

    const callGen = this.globalGeneration;

    for (const inv of invalidations) {
      const basePayload = {
        version: SESSION_CHANGES_PROTOCOL_VERSION,
        serverEpoch: root.serverEpoch,
        terminalIncarnation: root.terminalIncarnation,
        ompSessionId: root.ompSessionId,
        rootId: root.rootId,
        baselineId: root.baselineId,
        captureId: inv.captureId, // Preserves exact original attempt ID!
        mode: "unproven" as CaptureMode,
      };

      const chunks = chunkCapturePaths(basePayload, inv.paths, MAX_CAPTURE_BODY_BYTES);
      for (const chunk of chunks) {
        const res = await this.postJson<CaptureResponse>(
          "/capture",
          { ...basePayload, paths: chunk },
          1000,
        );
        if (
          this.globalGeneration !== callGen ||
          (this.activeSessionId !== null && this.activeSessionId !== root.ompSessionId)
        ) {
          return;
        }
        if (res.status === 503) {
          root.disabled = true;
          this.isPermanentlyDisabled = true;
          return;
        }
      }
    }
  }

  public async handleSessionSwitch(
    ompSessionId: string,
    agentId: string,
    cwd?: string,
  ): Promise<RootSessionRegistration | null> {
    this.globalGeneration++;
    this.pendingCalls.clear();
    return this.registerSession(ompSessionId, agentId, cwd);
  }

  /**
   * Turn settled notification on agent_end (ignoring intermediate turns with willContinue: true).
   */
  public async handleAgentEnd(
    event: AgentEndEventPayload | undefined,
    ctx: OmpExtensionContext | undefined,
  ): Promise<void> {
    try {
      if (this.isPermanentlyDisabled) return;
      if (event?.willContinue === true) {
        return; // Intermediate turn, not settled
      }

      const root = this.registry.resolveRoot(ctx?.agent);
      if (!root || root.disabled) return;

      // Flush any remaining pending invalidations before settled
      await this.flushPendingInvalidations(root).catch(() => {});

      // W7: Classify stop reason from assistant messages; default to unknown
      let stopReason: string | undefined;
      if (Array.isArray(event?.messages)) {
        for (let i = event.messages.length - 1; i >= 0; i--) {
          const msg = event.messages[i];
          if (msg && msg.role === "assistant" && msg.stopReason) {
            stopReason = msg.stopReason;
            break;
          }
        }
      }

      const outcome =
        stopReason === "stop" || stopReason === "ended"
          ? "completed"
          : stopReason === "aborted"
            ? "interrupted"
            : stopReason === "error"
              ? "error"
              : "unknown";

      const settledReq: SettledRequest = {
        version: SESSION_CHANGES_PROTOCOL_VERSION,
        serverEpoch: root.serverEpoch,
        terminalIncarnation: root.terminalIncarnation,
        ompSessionId: root.ompSessionId,
        rootId: root.rootId,
        baselineId: root.baselineId,
        turnId: event?.turnId || crypto.randomUUID(),
        outcome,
      };

      const res = await this.postJson("/settled", settledReq, 1000);
      if (res.status === 503) {
        root.disabled = true;
        this.isPermanentlyDisabled = true;
      }
    } catch (err: unknown) {
      this.logger?.warn?.("SessionChanges settled error", err);
    }
  }

  public handleSessionShutdown(ompSessionId: string): void {
    this.globalGeneration++;
    if (this.activeSessionId === ompSessionId) {
      this.activeSessionId = null;
    }

    // Clear pending tool calls associated with this session
    for (const [callId, call] of this.pendingCalls.entries()) {
      if (call.ompSessionId === ompSessionId) {
        this.pendingCalls.delete(callId);
      }
    }

    this.registry.removeRoot(ompSessionId);
  }
}

// ============================================================================
// Extension Export
// ============================================================================

export default function damHopperSessionChangesExtension(
  pi: OmpExtensionAPI,
): void {
  const wsUrlRaw = process.env.DAM_HOPPER_AGENT_STATUS_URL;
  const token = process.env.DAM_HOPPER_AGENT_STATUS_TOKEN;

  if (!wsUrlRaw || !token) {
    return;
  }

  const validUrl = validateLoopbackWsUrl(wsUrlRaw);
  if (!validUrl) {
    return;
  }

  if (token.length > 128 || !/^[\x21-\x7E]+$/.test(token)) {
    return;
  }

  const httpUrl = derivePrivateHttpUrl(validUrl.toString());
  const producer = new SessionChangesProducer({
    httpUrl,
    token,
    logger: pi.logger,
    registry: moduleRegistry,
  });

  pi.on("session_start", async (_event: unknown, ctxUnknown: unknown) => {
    const ctx = ctxUnknown as OmpExtensionContext | undefined;
    if (!ctx) return;

    const agentKind = ctx.agent?.kind || "main";
    const agentId = ctx.agent?.id || (agentKind === "main" ? "main" : "sub");

    if (agentKind === "main" || !ctx.agent?.parentId) {
      const sessionId = sanitizeSessionId(ctx.sessionManager?.getSessionId?.());
      await producer.registerSession(sessionId, agentId, ctx.cwd);
    } else if (ctx.agent?.parentId) {
      producer.registry.recordChildAgent(agentId, ctx.agent.parentId);
    }
  });

  pi.on("session_switch", async (_eventUnknown: unknown, ctxUnknown: unknown) => {
    const ctx = ctxUnknown as OmpExtensionContext | undefined;
    if (!ctx) return;

    const agentKind = ctx.agent?.kind || "main";
    const agentId = ctx.agent?.id || (agentKind === "main" ? "main" : "sub");

    if (agentKind === "main" || !ctx.agent?.parentId) {
      const sessionId = sanitizeSessionId(ctx.sessionManager?.getSessionId?.());
      await producer.handleSessionSwitch(sessionId, agentId, ctx.cwd);
    }
  });

  pi.on("tool_call", async (eventUnknown: unknown, ctxUnknown: unknown) => {
    const event = eventUnknown as ToolCallEventPayload | undefined;
    const ctx = ctxUnknown as OmpExtensionContext | undefined;
    await producer.handleToolCall(event?.toolName, event?.input, ctx, event?.toolCallId);
  });

  pi.on("tool_result", async (eventUnknown: unknown, ctxUnknown: unknown) => {
    const event = eventUnknown as ToolResultEventPayload | undefined;
    const ctx = ctxUnknown as OmpExtensionContext | undefined;
    await producer.handleToolResult(event?.toolName, event?.details, ctx, event?.toolCallId);
  });

  pi.on("agent_end", async (eventUnknown: unknown, ctxUnknown: unknown) => {
    const event = eventUnknown as AgentEndEventPayload | undefined;
    const ctx = ctxUnknown as OmpExtensionContext | undefined;
    await producer.handleAgentEnd(event, ctx);
  });

  pi.on("session_shutdown", (_eventUnknown: unknown, ctxUnknown: unknown) => {
    const ctx = ctxUnknown as OmpExtensionContext | undefined;
    const sessionId = sanitizeSessionId(ctx?.sessionManager?.getSessionId?.());
    producer.handleSessionShutdown(sessionId);
  });
}
