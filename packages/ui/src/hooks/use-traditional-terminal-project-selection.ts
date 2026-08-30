import { useCallback, useEffect, useMemo, useState } from "react";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";

interface Options {
  groups: readonly TraditionalTerminalProjectGroup[];
  activeSessionId: string | null;
  onSelectTab?: (sessionId: string) => void;
}

export function useTraditionalTerminalProjectSelection({
  groups,
  activeSessionId,
  onSelectTab,
}: Options) {
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [lastSelectedSessionByGroup, setLastSelectedSessionByGroup] = useState(
    () => new Map<string, string>(),
  );
  const rememberSelectedSession = useCallback(
    (groupId: string, sessionId: string) => {
      setLastSelectedSessionByGroup((current) => {
        if (current.get(groupId) === sessionId) return current;
        const next = new Map(current);
        next.set(groupId, sessionId);
        return next;
      });
    },
    [],
  );
  const groupSignature = JSON.stringify(
    groups.map((group) => [
      group.id,
      group.terminalTabs.map((tab) => tab.sessionId),
    ]),
  );
  const groupForSession = useMemo(() => {
    const result = new Map<string, string>();
    for (const group of groups) {
      for (const tab of group.terminalTabs) result.set(tab.sessionId, group.id);
    }
    return result;
    // groupSignature encodes every group ID and terminal membership.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupSignature]);
  const groupIds = useMemo(() => {
    return new Set(groups.map((group) => group.id));
    // groupSignature encodes the complete group ID set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupSignature]);
  const firstGroupId = groups[0]?.id ?? null;
  const activeGroup = groups.find((group) => group.id === activeGroupId);
  const selectedGroup = activeGroup ?? groups[0];

  useEffect(() => {
    const selectedSessionId = activeSessionId;
    const sessionGroupId = selectedSessionId
      ? groupForSession.get(selectedSessionId)
      : undefined;
    if (sessionGroupId && selectedSessionId) {
      rememberSelectedSession(sessionGroupId, selectedSessionId);
      setActiveGroupId(sessionGroupId);
      return;
    }
    setActiveGroupId((current) =>
      current && groupIds.has(current) ? current : firstGroupId,
    );
  }, [
    activeSessionId,
    firstGroupId,
    groupForSession,
    groupIds,
    rememberSelectedSession,
  ]);

  const activeSessionForGroup = selectedGroup
    ? selectedGroup.terminalTabs.some(
        (tab) => tab.sessionId === activeSessionId,
      )
      ? activeSessionId
      : (selectedGroup.terminalTabs.find(
          (tab) =>
            tab.sessionId === lastSelectedSessionByGroup.get(selectedGroup.id),
        )?.sessionId ??
        selectedGroup.terminalTabs.at(-1)?.sessionId ??
        null)
    : null;

  function handleSelectGroup(groupId: string) {
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    setActiveGroupId(groupId);
    const rememberedSessionId = lastSelectedSessionByGroup.get(groupId);
    const sessionId =
      group.terminalTabs.find((tab) => tab.sessionId === rememberedSessionId)
        ?.sessionId ?? group.terminalTabs.at(-1)?.sessionId;
    if (!sessionId) return;
    rememberSelectedSession(groupId, sessionId);
    onSelectTab?.(sessionId);
  }

  function handleSelectTab(sessionId: string) {
    const groupId = groupForSession.get(sessionId);
    if (groupId) {
      setActiveGroupId(groupId);
      rememberSelectedSession(groupId, sessionId);
    }
    onSelectTab?.(sessionId);
  }

  return {
    selectedGroup,
    activeSessionForGroup,
    handleSelectGroup,
    handleSelectTab,
  };
}
