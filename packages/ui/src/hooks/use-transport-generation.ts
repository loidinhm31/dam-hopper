import { useSyncExternalStore } from "react";
import {
  getTransportGeneration,
  subscribeTransportChanges,
} from "@/api/transport.js";
import {
  getConnectionSnapshot,
  subscribeConnections,
} from "@/api/connections.js";
import type { ProfileId } from "@/api/ownership.js";

/** Re-render on replacement or availability changes of the requested transport. */
export function useTransportGeneration(profileId?: ProfileId): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (profileId) {
        return subscribeConnections(onStoreChange);
      }
      return subscribeTransportChanges(onStoreChange);
    },
    () => {
      if (profileId) {
        const snapshot = getConnectionSnapshot(profileId);
        if (!snapshot) return 0;
        return snapshot.status === "connected"
          ? snapshot.owner.generation
          : -snapshot.owner.generation;
      }
      return getTransportGeneration();
    },
    () => 0,
  );
}
