import {
  createBrowserNativeTargetKey,
} from "./browser-owner-scope.js";
import {
  addClosingGate,
  isNativeTargetClosing,
} from "./browser-closing-gates.js";
import { countRetainedNativeReferences } from "./browser-native-reference-census.js";
import type {
  BrowserNativeTargetKey,
  BrowserOwnerScope,
  BrowserTargetRuntimeIdentity,
} from "./browser-tab-types.js";

/**
 * Synchronous atomic admission commit.
 * Checks whether the target is in a closing gate; if not, executes the commit
 * callback synchronously, preventing any race between checking and attaching.
 */
export function commitNativeTargetAdmission(
  scope: BrowserOwnerScope,
  sessionId: string,
  commit: () => void,
): boolean {
  const key = createBrowserNativeTargetKey(scope, sessionId);
  if (!key || isNativeTargetClosing(key)) {
    return false;
  }
  commit();
  return true;
}

/**
 * Synchronous atomic reference release and final-close reservation.
 * Releases the initiating view's reference and checks remaining census;
 * if no references remain, reserves the closing gate under the same synchronous execution.
 */
export function reserveCloseOrRelease(
  targetKey: BrowserNativeTargetKey,
  exclude: { windowId: string; tabId?: string },
  runtime?: BrowserTargetRuntimeIdentity,
): "released" | "final-close-reserved" {
  const remaining = countRetainedNativeReferences(targetKey, exclude, runtime);
  if (remaining > 0) {
    return "released";
  }
  addClosingGate(targetKey);
  return "final-close-reserved";
}
