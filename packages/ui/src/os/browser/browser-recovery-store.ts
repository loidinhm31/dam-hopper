import { areBrowserOwnerScopesEqual } from "./browser-owner-scope.js";
import { validateBrowserRecoveryDisk } from "./browser-recovery-validation.js";
import type { OsWindow } from "../types.js";
import { useWindowStore } from "../window-store.js";
import {
  BROWSER_RECOVERY_VERSION,
  MAX_BROWSER_METADATA_BYTES,
  type BrowserOwnerScope,
  type BrowserRecoveryDisk,
  type BrowserRecoveryOperation,
  type RememberedBrowserGroup,
} from "./browser-tab-types.js";

export const BROWSER_RECOVERY_STORAGE_KEY = "dam-hopper:browser:v1:recovery";
export const BROWSER_RECOVERY_LOCK_KEY = "dam-hopper:browser:v1:recovery-lock";

/** Origin-wide exclusive Web Lock for browser recovery & address writes. */
export async function withBrowserRecoveryLock<T>(fn: () => Promise<T> | T): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks || typeof navigator.locks.request !== "function") {
    throw new Error("Web Locks API is unavailable: browser recovery mutation blocked fail-closed");
  }
  return navigator.locks.request(BROWSER_RECOVERY_LOCK_KEY, { mode: "exclusive" }, async () => {
    return await fn();
  });
}

export function createEmptyBrowserRecoveryDisk(): BrowserRecoveryDisk {
  return {
    version: BROWSER_RECOVERY_VERSION,
    groups: [],
    addressSuppressedScopes: [],
    operations: [],
  };
}

export function loadBrowserRecoveryDisk(): BrowserRecoveryDisk {
  if (typeof localStorage === "undefined") return createEmptyBrowserRecoveryDisk();
  const raw = localStorage.getItem(BROWSER_RECOVERY_STORAGE_KEY);
  if (!raw) return createEmptyBrowserRecoveryDisk();
  if (new TextEncoder().encode(raw).length > MAX_BROWSER_METADATA_BYTES) {
    throw new Error(`Browser recovery metadata exceeds limit of ${MAX_BROWSER_METADATA_BYTES} bytes`);
  }

  const parsed: unknown = JSON.parse(raw);
  return validateBrowserRecoveryDisk(parsed);
}

export function saveBrowserRecoveryDisk(disk: BrowserRecoveryDisk): void {
  if (typeof localStorage === "undefined") return;
  const serialized = JSON.stringify(disk);
  if (new TextEncoder().encode(serialized).length > MAX_BROWSER_METADATA_BYTES) {
    throw new Error(`Browser recovery metadata exceeds limit of ${MAX_BROWSER_METADATA_BYTES} bytes`);
  }
  localStorage.setItem(BROWSER_RECOVERY_STORAGE_KEY, serialized);
}

export function isOwnerAddressSuppressed(scope: BrowserOwnerScope, disk?: BrowserRecoveryDisk): boolean {
  const current = disk ?? loadBrowserRecoveryDisk();
  return current.addressSuppressedScopes.some((s) => areBrowserOwnerScopesEqual(s, scope));
}

/** Stage an in-flight operation and optional closed-window group under the recovery lock. */
export async function stageRecoveryOperation(
  op: BrowserRecoveryOperation,
  group?: RememberedBrowserGroup | null,
): Promise<void> {
  await withBrowserRecoveryLock(() => {
    const disk = loadBrowserRecoveryDisk();
    const otherOps = disk.operations.filter((o) => o.operationId !== op.operationId);
    let nextGroups = [...disk.groups];

    // Enforce suppression: do not stage remembered group for address-suppressed owner
    if (group && !isOwnerAddressSuppressed(group.ownerScope, disk)) {
      nextGroups = nextGroups.filter((g) => !areBrowserOwnerScopesEqual(g.ownerScope, group.ownerScope));
      nextGroups.push(group);
    }

    // Associate pending creates with staged close-group
    const updatedOps = otherOps.map((existingOp) => {
      if (
        op.kind === "close-window" &&
        op.groupId &&
        existingOp.windowId === op.windowId &&
        existingOp.kind === "create" &&
        !existingOp.groupId
      ) {
        return { ...existingOp, groupId: op.groupId };
      }
      return existingOp;
    });

    saveBrowserRecoveryDisk({
      ...disk,
      groups: nextGroups,
      operations: [...updatedOps, op],
    });
  });
}

function readWindowClosingState(win: OsWindow | undefined): { operationId?: string; status?: string } | null {
  if (!win || win.appId !== "browser" || !win.appState || typeof win.appState !== "object") return null;
  if (!("closing" in win.appState) || !win.appState.closing || typeof win.appState.closing !== "object") return null;
  const closing = win.appState.closing;
  const operationId = "operationId" in closing && typeof closing.operationId === "string" ? closing.operationId : undefined;
  const status = "status" in closing && typeof closing.status === "string" ? closing.status : undefined;
  return status ? { operationId, status } : null;
}

export interface SettleRecoveryAuthorizedOptions {
  operationIds: readonly string[];
  expectedScope: BrowserOwnerScope;
  skipActiveClosingWindows?: boolean;
  allowUnknownClosingForWindowId?: string;
  shouldSettle?: (op: BrowserRecoveryOperation) => boolean;
}

/**
 * Proven-completion settlement: removes an operation whose remote close/create outcome was already
 * proven complete (intentionally permitted while a coordinator's window still carries closing="pending").
 * Enforces expectedScope and optional shouldSettle inside the recovery Web Lock.
 */
export async function settleProvenRecoveryOperation(
  operationId: string,
  expectedScope: BrowserOwnerScope,
  shouldSettle?: () => boolean,
): Promise<boolean> {
  return await withBrowserRecoveryLock(() => {
    if (shouldSettle && !shouldSettle()) return false;
    const disk = loadBrowserRecoveryDisk();
    let removed = false;
    const remainingOps = disk.operations.filter((o) => {
      if (o.operationId === operationId && areBrowserOwnerScopesEqual(o.ownerScope, expectedScope)) {
        removed = true;
        return false;
      }
      return true;
    });
    if (removed) {
      saveBrowserRecoveryDisk({
        ...disk,
        operations: remainingOps,
      });
    }
    return removed;
  });
}

/** Legacy/test wrapper for proven-completion singular settlement; production callers should pass expectedScope. */
export async function settleRecoveryOperation(
  operationId: string,
  expectedScope?: BrowserOwnerScope,
): Promise<void> {
  if (expectedScope) {
    await settleProvenRecoveryOperation(operationId, expectedScope);
    return;
  }
  await withBrowserRecoveryLock(() => {
    const disk = loadBrowserRecoveryDisk();
    const remainingOps = disk.operations.filter((o) => o.operationId !== operationId);
    saveBrowserRecoveryDisk({
      ...disk,
      operations: remainingOps,
    });
  });
}

/** Guarded user-dismissal settlement: atomically verifies owner scope and blocks active pending closes inside the lock. */
export async function settleRecoveryOperationsIfAuthorized(
  options: SettleRecoveryAuthorizedOptions,
): Promise<BrowserRecoveryOperation[]> {
  return await withBrowserRecoveryLock(() => {
    const disk = loadBrowserRecoveryDisk();
    const idSet = new Set(options.operationIds);
    const windows = useWindowStore.getState().session?.windows ?? {};
    const pendingClosingOpIds = new Set<string>();
    for (const w of Object.values(windows)) {
      const closing = readWindowClosingState(w);
      if (closing?.status === "pending" && closing.operationId) {
        pendingClosingOpIds.add(closing.operationId);
      }
    }
    const settled: BrowserRecoveryOperation[] = [];
    const remainingOps: BrowserRecoveryOperation[] = [];
    for (const op of disk.operations) {
      if (!idSet.has(op.operationId)) {
        remainingOps.push(op);
        continue;
      }
      if (!areBrowserOwnerScopesEqual(op.ownerScope, options.expectedScope)) {
        remainingOps.push(op);
        continue;
      }
      if (pendingClosingOpIds.has(op.operationId)) {
        remainingOps.push(op);
        continue;
      }
      const opWindowClosing = readWindowClosingState(windows[op.windowId]);
      if (opWindowClosing) {
        if (opWindowClosing.status === "pending") {
          remainingOps.push(op);
          continue;
        }
        if (
          options.skipActiveClosingWindows ||
          options.allowUnknownClosingForWindowId !== op.windowId
        ) {
          remainingOps.push(op);
          continue;
        }
      }
      if (options.shouldSettle && !options.shouldSettle(op)) {
        remainingOps.push(op);
        continue;
      }
      settled.push(op);
    }
    if (settled.length > 0) {
      saveBrowserRecoveryDisk({
        ...disk,
        operations: remainingOps,
      });
    }
    return settled;
  });
}

/** Atomically consume an eligible remembered group, blocking on suppression or pending/unknown closures. */
export async function consumeRememberedBrowserGroup(
  ownerScope: BrowserOwnerScope,
): Promise<RememberedBrowserGroup | null> {
  return await withBrowserRecoveryLock(() => {
    const disk = loadBrowserRecoveryDisk();
    if (isOwnerAddressSuppressed(ownerScope, disk)) return null;

    const targetGroup = disk.groups.find((g) => areBrowserOwnerScopesEqual(g.ownerScope, ownerScope));
    if (!targetGroup) return null;
    // Block automatic restore ONLY if an operation affects this specific group
    const isBlocked = disk.operations.some((op) => {
      if (!areBrowserOwnerScopesEqual(op.ownerScope, ownerScope)) return false;
      if (op.groupId && op.groupId === targetGroup.groupId) {
        return op.status === "pending" || op.status === "unknown";
      }
      return false;
    });
    if (isBlocked) return null;

    const remainingGroups = disk.groups.filter((g) => g.groupId !== targetGroup.groupId);
    saveBrowserRecoveryDisk({
      ...disk,
      groups: remainingGroups,
    });
    return targetGroup;
  });
}

/** Clear remembered pages: persist suppression first, then strip OS addresses under the same lock. */
export async function clearRememberedPagesAndSuppress(
  ownerScope: BrowserOwnerScope,
  stripOsAddressesFn: () => Promise<void> | void,
): Promise<{ success: boolean; error?: string }> {
  return await withBrowserRecoveryLock(async () => {
    const disk = loadBrowserRecoveryDisk();
    const alreadySuppressed = disk.addressSuppressedScopes.some((s) => areBrowserOwnerScopesEqual(s, ownerScope));
    const nextSuppressed = alreadySuppressed
      ? disk.addressSuppressedScopes
      : [...disk.addressSuppressedScopes, ownerScope];
    const nextGroups = disk.groups.filter((g) => !areBrowserOwnerScopesEqual(g.ownerScope, ownerScope));

    saveBrowserRecoveryDisk({
      ...disk,
      groups: nextGroups,
      addressSuppressedScopes: nextSuppressed,
    });

    try {
      await stripOsAddressesFn();
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: `Address suppression persisted, but OS address rewrite failed: ${String(err)}`,
      };
    }
  });
}

/** Reset address suppression for an explicit user submission or supported URL launch. */
export async function resetAddressSuppression(ownerScope: BrowserOwnerScope): Promise<void> {
  await withBrowserRecoveryLock(() => {
    const disk = loadBrowserRecoveryDisk();
    const nextSuppressed = disk.addressSuppressedScopes.filter((s) => !areBrowserOwnerScopesEqual(s, ownerScope));
    saveBrowserRecoveryDisk({
      ...disk,
      addressSuppressedScopes: nextSuppressed,
    });
  });
}
