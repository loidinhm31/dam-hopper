import { createPicker } from "./picker.js";
import {
  BROWSER_BRIDGE_VERSION,
  parseBrowserBridgeCommand,
  type BrowserBridgeErrorCode,
  type BrowserBridgeEvent,
  type BrowserSelectionV1,
} from "./protocol.js";

export * from "./protocol.js";

export interface BrowserBridgeOptions {
  /** Retained for source compatibility; parent-origin validation is not used. */
  parentOrigin?: string;
}

export interface BrowserBridge {
  destroy(): void;
}

const BROWSER_DEBUG_LOG_PREFIX = "[DamHopper Browser Debug]";

function shortId(value: string): string {
  return value.slice(0, 8);
}

/**
 * Installs the target-side bridge. It deliberately exposes no host APIs and only
 * communicates with the parent window. Parent-origin validation is deliberately
 * omitted so forwarded localhost ports and development hosts work without
 * target-side configuration; messages remain bound to the parent WindowProxy,
 * active nonce, request ID, and versioned schema.
 */
export function installBrowserBridge(
  options: BrowserBridgeOptions = {},
): BrowserBridge {
  void options;
  let activeNonce: string | null = null;
  let activeRequestId: string | null = null;
  console.info(`${BROWSER_DEBUG_LOG_PREFIX} bridge-installed`, {
    origin: window.location.origin,
    path: window.location.pathname,
    framed: window.parent !== window,
  });
  const post = (event: BrowserBridgeEvent): void => {
    window.parent.postMessage(event, "*");
    console.info(`${BROWSER_DEBUG_LOG_PREFIX} event-sent`, {
      type: event.type,
      targetOrigin: "*",
      nonce: shortId(event.nonce),
      requestId: shortId(event.requestId),
    });
  };
  const sendError = (
    code: BrowserBridgeErrorCode,
    message: string,
    nonce: string,
    requestId: string,
  ): void => {
    post({
      version: BROWSER_BRIDGE_VERSION,
      type: "dam-hopper:error",
      code,
      message,
      nonce,
      requestId,
    });
  };
  const picker = createPicker({
    onSelection: (selection: BrowserSelectionV1) => {
      if (activeNonce && activeRequestId) {
        post({
          version: BROWSER_BRIDGE_VERSION,
          type: "dam-hopper:selection",
          nonce: activeNonce,
          requestId: activeRequestId,
          selection,
        });
      }
    },
    onError: (code, message) => {
      if (activeNonce && activeRequestId)
        sendError(
          "picker_failed",
          `${code}: ${message}`,
          activeNonce,
          activeRequestId,
        );
    },
  });

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== window.parent) return;
    const command = parseBrowserBridgeCommand(event.data);
    if (!command) return;

    console.info(`${BROWSER_DEBUG_LOG_PREFIX} command-received`, {
      type: command.type,
      eventOrigin: event.origin,
      nonce: shortId(command.nonce),
      requestId: shortId(command.requestId),
    });

    if (command.type === "dam-hopper:connect") {
      picker.stop();
      activeNonce = command.nonce;
      activeRequestId = command.requestId;
      post({
        version: BROWSER_BRIDGE_VERSION,
        type: "dam-hopper:bridge-ready",
        nonce: command.nonce,
        requestId: command.requestId,
      });
      return;
    }
    if (command.nonce !== activeNonce) return;
    activeRequestId = command.requestId;
    if (command.type === "dam-hopper:start-picker") {
      try {
        picker.start();
        console.info(`${BROWSER_DEBUG_LOG_PREFIX} picker-started`);
      } catch {
        sendError(
          "picker_unavailable",
          "Picker could not start",
          command.nonce,
          command.requestId,
        );
      }
      return;
    }
    picker.stop();
  };

  window.addEventListener("message", onMessage);
  return {
    destroy: () => {
      picker.stop();
      window.removeEventListener("message", onMessage);
      activeNonce = null;
      activeRequestId = null;
    },
  };
}
