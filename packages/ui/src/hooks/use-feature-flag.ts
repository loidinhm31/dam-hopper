import { useMemo, useSyncExternalStore } from "react";
import { getConnectionSnapshot, subscribeConnections } from "@/api/connections.js";
import { getActiveProfileId } from "@/api/server-config.js";
import type { ConnectionRef, ProfileId } from "@/api/ownership.js";

export type FeatureAvailabilityState =
  | "available"
  | "unavailable"
  | "loading"
  | "unknown";

export interface FeatureAvailability {
  state: FeatureAvailabilityState;
  reason?: string;
  isAvailable: boolean;
}

/**
 * Derives owner-local feature availability from profile connection and support status.
 * Does not infer support from another profile or version string.
 */
export function useFeatureAvailability(
  flag: string,
  options?: { owner?: ConnectionRef; profileId?: ProfileId },
): FeatureAvailability {
  const profileId =
    options?.owner?.profileId ??
    options?.profileId ??
    getActiveProfileId();

  const connectionState = useSyncExternalStore(
    subscribeConnections,
    () => {
      const snap = profileId ? getConnectionSnapshot(profileId) : null;
      return snap ? `${snap.status}:${snap.error ?? ""}` : "none";
    },
    () => "none",
  );
  return useMemo<FeatureAvailability>(() => {
    if (!profileId) {
      return {
        state: "unknown",
        reason: "No active or specified profile",
        isAvailable: false,
      };
    }

    const snapshot = getConnectionSnapshot(profileId);
    if (!snapshot) {
      return {
        state: "loading",
        reason: "Connection status loading",
        isAvailable: false,
      };
    }

    if (snapshot.status === "unsupported") {
      return {
        state: "unavailable",
        reason: snapshot.error ?? "Profile unsupported",
        isAvailable: false,
      };
    }

    if (snapshot.status === "connecting") {
      return {
        state: "loading",
        reason: "Connecting to server",
        isAvailable: false,
      };
    }

    if (snapshot.status === "offline" || snapshot.status === "disconnected") {
      return {
        state: "unavailable",
        reason: "Server is offline or disconnected",
        isAvailable: false,
      };
    }

    if (snapshot.status === "login-required") {
      return {
        state: "unavailable",
        reason: snapshot.error ?? "Authentication required",
        isAvailable: false,
      };
    }

    if (snapshot.status === "connected") {
      return {
        state: "available",
        isAvailable: true,
      };
    }

    return {
      state: "unknown",
      reason: `Unknown connection status: ${snapshot.status}`,
      isAvailable: false,
    };
  }, [flag, options?.owner, options?.profileId, profileId, connectionState]);
}

/**
 * Owner-local feature flag check.
 */
export function useFeatureFlag(
  flag: string,
  options?: { owner?: ConnectionRef; profileId?: ProfileId },
): boolean {
  const availability = useFeatureAvailability(flag, options);
  return availability.isAvailable;
}
