import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { ConnectionRef } from "@/api/ownership.js";
import { connectionKey } from "@/api/ownership.js";
import type { GitBlameResponse, ProjectTargetInput } from "@/api/client.js";
import { normalizeProjectTarget, projectTargetCacheKey } from "@/api/client.js";
import { profileQueryKey } from "@/api/query-client.js";
import {
  computeMonacoLineCount,
  isBufferOverLimit,
  validateBlameResponse,
} from "./editor-git-blame.js";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { onConnectionInvalidated } from "@/api/connections.js";
import { generateUUID } from "@/lib/utils.js";

export type CachedAttribution = Omit<
  GitBlameResponse,
  "snapshotId" | "modelVersion"
>;

/** Maximum number of retained completed blame attribution entries per QueryClient. */
export const BLAME_CACHE_MAX_ENTRIES = 64;

/** Maximum total retained memory budget (32 MiB) for completed blame attributions per QueryClient. */
export const BLAME_CACHE_MAX_BYTES = 32 * 1024 * 1024;

/** TanStack Query GC time for blame queries (5 minutes). */
export const BLAME_CACHE_GC_MS = 5 * 60 * 1000;

const textEncoder = new TextEncoder();

/**
 * Computes synchronous SHA-256 hex digest of exact UTF-8 buffer bytes.
 */
export function computeBufferSha256(content: string): string {
  const bytes = textEncoder.encode(content);
  return bytesToHex(sha256(bytes));
}

const modelFingerprintCache = new WeakMap<object, Map<number, string>>();

/**
 * Returns memoized buffer SHA-256 keyed by live Monaco model and modelVersion.
 * Avoids repeated UTF-8 encoding and hashing on non-content renders.
 */
export function getModelBufferSha256(
  model: { getVersionId: () => number; getValue: () => string },
  content?: string,
): string {
  const version = model.getVersionId();
  let versionMap = modelFingerprintCache.get(model);
  if (!versionMap) {
    versionMap = new Map();
    modelFingerprintCache.set(model, versionMap);
  }
  const cached = versionMap.get(version);
  if (cached !== undefined) {
    return cached;
  }
  const text = content !== undefined ? content : model.getValue();
  const fingerprint = computeBufferSha256(text);
  // Cap versionMap to keep memory bounded
  if (versionMap.size >= 16) {
    versionMap.clear();
  }
  versionMap.set(version, fingerprint);
  return fingerprint;
}

export interface ModelBufferMetadata {
  isOverLimit: boolean;
  sha256: string | null;
  lineCount: number;
}

const modelMetadataCache = new WeakMap<object, Map<number, ModelBufferMetadata>>();

/**
 * Returns memoized buffer metadata (over-limit check, SHA-256 fingerprint, and Monaco line count)
 * keyed by live Monaco model and modelVersion.
 * Prevents repeated string extraction, UTF-8 encoding, and byte-boundary scans on every render.
 */
export function getModelBufferMetadata(
  model: { getVersionId: () => number; getValue: () => string },
): ModelBufferMetadata {
  const version = model.getVersionId();
  let versionMap = modelMetadataCache.get(model);
  if (!versionMap) {
    versionMap = new Map();
    modelMetadataCache.set(model, versionMap);
  }
  const cached = versionMap.get(version);
  if (cached !== undefined) {
    return cached;
  }
  const content = model.getValue();
  const overLimit = isBufferOverLimit(content);
  const sha = !overLimit ? computeBufferSha256(content) : null;
  const lineCount = computeMonacoLineCount(content);
  const meta: ModelBufferMetadata = {
    isOverLimit: overLimit,
    sha256: sha,
    lineCount,
  };
  if (versionMap.size >= 16) {
    versionMap.clear();
  }
  versionMap.set(version, meta);
  return meta;
}

/**
 * Builds TanStack Query key for a completed blame query.
 * Layout: profileQueryKey(owner, "git", "git-blame", project, canonicalWorktreeKey,
 *                         owningRootId, verifiedHeadOidOrKnownUnbornNull,
 *                         repositoryEpoch, path, sha256ExactBufferBytes)
 */
export function buildBlameQueryKey(
  owner: ConnectionRef,
  target: ProjectTargetInput,
  owningRootId: string,
  verifiedHeadOidOrKnownUnbornNull: string | null,
  repositoryEpoch: number,
  path: string,
  sha256ExactBufferBytes: string,
): QueryKey {
  const normalized = normalizeProjectTarget(target);
  const canonicalWorktreeKey = projectTargetCacheKey(normalized);
  return profileQueryKey(
    owner,
    "git",
    "git-blame",
    normalized.project,
    canonicalWorktreeKey,
    owningRootId,
    verifiedHeadOidOrKnownUnbornNull,
    repositoryEpoch,
    path,
    sha256ExactBufferBytes,
  );
}

/**
 * Checks whether a TanStack Query key matches a git-blame query for the given target and owner.
 */
export function isMatchingBlameQueryKey(
  key: unknown,
  target: ProjectTargetInput,
  owner?: ConnectionRef | null,
): boolean {
  if (!Array.isArray(key) || key.length < 7) return false;
  if (key[0] !== "profile") return false;
  const normalized = normalizeProjectTarget(target);
  const worktreeKey = projectTargetCacheKey(normalized);
  if (owner) {
    if (key[1] !== owner.profileId || key[2] !== owner.generation) return false;
  }
  if (key[3] !== "git" || key[4] !== "git-blame") return false;
  if (key[5] !== normalized.project) return false;
  if (key[6] !== worktreeKey) return false;
  return true;
}

function estimateStringWeight(str: string | null | undefined): number {
  if (!str) return 0;
  return 32 + str.length * 2;
}

/**
 * Computes deterministic conservative memory weight of CachedAttribution.
 * Strings: 2 bytes per UTF-16 code unit + 32-byte header.
 * Object/Array/Number: standard JS heap overhead estimates.
 */
export function estimateCachedAttributionWeight(
  cached: CachedAttribution,
): number {
  let bytes = 64; // base object
  bytes += estimateStringWeight(cached.rootId);
  bytes += estimateStringWeight(cached.rootRelativePath);
  bytes += estimateStringWeight(cached.baseCommitOid);
  bytes += estimateStringWeight(cached.status);
  bytes += 8; // bufferLineCount

  // ranges array: 64 base + (64 object + 24 numbers) per range
  bytes += 64 + cached.ranges.length * (64 + 3 * 8);

  // commits array: 64 base + commit objects
  bytes += 64;
  for (const c of cached.commits) {
    bytes += 64;
    bytes += estimateStringWeight(c.hash);
    bytes += estimateStringWeight(c.authorName);
    bytes += estimateStringWeight(c.authorEmail);
    bytes += 8; // authorTimestamp
    bytes += 8; // authorTimezoneOffsetMinutes
    bytes += estimateStringWeight(c.subject);
  }
  return bytes;
}

// Global monotonic epoch counter across all targets to prevent ABA / epoch repetition
let globalMonotonicEpochCounter = 1;

export interface TargetState {
  targetKey: string;
  owner: ConnectionRef;
  project: string;
  canonicalWorktreeKey: string;
  repositoryEpoch: number;
  trustedRootId: string | undefined;
  trustedHeadOid: string | null | undefined; // string: commit OID, null: unborn HEAD, undefined: unknown
  discoveryPending: boolean;
  discoveryToken: string | null;
  discoveryEpoch: number | null;
  pendingLeases: Set<string>;
  completedEntryKeys: Set<string>;
}

export interface RequestLease {
  leaseId: string;
  owner: ConnectionRef;
  targetKey: string;
  markerKey: QueryKey;
  capturedEpoch: number;
}

export interface DiscoveryHandle {
  token: string;
  capturedEpoch: number;
  owner: ConnectionRef;
  targetKey: string;
}

interface LRUEntry {
  keyString: string;
  queryKey: QueryKey;
  targetKey: string;
  weight: number;
  lastAccessed: number;
}

interface ClientBlameCacheState {
  targets: Map<string, TargetState>;
  lruEntries: Map<string, LRUEntry>;
  totalBytes: number;
  ownerUnsubscribers: Map<string, () => void>;
  queryCacheUnsubscriber: (() => void) | null;
  configuredGenerations: Set<string>;
}

const clientStateMap = new WeakMap<QueryClient, ClientBlameCacheState>();
let globalLruAccessCounter = 0;

function makeTargetKey(
  owner: ConnectionRef,
  project: string,
  canonicalWorktreeKey: string,
): string {
  return `${owner.profileId}:${owner.generation}:${project}:${canonicalWorktreeKey}`;
}

function getClientState(queryClient: QueryClient): ClientBlameCacheState {
  let state = clientStateMap.get(queryClient);
  if (!state) {
    const targets = new Map<string, TargetState>();
    const lruEntries = new Map<string, LRUEntry>();
    const ownerUnsubscribers = new Map<string, () => void>();
    const configuredGenerations = new Set<string>();

    const unsubQueryCache = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "removed") {
        const queryKey = event.query.queryKey;
        const keyString = JSON.stringify(queryKey);
        const entry = lruEntries.get(keyString);
        if (entry) {
          state!.totalBytes -= entry.weight;
          lruEntries.delete(keyString);
          const target = targets.get(entry.targetKey);
          if (target) {
            target.completedEntryKeys.delete(keyString);
            cleanupTargetIfSettled(state!, queryClient, target);
          }
        }
      }
    });

    state = {
      targets,
      lruEntries,
      totalBytes: 0,
      ownerUnsubscribers,
      queryCacheUnsubscriber: unsubQueryCache,
      configuredGenerations,
    };
    clientStateMap.set(queryClient, state);
  }
  return state;
}

function getOrCreateTargetState(
  state: ClientBlameCacheState,
  queryClient: QueryClient,
  owner: ConnectionRef,
  target: ProjectTargetInput,
): TargetState {
  const normalized = normalizeProjectTarget(target);
  const canonicalWorktreeKey = projectTargetCacheKey(normalized);
  const targetKey = makeTargetKey(
    owner,
    normalized.project,
    canonicalWorktreeKey,
  );
  let targetState = state.targets.get(targetKey);
  if (!targetState) {
    targetState = {
      targetKey,
      owner: { profileId: owner.profileId, generation: owner.generation },
      project: normalized.project,
      canonicalWorktreeKey,
      repositoryEpoch: ++globalMonotonicEpochCounter,
      trustedRootId: undefined,
      trustedHeadOid: undefined,
      discoveryPending: false,
      discoveryToken: null,
      discoveryEpoch: null,
      pendingLeases: new Set(),
      completedEntryKeys: new Set(),
    };
    state.targets.set(targetKey, targetState);

    // Register onConnectionInvalidated listener for this owner generation if not already active
    const ownerConnKey = connectionKey(owner);
    if (!state.ownerUnsubscribers.has(ownerConnKey)) {
      const unsub = onConnectionInvalidated(owner, () => {
        retireOwner(queryClient, owner);
      });
      state.ownerUnsubscribers.set(ownerConnKey, unsub);
    }
  }
  return targetState;
}

function cleanupTargetIfSettled(
  state: ClientBlameCacheState,
  _queryClient: QueryClient,
  target: TargetState,
): void {
  if (
    target.completedEntryKeys.size === 0 &&
    target.pendingLeases.size === 0 &&
    !target.discoveryPending
  ) {
    state.targets.delete(target.targetKey);
    checkOwnerRetirementNeeded(state, target.owner);
  }
}

function checkOwnerRetirementNeeded(
  state: ClientBlameCacheState,
  owner: ConnectionRef,
): void {
  let hasRemaining = false;
  for (const t of state.targets.values()) {
    if (
      t.owner.profileId === owner.profileId &&
      t.owner.generation === owner.generation
    ) {
      hasRemaining = true;
      break;
    }
  }
  if (!hasRemaining) {
    const ownerConnKey = connectionKey(owner);
    const unsub = state.ownerUnsubscribers.get(ownerConnKey);
    if (unsub) {
      unsub();
      state.ownerUnsubscribers.delete(ownerConnKey);
    }
    state.configuredGenerations.delete(ownerConnKey);
  }
}

function evictOldestLRUEntry(
  state: ClientBlameCacheState,
  queryClient: QueryClient,
): void {
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [keyString, entry] of state.lruEntries.entries()) {
    if (entry.lastAccessed < oldestTime) {
      oldestTime = entry.lastAccessed;
      oldestKey = keyString;
    }
  }
  if (!oldestKey) return;
  const entry = state.lruEntries.get(oldestKey);
  if (!entry) return;
  state.totalBytes -= entry.weight;
  state.lruEntries.delete(oldestKey);
  const target = state.targets.get(entry.targetKey);
  if (target) {
    target.completedEntryKeys.delete(oldestKey);
    cleanupTargetIfSettled(state, queryClient, target);
  }
  queryClient.removeQueries({ queryKey: entry.queryKey, exact: true });
}

/**
 * Begins a request lease before dispatching a network blame request.
 * Sets a small query marker in QueryClient so `queryClient.clear()` or QueryCache removal
 * immediately revokes the lease.
 */
export function beginRequestLease(
  queryClient: QueryClient,
  owner: ConnectionRef,
  target: ProjectTargetInput,
  path: string,
): RequestLease {
  const state = getClientState(queryClient);
  const targetState = getOrCreateTargetState(
    state,
    queryClient,
    owner,
    target,
  );
  const leaseId = generateUUID();
  const capturedEpoch = targetState.repositoryEpoch;
  const normalized = normalizeProjectTarget(target);
  const markerKey = profileQueryKey(
    owner,
    "git",
    "git-blame-lease",
    normalized.project,
    projectTargetCacheKey(normalized),
    path,
    leaseId,
  );

  queryClient.setQueryData(markerKey, { leaseId, createdAt: Date.now() });
  targetState.pendingLeases.add(leaseId);

  return {
    leaseId,
    owner: { profileId: owner.profileId, generation: owner.generation },
    targetKey: targetState.targetKey,
    markerKey,
    capturedEpoch,
  };
}

/**
 * Validates whether a request lease remains valid:
 * 1. Target repository epoch must not have advanced.
 * 2. Query marker must still exist in QueryClient (not cleared by clear() or removal).
 */
export function isLeaseValid(
  queryClient: QueryClient,
  lease: RequestLease,
): boolean {
  const state = clientStateMap.get(queryClient);
  if (!state) return false;
  const targetState = state.targets.get(lease.targetKey);
  if (!targetState) return false;
  if (targetState.repositoryEpoch !== lease.capturedEpoch) return false;
  if (!targetState.pendingLeases.has(lease.leaseId)) return false;

  const marker = queryClient.getQueryData<{ leaseId: string }>(lease.markerKey);
  if (!marker || marker.leaseId !== lease.leaseId) return false;

  return true;
}

/**
 * Ends and cleans up a request lease on settle or cancel.
 */
export function endRequestLease(
  queryClient: QueryClient,
  lease: RequestLease,
): void {
  const state = clientStateMap.get(queryClient);
  if (state) {
    const targetState = state.targets.get(lease.targetKey);
    if (targetState) {
      targetState.pendingLeases.delete(lease.leaseId);
      cleanupTargetIfSettled(state, queryClient, targetState);
    }
  }
  queryClient.removeQueries({ queryKey: lease.markerKey, exact: true });
}

export interface BlameHitResult {
  hit: boolean;
  data: GitBlameResponse | null;
  queryKey?: QueryKey;
}

/**
 * Synchronous side-effect-free warm hit derivation during render.
 * Validates connection, target epoch, trusted root/HEAD, TanStack Query status,
 * line count, and structural response invariants rebound to current modelVersion.
 */
export function getCompletedBlameHit(
  queryClient: QueryClient,
  owner: ConnectionRef,
  target: ProjectTargetInput,
  path: string,
  sha256: string,
  bufferLineCount: number,
  modelVersion: number,
  snapshotId: string,
): BlameHitResult {
  const state = clientStateMap.get(queryClient);
  if (!state) return { hit: false, data: null };

  const normalized = normalizeProjectTarget(target);
  const targetKey = makeTargetKey(
    owner,
    normalized.project,
    projectTargetCacheKey(normalized),
  );
  const targetState = state.targets.get(targetKey);
  if (!targetState) return { hit: false, data: null };

  // Discovery pending suspends new cache-hit eligibility
  if (targetState.discoveryPending) {
    return { hit: false, data: null };
  }

  // Trusted root and HEAD must be established (null = verified unborn, string = verified OID)
  if (
    targetState.trustedRootId === undefined ||
    targetState.trustedHeadOid === undefined
  ) {
    return { hit: false, data: null };
  }

  const queryKey = buildBlameQueryKey(
    owner,
    target,
    targetState.trustedRootId,
    targetState.trustedHeadOid,
    targetState.repositoryEpoch,
    path,
    sha256,
  );

  const query = queryClient.getQueryCache().find<CachedAttribution>({
    queryKey,
    exact: true,
  });
  if (!query) return { hit: false, data: null };
  if (query.state.status !== "success") return { hit: false, data: null };
  if (query.state.isInvalidated) return { hit: false, data: null };
  if (!query.state.data) return { hit: false, data: null };

  const cached = query.state.data;
  if (cached.bufferLineCount !== bufferLineCount) {
    return { hit: false, data: null };
  }
  if (cached.rootId !== targetState.trustedRootId) {
    return { hit: false, data: null };
  }
  if (cached.baseCommitOid !== targetState.trustedHeadOid) {
    return { hit: false, data: null };
  }

  // Rebind to fresh envelope without mutating cached data
  const rebound: GitBlameResponse = {
    ...cached,
    snapshotId,
    modelVersion,
  };

  const validation = validateBlameResponse(rebound, {
    expectedSnapshotId: snapshotId,
    expectedModelVersion: modelVersion,
    expectedBufferLineCount: bufferLineCount,
  });

  if (!validation.valid) {
    return { hit: false, data: null };
  }

  return {
    hit: true,
    data: validation.response,
    queryKey,
  };
}

/**
 * Updates LRU access recency for a warm hit. MUST be called in an effect, never during render.
 */
export function touchCompletedBlameHit(
  queryClient: QueryClient,
  queryKey: QueryKey,
): void {
  const state = clientStateMap.get(queryClient);
  if (!state) return;
  const keyString = JSON.stringify(queryKey);
  const entry = state.lruEntries.get(keyString);
  if (entry) {
    entry.lastAccessed = ++globalLruAccessCounter;
  }
}

/**
 * Commits a validated blame response to TanStack Query and cache tracking.
 * Fenced by capturedEpoch and request lease validity.
 */
export function setCompletedBlamePayload(
  queryClient: QueryClient,
  owner: ConnectionRef,
  target: ProjectTargetInput,
  path: string,
  sha256: string,
  response: GitBlameResponse,
  capturedEpoch: number,
  lease: RequestLease,
): boolean {
  if (!isLeaseValid(queryClient, lease)) {
    return false;
  }

  const state = getClientState(queryClient);
  const targetState = state.targets.get(lease.targetKey);
  if (!targetState) return false;

  // Epoch fence: if epoch advanced during request, reject cache write
  if (targetState.repositoryEpoch !== capturedEpoch) {
    return false;
  }

  // Authoritative response establishes trusted root and HEAD
  targetState.trustedRootId = response.rootId;
  targetState.trustedHeadOid = response.baseCommitOid;

  const cached: CachedAttribution = {
    rootId: response.rootId,
    rootRelativePath: response.rootRelativePath,
    baseCommitOid: response.baseCommitOid,
    bufferLineCount: response.bufferLineCount,
    status: response.status,
    ranges: response.ranges,
    commits: response.commits,
  };

  const weight = estimateCachedAttributionWeight(cached);
  if (weight > BLAME_CACHE_MAX_BYTES) {
    // Oversized entry is usable by caller but not admitted to cache
    return false;
  }

  const queryKey = buildBlameQueryKey(
    owner,
    target,
    response.rootId,
    response.baseCommitOid,
    capturedEpoch,
    path,
    sha256,
  );

  const keyString = JSON.stringify(queryKey);
  const existingEntry = state.lruEntries.get(keyString);

  // If replacing an existing key, remove it first so totalBytes reflects only other entries
  if (existingEntry) {
    state.totalBytes -= existingEntry.weight;
    state.lruEntries.delete(keyString);
    targetState.completedEntryKeys.delete(keyString);
  }

  // Evict until within entry count and memory budget
  while (
    (state.totalBytes + weight > BLAME_CACHE_MAX_BYTES ||
      state.lruEntries.size >= BLAME_CACHE_MAX_ENTRIES) &&
    state.lruEntries.size > 0
  ) {
    evictOldestLRUEntry(state, queryClient);
  }

  if (state.totalBytes + weight > BLAME_CACHE_MAX_BYTES) {
    return false;
  }

  // Configure 5-minute TanStack Query GC time for this owner's blame queries
  const ownerConnKey = connectionKey(owner);
  if (!state.configuredGenerations.has(ownerConnKey)) {
    state.configuredGenerations.add(ownerConnKey);
    queryClient.setQueryDefaults(
      ["profile", owner.profileId, owner.generation, "git", "git-blame"],
      { gcTime: BLAME_CACHE_GC_MS },
    );
  }

  queryClient.setQueryData(queryKey, cached);

  state.lruEntries.set(keyString, {
    keyString,
    queryKey,
    targetKey: targetState.targetKey,
    weight,
    lastAccessed: ++globalLruAccessCounter,
  });
  state.totalBytes += weight;
  targetState.completedEntryKeys.add(keyString);

  return true;
}

/**
 * Advances the repository epoch for a target, revokes trusted root/HEAD, and invalidates queries.
 */
export function advanceTargetEpoch(
  queryClient:
    | QueryClient
    | {
        invalidateQueries: (options: { queryKey: QueryKey }) => Promise<void>;
        removeQueries?: (options: { queryKey: QueryKey }) => void;
      },
  owner: ConnectionRef,
  target: ProjectTargetInput,
): number {
  const newEpoch = ++globalMonotonicEpochCounter;
  const normalized = normalizeProjectTarget(target);
  const canonicalWorktreeKey = projectTargetCacheKey(normalized);
  const targetKey = makeTargetKey(
    owner,
    normalized.project,
    canonicalWorktreeKey,
  );

  const qc = queryClient as QueryClient;
  const state = clientStateMap.get(qc);
  if (state) {
    const targetState = state.targets.get(targetKey);
    if (targetState) {
      targetState.repositoryEpoch = newEpoch;

      for (const keyString of targetState.completedEntryKeys) {
        const entry = state.lruEntries.get(keyString);
        if (entry) {
          state.totalBytes -= entry.weight;
          state.lruEntries.delete(keyString);
        }
      }
      targetState.completedEntryKeys.clear();
      cleanupTargetIfSettled(state, qc, targetState);
    }
  }

  const blamePrefix = profileQueryKey(
    owner,
    "git",
    "git-blame",
    normalized.project,
    canonicalWorktreeKey,
  );

  void queryClient.invalidateQueries({ queryKey: blamePrefix });
  if (typeof (queryClient as QueryClient).removeQueries === "function") {
    (queryClient as QueryClient).removeQueries({ queryKey: blamePrefix });
  }

  return newEpoch;
}

/**
 * Invalidates blame cache for a specific target.
 */
export function invalidateBlameForTarget(
  queryClient:
    | QueryClient
    | {
        invalidateQueries: (options: { queryKey: QueryKey }) => Promise<void>;
        removeQueries?: (options: { queryKey: QueryKey }) => void;
      },
  owner: ConnectionRef | null | undefined,
  target: ProjectTargetInput,
): void {
  if (owner) {
    advanceTargetEpoch(queryClient, owner, target);
  } else {
    const normalized = normalizeProjectTarget(target);
    const worktreeKey = projectTargetCacheKey(normalized);
    const qc = queryClient as QueryClient;
    const state = clientStateMap.get(qc);
    if (state) {
      for (const targetState of Array.from(state.targets.values())) {
        if (
          targetState.project === normalized.project &&
          targetState.canonicalWorktreeKey === worktreeKey
        ) {
          advanceTargetEpoch(queryClient, targetState.owner, target);
        }
      }
    }
  }
}

/**
 * Invalidates blame cache for all targets matching an owner and project name.
 * If project is omitted, invalidates all blame targets for that owner.
 */
export function invalidateBlameForProject(
  queryClient:
    | QueryClient
    | {
        invalidateQueries: (options: { queryKey: QueryKey }) => Promise<void>;
        removeQueries?: (options: { queryKey: QueryKey }) => void;
      },
  owner: ConnectionRef,
  project?: string,
): void {
  const qc = queryClient as QueryClient;
  const state = clientStateMap.get(qc);
  if (state) {
    for (const targetState of Array.from(state.targets.values())) {
      if (
        targetState.owner.profileId === owner.profileId &&
        targetState.owner.generation === owner.generation &&
        (!project || targetState.project === project)
      ) {
        targetState.repositoryEpoch = ++globalMonotonicEpochCounter;
        targetState.trustedRootId = undefined;
        targetState.trustedHeadOid = undefined;

        for (const keyString of targetState.completedEntryKeys) {
          const entry = state.lruEntries.get(keyString);
          if (entry) {
            state.totalBytes -= entry.weight;
            state.lruEntries.delete(keyString);
          }
        }
        targetState.completedEntryKeys.clear();
        cleanupTargetIfSettled(state, qc, targetState);
      }
    }
  }

  const queryPrefix = project
    ? profileQueryKey(owner, "git", "git-blame", project)
    : profileQueryKey(owner, "git", "git-blame");

  void queryClient.invalidateQueries({ queryKey: queryPrefix });
  if (typeof (queryClient as QueryClient).removeQueries === "function") {
    (queryClient as QueryClient).removeQueries({ queryKey: queryPrefix });
  }
}

/**
 * Invalidates all blame targets for an owner across all projects.
 */
export function invalidateBlameForOwner(
  queryClient:
    | QueryClient
    | {
        invalidateQueries: (options: { queryKey: QueryKey }) => Promise<void>;
        removeQueries?: (options: { queryKey: QueryKey }) => void;
      },
  owner: ConnectionRef,
): void {
  invalidateBlameForProject(queryClient, owner);
}

/**
 * Retires an owner generation: revokes all cached entries, pending leases, and listeners.
 */
export function retireOwner(
  queryClient:
    | QueryClient
    | {
        invalidateQueries: (options: { queryKey: QueryKey }) => Promise<void>;
        removeQueries?: (options: { queryKey: QueryKey }) => void;
      },
  owner: ConnectionRef,
): void {
  const qc = queryClient as QueryClient;
  const state = clientStateMap.get(qc);
  if (state) {
    for (const targetState of Array.from(state.targets.values())) {
      if (
        targetState.owner.profileId === owner.profileId &&
        targetState.owner.generation === owner.generation
      ) {
        targetState.repositoryEpoch = ++globalMonotonicEpochCounter;
        targetState.trustedRootId = undefined;
        targetState.trustedHeadOid = undefined;

        for (const keyString of targetState.completedEntryKeys) {
          const entry = state.lruEntries.get(keyString);
          if (entry) {
            state.totalBytes -= entry.weight;
            state.lruEntries.delete(keyString);
          }
        }
        targetState.completedEntryKeys.clear();
        targetState.pendingLeases.clear();
        state.targets.delete(targetState.targetKey);
      }
    }

    const ownerConnKey = connectionKey(owner);
    const unsub = state.ownerUnsubscribers.get(ownerConnKey);
    if (unsub) {
      unsub();
      state.ownerUnsubscribers.delete(ownerConnKey);
    }
    state.configuredGenerations.delete(ownerConnKey);
  }

  const blamePrefix = profileQueryKey(owner, "git", "git-blame");
  const leasePrefix = profileQueryKey(owner, "git", "git-blame-lease");

  void queryClient.invalidateQueries({ queryKey: blamePrefix });
  if (typeof (queryClient as QueryClient).removeQueries === "function") {
    (queryClient as QueryClient).removeQueries({ queryKey: blamePrefix });
    (queryClient as QueryClient).removeQueries({ queryKey: leasePrefix });
  }
}

/**
 * Begins root discovery: temporarily suspends cache-hit eligibility for the target.
 */
export function beginRootDiscovery(
  queryClient: QueryClient,
  owner: ConnectionRef,
  target: ProjectTargetInput,
): DiscoveryHandle {
  const state = getClientState(queryClient);
  const targetState = getOrCreateTargetState(
    state,
    queryClient,
    owner,
    target,
  );
  const token = generateUUID();
  targetState.discoveryPending = true;
  targetState.discoveryToken = token;
  targetState.discoveryEpoch = targetState.repositoryEpoch;

  return {
    token,
    capturedEpoch: targetState.repositoryEpoch,
    owner: { profileId: owner.profileId, generation: owner.generation },
    targetKey: targetState.targetKey,
  };
}

/**
 * Completes root discovery and updates trusted root and HEAD.
 * Returns stale flag if epoch changed or token mismatched.
 */
export function completeRootDiscovery(
  queryClient: QueryClient,
  handle: DiscoveryHandle,
  discoveredRootId: string,
  discoveredHeadOid: string | null,
): { isStale: boolean; headChanged: boolean; rootChanged: boolean } {
  const state = clientStateMap.get(queryClient);
  if (!state) return { isStale: true, headChanged: true, rootChanged: true };
  const targetState = state.targets.get(handle.targetKey);
  if (!targetState) {
    return { isStale: true, headChanged: true, rootChanged: true };
  }

  // Finding 3 fix: Only the active discovery token can clear discoveryPending
  if (targetState.discoveryToken !== handle.token) {
    return { isStale: true, headChanged: true, rootChanged: true };
  }

  if (targetState.repositoryEpoch !== handle.capturedEpoch) {
    targetState.discoveryPending = false;
    targetState.discoveryToken = null;
    targetState.discoveryEpoch = null;
    return { isStale: true, headChanged: true, rootChanged: true };
  }

  targetState.discoveryPending = false;
  targetState.discoveryToken = null;
  targetState.discoveryEpoch = null;

  const prevHead = targetState.trustedHeadOid;
  const prevRoot = targetState.trustedRootId;

  // If prevHead is known (string or null for unborn), compare against discoveredHeadOid.
  // Initial discovery (prevHead === undefined) establishes baseline without reporting false change.
  const headChanged = prevHead !== undefined && prevHead !== discoveredHeadOid;
  const rootChanged = prevRoot !== undefined && prevRoot !== discoveredRootId;

  targetState.trustedRootId = discoveredRootId;
  targetState.trustedHeadOid = discoveredHeadOid;

  return { isStale: false, headChanged, rootChanged };
}

/**
 * Cancels pending root discovery on error.
 */
export function cancelRootDiscovery(
  queryClient: QueryClient,
  handle: DiscoveryHandle,
): void {
  const state = clientStateMap.get(queryClient);
  if (!state) return;
  const targetState = state.targets.get(handle.targetKey);
  if (targetState && targetState.discoveryToken === handle.token) {
    targetState.discoveryPending = false;
    targetState.discoveryToken = null;
    targetState.discoveryEpoch = null;
    cleanupTargetIfSettled(state, queryClient, targetState);
  }
}

/**
 * Returns current snapshot of TargetState for diagnostic or hook initialization.
 */
export function getTargetState(
  queryClient: QueryClient,
  owner: ConnectionRef,
  target: ProjectTargetInput,
): {
  repositoryEpoch: number;
  trustedRootId?: string;
  trustedHeadOid?: string | null;
} {
  const state = clientStateMap.get(queryClient);
  if (!state) return { repositoryEpoch: 1 };
  const normalized = normalizeProjectTarget(target);
  const targetKey = makeTargetKey(
    owner,
    normalized.project,
    projectTargetCacheKey(normalized),
  );
  const ts = state.targets.get(targetKey);
  if (!ts) return { repositoryEpoch: 1 };
  return {
    repositoryEpoch: ts.repositoryEpoch,
    trustedRootId: ts.trustedRootId,
    trustedHeadOid: ts.trustedHeadOid,
  };
}
