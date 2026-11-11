import {
  getBrowserSession,
  listBrowserSessions,
} from "@/api/browser-host-client.js";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { commitNativeTargetAdmission } from "./browser-admission-guard.js";
import {
  closeBrowserTarget,
  isNativeTargetClosing,
  type BrowserCloseOutcome,
} from "./browser-close-lifecycle.js";
import {
  createBrowserNativeTargetKey,
  isCapturedBrowserOwnerCurrent,
} from "./browser-owner-scope.js";
import type {
  BrowserOwnerScope,
  BrowserTargetRuntimeIdentity,
} from "./browser-tab-types.js";

const acknowledgedOperations = new Set<string>();

export function isOperationRiskAcknowledged(operationId: string): boolean {
  return acknowledgedOperations.has(operationId);
}

export function acknowledgeUnknownOperationRisk(operationId: string): void {
  acknowledgedOperations.add(operationId);
}

export function clearInventoryAcksForTesting(): void {
  acknowledgedOperations.clear();
}

/** Synchronous atomic admission commit to prevent racing final close. */
export function commitTargetAdmission(
  scope: BrowserOwnerScope,
  sessionId: string,
  commitFn: () => void,
): boolean {
  return commitNativeTargetAdmission(scope, sessionId, commitFn);
}

/** Check if a target can be safely admitted/attached without racing an active deletion gate. */
export function canAdmitNativeTarget(scope: BrowserOwnerScope, sessionId: string): boolean {
  const key = createBrowserNativeTargetKey(scope, sessionId);
  if (!key) return false;
  return !isNativeTargetClosing(key);
}

/** List verified server sessions for the owner, excluding targets currently undergoing closure. */
export async function listVerifiedBrowserSessions(
  owner: ConnectionRef,
  scope: BrowserOwnerScope,
  signal?: AbortSignal,
): Promise<BrowserSessionDto[]> {
  if (!isCapturedBrowserOwnerCurrent(owner, scope)) return [];

  const rawSessions = await listBrowserSessions(owner, signal);
  if (!isCapturedBrowserOwnerCurrent(owner, scope)) return [];

  return rawSessions.filter((session) => {
    const key = createBrowserNativeTargetKey(scope, session.browserSessionId);
    if (!key || isNativeTargetClosing(key)) return false;
    return session.status === "running" || session.status === "initializing";
  });
}

/** Retrieve verified server session by ID, forbidding targets undergoing closure or lost. */
export async function getVerifiedBrowserSession(
  owner: ConnectionRef,
  scope: BrowserOwnerScope,
  sessionId: string,
  signal?: AbortSignal,
): Promise<BrowserSessionDto | null> {
  if (!isCapturedBrowserOwnerCurrent(owner, scope)) return null;

  const key = createBrowserNativeTargetKey(scope, sessionId);
  if (!key || isNativeTargetClosing(key)) return null;

  try {
    const session = await getBrowserSession(owner, sessionId, signal);
    if (!isCapturedBrowserOwnerCurrent(owner, scope) || isNativeTargetClosing(key)) {
      return null;
    }
    if (session.status === "closing" || session.status === "lost" || session.status === "closed") {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

/** Explicitly close a user-selected session from inventory reconciliation. */
export async function closeSelectedInventorySession(
  owner: ConnectionRef,
  scope: BrowserOwnerScope,
  sessionId: string,
  windowId: string,
  runtime?: BrowserTargetRuntimeIdentity,
  signal?: AbortSignal,
): Promise<BrowserCloseOutcome> {
  return closeBrowserTarget({
    owner,
    scope,
    sessionId,
    windowId,
    runtime,
    signal,
  });
}
