import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { parseTerminalKey, projectKey, terminalKey, type TerminalRef } from "@/api/ownership.js";
import {
  getConnectionSnapshot,
  subscribeConnections,
  type ConnectionSnapshot,
} from "@/api/connections.js";
import {
  getProfileChangeVersion,
  getProfiles,
  subscribeToProfileChanges,
} from "@/api/server-config.js";
import { useAggregatedTerminalSessions } from "@/hooks/use-aggregated-terminal-sessions.js";
import {
  useAggregatedProjects,
  type AggregatedProjectItem,
} from "@/hooks/use-aggregated-projects.js";
import { useAgentStatusStore } from "@/stores/agent-status.js";
import { useWindowStore } from "../window-store.js";
import type { OsWindow } from "../types.js";
import {
  buildTraditionalTerminalProjectGroups,
  type TraditionalTerminalProjectGroup,
} from "@/lib/traditional-terminal-projects.js";
import type { DisplayTabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import {
  canDismissWorkspace,
  unionOpenWorkspaceGroups,
  type OpenWorkspaceRef,
} from "@/lib/agent-hub-open-workspaces.js";
import {
  buildTerminalRuntimeIndex,
  type TerminalRuntimeCandidate,
} from "@/lib/terminal-runtime-identity.js";
import {
  useHubTerminalMountsStore,
  type HubTerminalMount,
} from "./hub-terminal-mounts-store.js";
import {
  buildAgentHubItems,
  computeAgentHubSummary,
  type AgentHubItem,
  type AgentHubSummary,
} from "../agent-hub.js";
import {
  terminalTargetKey,
  type TerminalTarget,
} from "@/api/terminal-session-contract.js";
import { useAllTerminalActions } from "@/lib/terminal-session-action-coordinator.js";

function isSessionTerminatingOrEnded(
  s: {
    readonly alive?: boolean;
    readonly terminationState?: string;
    readonly terminationTarget?: TerminalTarget | null;
  },
  terminalActions: ReadonlyMap<string, { readonly status: string }>,
): boolean {
  if (
    s.alive === false ||
    s.terminationState === "exited" ||
    s.terminationState === "restartCancelled" ||
    s.terminationState === "terminationRequested"
  ) {
    return true;
  }
  if (s.terminationTarget) {
    const action = terminalActions.get(terminalTargetKey(s.terminationTarget));
    if (
      action &&
      (action.status === "dispatching" ||
        action.status === "terminationRequested" ||
        action.status === "ended" ||
        action.status === "restartCancelled")
    ) {
      return true;
    }
  }
  return false;
}
function isUuidOrInternalId(str: string): boolean {
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      str,
    )
  ) {
    return true;
  }
  if (str.startsWith("terminal:") || str.startsWith("term-")) {
    return true;
  }
  return false;
}

export function resolveTerminalTabBaseLabel(
  name?: string | null,
  command?: string | null,
): string {
  const trimmedName = name?.trim();
  if (trimmedName && !isUuidOrInternalId(trimmedName)) {
    return trimmedName;
  }
  const cmd = command?.trim();
  if (cmd && !isUuidOrInternalId(cmd)) {
    const base = cmd.split("/").pop() || cmd;
    return base;
  }
  return "terminal";
}

export type RestoredWorkspaceSelectionResult =
  | { action: "wait" }
  | { action: "select"; groupId: string }
  | { action: "drop" };

export function resolveRestoredWorkspaceSelection(
  persistedKey: string | undefined,
  groups: readonly TraditionalTerminalProjectGroup<DisplayTabEntry>[],
  inventoryLoaded: boolean,
): RestoredWorkspaceSelectionResult {
  if (!persistedKey) {
    return { action: "drop" };
  }
  if (!inventoryLoaded) {
    return { action: "wait" };
  }
  const match = groups.find((g) => g.id === persistedKey);
  if (match) {
    return { action: "select", groupId: persistedKey };
  }
  return { action: "drop" };
}

export interface UseAgentHubWorkspacesResult {
  readonly groups: readonly TraditionalTerminalProjectGroup<DisplayTabEntry>[];
  readonly openWorkspaceRefs: readonly OpenWorkspaceRef[];
  readonly runtimeIndex: ReadonlyMap<string, TerminalTarget>;
  readonly items: readonly AgentHubItem[];
  readonly summary: AgentHubSummary;
  readonly sidebarHidden: boolean;
  readonly disclosedGroupIds: ReadonlySet<string>;
  readonly selectedWorkspace?: string;
  readonly selectGroupRequest?: { groupId: string; nonce: number };
  readonly projectInventory: readonly AggregatedProjectItem[];
  readonly inventoryLoading: boolean;
  readonly terminalInventoryLoaded: boolean;
  readonly loadedTerminalInventoryProfileIds: ReadonlySet<string>;
  openWorkspace(ref: OpenWorkspaceRef): void;
  closeWorkspace(groupId: string): void;
  toggleDisclosure(groupId: string): void;
  toggleSidebar(): void;
  setSidebarHidden(hidden: boolean): void;
  handleSelectedGroupChange(
    group: TraditionalTerminalProjectGroup | null,
  ): void;
  requestSelectGroup(groupId: string): void;
}

export function useAgentHubWorkspaces(
  window: OsWindow,
): UseAgentHubWorkspacesResult {
  const updateAppState = useWindowStore((s) => s.updateAppState);
  const sessionWindows = useWindowStore((s) => s.session.windows);

  // AppState slices (subscribe to store so local updates re-render immediately)
  const winAppState = useWindowStore(
    (s) => s.session.windows[window.id]?.appState,
  );
  const appState = winAppState ?? window.appState ?? {};
  const openWorkspaceRefs = useMemo<readonly OpenWorkspaceRef[]>(() => {
    if (!Array.isArray(appState.openWorkspaces)) return [];
    const list: OpenWorkspaceRef[] = [];
    for (const item of appState.openWorkspaces) {
      if (
        item &&
        typeof item === "object" &&
        "profileId" in item &&
        "project" in item &&
        typeof item.profileId === "string" &&
        typeof item.project === "string" &&
        item.profileId.length > 0 &&
        item.project.length > 0
      ) {
        list.push({ profileId: item.profileId, project: item.project });
      }
    }
    return list;
  }, [appState.openWorkspaces]);

  const sidebarHidden = Boolean(appState.sidebarHidden);
  const disclosedGroupIds = useMemo<ReadonlySet<string>>(() => {
    if (!Array.isArray(appState.disclosedWorkspaces)) return new Set();
    const set = new Set<string>();
    for (const id of appState.disclosedWorkspaces) {
      if (typeof id === "string" && id.length > 0) set.add(id);
    }
    return set;
  }, [appState.disclosedWorkspaces]);

  const persistedSelectedWorkspace =
    typeof appState.selectedWorkspace === "string" &&
    appState.selectedWorkspace.length > 0
      ? appState.selectedWorkspace
      : undefined;

  const [selectGroupRequest, setSelectGroupRequest] = useState<
    { groupId: string; nonce: number } | undefined
  >(undefined);

  const setAppState = useCallback(
    (
      updater: (
        prev: Record<string, unknown>,
      ) => Record<string, unknown>,
    ) => {
      const currentWin = useWindowStore.getState().session.windows[window.id];
      const prevAppState = currentWin?.appState ?? {};
      const next = updater(prevAppState);
      if (next === prevAppState) return;
      updateAppState(window.id, next);
    },
    [window.id, updateAppState],
  );

  // External aggregated data
  const {
    sessions: rawSessions,
    isSuccess: terminalInventoryLoaded,
    loadedProfileIds: loadedTerminalInventoryProfileIds,
  } = useAggregatedTerminalSessions();
  const { allProjects: projectInventory = [], isLoading: inventoryLoading } =
    useAggregatedProjects();
  const statusProfiles = useAgentStatusStore((state) => state.profiles);

  const profileVersion = useSyncExternalStore(
    subscribeToProfileChanges,
    getProfileChangeVersion,
    () => 0,
  );
  const registeredProfiles = useMemo(
    () => getProfiles(),
    [profileVersion],
  );
  const profileLabels = useMemo(
    () => new Map(registeredProfiles.map((p) => [p.id, p.name])),
    [registeredProfiles],
  );

  const connectionSignature = useSyncExternalStore(
    subscribeConnections,
    () =>
      JSON.stringify(
        registeredProfiles.map((profile) => {
          const snapshot = getConnectionSnapshot(profile.id);
          return [profile.id, snapshot?.status, snapshot?.owner.generation];
        }),
      ),
    () => "",
  );

  const connectionsMap = useMemo(() => {
    const map = new Map<string, ConnectionSnapshot>();
    for (const profile of registeredProfiles) {
      const snapshot = getConnectionSnapshot(profile.id);
      if (snapshot) map.set(profile.id, snapshot);
    }
    return map;
  }, [registeredProfiles, connectionSignature]);

  const terminalActions = useAllTerminalActions();

  // Build live session groups (with qualified tab IDs for AC5)
  const sessionGroups = useMemo(() => {
    const mounted: MountedSession[] = [];
    const tabs: DisplayTabEntry[] = [];
    const ordinalsByGroup = new Map<string, number>();

    for (const s of rawSessions) {
      if (isSessionTerminatingOrEnded(s, terminalActions)) {
        continue;
      }
      const termRef: TerminalRef = { profileId: s.profileId, id: s.id };
      const qSessionId = terminalKey(termRef);
      const groupKey = `${s.profileId}:${s.project || "default"}`;
      const ordinal = (ordinalsByGroup.get(groupKey) ?? 0) + 1;
      ordinalsByGroup.set(groupKey, ordinal);

      const baseLabel = resolveTerminalTabBaseLabel(s.name, s.command);
      const label = `${baseLabel} #${ordinal}`;

      mounted.push({
        sessionId: qSessionId,
        terminalRef: termRef,
        profileId: s.profileId,
        project: s.project || "default",
        command: s.command || "bash",
        cwd: s.cwd,
        worktreePath: s.worktreePath,
      });

      tabs.push({
        sessionId: qSessionId,
        terminalRef: termRef,
        profileId: s.profileId,
        label,
        title: {
          baseLabel,
          ordinal,
          fullText: label,
        },
        session: {
          id: qSessionId, // CRITICAL: tab.sessionId === terminalKey(ref) AND session.id === tab.sessionId
          incarnation: s.incarnation ?? 0,
          incarnationExact: s.incarnationExact,
          terminationState: s.terminationState,
          alive: s.alive,
          command: s.command,
          cwd: s.cwd,
          type: s.type,
          startedAt: s.startedAt ?? 0,
        },
      });
    }

    return buildTraditionalTerminalProjectGroups(mounted, tabs);
  }, [rawSessions, terminalActions]);

  // Union with open workspaces (P01)
  const groups = useMemo(
    () =>
      unionOpenWorkspaceGroups(
        sessionGroups,
        openWorkspaceRefs,
        projectInventory ?? [],
      ),
    [sessionGroups, openWorkspaceRefs, projectInventory],
  );

  // Runtime index and Mount publishing
  const runtimeIndex = useMemo(() => {
    const candidates: TerminalRuntimeCandidate[] = rawSessions.map((s) => ({
      profileId: s.profileId,
      id: s.id,
      terminationTarget: s.terminationTarget,
    }));
    return buildTerminalRuntimeIndex(candidates, getConnectionSnapshot);
  }, [rawSessions, connectionSignature]);

  useEffect(() => {
    const mounts: HubTerminalMount[] = [];
    for (const s of rawSessions) {
      if (
        isSessionTerminatingOrEnded(s, terminalActions) ||
        !s.terminationTarget
      ) {
        continue;
      }
      mounts.push({
        logicalKey: terminalKey({ profileId: s.profileId, id: s.id }),
        target: s.terminationTarget,
        project: s.project || "default",
        command: s.command || "bash",
        cwd: s.cwd,
        worktreePath: s.worktreePath,
      });
    }

    useHubTerminalMountsStore.getState().publish(window.id, mounts);
    // Invariant: DO NOT clear on unmount! P03 prunes on window close.
  }, [rawSessions, terminalActions, window.id]);

  // Adapt groups for agent evidence join (raw session.id = ref.id matching buildTraditionalTerminalAgentRows)
  const agentRosterGroups = useMemo(
    () =>
      groups.map((group) => {
        const terminalTabs: DisplayTabEntry[] = [];
        for (const tab of group.terminalTabs) {
          const parsed = parseTerminalKey(tab.sessionId);
          const ref = tab.terminalRef ?? parsed;
          const session = tab.session;
          if (!parsed || !session || !ref || parsed.id !== ref.id) {
            terminalTabs.push(tab);
            continue;
          }
          terminalTabs.push({
            ...tab,
            session: { ...session, id: ref.id },
          });
        }
        return { ...group, terminalTabs };
      }),
    [groups],
  );

  // Read model items and summary
  const items = useMemo(() => {
    return buildAgentHubItems({
      groups: agentRosterGroups,
      profiles: statusProfiles,
      connections: connectionsMap,
      profileLabels,
      sessions: rawSessions,
      windows: sessionWindows,
    });
  }, [
    agentRosterGroups,
    statusProfiles,
    connectionsMap,
    profileLabels,
    rawSessions,
    sessionWindows,
  ]);

  const summary = useMemo(() => {
    return computeAgentHubSummary(items, connectionsMap);
  }, [items, connectionsMap]);

  // Restored selection resolution (V7)
  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    const resolution = resolveRestoredWorkspaceSelection(
      persistedSelectedWorkspace,
      groups,
      !inventoryLoading,
    );

    if (resolution.action === "wait") {
      return;
    }

    restoreAttemptedRef.current = true;
    if (resolution.action === "select") {
      setSelectGroupRequest({
        groupId: resolution.groupId,
        nonce: Date.now(),
      });
    } else if (resolution.action === "drop") {
      if (persistedSelectedWorkspace) {
        setAppState((prev) => {
          if (prev.selectedWorkspace === undefined) return prev;
          const next = { ...prev };
          delete next.selectedWorkspace;
          return next;
        });
      }
    }
  }, [persistedSelectedWorkspace, groups, inventoryLoading, setAppState]);

  // Actions
  const openWorkspace = useCallback(
    (ref: OpenWorkspaceRef) => {
      const key = projectKey(ref);
      setAppState((prev) => {
        const existing = Array.isArray(prev.openWorkspaces)
          ? (prev.openWorkspaces as OpenWorkspaceRef[])
          : [];
        if (existing.some((r) => projectKey(r) === key)) {
          return prev;
        }
        const next = [
          ...existing,
          { profileId: ref.profileId, project: ref.project },
        ].slice(0, 64);
        return { ...prev, openWorkspaces: next };
      });
      setSelectGroupRequest({ groupId: key, nonce: Date.now() });
    },
    [setAppState],
  );

  const closeWorkspace = useCallback(
    (groupId: string) => {
      const targetGroup = groups.find((g) => g.id === groupId);
      if (!targetGroup || !canDismissWorkspace(targetGroup)) {
        return;
      }
      setAppState((prev) => {
        const existing = Array.isArray(prev.openWorkspaces)
          ? (prev.openWorkspaces as OpenWorkspaceRef[])
          : [];
        const next = existing.filter((r) => projectKey(r) !== groupId);
        const nextSelected =
          prev.selectedWorkspace === groupId ? undefined : prev.selectedWorkspace;
        return {
          ...prev,
          openWorkspaces: next,
          selectedWorkspace: nextSelected,
        };
      });
    },
    [groups, setAppState],
  );

  const toggleDisclosure = useCallback(
    (groupId: string) => {
      setAppState((prev) => {
        const existing = Array.isArray(prev.disclosedWorkspaces)
          ? (prev.disclosedWorkspaces as string[])
          : [];
        const set = new Set(existing);
        if (set.has(groupId)) {
          set.delete(groupId);
        } else {
          if (set.size < 64) set.add(groupId);
        }
        return { ...prev, disclosedWorkspaces: Array.from(set) };
      });
    },
    [setAppState],
  );

  const toggleSidebar = useCallback(() => {
    setAppState((prev) => ({ ...prev, sidebarHidden: !prev.sidebarHidden }));
  }, [setAppState]);

  const setSidebarHidden = useCallback(
    (hidden: boolean) => {
      setAppState((prev) => ({ ...prev, sidebarHidden: hidden }));
    },
    [setAppState],
  );

  const handleSelectedGroupChange = useCallback(
    (group: TraditionalTerminalProjectGroup | null) => {
      if (!restoreAttemptedRef.current) return;
      const nextKey = group ? group.id : undefined;
      setAppState((prev) => {
        if (prev.selectedWorkspace === nextKey) return prev;
        return { ...prev, selectedWorkspace: nextKey };
      });
    },
    [setAppState],
  );

  const requestSelectGroup = useCallback((groupId: string) => {
    setSelectGroupRequest({ groupId, nonce: Date.now() });
  }, []);

  return {
    groups,
    openWorkspaceRefs,
    runtimeIndex,
    items,
    summary,
    sidebarHidden,
    disclosedGroupIds,
    selectedWorkspace: persistedSelectedWorkspace,
    selectGroupRequest,
    projectInventory,
    inventoryLoading,
    terminalInventoryLoaded,
    loadedTerminalInventoryProfileIds,
    openWorkspace,
    closeWorkspace,
    toggleDisclosure,
    toggleSidebar,
    setSidebarHidden,
    handleSelectedGroupChange,
    requestSelectGroup,
  };
}
