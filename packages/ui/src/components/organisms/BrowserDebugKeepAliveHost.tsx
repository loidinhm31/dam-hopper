import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  BROWSER_BRIDGE_VERSION,
  type BrowserBridgeCommand,
} from "@dam-hopper/browser-bridge";
import type { BrowserDebugController } from "@/hooks/use-browser-debug.js";
import {
  createBrowserDebugId,
  getBrowserDebugViewportFrame,
  type BrowserDebugViewportFrame,
} from "@/lib/browser-debug-keep-alive.js";
import { parseTrustedBrowserBridgeEvent } from "@/lib/browser-debug-protocol.js";

export interface BrowserDebugKeepAliveHostProps {
  browser: BrowserDebugController;
  viewportRef: RefObject<HTMLDivElement | null>;
  viewportVersion: number;
  isViewportVisible: boolean;
}

export interface BrowserDebugKeepAliveHandle {
  startPicker: () => void;
  stopPicker: () => void;
}

/**
 * Keeps one browser iframe alive while tool shells change. The iframe is
 * moved between a visible viewport and this hidden parking container; it is
 * never recreated merely because Browser is hidden, maximized, or changes shell.
 */
export const BrowserDebugKeepAliveHost = forwardRef<
  BrowserDebugKeepAliveHandle,
  BrowserDebugKeepAliveHostProps
>(function BrowserDebugKeepAliveHost({
  browser,
  viewportRef,
  viewportVersion,
  isViewportVisible,
}, ref) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [viewportFrame, setViewportFrame] =
    useState<BrowserDebugViewportFrame | null>(null);
  const bridgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trustRef = useRef<{
    origin: string;
    source: Window;
    nonce: string;
    requestIds: Set<string>;
  } | null>(null);

  const sendConnect = useCallback(() => {
    const iframe = iframeRef.current;
    const target = browser.target;
    const source = iframe?.contentWindow;
    if (!iframe || !target || !source || iframe.getAttribute("src") !== target.url)
      return;

    // A target reload gets a fresh bridge nonce. Do not let selection or
    // capture state from the previous document cross that trust boundary.
    browser.setSelection(null);
    browser.setPickerActive(false);
    browser.setError(null);

    const nonce = createBrowserDebugId();
    const requestId = createBrowserDebugId();
    if (!nonce || !requestId) {
      browser.setBridgeStatus("unsupported");
      browser.setError("Browser cryptographic entropy is unavailable.");
      return;
    }
    trustRef.current = {
      origin: target.origin,
      source,
      nonce,
      requestIds: new Set([requestId]),
    };
    const command: BrowserBridgeCommand = {
      version: BROWSER_BRIDGE_VERSION,
      type: "dam-hopper:connect",
      nonce,
      requestId,
    };
    source.postMessage(command, target.origin);
    browser.setBridgeStatus("loading");
    if (bridgeTimeoutRef.current) clearTimeout(bridgeTimeoutRef.current);
    bridgeTimeoutRef.current = setTimeout(() => {
      if (trustRef.current?.nonce !== nonce) return;
      trustRef.current = null;
      browser.setBridgeStatus("unsupported");
      browser.setError(
        `No Browser Debug response from ${target.url}. Verify this URL is reachable from the browser (forward the target port over SSH), then load or reload the unpacked DamHopper Browser Debug extension and click Load again.`,
      );
    }, 5_000);
  }, [browser]);

  const sendPickerCommand = useCallback(
    (type: "dam-hopper:start-picker" | "dam-hopper:stop-picker") => {
      const trust = trustRef.current;
      const source = iframeRef.current?.contentWindow;
      if (!trust || !source) return;
      const requestId = createBrowserDebugId();
      if (!requestId) {
        browser.setBridgeStatus("error");
        browser.setError("Browser cryptographic entropy is unavailable.");
        return;
      }
      trust.requestIds.add(requestId);
      const command: BrowserBridgeCommand = {
        version: BROWSER_BRIDGE_VERSION,
        type,
        nonce: trust.nonce,
        requestId,
      };
      source.postMessage(command, trust.origin);
      browser.setPickerActive(type === "dam-hopper:start-picker");
    },
    [browser],
  );

  useImperativeHandle(
    ref,
    () => ({
      startPicker: () => sendPickerCommand("dam-hopper:start-picker"),
      stopPicker: () => sendPickerCommand("dam-hopper:stop-picker"),
    }),
    [sendPickerCommand],
  );

  useEffect(() => {
    const listener = (event: MessageEvent<unknown>) => {
      const trust = trustRef.current;
      if (!trust) return;
      const message = parseTrustedBrowserBridgeEvent(event, trust);
      if (!message) return;
      if (message.type === "dam-hopper:bridge-ready") {
        if (bridgeTimeoutRef.current) clearTimeout(bridgeTimeoutRef.current);
        browser.setBridgeStatus("ready");
        browser.setError(null);
        return;
      }
      if (message.type === "dam-hopper:selection") {
        browser.setSelection(message.selection);
        browser.setPickerActive(false);
        return;
      }
      browser.setBridgeStatus("error");
      browser.setError(message.message);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [browser]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    trustRef.current = null;
    if (bridgeTimeoutRef.current) clearTimeout(bridgeTimeoutRef.current);
    if (!browser.target) {
      iframe.removeAttribute("src");
      return;
    }
    iframe.src = browser.target.url;
  }, [browser.target]);

  useEffect(
    () => () => {
      if (bridgeTimeoutRef.current) clearTimeout(bridgeTimeoutRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!isViewportVisible) return;
    const viewport = viewportRef.current;
    const updateFrame = () =>
      setViewportFrame(getBrowserDebugViewportFrame(viewport));
    updateFrame();
    if (!viewport) return;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateFrame);
    observer?.observe(viewport);
    window.addEventListener("resize", updateFrame);
    window.addEventListener("scroll", updateFrame, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateFrame);
      window.removeEventListener("scroll", updateFrame, true);
    };
  }, [browser.target, isViewportVisible, viewportRef, viewportVersion]);

  const effectiveViewportFrame = isViewportVisible ? viewportFrame : null;

  return (
    <div
      aria-hidden={effectiveViewportFrame === null}
      style={{
        position: "fixed",
        visibility: effectiveViewportFrame ? "visible" : "hidden",
        pointerEvents: effectiveViewportFrame ? "auto" : "none",
        width: effectiveViewportFrame?.width ?? 0,
        height: effectiveViewportFrame?.height ?? 0,
        top: effectiveViewportFrame?.top ?? -10000,
        left: effectiveViewportFrame?.left ?? -10000,
        overflow: "hidden",
        zIndex: 30,
      }}
    >
      <iframe
        ref={iframeRef}
        title="Browser debug target"
        className="h-full w-full border-0"
        referrerPolicy="no-referrer"
        onLoad={sendConnect}
      />
    </div>
  );
});
