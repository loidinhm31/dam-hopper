import {
  parseBrowserBridgeEvent,
  type BrowserBridgeEvent,
} from "@dam-hopper/browser-bridge";
import type { BrowserDebugHostMessage } from "./browser-debug-host.js";

export interface BrowserBridgeTrust {
  /** Exact target origin for this iframe load. */
  origin: string;
  /**
   * Exact, stable source evidence for this load. Web uses WindowProxy;
   * native uses an opaque relay identity validated by its controller.
   */
  source: unknown;
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
  event: MessageEvent<unknown> | BrowserDebugHostMessage,
  trust: BrowserBridgeTrust,
): BrowserBridgeEvent | null {
  if (event.source !== trust.source) return null;
  if (event.origin !== trust.origin) return null;
  const message = parseBrowserBridgeEvent(event.data);
  if (!message || message.nonce !== trust.nonce) return null;
  return trust.requestIds.has(message.requestId) ? message : null;
}
