import type { BrowserBridgeEvent } from "./protocol.js";

/** A delivery envelope supplied by a host-specific bridge channel. */
export interface BrowserBridgeChannelMessage {
  data: unknown;
  origin: string;
  source: unknown;
}

/**
 * Target-side delivery only. The bridge core remains responsible for parsing
 * protocol values and checking origin/source/nonce/request trust.
 */
export interface BrowserBridgeTargetChannel {
  /** The expected parent/host source used by the bridge core trust check. */
  readonly source: unknown;
  send(event: BrowserBridgeEvent, targetOrigin: string): void;
  subscribe(
    listener: (message: BrowserBridgeChannelMessage) => void,
  ): () => void;
  destroy(): void;
}

/** The current web transport: window.parent postMessage plus message events. */
export function createPostMessageBrowserBridgeChannel(
  parentWindow: Window = window.parent,
  listenWindow: Window = window,
): BrowserBridgeTargetChannel {
  const listeners = new Set<(message: BrowserBridgeChannelMessage) => void>();
  let destroyed = false;

  const onMessage = (event: MessageEvent<unknown>) => {
    if (destroyed) return;
    const message: BrowserBridgeChannelMessage = {
      data: event.data,
      origin: event.origin,
      source: event.source,
    };
    listeners.forEach((listener) => listener(message));
  };

  listenWindow.addEventListener("message", onMessage);

  return {
    source: parentWindow,
    send(event, targetOrigin) {
      if (!destroyed) parentWindow.postMessage(event, targetOrigin);
    },
    subscribe(listener) {
      if (destroyed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      listenWindow.removeEventListener("message", onMessage);
    },
  };
}
