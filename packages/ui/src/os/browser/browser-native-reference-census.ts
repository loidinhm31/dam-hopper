import { useWindowStore } from "../window-store.js";
import {
  areBrowserNativeTargetKeysEqual,
  createBrowserNativeTargetKey,
  isBrowserRuntimeCompatible,
} from "./browser-owner-scope.js";
import type {
  BrowserNativeTargetKey,
  BrowserTargetRuntimeIdentity,
  BrowserWindowState,
} from "./browser-tab-types.js";

/** Count retained same-client native references across windows & profile IDs. */
export function countRetainedNativeReferences(
  targetKey: BrowserNativeTargetKey,
  exclude?: { windowId: string; tabId?: string },
  runtime?: BrowserTargetRuntimeIdentity,
): number {
  const windows = useWindowStore.getState().session.windows;
  let count = 0;

  for (const win of Object.values(windows)) {
    if (win.appId !== "browser" || !win.appState) continue;
    const appState = win.appState as BrowserWindowState | { sessionId?: string };

    if ("tabs" in appState && Array.isArray(appState.tabs)) {
      const scope = appState.ownerScope;
      if (!scope) continue;
      for (const tab of appState.tabs) {
        if (exclude && win.id === exclude.windowId && tab.tabId === exclude.tabId) continue;
        if (!tab.sessionId || tab.phase === "closing" || tab.phase === "close-unknown") continue;
        const candidateKey = createBrowserNativeTargetKey(scope, tab.sessionId);
        if (
          candidateKey &&
          areBrowserNativeTargetKeysEqual(candidateKey, targetKey) &&
          isBrowserRuntimeCompatible(runtime, tab.snapshot)
        ) {
          count++;
        }
      }
    } else if ("sessionId" in appState && typeof appState.sessionId === "string") {
      if (exclude && win.id === exclude.windowId) continue;
      if (appState.sessionId === targetKey.sessionId) {
        count++;
      }
    }
  }

  return count;
}
