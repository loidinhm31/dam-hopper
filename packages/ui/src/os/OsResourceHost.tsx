import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { TerminalKeepAliveHost } from "@/components/organisms/TerminalKeepAliveHost.js";
import { MonacoKeepAliveHost } from "./MonacoKeepAliveHost.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import { useWindowStore } from "./window-store.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
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

export interface OsResourceHostProps {
  mountedSessions?: MountedSession[];
  children?: ReactNode;
}

interface BrowserSlotRegistration {
  windowId: string;
  url: string;
  element: HTMLElement | null;
  isVisible: boolean;
}

const browserSlots = new Map<string, BrowserSlotRegistration>();
const browserSlotListeners = new Set<() => void>();

export function registerBrowserSlot(
  windowId: string,
  url: string,
  element: HTMLElement | null,
  isVisible: boolean,
): () => void {
  browserSlots.set(windowId, { windowId, url, element, isVisible });
  browserSlotListeners.forEach((l) => l());
  return () => {
    browserSlots.delete(windowId);
    browserSlotListeners.forEach((l) => l());
  };
}

export function updateBrowserSlot(
  windowId: string,
  element: HTMLElement | null,
  isVisible: boolean,
): void {
  const existing = browserSlots.get(windowId);
  if (existing) {
    existing.element = element;
    existing.isVisible = isVisible;
    browserSlotListeners.forEach((l) => l());
  }
}

function OsBrowserIframe({
  windowId,
  url,
}: {
  windowId: string;
  url: string;
}) {
  const isCognitoActive = useCognitoModeStore((state) => state.active);
  const targetWindow = useWindowStore((state) => state.session.windows[windowId]);
  const activeDesktopId = useWindowStore((state) => state.session.activeDesktopId);
  const [slot, setSlot] = useState<BrowserSlotRegistration | null>(() =>
    browserSlots.get(windowId) ?? null,
  );
  const [geometry, setGeometry] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    visible: boolean;
  }>({
    top: -10000,
    left: -10000,
    width: 800,
    height: 600,
    visible: false,
  });

  useEffect(() => {
    const update = () => {
      setSlot(browserSlots.get(windowId) ?? null);
    };
    browserSlotListeners.add(update);
    return () => {
      browserSlotListeners.delete(update);
    };
  }, [windowId]);

  useLayoutEffect(() => {
    if (!slot || !slot.isVisible || !slot.element) {
      setGeometry((prev) =>
        prev.visible
          ? { ...prev, visible: false, top: -10000, left: -10000 }
          : prev,
      );
      return;
    }

    const el = slot.element;
    const updateGeometry = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setGeometry((prev) => {
          if (
            prev.top === rect.top &&
            prev.left === rect.left &&
            prev.width === rect.width &&
            prev.height === rect.height &&
            prev.visible === true
          ) {
            return prev;
          }
          return {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            visible: true,
          };
        });
      }
    };

    updateGeometry();
    const observer = new ResizeObserver(updateGeometry);
    observer.observe(el);
    window.addEventListener("resize", updateGeometry);
    window.addEventListener("scroll", updateGeometry, true);
    window.addEventListener("pointermove", updateGeometry, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateGeometry);
      window.removeEventListener("scroll", updateGeometry, true);
      window.removeEventListener("pointermove", updateGeometry);
    };
  }, [
    slot,
    targetWindow?.floatBounds?.x,
    targetWindow?.floatBounds?.y,
    targetWindow?.floatBounds?.width,
    targetWindow?.floatBounds?.height,
    targetWindow?.mode,
    targetWindow?.maximized,
    targetWindow?.desktopId,
    targetWindow?.minimized,
    activeDesktopId,
  ]);
  const isEffectiveVisible = geometry.visible && !isCognitoActive;

  return (
    <div
      aria-hidden={!isEffectiveVisible}
      data-os-browser-host-window={windowId}
      style={{
        position: "fixed",
        top: geometry.top,
        left: geometry.left,
        width: geometry.width,
        height: geometry.height,
        visibility: isEffectiveVisible ? "visible" : "hidden",
        pointerEvents: isEffectiveVisible ? "auto" : "none",
        zIndex: 20,
        overflow: "hidden",
      }}
    >
      <iframe
        src={url}
        data-os-preview-iframe="true"
        data-testid={`preview-iframe-${windowId}`}
        title={`Browser preview ${url}`}
        className="w-full h-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
    </div>
  );
}

function OsBrowserKeepAliveHost() {
  const sessionWindows = useWindowStore((state) => state.session.windows);
  const browserWindows = useMemo(
    () =>
      Object.values(sessionWindows).filter((w) => w.appId === "browser"),
    [sessionWindows],
  );

  return (
    <div
      aria-hidden="true"
      data-os-browser-parking-host="true"
      style={{ pointerEvents: "none" }}
    >
      {browserWindows.map((win) => {
        if (
          (win.appState?.presentation as { kind?: string } | undefined)?.kind === "choose-target" ||
          !win.appState?.url
        ) {
          return null;
        }
        const previewUrl = win.appState.url as string;
        return (
          <OsBrowserIframe key={win.id} windowId={win.id} url={previewUrl} />
        );
      })}
    </div>
  );
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
      <OsBrowserKeepAliveHost />
      {children}
    </MonacoKeepAliveHost>
  );
}
