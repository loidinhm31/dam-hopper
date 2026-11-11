import { closeBrowserSession, getBrowserSession } from "@/api/browser-host-client.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { generateUUID } from "@/lib/utils.js";
import {
  commitNativeTargetAdmission,
  reserveCloseOrRelease,
} from "./browser-admission-guard.js";
import {
  clearClosingGatesForTesting,
  isNativeTargetClosing,
  removeClosingGate,
  restoreClosingGatesFromRecovery,
} from "./browser-closing-gates.js";
import { countRetainedNativeReferences } from "./browser-native-reference-census.js";
import {
  createBrowserNativeTargetKey,
  formatBrowserNativeTargetKey,
  isBrowserRuntimeCompatible,
  isCapturedBrowserOwnerCurrent,
} from "./browser-owner-scope.js";
import {
  settleRecoveryOperation,
  stageRecoveryOperation,
} from "./browser-recovery-store.js";
import type {
  BrowserNativeTargetKey,
  BrowserOwnerScope,
  BrowserTargetRuntimeIdentity,
} from "./browser-tab-types.js";

export {
  commitNativeTargetAdmission,
  countRetainedNativeReferences,
  isNativeTargetClosing,
  restoreClosingGatesFromRecovery,
};

export function clearCloseLifecycleForTesting(): void {
  clearClosingGatesForTesting();
  inFlightFinalDeletes.clear();
}

export type BrowserCloseOutcome =
  | { readonly kind: "released"; readonly remoteDeleteIssued: false }
  | { readonly kind: "closed"; readonly remoteDeleteIssued: boolean }
  | { readonly kind: "unknown"; readonly operationId: string; readonly error: string }
  | { readonly kind: "rejected"; readonly error: string };

const inFlightFinalDeletes = new Map<string, Promise<BrowserCloseOutcome>>();

export async function closeBrowserTarget(params: {
  owner: ConnectionRef;
  scope: BrowserOwnerScope;
  sessionId: string;
  windowId: string;
  tabId?: string;
  operationId?: string;
  groupId?: string;
  runtime?: BrowserTargetRuntimeIdentity;
  signal?: AbortSignal;
}): Promise<BrowserCloseOutcome> {
  const targetKey = createBrowserNativeTargetKey(params.scope, params.sessionId);
  if (!targetKey) return { kind: "rejected", error: "Invalid native target parameters" };

  const keyFormatted = formatBrowserNativeTargetKey(targetKey);
  const operationId = params.operationId ?? generateUUID();
  const stageUnknown = () =>
    stageRecoveryOperation({
      operationId,
      ownerScope: params.scope,
      kind: params.tabId ? "close-tab" : "close-window",
      groupId: params.groupId,
      windowId: params.windowId,
      tabId: params.tabId,
      sessionId: params.sessionId,
      status: "unknown",
    }).catch(() => {});

  await stageRecoveryOperation({
    operationId,
    ownerScope: params.scope,
    kind: params.tabId ? "close-tab" : "close-window",
    groupId: params.groupId,
    windowId: params.windowId,
    tabId: params.tabId,
    sessionId: params.sessionId,
    status: "pending",
  });

  const closeDisposition = reserveCloseOrRelease(
    targetKey,
    { windowId: params.windowId, tabId: params.tabId },
    params.runtime,
  );
  if (closeDisposition === "released") {
    await settleRecoveryOperation(operationId);
    return { kind: "released", remoteDeleteIssued: false };
  }

  const existingInFlight = inFlightFinalDeletes.get(keyFormatted);
  if (existingInFlight) {
    const outcome = await existingInFlight;
    if (outcome.kind === "closed" || outcome.kind === "released") {
      await settleRecoveryOperation(operationId);
    }
    return outcome;
  }

  const executeDelete = async (): Promise<BrowserCloseOutcome> => {
    try {
      if (!isCapturedBrowserOwnerCurrent(params.owner, params.scope)) {
        await stageUnknown();
        return { kind: "rejected", error: "Owner or connection generation mismatch" };
      }

      const recheck = countRetainedNativeReferences(targetKey, { windowId: params.windowId, tabId: params.tabId }, params.runtime);
      if (recheck > 0) {
        removeClosingGate(targetKey);
        await settleRecoveryOperation(operationId);
        return { kind: "released", remoteDeleteIssued: false };
      }

      try {
        const live = await getBrowserSession(params.owner, params.sessionId, params.signal);
        if (live.status === "closed") {
          await settleRecoveryOperation(operationId);
          removeClosingGate(targetKey);
          return { kind: "closed", remoteDeleteIssued: false };
        }
        if (params.runtime && !isBrowserRuntimeCompatible(params.runtime, live)) {
          await stageUnknown();
          return { kind: "rejected", error: "Target runtime mismatch: live target was replaced" };
        }
      } catch (getErr: unknown) {
        const status = typeof getErr === "object" && getErr !== null && "status" in getErr && typeof getErr.status === "number"
          ? getErr.status : undefined;
        if (status === 404) {
          await settleRecoveryOperation(operationId);
          removeClosingGate(targetKey);
          return { kind: "closed", remoteDeleteIssued: false };
        }
        await stageUnknown();
        return { kind: "unknown", operationId, error: `Pre-flight check failed: ${String(getErr)}` };
      }

      // Recheck owner currency post-GET before issuing DELETE
      if (!isCapturedBrowserOwnerCurrent(params.owner, params.scope)) {
        await stageUnknown();
        return { kind: "rejected", error: "Owner or connection generation mismatch after preflight GET" };
      }

      try {
        await closeBrowserSession(params.owner, params.sessionId, params.signal);
      } catch (delErr: unknown) {
        const status = typeof delErr === "object" && delErr !== null && "status" in delErr && typeof delErr.status === "number"
          ? delErr.status : undefined;
        if (status === 404) {
          await settleRecoveryOperation(operationId);
          removeClosingGate(targetKey);
          return { kind: "closed", remoteDeleteIssued: true };
        }
        throw delErr;
      }

      await settleRecoveryOperation(operationId);
      removeClosingGate(targetKey);
      return { kind: "closed", remoteDeleteIssued: true };
    } catch (err: unknown) {
      await stageUnknown();
      return { kind: "unknown", operationId, error: err instanceof Error ? err.message : String(err) };
    } finally {
      inFlightFinalDeletes.delete(keyFormatted);
    }
  };

  const promise = executeDelete();
  inFlightFinalDeletes.set(keyFormatted, promise);
  return promise;
}
