import {
  parseBrowserBridgeEvent,
  type BrowserBridgeEvent,
} from "@dam-hopper/browser-bridge";

export interface BrowserBridgeTrust {
  /** Exact URL origin of the currently loaded target iframe. */
  origin: string;
  /** The exact WindowProxy from iframe.contentWindow for this load. */
  source: Window;
  /** Replaced on every iframe navigation or parent reconnect. */
  nonce: string;
  /** Only requests issued for the current nonce may change UI state. */
  requestIds: ReadonlySet<string>;
}

/**
 * Fail-closed parent parser. Callers replace this trust object whenever the
 * iframe navigates, so stale messages cannot mutate the Browser tool state.
 */
export function parseTrustedBrowserBridgeEvent(
  event: MessageEvent<unknown>,
  trust: BrowserBridgeTrust,
): BrowserBridgeEvent | null {
  if (event.origin !== trust.origin || event.source !== trust.source)
    return null;
  const message = parseBrowserBridgeEvent(event.data);
  if (!message || message.nonce !== trust.nonce) return null;
  return trust.requestIds.has(message.requestId) ? message : null;
}
