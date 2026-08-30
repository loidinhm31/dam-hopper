import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";

/** A missing tab is not a valid close target; pinned tabs are protected. */
export function isTerminalTabClosable(
  tabs: readonly TabEntry[],
  sessionId: string,
): boolean {
  const tab = tabs.find((candidate) => candidate.sessionId === sessionId);
  return tab !== undefined && tab.isPinned !== true;
}

/** Prefer a caller-supplied target, preserving the legacy global fallback. */
export function resolveTerminalCloseFallback(
  tabs: readonly Pick<TabEntry, "sessionId">[],
  preferredSessionId?: string,
): string | null {
  if (
    preferredSessionId &&
    tabs.some((tab) => tab.sessionId === preferredSessionId)
  ) {
    return preferredSessionId;
  }
  return tabs.at(-1)?.sessionId ?? null;
}
