/**
 * Transport lifecycle utilities — reinitialize connection without page reload.
 */

import { getTransport, reconfigureTransport } from "./transport.js";
import { connectProfile } from "./connections.js";
import { IdleTransport } from "./idle-transport.js";
import { WsTransport } from "./ws-transport.js";
import {
  initTransportListeners,
  resetTransportListeners,
} from "@/hooks/use-sse.js";
/**
 * Reinitialize the transport with a new server URL.
 * Destroys the old WebSocket connection, creates a new one, and resets event listeners.
 *
 * @param newServerUrl - The new server URL to connect to
 */
export function reinitializeTransport(
  newServerUrl?: string,
  profileId?: string,
): void {
  if (profileId) {
    void connectProfile(profileId).catch(() => {});
  }
  const transportUrl = newServerUrl;

  // 1. Get the current transport and destroy it (closes WebSocket, cleans up listeners)
  const oldTransport = getTransport();
  if (
    oldTransport &&
    "destroy" in oldTransport &&
    typeof oldTransport.destroy === "function"
  ) {
    oldTransport.destroy();
  }

  // 2. Remove push listeners owned by the old transport.
  resetTransportListeners();

  // 3. Use an idle transport when no profile remains, so the old authenticated
  // transport cannot reconnect after the last profile is deleted.
  const newTransport = transportUrl
    ? new WsTransport(transportUrl, profileId)
    : new IdleTransport();

  // 4. Install the new transport and attach its push listeners immediately.
  reconfigureTransport(newTransport);
  initTransportListeners();
}

