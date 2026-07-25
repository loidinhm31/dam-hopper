import type { PortEntry } from "@/hooks/use-ports.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";

export const FREE_RUNTIME_GROUP_ID = "__free__";
export const FREE_RUNTIME_GROUP_NAME = "Free Terminals";
export const UNASSIGNED_RUNTIME_GROUP_ID = "__unassigned__";
export const UNASSIGNED_RUNTIME_GROUP_NAME = "Unassigned";

export interface RuntimePort {
  port: number;
  project: string;
  state: Exclude<PortEntry["state"], "lost">;
  sessionId: string | null;
  tunnel: PortEntry["tunnel"];
  tunnelStatus: NonNullable<PortEntry["tunnel"]>["status"] | null;
  tunnelUrl?: string;
  tunnelId?: string;
}

export interface RuntimeSessionItem {
  kind: "session";
  id: string;
  groupId: string;
  sessionId: string;
  label: string;
  project: string;
  command: string;
  cwd?: string;
  alive?: boolean;
  startedAt: number;
  ports: RuntimePort[];
}

export interface RuntimeServiceGroupItem {
  kind: "service-group";
  id: string;
  groupId: string;
  label: string;
  sessions: RuntimeSessionItem[];
  startedAt: number;
}

export interface RuntimePortItem {
  kind: "port";
  id: string;
  groupId: string;
  port: number;
  ports: [RuntimePort];
}

export type RuntimeTreeItem =
  | RuntimeSessionItem
  | RuntimeServiceGroupItem
  | RuntimePortItem;

export interface RuntimeTreeGroup {
  id: string;
  name: string;
  isFreeGroup: boolean;
  items: RuntimeTreeItem[];
}

export interface RuntimeTreeInput {
  terminals: MountedSession[];
  tabs: TabEntry[];
  ports: PortEntry[];
  projectOrder?: string[];
  runtimeGroupOrder?: string[];
  runtimeItemOrder?: Record<string, string[]>;
}

interface MutableGroup extends RuntimeTreeGroup {
  firstSeen: number;
}

function groupKey(project: string, sessionId?: string) {
  const normalized = project.trim();
  if (normalized) return normalized;
  return sessionId?.startsWith("free:")
    ? FREE_RUNTIME_GROUP_ID
    : UNASSIGNED_RUNTIME_GROUP_ID;
}

function groupName(id: string) {
  if (id === FREE_RUNTIME_GROUP_ID) return FREE_RUNTIME_GROUP_NAME;
  if (id === UNASSIGNED_RUNTIME_GROUP_ID) return UNASSIGNED_RUNTIME_GROUP_NAME;
  return id;
}

function ensureGroup(groups: Map<string, MutableGroup>, id: string) {
  const current = groups.get(id);
  if (current) return current;
  const next: MutableGroup = {
    id,
    name: groupName(id),
    isFreeGroup: id === FREE_RUNTIME_GROUP_ID,
    items: [],
    firstSeen: groups.size,
  };
  groups.set(id, next);
  return next;
}

function fallbackTerminalLabel(terminal: MountedSession) {
  if (terminal.sessionId.startsWith("free:")) return "Free terminal";
  return terminal.command.split(/[\s/\\]/).find(Boolean) ?? terminal.sessionId;
}

function toRuntimePort(port: PortEntry, project: string): RuntimePort {
  return {
    port: port.port,
    project,
    state: port.state as Exclude<PortEntry["state"], "lost">,
    sessionId: port.sessionId,
    tunnel: port.tunnel,
    tunnelStatus: port.tunnel?.status ?? null,
    tunnelUrl: port.tunnel?.url,
    tunnelId: port.tunnel?.id,
  };
}

function sortGroups(
  groups: MutableGroup[],
  projectOrder: string[],
  runtimeGroupOrder: string[],
) {
  return groups.sort((left, right) => {
    const runtimeLeft = runtimeGroupOrder.indexOf(left.id);
    const runtimeRight = runtimeGroupOrder.indexOf(right.id);
    if (runtimeLeft !== -1 || runtimeRight !== -1) {
      if (runtimeLeft === -1) return 1;
      if (runtimeRight === -1) return -1;
      return runtimeLeft - runtimeRight;
    }

    const projectLeft = projectOrder.indexOf(left.id);
    const projectRight = projectOrder.indexOf(right.id);
    if (projectLeft !== -1 || projectRight !== -1) {
      if (projectLeft === -1) return 1;
      if (projectRight === -1) return -1;
      return projectLeft - projectRight;
    }

    if (left.id === FREE_RUNTIME_GROUP_ID || right.id === FREE_RUNTIME_GROUP_ID) {
      return left.id === FREE_RUNTIME_GROUP_ID ? -1 : 1;
    }
    if (
      left.id === UNASSIGNED_RUNTIME_GROUP_ID ||
      right.id === UNASSIGNED_RUNTIME_GROUP_ID
    ) {
      return left.id === UNASSIGNED_RUNTIME_GROUP_ID ? -1 : 1;
    }

    return left.firstSeen - right.firstSeen;
  });
}

function sortItems(group: MutableGroup, runtimeItemOrder: Record<string, string[]>) {
  const persistedOrder = runtimeItemOrder[group.id] ?? [];
  group.items.sort((left, right) => {
    const persistedLeft = persistedOrder.indexOf(left.id);
    const persistedRight = persistedOrder.indexOf(right.id);
    if (persistedLeft !== -1 || persistedRight !== -1) {
      if (persistedLeft === -1) return 1;
      if (persistedRight === -1) return -1;
      return persistedLeft - persistedRight;
    }

    if (left.kind !== right.kind) {
      const rank = { "service-group": 0, session: 1, port: 2 };
      return rank[left.kind] - rank[right.kind];
    }

    if (left.kind === "port") {
      return left.port - (right as RuntimePortItem).port;
    }

    return left.startedAt - (right as RuntimeSessionItem | RuntimeServiceGroupItem).startedAt;
  });
}

export function buildRuntimeTree({
  terminals,
  tabs,
  ports,
  projectOrder = [],
  runtimeGroupOrder = [],
  runtimeItemOrder = {},
}: RuntimeTreeInput): RuntimeTreeGroup[] {
  const groups = new Map<string, MutableGroup>();
  const tabById = new Map(tabs.map((tab) => [tab.sessionId, tab]));
  const sessionItems = new Map<string, RuntimeSessionItem>();
  const orphanPortsByGroup = new Map<string, RuntimePortItem[]>();

  terminals.forEach((terminal, index) => {
    const id = groupKey(terminal.project, terminal.sessionId);
    const group = ensureGroup(groups, id);
    const tab = tabById.get(terminal.sessionId);
    const item: RuntimeSessionItem = {
      kind: "session",
      id: `session:${terminal.sessionId}`,
      groupId: id,
      sessionId: terminal.sessionId,
      label: tab?.label ?? fallbackTerminalLabel(terminal),
      project: terminal.project,
      command: terminal.command,
      cwd: terminal.cwd,
      alive: tab?.session?.alive,
      startedAt:
        tab?.session?.startedAt ??
        Number.MAX_SAFE_INTEGER - terminals.length + index,
      ports: [],
    };
    group.items.push(item);
    sessionItems.set(terminal.sessionId, item);
  });

  for (const port of ports) {
    if (port.state === "lost") continue;
    const attached = port.sessionId ? sessionItems.get(port.sessionId) : undefined;
    if (attached) {
      attached.ports.push(toRuntimePort(port, groupName(attached.groupId)));
      continue;
    }

    const id = groupKey(port.project ?? "", port.sessionId ?? undefined);
    ensureGroup(groups, id);
    const groupPorts = orphanPortsByGroup.get(id) ?? [];
    groupPorts.push({
      kind: "port",
      id: `port:${id}:${port.port}`,
      groupId: id,
      port: port.port,
      ports: [toRuntimePort(port, groupName(id))],
    });
    orphanPortsByGroup.set(id, groupPorts);
  }

  for (const group of groups.values()) {
    const serviceSessions: RuntimeSessionItem[] = [];
    const shellSessions: RuntimeSessionItem[] = [];

    for (const session of sessionItems.values()) {
      if (session.groupId !== group.id) continue;
      if (session.ports.length > 0) serviceSessions.push(session);
      else shellSessions.push(session);
    }

    group.items = [];

    if (serviceSessions.length > 0) {
      serviceSessions.sort((left, right) => left.startedAt - right.startedAt);
      group.items.push({
        kind: "service-group",
        id: `services:${group.id}`,
        groupId: group.id,
        label: "Running ports",
        sessions: serviceSessions,
        startedAt: serviceSessions[0]?.startedAt ?? Number.MAX_SAFE_INTEGER,
      });
    }

    shellSessions.sort((left, right) => left.startedAt - right.startedAt);
    group.items.push(...shellSessions);
    group.items.push(...(orphanPortsByGroup.get(group.id) ?? []));
  }

  const sortedGroups = sortGroups([...groups.values()], projectOrder, runtimeGroupOrder);
  for (const group of sortedGroups) {
    for (const item of group.items) {
      if (item.kind === "session") {
        item.ports.sort((left, right) => left.port - right.port);
      } else if (item.kind === "service-group") {
        for (const session of item.sessions) {
          session.ports.sort((left, right) => left.port - right.port);
        }
      }
    }
    sortItems(group, runtimeItemOrder);
  }

  return sortedGroups;
}

export function reorderRuntimeIds(
  ids: string[],
  draggedId: string,
  targetId: string,
) {
  const fromIndex = ids.indexOf(draggedId);
  const toIndex = ids.indexOf(targetId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return null;
  }

  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
