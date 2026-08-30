import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";

export const FREE_TRADITIONAL_TERMINAL_GROUP_ID = "free-terminals";

export interface TraditionalTerminalProjectGroup {
  id: string;
  projectName: string | null;
  label: string;
  terminalTabs: TabEntry[];
  mountedSessions: MountedSession[];
}

export function buildTraditionalTerminalProjectGroups(
  mountedSessions: readonly MountedSession[],
  terminalTabs: readonly TabEntry[],
): TraditionalTerminalProjectGroup[] {
  const mountedBySessionId = new Map(
    mountedSessions.map((session) => [session.sessionId, session]),
  );
  const groupsById = new Map<string, TraditionalTerminalProjectGroup>();

  for (const tab of terminalTabs) {
    const mounted = mountedBySessionId.get(tab.sessionId);
    if (!mounted) continue;

    const projectName = mounted.project || null;
    const id = projectName
      ? `project:${projectName}`
      : FREE_TRADITIONAL_TERMINAL_GROUP_ID;
    let group = groupsById.get(id);
    if (!group) {
      group = {
        id,
        projectName,
        label: projectName ?? "Free terminals",
        terminalTabs: [],
        mountedSessions: [],
      };
      groupsById.set(id, group);
    }

    group.terminalTabs.push(tab);
    group.mountedSessions.push(mounted);
  }
  return [...groupsById.values()];
}

export function traditionalTerminalLayoutStorageKey(groupId: string): string {
  return `dam-hopper:terminal-layout:v2:${encodeURIComponent(groupId)}`;
}

export function traditionalTerminalProjectTabId(groupId: string): string {
  return `traditional-terminal-project-tab-${encodeURIComponent(groupId)}`;
}

export function traditionalTerminalProjectPanelId(groupId: string): string {
  return `traditional-terminal-project-panel-${encodeURIComponent(groupId)}`;
}
