import { useCallback, useEffect, useMemo, useState } from "react";
import { getConnectionSnapshot } from "@/api/connections.js";
import { parseTerminalKey } from "@/api/ownership.js";
import {
  mapTerminalRowAvailability,
  type TerminalCloseRequest,
  type TerminalInventoryTerminationState,
  type TerminalTarget,
} from "@/api/terminal-session-contract.js";
import {
  loadPinnedTerminalIds,
  retainPinnedTerminalIds,
  savePinnedTerminalIds,
  setPinnedTerminalId,
  type TerminalPinStorage,
} from "@/lib/terminal-pin-persistence.js";
import {
  useTerminalClose,
  type TerminalCloseContextValue,
} from "../terminal-close-context.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";

export interface UseHubTerminalTabActionsOptions {
  readonly hubWindowId: string;
  readonly groups: readonly TraditionalTerminalProjectGroup[];
  readonly runtimeIndex: ReadonlyMap<string, TerminalTarget>;
  onSelectTab(sessionId: string): void;
  onClearSelection?(): void;
  /** Injectable source of the close coordinator (defaults to the context hook; always invoked unconditionally). */
  terminalCloseSource?: () => TerminalCloseContextValue;
  pinStorage?: TerminalPinStorage;
  terminalInventoryLoaded?: boolean;
  loadedProfileIds?: ReadonlySet<string>;
}

export interface UseHubTerminalTabActionsResult {
  readonly actionNotice: string | null;
  isTabPinned(sessionId: string): boolean;
  onToggleTabPin(sessionId: string): void;
  onCloseTab(sessionId: string, preferredFallbackSessionId?: string): void;
  clearActionNotice(): void;
}

function arePinMapsEqual(
  a: ReadonlyMap<string, ReadonlySet<string>>,
  b: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [prof, setA] of a) {
    const setB = b.get(prof);
    if (!setB || setA.size !== setB.size) return false;
    for (const id of setA) {
      if (!setB.has(id)) return false;
    }
  }
  return true;
}

export function useHubTerminalTabActions(
  options: UseHubTerminalTabActionsOptions,
): UseHubTerminalTabActionsResult {
  const {
    hubWindowId,
    groups,
    runtimeIndex,
    onSelectTab,
    onClearSelection,
    terminalCloseSource = useTerminalClose,
    pinStorage,
    terminalInventoryLoaded = true,
    loadedProfileIds,
  } = options;

  let terminalClose: TerminalCloseContextValue | null = null;
  try {
    terminalClose = terminalCloseSource();
  } catch {
    terminalClose = null;
  }

  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Per-profile pinned terminal IDs: Map<profileId, Set<terminalId>>
  const [pinnedByProfile, setPinnedByProfile] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(() => new Map());

  // Extract profiles present in groups
  const profileIds = useMemo(() => {
    const set = new Set<string>();
    for (const group of groups) {
      if (group.profileId) set.add(group.profileId);
      for (const tab of group.terminalTabs) {
        if (tab.profileId) set.add(tab.profileId);
      }
    }
    return Array.from(set);
  }, [groups]);

  // Load and retain pins against live sessions (prune only after terminal inventory is confirmed loaded)
  useEffect(() => {
    const nextMap = new Map<string, ReadonlySet<string>>();

    for (const profileId of profileIds) {
      const stored = loadPinnedTerminalIds(pinStorage, profileId);
      // Protect stored pins during loading, disconnection, or when inventory has not yet loaded for this profile
      const isProfileLoaded = loadedProfileIds
        ? loadedProfileIds.has(profileId)
        : Boolean(terminalInventoryLoaded);
      const conn = getConnectionSnapshot(profileId);
      if (!isProfileLoaded || (conn && conn.status !== "connected")) {
        nextMap.set(profileId, stored);
        continue;
      }
      const liveIds = new Set<string>();
      for (const group of groups) {
        for (const tab of group.terminalTabs) {
          const parsed = parseTerminalKey(tab.sessionId);
          if (parsed && parsed.profileId === profileId) {
            liveIds.add(parsed.id);
          }
        }
      }

      const retained = retainPinnedTerminalIds(stored, liveIds);
      nextMap.set(profileId, retained);

      if (retained.size !== stored.size) {
        savePinnedTerminalIds(retained, pinStorage, profileId);
      }
    }

    setPinnedByProfile((prev) => {
      if (arePinMapsEqual(prev, nextMap)) return prev;
      return nextMap;
    });
  }, [groups, loadedProfileIds, pinStorage, profileIds, terminalInventoryLoaded]);

  const isTabPinned = useCallback(
    (sessionId: string): boolean => {
      const parsed = parseTerminalKey(sessionId);
      if (!parsed) return false;
      const pins = pinnedByProfile.get(parsed.profileId);
      return pins ? pins.has(parsed.id) : false;
    },
    [pinnedByProfile],
  );

  const onToggleTabPin = useCallback(
    (sessionId: string) => {
      const parsed = parseTerminalKey(sessionId);
      if (!parsed) return;

      const profileId = parsed.profileId;
      const terminalId = parsed.id;
      const currentPins = pinnedByProfile.get(profileId) ?? new Set<string>();
      const currentlyPinned = currentPins.has(terminalId);
      const nextPins = setPinnedTerminalId(
        currentPins,
        terminalId,
        !currentlyPinned,
      );

      savePinnedTerminalIds(nextPins, pinStorage, profileId);
      setPinnedByProfile((prev) => {
        const next = new Map(prev);
        next.set(profileId, nextPins);
        return next;
      });
    },
    [pinStorage, pinnedByProfile],
  );

  const onCloseTab = useCallback(
    (sessionId: string, preferredFallbackSessionId?: string) => {
      if (isTabPinned(sessionId)) {
        setActionNotice("Cannot close pinned terminal tab; unpin it first.");
        return;
      }

      let rowState: TerminalInventoryTerminationState | undefined = undefined;
      for (const group of groups) {
        const tab = group.terminalTabs.find((t) => t.sessionId === sessionId);
        if (tab) {
          rowState =
            (
              tab.session as
                | { terminationState?: TerminalInventoryTerminationState }
                | undefined
            )?.terminationState ?? (tab.session?.alive ? "live" : "exited");
          break;
        }
      }

      const availability = mapTerminalRowAvailability(rowState);
      const isDead =
        rowState === "exited" || rowState === "restartCancelled";

      let closedOnce = false;
      const onCloseView = () => {
        if (closedOnce) return;
        closedOnce = true;
        if (preferredFallbackSessionId) {
          onSelectTab(preferredFallbackSessionId);
        } else {
          onClearSelection?.();
        }
      };

      // 1. Try closing via terminalClose coordinator if exact target is in runtimeIndex
      const renderedTarget = runtimeIndex.get(sessionId);
      if (renderedTarget && terminalClose) {
        const closeRequest: TerminalCloseRequest = {
          windowId: hubWindowId,
          entry: "pane-tab",
          target: renderedTarget,
          availability,
        };

        terminalClose.requestTerminalClose(closeRequest, onCloseView);
        return;
      }

      // If the session is already dead or exited, unpin and dismiss local view tab
      if (isDead) {
        onCloseView();
        return;
      }

      // Live terminal without authoritative target or coordinator must fail closed
      setActionNotice(
        "Cannot close terminal: Session target is unavailable or disconnected.",
      );
    },
    [
      isTabPinned,
      groups,
      hubWindowId,
      onClearSelection,
      onSelectTab,
      runtimeIndex,
      terminalClose,
    ],
  );

  const clearActionNotice = useCallback(() => {
    setActionNotice(null);
  }, []);

  return {
    actionNotice,
    isTabPinned,
    onToggleTabPin,
    onCloseTab,
    clearActionNotice,
  };
}
