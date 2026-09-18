import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import { projectKey, parseTerminalKey, type ProjectRef } from "@/api/ownership.js";
import { getProfiles } from "@/api/server-config.js";

export const FREE_TRADITIONAL_TERMINAL_GROUP_ID = "free-terminals";

export interface TraditionalTerminalProjectGroup<
  T extends TabEntry = TabEntry,
> {
  id: string;
  projectName: string | null;
  projectRef?: ProjectRef;
  profileId?: string;
  profileName?: string;
  label: string;
  terminalTabs: T[];
  mountedSessions: MountedSession[];
}

export function buildTraditionalTerminalProjectGroups<T extends TabEntry>(
  mountedSessions: readonly MountedSession[],
  terminalTabs: readonly T[],
): TraditionalTerminalProjectGroup<T>[] {
  const mountedBySessionId = new Map<string, MountedSession>();
  for (const session of mountedSessions) {
    mountedBySessionId.set(session.sessionId, session);
    const parsed = parseTerminalKey(session.sessionId);
    if (parsed?.id && !mountedBySessionId.has(parsed.id)) {
      mountedBySessionId.set(parsed.id, session);
    }
  }
  const groupsById = new Map<string, TraditionalTerminalProjectGroup<T>>();

  for (const tab of terminalTabs) {
    const mounted =
      mountedBySessionId.get(tab.sessionId) ??
      (parseTerminalKey(tab.sessionId)?.id ? mountedBySessionId.get(parseTerminalKey(tab.sessionId)!.id) : undefined);
    if (!mounted) continue;

    const projectName = mounted.project || null;
    const profileId = mounted.terminalRef?.profileId ?? mounted.profileId ?? parseTerminalKey(tab.sessionId)?.profileId;
    const projectRef = profileId ? {profileId, project: projectName ?? ""} : undefined;
    const profileName = profileId ? (getProfiles().find((p) => p.id === profileId)?.name ?? (profileId !== "default" ? profileId : undefined)) : undefined;
    const id = projectRef ? projectKey(projectRef) : projectName
      ? `project:${projectName}`
      : FREE_TRADITIONAL_TERMINAL_GROUP_ID;
    let group = groupsById.get(id);
    if (!group) {
      group = {
        id,
        projectName,
        projectRef,
        profileId,
        profileName,
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

export function firstRemainingTraditionalTerminalId<T extends TabEntry>(
  group: Pick<TraditionalTerminalProjectGroup<T>, "terminalTabs">,
  closedSessionId: string,
): string | undefined {
  return group.terminalTabs.find((tab) => tab.sessionId !== closedSessionId)
    ?.sessionId;
}

export function traditionalTerminalLayoutStorageKey(
  groupId: string,
  profileId?: string,
): string {
  const encoded = profileId
    ? encodeURIComponent(JSON.stringify([profileId, groupId]))
    : encodeURIComponent(groupId);
  return `dam-hopper:terminal-layout:v3:${encoded}`;
}

export function traditionalTerminalProjectTabId(groupId: string): string {
  return `traditional-terminal-project-tab-${encodeURIComponent(groupId)}`;
}

export function traditionalTerminalProjectPanelId(groupId: string): string {
  return `traditional-terminal-project-panel-${encodeURIComponent(groupId)}`;
}
