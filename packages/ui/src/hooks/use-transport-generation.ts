import { useSyncExternalStore } from "react";
import {
  getTransportGeneration,
  subscribeTransportChanges,
} from "@/api/transport.js";

/** Re-render consumers when the active WebSocket/REST transport is replaced. */
export function useTransportGeneration(): number {
  return useSyncExternalStore(
    subscribeTransportChanges,
    getTransportGeneration,
    getTransportGeneration,
  );
}
