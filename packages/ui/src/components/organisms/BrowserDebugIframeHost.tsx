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
  getBrowserDebugViewportGeometry,
  type BrowserDebugViewportGeometry,
  type BrowserDebugViewportFrame,
} from "@/lib/browser-debug-keep-alive.js";
import {
  type BrowserDebugHostEvent,
  type BrowserDebugHostEventPayload,
  type BrowserDebugHostCapability,
  type BrowserDebugHost,
  type BrowserDebugHostCommand,
  type BrowserDebugHostViewport,
} from "@/lib/browser-debug-host.js";
import type { BrowserDebugTarget } from "@/lib/browser-debug-origin.js";
import { parseTrustedBrowserBridgeEvent } from "@/lib/browser-debug-protocol.js";

export interface BrowserDebugIframeHostProps {
  browser: BrowserDebugController;
  viewportRef: RefObject<HTMLDivElement | null>;
  viewportStageRef?: RefObject<HTMLDivElement | null>;
  viewportVersion: number;
  isViewportVisible: boolean;
  onHostEvent?: (event: BrowserDebugHostEvent) => void;
}

export interface BrowserDebugIframeHostHandle extends BrowserDebugHost {
  startPicker: () => void;
  stopPicker: () => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
}

function protocolCapabilities(
  capabilities: readonly ("navigation" | "console")[],
): BrowserDebugHostCapability[] {
  return ["picker", ...capabilities];
}

/** Web host adapter. It owns one stable iframe and emits normalized events. */
export const BrowserDebugIframeHost = forwardRef<
  BrowserDebugIframeHostHandle,
  BrowserDebugIframeHostProps
>(function BrowserDebugIframeHost(
  {
    browser,
    viewportRef,
    viewportStageRef,
    viewportVersion,
    isViewportVisible,
    onHostEvent,
  },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [viewportGeometry, setViewportGeometry] =
    useState<BrowserDebugViewportGeometry | null>(null);
  const [hostTarget, setHostTarget] = useState<
    BrowserDebugTarget | null | undefined
  >(undefined);
  const [hostViewport, setHostViewport] = useState<
    BrowserDebugHostViewport | null | undefined
  >(undefined);
  const bridgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const destroyedRef = useRef(false);
  const listenersRef = useRef(
    new Set<(event: BrowserDebugHostEvent) => void>(),
  );
  const trustRef = useRef<{
    origin: string;
    source: unknown;
    nonce: string;
    requestIds: Set<string>;
  } | null>(null);

  const target = hostTarget === undefined ? browser.target : hostTarget;

  const emitHostEvent = useCallback(
    (event: BrowserDebugHostEventPayload) => {
      const normalizedEvent: BrowserDebugHostEvent = {
        ...event,
        generation: generationRef.current,
      };
      if (destroyedRef.current) return;
      onHostEvent?.(normalizedEvent);
      listenersRef.current.forEach((listener) => listener(normalizedEvent));
    },
    [onHostEvent],
  );

  const sendConnect = useCallback(() => {
    const iframe = iframeRef.current;
    const source = iframe?.contentWindow;
    if (
      !iframe ||
      !target ||
      !source ||
      iframe.getAttribute("src") !== target.url
    )
      return;

    generationRef.current += 1;
    browser.setSelection(null);
    browser.setPickerActive(false);
    browser.setBridgeCapabilities([]);
    browser.setError(null);

    const nonce = createBrowserDebugId();
    const requestId = createBrowserDebugId();
    if (!nonce || !requestId) {
      emitHostEvent({
        type: "status",
        status: "unsupported",
        message: "Browser cryptographic entropy is unavailable.",
      });
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
    emitHostEvent({ type: "status", status: "loading" });
    if (bridgeTimeoutRef.current) clearTimeout(bridgeTimeoutRef.current);
    bridgeTimeoutRef.current = setTimeout(() => {
      if (trustRef.current?.nonce !== nonce) return;
      trustRef.current = null;
      emitHostEvent({
        type: "status",
        status: "unsupported",
        message: `No Browser Debug response from ${target.url}. Verify this URL is reachable from the browser (forward the target port over SSH), then load or reload the unpacked DamHopper Browser Debug extension and click Load again.`,
      });
    }, 5_000);
  }, [browser, emitHostEvent, target]);

  const sendBrowserCommand = useCallback(
    (
      type:
        | "dam-hopper:start-picker"
        | "dam-hopper:stop-picker"
        | "dam-hopper:go-back"
        | "dam-hopper:go-forward"
        | "dam-hopper:reload",
    ) => {
      const trust = trustRef.current;
      const source = iframeRef.current?.contentWindow;
      if (destroyedRef.current || !trust || !source) return;
      const requestId = createBrowserDebugId();
      if (!requestId) {
        emitHostEvent({
          type: "status",
          status: "error",
          message: "Browser cryptographic entropy is unavailable.",
        });
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
      if (
        type === "dam-hopper:start-picker" ||
        type === "dam-hopper:stop-picker"
      ) {
        browser.setPickerActive(type === "dam-hopper:start-picker");
      } else {
        browser.setSelection(null);
        browser.setPickerActive(false);
      }
    },
    [browser, emitHostEvent],
  );

  const command = useCallback(
    (hostCommand: BrowserDebugHostCommand) => {
      const protocolCommand: Record<
        BrowserDebugHostCommand,
        Parameters<typeof sendBrowserCommand>[0]
      > = {
        "start-picker": "dam-hopper:start-picker",
        "stop-picker": "dam-hopper:stop-picker",
        "go-back": "dam-hopper:go-back",
        "go-forward": "dam-hopper:go-forward",
        reload: "dam-hopper:reload",
      };
      sendBrowserCommand(protocolCommand[hostCommand]);
    },
    [sendBrowserCommand],
  );

  const subscribe = useCallback(
    (listener: (event: BrowserDebugHostEvent) => void) => {
      if (destroyedRef.current) return () => undefined;
      listenersRef.current.add(listener);
      return () => listenersRef.current.delete(listener);
    },
    [],
  );

  const destroy = useCallback(() => {
    if (destroyedRef.current) return;
    destroyedRef.current = true;
    trustRef.current = null;
    if (bridgeTimeoutRef.current) clearTimeout(bridgeTimeoutRef.current);
    bridgeTimeoutRef.current = null;
    iframeRef.current?.removeAttribute("src");
    listenersRef.current.clear();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setTarget: (nextTarget) => {
        if (destroyedRef.current) return;
        setHostTarget(nextTarget);
      },
      setViewport: (nextViewport) => {
        if (destroyedRef.current) return;
        setHostViewport(nextViewport);
      },
      command,
      subscribe,
      destroy,
      startPicker: () => sendBrowserCommand("dam-hopper:start-picker"),
      stopPicker: () => sendBrowserCommand("dam-hopper:stop-picker"),
      goBack: () => sendBrowserCommand("dam-hopper:go-back"),
      goForward: () => sendBrowserCommand("dam-hopper:go-forward"),
      reload: () => sendBrowserCommand("dam-hopper:reload"),
    }),
    [command, destroy, sendBrowserCommand, subscribe],
  );

  useEffect(() => {
    const listener = (event: MessageEvent<unknown>) => {
      const trust = trustRef.current;
      if (!trust) return;
      const message = parseTrustedBrowserBridgeEvent(event, trust);
      if (!message) return;
      if (message.type === "dam-hopper:bridge-ready") {
        if (bridgeTimeoutRef.current) clearTimeout(bridgeTimeoutRef.current);
        emitHostEvent({
          type: "ready",
          capabilities: protocolCapabilities(message.capabilities ?? []),
        });
        return;
      }
      if (message.type === "dam-hopper:selection") {
        emitHostEvent({ type: "selection", selection: message.selection });
        return;
      }
      if (message.type === "dam-hopper:navigation") {
        emitHostEvent({ type: "navigation", url: message.url });
        return;
      }
      if (message.type === "dam-hopper:console") {
        emitHostEvent({
          type: "console",
          level: message.level,
          message: message.message,
        });
        return;
      }
      emitHostEvent({
        type: "status",
        status: "error",
        message: message.message,
      });
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [emitHostEvent]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    destroyedRef.current = false;
    generationRef.current += 1;
    trustRef.current = null;
    if (bridgeTimeoutRef.current) clearTimeout(bridgeTimeoutRef.current);
    if (!target) {
      iframe.removeAttribute("src");
      return;
    }
    iframe.src = target.url;
  }, [target]);

  useEffect(
    () => () => {
      destroy();
    },
    [destroy],
  );

  useLayoutEffect(() => {
    if (!isViewportVisible) return;
    const viewport = viewportRef.current;
    const stage = viewportStageRef?.current;
    const updateGeometry = () =>
      setViewportGeometry(
        getBrowserDebugViewportGeometry(viewportRef.current, stage),
      );
    updateGeometry();
    if (!viewport && !stage) return;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateGeometry);
    if (viewport) observer?.observe(viewport);
    if (stage) observer?.observe(stage);
    stage?.addEventListener("scroll", updateGeometry);
    window.addEventListener("resize", updateGeometry);
    window.addEventListener("scroll", updateGeometry, true);
    return () => {
      observer?.disconnect();
      stage?.removeEventListener("scroll", updateGeometry);
      window.removeEventListener("resize", updateGeometry);
      window.removeEventListener("scroll", updateGeometry, true);
    };
  }, [
    browser.target,
    isViewportVisible,
    viewportRef,
    viewportStageRef,
    viewportVersion,
  ]);

  const effectiveViewportFrame =
    hostViewport === undefined
      ? isViewportVisible
        ? (viewportGeometry?.visibleFrame ?? null)
        : null
      : hostViewport;
  const effectiveContentFrame: BrowserDebugViewportFrame | null =
    hostViewport === undefined
      ? isViewportVisible
        ? (viewportGeometry?.frame ?? null)
        : null
      : hostViewport;
  const iframeStyle =
    effectiveViewportFrame && effectiveContentFrame
      ? {
          position: "absolute" as const,
          top: effectiveContentFrame.top - effectiveViewportFrame.top,
          left: effectiveContentFrame.left - effectiveViewportFrame.left,
          width: effectiveContentFrame.width,
          height: effectiveContentFrame.height,
          display: "block",
        }
      : undefined;

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
        className="border-0"
        style={iframeStyle}
        referrerPolicy="no-referrer"
        onLoad={sendConnect}
      />
    </div>
  );
});
