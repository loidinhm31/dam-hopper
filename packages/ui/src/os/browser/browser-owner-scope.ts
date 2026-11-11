import {
  getConnectionSnapshot,
  isCurrentConnection,
  type ConnectionSnapshot,
} from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { normalizeServerUrl } from "@/api/server-config.js";
import type {
  BrowserNativeTargetKey,
  BrowserOwnerScope,
  BrowserTargetRuntimeIdentity,
} from "./browser-tab-types.js";

const DECIMAL_POSITIVE_U64 = /^[1-9][0-9]{0,19}$/;
const MAX_U64 = 18446744073709551615n;

export interface VerifiedBrowserOwner {
  readonly owner: ConnectionRef;
  readonly scope: BrowserOwnerScope;
}

/** Normalize an endpoint URL via server-config and validate HTTP(S) without userinfo. */
export function normalizeBrowserEndpoint(serverUrl: string): string {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
    if (!isHttp || !parsed.hostname || parsed.username || parsed.password) return "";
    return normalized;
  } catch {
    return "";
  }
}

export function isCanonicalPositiveU64Decimal(value: unknown): value is string {
  if (typeof value !== "string" || !DECIMAL_POSITIVE_U64.test(value)) return false;
  try {
    const parsed = BigInt(value);
    return parsed >= 1n && parsed <= MAX_U64;
  } catch {
    return false;
  }
}

/** Extract verified profile-scoped owner from a connected snapshot; fails closed otherwise. */
export function extractBrowserOwnerScopeFromSnapshot(
  snapshot: ConnectionSnapshot | null | undefined,
): BrowserOwnerScope | null {
  if (!snapshot || snapshot.status !== "connected") return null;
  const { profileId } = snapshot.owner;
  if (typeof profileId !== "string" || profileId.trim().length === 0) return null;
  const endpoint = normalizeBrowserEndpoint(snapshot.serverUrl);
  const identity = snapshot.verifiedBrowserIdentity;
  if (
    !endpoint ||
    !identity ||
    typeof identity.principal !== "string" ||
    identity.principal.trim().length === 0 ||
    (identity.namespace !== "prod" && identity.namespace !== "dev")
  ) {
    return null;
  }
  return Object.freeze({
    profileId,
    endpoint,
    principal: identity.principal,
    namespace: identity.namespace,
  });
}

/** Capture verified owner + connection generation only for a current connected profile. */
export function captureVerifiedBrowserOwner(profileId: string): VerifiedBrowserOwner | null {
  const snapshot = getConnectionSnapshot(profileId);
  if (!snapshot || !isCurrentConnection(snapshot.owner)) return null;
  const scope = extractBrowserOwnerScopeFromSnapshot(snapshot);
  return scope ? Object.freeze({ owner: snapshot.owner, scope }) : null;
}

export function areBrowserOwnerScopesEqual(
  a?: BrowserOwnerScope | null,
  b?: BrowserOwnerScope | null,
): boolean {
  return Boolean(
    a && b && a.profileId === b.profileId && a.endpoint === b.endpoint &&
      a.principal === b.principal && a.namespace === b.namespace,
  );
}

export function isCapturedBrowserOwnerCurrent(
  owner: ConnectionRef,
  expectedScope: BrowserOwnerScope,
): boolean {
  if (!isCurrentConnection(owner)) return false;
  const current = extractBrowserOwnerScopeFromSnapshot(getConnectionSnapshot(owner.profileId));
  return areBrowserOwnerScopesEqual(current, expectedScope);
}

export function browserOwnerScopeKey(scope: BrowserOwnerScope): string {
  return JSON.stringify([scope.profileId, scope.endpoint, scope.principal, scope.namespace]);
}

/**
 * Derive native target identity excluding profileId for same-client reference census,
 * final-release serialization, and closing-target gates; never transfers credentials.
 */
export function createBrowserNativeTargetKey(
  scope: BrowserOwnerScope | null | undefined,
  sessionId: string | null | undefined,
): BrowserNativeTargetKey | null {
  if (!scope || typeof sessionId !== "string" || sessionId.trim().length === 0) return null;
  const endpoint = normalizeBrowserEndpoint(scope.endpoint);
  if (
    !endpoint ||
    typeof scope.principal !== "string" ||
    scope.principal.trim().length === 0 ||
    (scope.namespace !== "prod" && scope.namespace !== "dev")
  ) {
    return null;
  }
  return Object.freeze({
    endpoint,
    principal: scope.principal,
    namespace: scope.namespace,
    sessionId,
  });
}

export function formatBrowserNativeTargetKey(key: BrowserNativeTargetKey): string {
  return JSON.stringify([key.endpoint, key.principal, key.namespace, key.sessionId]);
}

export function areBrowserNativeTargetKeysEqual(
  a?: BrowserNativeTargetKey | null,
  b?: BrowserNativeTargetKey | null,
): boolean {
  return Boolean(
    a && b && a.endpoint === b.endpoint && a.principal === b.principal &&
      a.namespace === b.namespace && a.sessionId === b.sessionId,
  );
}

/**
 * Compare incarnation and decimal u64 profileEpoch where available.
 * Rejects malformed epochs and runtime mismatches; missing evidence never proves absence.
 */
export function isBrowserRuntimeCompatible(
  expected?: BrowserTargetRuntimeIdentity | null,
  actual?: BrowserTargetRuntimeIdentity | null,
): boolean {
  for (const runtime of [expected, actual]) {
    if (runtime?.profileEpoch !== undefined && !isCanonicalPositiveU64Decimal(runtime.profileEpoch)) {
      return false;
    }
  }
  if (expected?.browserIncarnation && actual?.browserIncarnation &&
      expected.browserIncarnation !== actual.browserIncarnation) {
    return false;
  }
  if (expected?.profileEpoch && actual?.profileEpoch &&
      expected.profileEpoch !== actual.profileEpoch) {
    return false;
  }
  return true;
}

export function mayReferenceSameNativeTarget(params: {
  scopeA: BrowserOwnerScope;
  sessionIdA: string;
  runtimeA?: BrowserTargetRuntimeIdentity | null;
  scopeB: BrowserOwnerScope;
  sessionIdB: string;
  runtimeB?: BrowserTargetRuntimeIdentity | null;
}): boolean {
  const keyA = createBrowserNativeTargetKey(params.scopeA, params.sessionIdA);
  const keyB = createBrowserNativeTargetKey(params.scopeB, params.sessionIdB);
  return areBrowserNativeTargetKeysEqual(keyA, keyB) &&
    isBrowserRuntimeCompatible(params.runtimeA, params.runtimeB);
}
