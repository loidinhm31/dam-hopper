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

/** Re-render consumers when the active WebSocket/REST transport is replaced. */
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
        return getConnectionSnapshot(profileId)?.owner.generation ?? 0;
      }
      return getTransportGeneration();
    },
    () => 0,
  );
}
