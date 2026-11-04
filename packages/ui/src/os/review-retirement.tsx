import { useEffect, useRef, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { OsWindow } from "./types.js";
import { useWindowStore } from "./window-store.js";
import type { ReviewTarget } from "@/api/terminal-session-contract.js";
import type { ConnectionRef } from "@/api/ownership.js";
import {
  cancelReviewQueries,
  removeReviewQueries,
  purgeOwnerReviewQueries,
  useSessionChangesEnabled,
} from "@/api/session-changes-queries.js";
import {
  getConnectionSnapshot,
  subscribeConnections,
} from "@/api/connections.js";
import {
  getProfiles,
  subscribeToProfileChanges,
} from "@/api/server-config.js";

export interface ReviewRetirementGuardProps {
  window: OsWindow;
}

/**
 * Root guard mounted per protected Review window across all desktops,
 * including minimized and hidden windows.
 *
 * Subscribes to connection and profile config changes.
 * On disable, disconnect, or owner retirement:
 * - Synchronously removes live/protected viewer eligibility
 * - Cancels in-flight requests and purges affected TanStack queries
 * - Strips captured Review tuple, root, baseline, and generation from runtime/appState
 * - Retains content-free explanation UI
 */
export function ReviewRetirementGuard({ window }: ReviewRetirementGuardProps) {
  const qc = useQueryClient();

  const target: ReviewTarget | null =
    window.runtimeIdentity?.kind === "review"
      ? window.runtimeIdentity.target
      : (window.appState?.target as ReviewTarget | undefined) ?? null;

  const targetRef = useRef<ReviewTarget | null>(target);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  const owner: ConnectionRef | undefined = useMemo(() => {
    if (!target) return undefined;
    return {
      profileId: target.profileId,
      generation: target.generation,
    };
  }, [target]);

  const { enabled: isTrackingEnabled, isLoading: isTrackingLoading, error: trackingError } =
    useSessionChangesEnabled(owner);
  const retireProtectedReview = useCallback(
    (reason: string) => {
      const currentTarget = targetRef.current;
      if (!currentTarget) return;

      // 1. Cancel and purge queries for this exact review identity
      void cancelReviewQueries(qc, currentTarget);
      removeReviewQueries(qc, currentTarget);

      // 2. Purge owner review queries on retirement
      void purgeOwnerReviewQueries(qc, {
        profileId: currentTarget.profileId,
        generation: currentTarget.generation,
      });

      // 3. Synchronously remove runtime identity and strip ReviewTarget from appState
      const currentWin = useWindowStore.getState().session.windows[window.id];
      if (currentWin) {
        useWindowStore.getState().setSession({
          ...useWindowStore.getState().session,
          windows: {
            ...useWindowStore.getState().session.windows,
            [window.id]: {
              ...currentWin,
              runtimeIdentity: undefined,
              appState: {
                ...currentWin.appState,
                target: undefined,
                terminalId: undefined,
                terminalIncarnation: undefined,
                ompSessionId: undefined,
                serverEpoch: undefined,
                rootId: undefined,
                baselineId: undefined,
                generation: undefined,
                retiredReason: reason,
              },
            },
          },
        });
      }
    },
    [qc, window.id],
  );

  useEffect(() => {
    if (!target) return;

    const checkRetirement = () => {
      const currentTarget = targetRef.current;
      if (!currentTarget) return;

      const profiles = getProfiles();
      const profileExists = profiles.some((p) => p.id === currentTarget.profileId);
      if (!profileExists) {
        retireProtectedReview("profile_removed");
        return;
      }

      const snap = getConnectionSnapshot(currentTarget.profileId);
      if (!snap || snap.status !== "connected") {
        retireProtectedReview("connection_disconnected");
        return;
      }

      if (snap.owner.generation !== currentTarget.generation) {
        retireProtectedReview("generation_retired");
        return;
      }
    };

    checkRetirement();

    const unsubConn = subscribeConnections(checkRetirement);
    const unsubProf = subscribeToProfileChanges(checkRetirement);

    return () => {
      unsubConn();
      unsubProf();
    };
  }, [target, retireProtectedReview]);

  // Retire if tracking is confirmed disabled
  useEffect(() => {
    if (target && !isTrackingLoading && !trackingError && !isTrackingEnabled) {
      retireProtectedReview("tracking_disabled");
    }
  }, [target, isTrackingLoading, trackingError, isTrackingEnabled, retireProtectedReview]);

  return null;
}

/**
 * Root host that renders a ReviewRetirementGuard for every active or
 * minimized/hidden Review window across all desktops.
 */
export function ReviewRetirementHost() {
  const windows = useWindowStore((state) => state.session.windows);
  const reviewWindows = Object.values(windows).filter(
    (w) =>
      w.appId === "session-changes" &&
      (w.runtimeIdentity?.kind === "review" || Boolean(w.appState?.target)),
  );

  return (
    <>
      {reviewWindows.map((win) => (
        <ReviewRetirementGuard key={win.id} window={win} />
      ))}
    </>
  );
}
