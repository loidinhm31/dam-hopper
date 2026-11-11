import {
  createBrowserNativeTargetKey,
  formatBrowserNativeTargetKey,
} from "./browser-owner-scope.js";
import { loadBrowserRecoveryDisk } from "./browser-recovery-store.js";
import type {
  BrowserNativeTargetKey,
  BrowserRecoveryDisk,
} from "./browser-tab-types.js";

const closingTargetGates = new Set<string>();

export function isNativeTargetClosing(key: BrowserNativeTargetKey): boolean {
  return closingTargetGates.has(formatBrowserNativeTargetKey(key));
}

export function addClosingGate(key: BrowserNativeTargetKey): void {
  closingTargetGates.add(formatBrowserNativeTargetKey(key));
}

export function removeClosingGate(key: BrowserNativeTargetKey): void {
  closingTargetGates.delete(formatBrowserNativeTargetKey(key));
}

export function restoreClosingGatesFromRecovery(disk?: BrowserRecoveryDisk): void {
  try {
    const current = disk ?? loadBrowserRecoveryDisk();
    closingTargetGates.clear();
    for (const op of current.operations) {
      if ((op.kind === "close-tab" || op.kind === "close-window") && op.sessionId) {
        const key = createBrowserNativeTargetKey(op.ownerScope, op.sessionId);
        if (key) closingTargetGates.add(formatBrowserNativeTargetKey(key));
      }
    }
  } catch {}
}

export function clearClosingGatesForTesting(): void {
  closingTargetGates.clear();
}
