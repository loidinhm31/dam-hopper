import { createPicker } from "./picker.js";
import {
  BROWSER_BRIDGE_VERSION,
  parseBrowserBridgeCommand,
  type BrowserBridgeErrorCode,
  type BrowserBridgeEvent,
  type BrowserSelectionV1,
} from "./protocol.js";

export * from "./protocol.js";
export * from "./extension-presence.js";

export interface BrowserBridgeOptions {
  /** Optional exact parent origin for consumers that know it in advance. */
  parentOrigin?: string;
  /** Exact deployed DamHopper parent origins in addition to loopback origins. */
  allowedParentOrigins?: readonly string[];
}

export interface BrowserBridge {
  destroy(): void;
}

export function isAllowedParentOrigin(
  origin: string,
  options: BrowserBridgeOptions,
): boolean {
  if (options.parentOrigin) return options.parentOrigin === origin;
  if (options.allowedParentOrigins?.includes(origin)) return true;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]" ||
        url.hostname === "::1")
    );
  } catch {
    return false;
  }
}

/** Installs the target-side bridge without exposing host APIs or page privileges. */
export function installBrowserBridge(
  options: BrowserBridgeOptions = {},
): BrowserBridge {
  let activeNonce: string | null = null;
  let activeRequestId: string | null = null;
  let activeParentOrigin: string | null = null;
  const post = (event: BrowserBridgeEvent): void => {
    if (activeParentOrigin)
      window.parent.postMessage(event, activeParentOrigin);
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
    if (activeParentOrigin && event.origin !== activeParentOrigin) return;
    const command = parseBrowserBridgeCommand(event.data);
    if (!command) return;

    if (command.type === "dam-hopper:connect") {
      if (!isAllowedParentOrigin(event.origin, options)) return;
      picker.stop();
      activeParentOrigin = event.origin;
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
      activeParentOrigin = null;
    },
  };
}
