import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";

/** A missing tab is not a valid close target; pinned tabs are protected. */
export function isTerminalTabClosable(
  tabs: readonly TabEntry[],
  sessionId: string,
): boolean {
  const tab = tabs.find((candidate) => candidate.sessionId === sessionId);
  return tab !== undefined && tab.isPinned !== true;
}
