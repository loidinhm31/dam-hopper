import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { TerminalKeepAliveHost } from "@/components/organisms/TerminalKeepAliveHost.js";
import { MonacoKeepAliveHost } from "./MonacoKeepAliveHost.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import { useWindowStore } from "./window-store.js";
import {
  getAllConnectionSnapshots,
  getConnectionSnapshot,
  subscribeConnections,
} from "@/api/connections.js";
import { useShellInputContext } from "./shell-input-context.js";
import {
  terminalTargetKey,
  type TerminalTarget,
} from "@/api/terminal-session-contract.js";
import { useAggregatedTerminalSessions } from "@/hooks/use-aggregated-terminal-sessions.js";
import { useHubTerminalMountsStore } from "./agent-hub/hub-terminal-mounts-store.js";
import {
  mergeTerminalMountDescriptors,
  type HubMountDescriptor,
} from "./agent-hub/merge-hub-terminal-mounts.js";
import { BrowserStreamKeepAliveHost } from "./BrowserStreamKeepAliveHost.js";

export interface OsResourceHostProps {
  mountedSessions?: MountedSession[];
  children?: ReactNode;
}


export function OsResourceHost({
  mountedSessions = [],
  children,
}: OsResourceHostProps) {
  const sessionWindows = useWindowStore((state) => state.session.windows);

  let isTerminalSuppressed = false;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const shellInput = useShellInputContext();
    isTerminalSuppressed = shellInput.isTerminalSuppressed;
  } catch {
    // optional fallback if outside ShellInputProvider
  }

  const derivedTerminalSessions: MountedSession[] = useMemo(() => {
    const sessions: MountedSession[] = [];
    for (const w of Object.values(sessionWindows)) {
      if (w.appId !== "terminals") continue;
      const profileId = w.ctx.profileId;
      // Fail closed: if profile is unknown, do not mount ambient fallback
      const snap = getConnectionSnapshot(profileId);
      if (!snap && profileId !== "default") continue;

      const target =
        w.runtimeIdentity?.kind === "terminal"
          ? w.runtimeIdentity.target
          : (w.appState?.target as TerminalTarget | undefined);

      const sessionId =
        target?.terminalId ??
        (w.appState?.sessionId as string | undefined) ??
        (w.appState?.terminalId as string | undefined) ??
        (w.appState?.requestedTerminalId as string | undefined) ??
        `${profileId}:${w.id}`;

      sessions.push({
        mountKey: `${w.id}:${profileId}:${sessionId}`,
        sessionId,
        project: w.ctx.projectId ?? "default",
        command: "",
        profileId,
        terminalRef: {
          profileId,
          id: sessionId,
        },
        terminalTarget: target,
        attachPolicy: target ? "existing-only" : undefined,
      });
    }
    return sessions;
  }, [sessionWindows]);

  // Subscribe to connection snapshots for reactive Hub validity
  const connectionSignature = useSyncExternalStore(
    subscribeConnections,
    () => {
      const snaps = getAllConnectionSnapshots();
      return snaps
        .map((s) => `${s.owner.profileId}:${s.status}:${s.owner.generation}`)
        .sort()
        .join(";");
    },
    () => "",
  );

  const { sessions: aggregatedSessions, observations } =
    useAggregatedTerminalSessions();

  // Identify which profiles have their inventory loaded
  const loadedProfiles = useMemo(() => {
    const loaded = new Set<string>();
    for (const obs of observations) {
      const owner = obs.owner;
      if (owner) {
        const snap = getConnectionSnapshot(owner.profileId);
        if (
          snap &&
          snap.status === "connected" &&
          snap.owner.generation === owner.generation
        ) {
          loaded.add(owner.profileId);
        }
      } else {
        loaded.add("default");
      }
    }
    return loaded;
  }, [observations, connectionSignature]);

  const activeTargetKeys = useMemo(() => {
    const set = new Set<string>();
    for (const s of aggregatedSessions) {
      if (s.terminationTarget) {
        set.add(terminalTargetKey(s.terminationTarget));
      }
    }
    return set;
  }, [aggregatedSessions]);

  const isValidHubTarget = useCallback(
    (target: TerminalTarget): boolean => {
      const snap = getConnectionSnapshot(target.profileId);
      if (!snap || snap.status !== "connected") return false;
      if (snap.owner.generation !== target.generation) return false;
      if (loadedProfiles.has(target.profileId)) {
        return activeTargetKeys.has(terminalTargetKey(target));
      }
      return true;
    },
    [loadedProfiles, activeTargetKeys],
  );

  // Hub mounts store subscription
  const hubMountsByHub = useHubTerminalMountsStore((s) => s.mountsByHub);

  // Prune store entries for closed Hub windows (R2)
  useEffect(() => {
    const hubIds = Object.keys(hubMountsByHub);
    for (const hubId of hubIds) {
      if (!sessionWindows[hubId]) {
        useHubTerminalMountsStore.getState().clear(hubId);
      }
    }
  }, [hubMountsByHub, sessionWindows]);

  const activeHubMounts = useMemo(() => {
    const mounts: HubMountDescriptor[] = [];
    for (const [hubId, hubMountsList] of Object.entries(hubMountsByHub)) {
      if (sessionWindows[hubId]) {
        for (const m of hubMountsList) {
          mounts.push({ ...m, hubWindowId: hubId });
        }
      }
    }
    return mounts;
  }, [hubMountsByHub, sessionWindows]);

  const retainedKeysRef = useRef<Map<string, string>>(new Map());
  const renderedKeysRef = useRef<Set<string>>(new Set());

  const allMountedSessions = useMemo(() => {
    const { sessions: mergedSessions, retainedKeys: nextRetainedKeys } =
      mergeTerminalMountDescriptors({
        hubMounts: activeHubMounts,
        derived: [...mountedSessions, ...derivedTerminalSessions],
        renderedKeys: renderedKeysRef.current,
        retainedKeys: retainedKeysRef.current,
        isValidHubTarget,
      });

    retainedKeysRef.current = nextRetainedKeys;
    renderedKeysRef.current = new Set(
      mergedSessions
        .map((s) => s.mountKey)
        .filter((k): k is string => Boolean(k)),
    );
    return mergedSessions;
  }, [
    activeHubMounts,
    mountedSessions,
    derivedTerminalSessions,
    isValidHubTarget,
  ]);
  return (
    <MonacoKeepAliveHost>
      <TerminalKeepAliveHost
        mountedSessions={allMountedSessions}
        suppressNativeKeyboard={isTerminalSuppressed}
      />
      <BrowserStreamKeepAliveHost />
      {children}
    </MonacoKeepAliveHost>
  );
}
