import { generateUUID } from "@/lib/utils.js";
import {
  BROWSER_RECOVERY_VERSION,
  type BrowserOwnerScope,
  type BrowserWindowState,
  type RememberedBrowserGroup,
} from "./browser-tab-types.js";
import {
  normalizeBrowserCommittedUrl,
  resolveActiveTabId,
} from "./browser-url-normalization.js";

/** Create a remembered closed-window group for explicit owner-scoped default restore. */
export function createRememberedBrowserGroup(
  ownerScope: BrowserOwnerScope,
  state: BrowserWindowState,
  groupId: string = generateUUID(),
): RememberedBrowserGroup | null {
  const ordinaryTabs = state.tabs.filter((t) => t.kind !== "popup");
  const activeTabId = resolveActiveTabId(ordinaryTabs, state.tabs, state.activeTabId);
  const validAddresses: string[] = [];
  let activeIndex = 0;

  ordinaryTabs.forEach((tab) => {
    const normalized = normalizeBrowserCommittedUrl(tab.committedUrl);
    if (normalized) {
      if (tab.tabId === activeTabId) activeIndex = validAddresses.length;
      validAddresses.push(normalized);
    }
  });

  if (validAddresses.length === 0) return null;

  return {
    version: BROWSER_RECOVERY_VERSION,
    groupId,
    ownerScope,
    addresses: validAddresses,
    activeIndex: Math.min(activeIndex, validAddresses.length - 1),
  };
}
