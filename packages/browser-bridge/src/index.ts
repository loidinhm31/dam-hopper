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
  /** Exact DamHopper parent origin. Wildcards are intentionally rejected. */
  parentOrigin: string;
}

export interface BrowserBridge {
  destroy(): void;
}

function exactOrigin(value: string): string | null {
  try {
    const origin = new URL(value).origin;
    return origin === "null" || origin === "*" ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Installs the target-side bridge. It deliberately exposes no host APIs and only
 * communicates with the configured parent window at its exact origin.
 */
export function installBrowserBridge(
  options: BrowserBridgeOptions,
): BrowserBridge {
  const parentOrigin = exactOrigin(options.parentOrigin);
  if (!parentOrigin)
    throw new Error("Browser bridge requires an exact parent origin");

  let activeNonce: string | null = null;
  let activeRequestId: string | null = null;
  const post = (event: BrowserBridgeEvent): void =>
    window.parent.postMessage(event, parentOrigin);
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
    if (event.source !== window.parent || event.origin !== parentOrigin) return;
    const command = parseBrowserBridgeCommand(event.data);
    if (!command) return;

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
