import type { PortEntry } from "@/hooks/use-ports.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";

export const FREE_RUNTIME_GROUP_ID = "__free__";
export const FREE_RUNTIME_GROUP_NAME = "Free Terminals";
export const UNASSIGNED_RUNTIME_GROUP_ID = "__unassigned__";
export const UNASSIGNED_RUNTIME_GROUP_NAME = "Unassigned";

export interface RuntimeTerminal {
  sessionId: string;
  label: string;
  project: string;
  command: string;
  cwd?: string;
  alive?: boolean;
}

export interface RuntimePort {
  port: number;
  project: string;
  state: Exclude<PortEntry["state"], "lost">;
  sessionId: string | null;
  tunnelStatus: NonNullable<PortEntry["tunnel"]>["status"] | null;
}

export interface RuntimeProjectGroup {
  id: string;
  name: string;
  terminals: RuntimeTerminal[];
  ports: RuntimePort[];
  isFreeGroup: boolean;
}

export interface RuntimeGroupingInput {
  terminals: MountedSession[];
  tabs: TabEntry[];
  ports: PortEntry[];
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

function ensureGroup(groups: RuntimeProjectGroup[], id: string) {
  let group = groups.find((candidate) => candidate.id === id);
  if (!group) {
    group = {
      id,
      name: groupName(id),
      terminals: [],
      ports: [],
      isFreeGroup: id === FREE_RUNTIME_GROUP_ID,
    };
    groups.push(group);
  }
  return group;
}

function fallbackTerminalLabel(terminal: MountedSession) {
  if (terminal.sessionId.startsWith("free:")) return "Free terminal";
  const base = terminal.command.split(/[\s/\\]/).find(Boolean);
  return base || terminal.sessionId;
}

export function groupActiveTerminalRuntime({
  terminals,
  tabs,
  ports,
}: RuntimeGroupingInput): RuntimeProjectGroup[] {
  const groups: RuntimeProjectGroup[] = [];
  const tabById = new Map(tabs.map((tab) => [tab.sessionId, tab]));
  const terminalById = new Map(terminals.map((t) => [t.sessionId, t]));

  for (const terminal of terminals) {
    const id = groupKey(terminal.project, terminal.sessionId);
    ensureGroup(groups, id).terminals.push({
      sessionId: terminal.sessionId,
      label:
        tabById.get(terminal.sessionId)?.label ??
        fallbackTerminalLabel(terminal),
      project: terminal.project,
      command: terminal.command,
      cwd: terminal.cwd,
      alive: tabById.get(terminal.sessionId)?.session?.alive,
    });
  }

  for (const port of ports) {
    if (port.state === "lost") continue;

    const owningTerminal = port.sessionId
      ? terminalById.get(port.sessionId)
      : undefined;
    const id = groupKey(owningTerminal?.project ?? port.project ?? "");
    ensureGroup(groups, id).ports.push({
      port: port.port,
      project: groupName(id),
      state: port.state,
      sessionId: port.sessionId,
      tunnelStatus: port.tunnel?.status ?? null,
    });
  }

  for (const group of groups) {
    group.ports.sort((a, b) => a.port - b.port);
  }

  return groups;
}
