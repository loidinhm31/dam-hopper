/**
 * Transport lifecycle utilities — reinitialize connection without page reload.
 */

import { getTransport, reconfigureTransport } from "./transport.js";
import { IdleTransport } from "./idle-transport.js";
import { WsTransport } from "./ws-transport.js";
import { resetTransportListeners } from "@/hooks/use-sse.js";

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
  const transportUrl = resolveTransportUrl(newServerUrl);

  // 1. Get the current transport and destroy it (closes WebSocket, cleans up listeners)
  const oldTransport = getTransport();
  if (
    oldTransport &&
    "destroy" in oldTransport &&
    typeof oldTransport.destroy === "function"
  ) {
    oldTransport.destroy();
  }

  // 2. Reset all push event listeners so they can be re-registered with the new transport
  resetTransportListeners();

  // 3. Use an idle transport when no profile remains, so the old authenticated
  // transport cannot reconnect after the last profile is deleted.
  const newTransport = transportUrl
    ? new WsTransport(transportUrl, profileId)
    : new IdleTransport();

  // 4. Install the new transport globally
  reconfigureTransport(newTransport);
}

function resolveTransportUrl(newServerUrl?: string): string | undefined {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return newServerUrl;
  }
  if (document.documentElement.dataset.appHost !== "native") {
    return newServerUrl;
  }
  if (!newServerUrl) return undefined;

  try {
    return new URL(newServerUrl, window.location.href).origin ===
      window.location.origin
      ? newServerUrl
      : undefined;
  } catch {
    return undefined;
  }
}
