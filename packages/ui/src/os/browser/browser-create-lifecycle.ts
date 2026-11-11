import { createBrowserSession } from "@/api/browser-host-client.js";
import type { BrowserSessionDto, CreateSessionRequest } from "@/api/browser-host-types.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { generateUUID } from "@/lib/utils.js";
import { closeBrowserTarget } from "./browser-close-lifecycle.js";
import { isCapturedBrowserOwnerCurrent } from "./browser-owner-scope.js";
import {
  loadBrowserRecoveryDisk,
  settleRecoveryOperation,
  stageRecoveryOperation,
} from "./browser-recovery-store.js";
import type {
  BrowserOwnerScope,
  BrowserTargetRuntimeIdentity,
} from "./browser-tab-types.js";
import { normalizeBrowserCommittedUrl } from "./browser-url-normalization.js";

export type BrowserCreateOutcome =
  | { readonly kind: "success"; readonly session: BrowserSessionDto; readonly adopted: boolean }
  | { readonly kind: "rejected"; readonly status?: number; readonly error: string; readonly capacity?: boolean }
  | { readonly kind: "unknown"; readonly operationId: string; readonly error: string };

interface InFlightCreate {
  readonly operationId: string;
  readonly creationKey: string;
  readonly promise: Promise<BrowserCreateOutcome>;
}

interface WithheldCleanup {
  readonly owner: ConnectionRef;
  readonly scope: BrowserOwnerScope;
  readonly sessionId: string;
  readonly windowId: string;
  readonly operationId: string;
  readonly runtime?: BrowserTargetRuntimeIdentity;
}

const inFlightCreates = new Map<string, InFlightCreate>();
const withheldCleanups: WithheldCleanup[] = [];

export function clearInFlightCreatesForTesting(): void {
  inFlightCreates.clear();
  withheldCleanups.length = 0;
}

export function processWithheldCleanups(currentScope: BrowserOwnerScope, currentOwner: ConnectionRef): void {
  for (let i = withheldCleanups.length - 1; i >= 0; i--) {
    const item = withheldCleanups[i]!;
    if (isCapturedBrowserOwnerCurrent(currentOwner, item.scope)) {
      void closeBrowserTarget({
        owner: currentOwner,
        scope: item.scope,
        sessionId: item.sessionId,
        windowId: item.windowId,
        operationId: item.operationId,
        runtime: item.runtime,
      }).then((outcome) => {
        if (outcome.kind === "closed" || outcome.kind === "released") {
          const idx = withheldCleanups.indexOf(item);
          if (idx >= 0) withheldCleanups.splice(idx, 1);
          void settleRecoveryOperation(item.operationId).catch(() => {});
        }
      });
    }
  }
}

export function dispatchBrowserCreateIntent(params: {
  owner: ConnectionRef;
  scope: BrowserOwnerScope;
  windowId: string;
  tabId: string;
  actionSequence: number;
  url: string;
  viewport?: { width: number; height: number; dpr: number };
  isTabCurrent: () => boolean;
  onLateCleanup?: (scope: BrowserOwnerScope, sessionId: string) => void;
  signal?: AbortSignal;
}): Promise<BrowserCreateOutcome> {
  const intentKey = JSON.stringify([params.owner.profileId, params.owner.generation, params.windowId, params.tabId, params.actionSequence]);
  const existing = inFlightCreates.get(intentKey);
  if (existing) return existing.promise;

  const committedUrl = normalizeBrowserCommittedUrl(params.url);
  if (!committedUrl) return Promise.resolve({ kind: "rejected", error: "Invalid URL for target creation" });

  const operationId = generateUUID();
  const creationKey = generateUUID();
  const request: CreateSessionRequest = Object.freeze({
    creationKey,
    url: committedUrl,
    viewport: Object.freeze(params.viewport ? { ...params.viewport } : { width: 1280, height: 800, dpr: 1 }),
  });

  const execute = async (): Promise<BrowserCreateOutcome> => {
    try {
      await stageRecoveryOperation({
        operationId,
        ownerScope: params.scope,
        kind: "create",
        windowId: params.windowId,
        tabId: params.tabId,
        status: "pending",
      });

      if (!isCapturedBrowserOwnerCurrent(params.owner, params.scope)) {
        await settleRecoveryOperation(operationId).catch(() => {});
        return { kind: "rejected", error: "Owner or connection generation expired during lock acquisition" };
      }

      const session = await createBrowserSession(params.owner, request, params.signal);
      const ownerStillCurrent = isCapturedBrowserOwnerCurrent(params.owner, params.scope);
      const tabStillCurrent = params.isTabCurrent();

      if (ownerStillCurrent && tabStillCurrent) {
        await settleRecoveryOperation(operationId);
        if (isCapturedBrowserOwnerCurrent(params.owner, params.scope) && params.isTabCurrent()) {
          return { kind: "success", session, adopted: true };
        }
      }

      // Late create: tab closed/replaced. Retain durable marker preserving groupId until cleanup finishes.
      const currentDisk = loadBrowserRecoveryDisk();
      const existingOp = currentDisk.operations.find((o) => o.operationId === operationId);
      const groupId = existingOp?.groupId;
      const runtimeIdentity = { browserIncarnation: session.browserIncarnation, profileEpoch: session.profileEpoch };

      await stageRecoveryOperation({
        operationId,
        ownerScope: params.scope,
        kind: "close-tab",
        groupId,
        windowId: params.windowId,
        tabId: params.tabId,
        sessionId: session.browserSessionId,
        status: ownerStillCurrent ? "pending" : "unknown",
      }).catch(() => {});

      if (ownerStillCurrent) {
        const cleanupRes = await closeBrowserTarget({
          owner: params.owner,
          scope: params.scope,
          sessionId: session.browserSessionId,
          windowId: params.windowId,
          tabId: params.tabId,
          operationId,
          groupId,
          runtime: runtimeIdentity,
        });
        if (cleanupRes.kind === "closed" || cleanupRes.kind === "released") {
          await settleRecoveryOperation(operationId).catch(() => {});
        }
      } else {
        withheldCleanups.push({
          owner: params.owner,
          scope: params.scope,
          sessionId: session.browserSessionId,
          windowId: params.windowId,
          operationId,
          runtime: runtimeIdentity,
        });
      }

      params.onLateCleanup?.(params.scope, session.browserSessionId);
      return { kind: "success", session, adopted: false };
    } catch (err: unknown) {
      const status = typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
        ? err.status : undefined;

      if (status !== undefined && status >= 400 && status < 500) {
        await settleRecoveryOperation(operationId).catch(() => {});
        return { kind: "rejected", status, error: err instanceof Error ? err.message : String(err), capacity: status === 429 };
      }

      const currentDisk = loadBrowserRecoveryDisk();
      const existingOp = currentDisk.operations.find((o) => o.operationId === operationId);

      await stageRecoveryOperation({
        operationId,
        ownerScope: params.scope,
        kind: "create",
        groupId: existingOp?.groupId,
        windowId: params.windowId,
        tabId: params.tabId,
        status: "unknown",
      }).catch(() => {});

      return { kind: "unknown", operationId, error: err instanceof Error ? err.message : String(err) };
    } finally {
      inFlightCreates.delete(intentKey);
    }
  };

  const promise = execute();
  inFlightCreates.set(intentKey, { operationId, creationKey, promise });
  return promise;
}
