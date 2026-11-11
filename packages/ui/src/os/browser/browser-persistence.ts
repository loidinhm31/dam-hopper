import { generateUUID } from "@/lib/utils.js";
import { normalizeBrowserEndpoint } from "./browser-owner-scope.js";
import {
  BROWSER_STATE_VERSION,
  MAX_BROWSER_METADATA_BYTES,
  type BrowserOwnerScope,
  type BrowserPortableTabDisk,
  type BrowserPortableWindowDisk,
  type BrowserTabDisk,
  type BrowserTabKind,
  type BrowserTabPhase,
  type BrowserTabRuntime,
  type BrowserWindowDisk,
  type BrowserWindowState,
} from "./browser-tab-types.js";
import {
  normalizeBrowserCommittedUrl,
  resolveActiveTabId,
} from "./browser-url-normalization.js";

export { createRememberedBrowserGroup } from "./browser-group-projection.js";
export { MAX_BROWSER_METADATA_BYTES, normalizeBrowserCommittedUrl };

/** Project runtime window state for disk persistence or portable/recipe export. */
export function projectBrowserWindowState(
  state: BrowserWindowState,
  mode: "local" | "portable" | "recipe",
): BrowserWindowDisk | BrowserPortableWindowDisk {
  const ordinaryTabs = state.tabs.filter((t) => t.kind !== "popup");
  const activeTabId = resolveActiveTabId(ordinaryTabs, state.tabs, state.activeTabId);

  if (mode === "local") {
    const tabs: BrowserTabDisk[] = ordinaryTabs.map((t) => {
      const committedUrl = normalizeBrowserCommittedUrl(t.committedUrl);
      const sessionId = typeof t.sessionId === "string" && t.sessionId.trim() ? t.sessionId : undefined;
      return { tabId: t.tabId, ...(committedUrl ? { committedUrl } : {}), ...(sessionId ? { sessionId } : {}) };
    });
    const result: BrowserWindowDisk = {
      browserStateVersion: BROWSER_STATE_VERSION,
      ...(state.ownerScope ? { ownerScope: state.ownerScope } : {}),
      tabs: tabs.length > 0 ? tabs : [{ tabId: activeTabId }],
      activeTabId,
    };
    if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_BROWSER_METADATA_BYTES) {
      throw new Error(`Projected browser metadata exceeds limit of ${MAX_BROWSER_METADATA_BYTES} bytes`);
    }
    return result;
  }

  const tabs: BrowserPortableTabDisk[] = ordinaryTabs.map((t) => {
    const committedUrl = normalizeBrowserCommittedUrl(t.committedUrl);
    return { tabId: t.tabId, ...(committedUrl ? { committedUrl } : {}) };
  });
  const portableResult: BrowserPortableWindowDisk = {
    browserStateVersion: BROWSER_STATE_VERSION,
    tabs: tabs.length > 0 ? tabs : [{ tabId: activeTabId }],
    activeTabId,
  };
  if (new TextEncoder().encode(JSON.stringify(portableResult)).length > MAX_BROWSER_METADATA_BYTES) {
    throw new Error(`Projected browser metadata exceeds limit of ${MAX_BROWSER_METADATA_BYTES} bytes`);
  }
  return portableResult;
}

export interface ParseBrowserDiskResult {
  readonly valid: boolean;
  readonly state?: BrowserWindowState;
  readonly error?: string;
}

/** Parse and validate persisted or imported Browser window disk bytes/object. */
export function parseBrowserWindowDisk(
  raw: unknown,
  mode: "local" | "import" | "recipe",
): ParseBrowserDiskResult {
  if (!raw || typeof raw !== "object") {
    return { valid: false, error: "Browser state must be an object" };
  }
  const serialized = JSON.stringify(raw);
  if (new TextEncoder().encode(serialized).length > MAX_BROWSER_METADATA_BYTES) {
    return { valid: false, error: `Browser metadata exceeds limit of ${MAX_BROWSER_METADATA_BYTES} bytes` };
  }

  const obj = raw as Record<string, unknown>;

  // Legacy flat schema conversion: { url?, sessionId?, logicalSessionId?, presentation? }
  if (obj.browserStateVersion === undefined && (obj.url !== undefined || obj.sessionId !== undefined)) {
    const committedUrl = normalizeBrowserCommittedUrl(obj.url);
    const tabId = generateUUID();
    return {
      valid: true,
      state: {
        browserStateVersion: BROWSER_STATE_VERSION,
        tabs: [{
          tabId,
          kind: "ordinary",
          ...(committedUrl ? { committedUrl } : {}),
          phase: committedUrl ? "unavailable" : "new-tab",
          draft: { value: committedUrl ?? "", dirty: false },
          actionSequence: 0,
        }],
        activeTabId: tabId,
      },
    };
  }

  if (obj.browserStateVersion !== BROWSER_STATE_VERSION) {
    return { valid: false, error: `Unsupported browserStateVersion: ${String(obj.browserStateVersion)}` };
  }

  if (!Array.isArray(obj.tabs) || obj.tabs.length === 0) {
    return { valid: false, error: "Browser window disk state must contain at least one tab" };
  }

  const seenIds = new Set<string>();
  const idMap = new Map<string, string>();
  const runtimeTabs: BrowserTabRuntime[] = [];

  for (const rawTab of obj.tabs) {
    if (!rawTab || typeof rawTab !== "object") continue;
    const tabObj = rawTab as Record<string, unknown>;
    const rawTabId = typeof tabObj.tabId === "string" && tabObj.tabId.trim() ? tabObj.tabId : generateUUID();
    const tabId = mode === "import" ? generateUUID() : seenIds.has(rawTabId) ? generateUUID() : rawTabId;
    seenIds.add(tabId);
    idMap.set(rawTabId, tabId);

    const kind: BrowserTabKind = tabObj.kind === "popup" ? "popup" : "ordinary";
    const parentTabId = typeof tabObj.parentTabId === "string" ? tabObj.parentTabId : undefined;
    const committedUrl = normalizeBrowserCommittedUrl(tabObj.committedUrl);
    const sessionId = mode === "local" && typeof tabObj.sessionId === "string" && tabObj.sessionId.trim()
      ? tabObj.sessionId
      : undefined;

    const phase: BrowserTabPhase = sessionId && mode === "local"
      ? "connecting"
      : committedUrl
        ? "unavailable"
        : "new-tab";

    runtimeTabs.push({
      tabId,
      kind,
      ...(parentTabId ? { parentTabId } : {}),
      ...(committedUrl ? { committedUrl } : {}),
      ...(sessionId ? { sessionId } : {}),
      phase,
      draft: { value: committedUrl ?? "", dirty: false },
      actionSequence: 0,
    });
  }

  if (runtimeTabs.length === 0) {
    const blankId = generateUUID();
    runtimeTabs.push({
      tabId: blankId,
      kind: "ordinary",
      phase: "new-tab",
      draft: { value: "", dirty: false },
      actionSequence: 0,
    });
  }

  let activeTabId = typeof obj.activeTabId === "string" ? obj.activeTabId : runtimeTabs[0]!.tabId;
  if (mode === "import" && idMap.has(activeTabId)) {
    activeTabId = idMap.get(activeTabId)!;
  } else if (!runtimeTabs.some((t) => t.tabId === activeTabId)) {
    activeTabId = runtimeTabs[0]!.tabId;
  }

  let ownerScope: BrowserOwnerScope | undefined;
  if (mode === "local" && obj.ownerScope && typeof obj.ownerScope === "object") {
    const s = obj.ownerScope as Record<string, unknown>;
    const endpoint = typeof s.endpoint === "string" ? normalizeBrowserEndpoint(s.endpoint) : "";
    if (
      typeof s.profileId === "string" && s.profileId.trim() &&
      endpoint &&
      typeof s.principal === "string" && s.principal.trim() &&
      (s.namespace === "prod" || s.namespace === "dev")
    ) {
      ownerScope = Object.freeze({
        profileId: s.profileId,
        endpoint,
        principal: s.principal,
        namespace: s.namespace,
      });
    }
  }

  return {
    valid: true,
    state: {
      browserStateVersion: BROWSER_STATE_VERSION,
      ...(ownerScope ? { ownerScope } : {}),
      tabs: runtimeTabs,
      activeTabId,
    },
  };
}
