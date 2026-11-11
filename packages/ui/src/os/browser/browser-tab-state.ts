import { generateUUID } from "@/lib/utils.js";
import {
  BROWSER_STATE_VERSION,
  type BrowserOwnerScope,
  type BrowserTabKind,
  type BrowserTabRuntime,
  type BrowserWindowState,
} from "./browser-tab-types.js";

/** Unambiguous tuple identity for viewer slots, claims, and audio/focus registries. */
export function browserTabSlotKey(windowId: string, tabId: string): string {
  return JSON.stringify([windowId, tabId]);
}

export function parseBrowserTabSlotKey(key: string): { windowId: string; tabId: string } | null {
  try {
    const parsed: unknown = JSON.parse(key);
    if (
      Array.isArray(parsed) && parsed.length === 2 &&
      typeof parsed[0] === "string" && typeof parsed[1] === "string" &&
      parsed[0].length > 0 && parsed[1].length > 0
    ) {
      return { windowId: parsed[0], tabId: parsed[1] };
    }
  } catch {
    // malformed key
  }
  return null;
}

function requireNonEmptyTabId(tabId: string): string {
  if (typeof tabId !== "string" || tabId.trim().length === 0) {
    throw new Error("Browser tabId must be a non-empty string");
  }
  return tabId;
}
export function createBlankBrowserTab(options?: {
  tabId?: string;
  kind?: BrowserTabKind;
  draftValue?: string;
  dirty?: boolean;
}): BrowserTabRuntime {
  const tabId = options?.tabId !== undefined ? requireNonEmptyTabId(options.tabId) : generateUUID();
  const draftValue = options?.draftValue ?? "";
  return {
    tabId,
    kind: options?.kind ?? "ordinary",
    phase: "new-tab",
    draft: {
      value: draftValue,
      dirty: options?.dirty ?? draftValue.length > 0,
    },
    actionSequence: 0,
  };
}

export function createInitialBrowserWindowState(options?: {
  ownerScope?: BrowserOwnerScope;
  tabs?: readonly BrowserTabRuntime[];
  activeTabId?: string;
  restoreGroupId?: string;
}): BrowserWindowState {
  const seen = new Set<string>();
  const dedupedTabs: BrowserTabRuntime[] = [];
  for (const tab of options?.tabs ?? []) {
    if (typeof tab.tabId !== "string" || !tab.tabId.trim() || seen.has(tab.tabId)) continue;
    seen.add(tab.tabId);
    dedupedTabs.push(tab);
  }
  const tabs = dedupedTabs.length > 0 ? dedupedTabs : [createBlankBrowserTab()];
  const activeTabId = options?.activeTabId && tabs.some((t) => t.tabId === options.activeTabId)
    ? options.activeTabId
    : tabs[0]!.tabId;

  return {
    browserStateVersion: BROWSER_STATE_VERSION,
    ...(options?.ownerScope ? { ownerScope: options.ownerScope } : {}),
    tabs,
    activeTabId,
    ...(options?.restoreGroupId ? { restoreGroupId: options.restoreGroupId } : {}),
  };
}

export function findBrowserTab(
  state: BrowserWindowState,
  tabId: string,
): BrowserTabRuntime | undefined {
  return state.tabs.find((t) => t.tabId === tabId);
}

export function getActiveBrowserTab(state: BrowserWindowState): BrowserTabRuntime {
  return state.tabs.find((t) => t.tabId === state.activeTabId) ?? state.tabs[0]!;
}

export function selectBrowserTab(
  state: BrowserWindowState,
  tabId: string,
): BrowserWindowState {
  if (state.activeTabId === tabId || !state.tabs.some((t) => t.tabId === tabId)) {
    return state;
  }
  return { ...state, activeTabId: tabId };
}

export function addBrowserTab(
  state: BrowserWindowState,
  options?: { tab?: BrowserTabRuntime; afterTabId?: string; activate?: boolean },
): { state: BrowserWindowState; tab: BrowserTabRuntime } {
  const tab = options?.tab ?? createBlankBrowserTab();
  requireNonEmptyTabId(tab.tabId);
  if (state.tabs.some((existing) => existing.tabId === tab.tabId)) {
    throw new Error(`Duplicate browser tabId: ${tab.tabId}`);
  }
  const nextTabs = [...state.tabs];
  const insertAfter = options?.afterTabId
    ? nextTabs.findIndex((t) => t.tabId === options.afterTabId)
    : -1;
  if (insertAfter >= 0) {
    nextTabs.splice(insertAfter + 1, 0, tab);
  } else {
    nextTabs.push(tab);
  }
  const activate = options?.activate ?? true;
  return {
    tab,
    state: {
      ...state,
      tabs: nextTabs,
      activeTabId: activate ? tab.tabId : state.activeTabId,
    },
  };
}

export function removeBrowserTab(
  state: BrowserWindowState,
  tabId: string,
  options?: { preferredActiveTabId?: string; replacementBlankTabId?: string },
): BrowserWindowState {
  const removedIndex = state.tabs.findIndex((t) => t.tabId === tabId);
  if (removedIndex < 0) return state;

  const remaining = state.tabs.filter((t) => t.tabId !== tabId);
  if (remaining.length === 0) {
    const blankTab = createBlankBrowserTab({ tabId: options?.replacementBlankTabId });
    return { ...state, tabs: [blankTab], activeTabId: blankTab.tabId };
  }

  let nextActiveTabId = state.activeTabId;
  if (state.activeTabId === tabId) {
    const preferred =
      options?.preferredActiveTabId &&
      remaining.some((t) => t.tabId === options.preferredActiveTabId)
        ? options.preferredActiveTabId
        : undefined;
    nextActiveTabId =
      preferred ?? remaining[Math.min(removedIndex, remaining.length - 1)]!.tabId;
  } else if (!remaining.some((t) => t.tabId === nextActiveTabId)) {
    nextActiveTabId = remaining[0]!.tabId;
  }

  return { ...state, tabs: remaining, activeTabId: nextActiveTabId };
}

export function patchBrowserTab(
  state: BrowserWindowState,
  tabId: string,
  updater:
    | Partial<Omit<BrowserTabRuntime, "tabId">>
    | ((tab: BrowserTabRuntime) => BrowserTabRuntime),
): BrowserWindowState {
  const index = state.tabs.findIndex((t) => t.tabId === tabId);
  if (index < 0) return state;

  const current = state.tabs[index]!;
  const updated =
    typeof updater === "function"
      ? { ...updater(current), tabId: current.tabId }
      : { ...current, ...updater, tabId: current.tabId };
  const nextTabs = [...state.tabs];
  nextTabs[index] = updated;
  return { ...state, tabs: nextTabs };
}

export function setBrowserTabDraft(
  state: BrowserWindowState,
  tabId: string,
  value: string,
  dirty?: boolean,
): BrowserWindowState {
  return patchBrowserTab(state, tabId, (tab) => ({
    ...tab,
    draft: {
      value,
      dirty: dirty ?? value !== (tab.committedUrl ?? ""),
    },
  }));
}
