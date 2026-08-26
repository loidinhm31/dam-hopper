import { createPicker } from "./picker.js";
import { observeConsole, observeNavigation } from "./browser-observers.js";
import {
  createPostMessageBrowserBridgeChannel,
  type BrowserBridgeTargetChannel,
} from "./bridge-channel.js";
import {
  BROWSER_BRIDGE_VERSION,
  parseBrowserBridgeCommand,
  type BrowserBridgeErrorCode,
  type BrowserBridgeEvent,
  type BrowserBridgeCapability,
  type BrowserConsoleLevel,
  type BrowserSelectionV1,
} from "./protocol.js";

export * from "./protocol.js";
export * from "./extension-presence.js";
export * from "./bridge-channel.js";

export interface BrowserBridgeOptions {
  /** Optional exact parent origin for consumers that know it in advance. */
  parentOrigin?: string;
  /** Exact deployed DamHopper parent origins in addition to loopback origins. */
  allowedParentOrigins?: readonly string[];
  /** Optional host transport; defaults to the current parent-window channel. */
  channel?: BrowserBridgeTargetChannel;
  /** Capabilities reported by a host-provided channel. */
  capabilities?: readonly BrowserBridgeCapability[];
}

export interface BrowserBridge {
  destroy(): void;
}

export function isAllowedParentOrigin(
  origin: string,
  options: BrowserBridgeOptions,
): boolean {
  if (options.parentOrigin) return options.parentOrigin === origin;
  if (options.allowedParentOrigins) {
    return options.allowedParentOrigins.includes(origin);
  }
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
  const channel = options.channel ?? createPostMessageBrowserBridgeChannel();
  let activeNonce: string | null = null;
  let activeRequestId: string | null = null;
  let activeParentOrigin: string | null = null;
  const capabilities: BrowserBridgeCapability[] = options.capabilities
    ? [...options.capabilities]
    : options.parentOrigin || options.allowedParentOrigins?.length
      ? ["navigation", "console"]
      : [];
  const post = (event: BrowserBridgeEvent): void => {
    if (activeParentOrigin) channel.send(event, activeParentOrigin);
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
  const sendNavigation = () => {
    if (
      !capabilities.includes("navigation") ||
      !activeNonce ||
      !activeRequestId
    )
      return;
    post({
      version: BROWSER_BRIDGE_VERSION,
      type: "dam-hopper:navigation",
      nonce: activeNonce,
      requestId: activeRequestId,
      url: window.location.href,
    });
  };
  const sendConsole = (level: BrowserConsoleLevel, message: string) => {
    if (!capabilities.includes("console") || !activeNonce || !activeRequestId)
      return;
    post({
      version: BROWSER_BRIDGE_VERSION,
      type: "dam-hopper:console",
      nonce: activeNonce,
      requestId: activeRequestId,
      level,
      message,
    });
  };
  const stopNavigationObserver = observeNavigation(sendNavigation);
  const stopConsoleObserver = observeConsole(sendConsole);
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

  const onMessage = (message: {
    data: unknown;
    origin: string;
    source: unknown;
  }): void => {
    if (message.source !== channel.source) return;
    if (activeParentOrigin && message.origin !== activeParentOrigin) return;
    const command = parseBrowserBridgeCommand(message.data);
    if (!command) return;

    if (command.type === "dam-hopper:connect") {
      if (!isAllowedParentOrigin(message.origin, options)) return;
      picker.stop();
      activeParentOrigin = message.origin;
      activeNonce = command.nonce;
      activeRequestId = command.requestId;
      post({
        version: BROWSER_BRIDGE_VERSION,
        type: "dam-hopper:bridge-ready",
        nonce: command.nonce,
        requestId: command.requestId,
        capabilities,
      });
      sendNavigation();
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
    if (
      command.type === "dam-hopper:go-back" &&
      capabilities.includes("navigation")
    ) {
      picker.stop();
      history.back();
      return;
    }
    if (
      command.type === "dam-hopper:go-forward" &&
      capabilities.includes("navigation")
    ) {
      picker.stop();
      history.forward();
      return;
    }
    if (
      command.type === "dam-hopper:reload" &&
      capabilities.includes("navigation")
    ) {
      picker.stop();
      window.location.reload();
      return;
    }
    picker.stop();
  };

  const unsubscribe = channel.subscribe(onMessage);
  let destroyed = false;
  return {
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      picker.stop();
      stopNavigationObserver();
      stopConsoleObserver();
      unsubscribe();
      channel.destroy();
      activeNonce = null;
      activeRequestId = null;
      activeParentOrigin = null;
    },
  };
}
