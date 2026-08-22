import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import type { BrowserDebugController } from "@/hooks/use-browser-debug.js";
import {
  acceptBrowserDebugHostEventGeneration,
  applyBrowserDebugHostEvent,
  type BrowserDebugHostEvent,
} from "@/lib/browser-debug-host.js";
import { getBrowserDebugViewportGeometry } from "@/lib/browser-debug-keep-alive.js";
import { useBrowserDebugHost } from "@/contexts/BrowserDebugHostContext.js";
import {
  BrowserDebugIframeHost,
  type BrowserDebugIframeHostHandle,
} from "./BrowserDebugIframeHost.js";

export interface BrowserDebugKeepAliveHostProps {
  browser: BrowserDebugController;
  viewportRef: RefObject<HTMLDivElement | null>;
  viewportStageRef?: RefObject<HTMLDivElement | null>;
  viewportVersion: number;
  isViewportVisible: boolean;
}

export type BrowserDebugKeepAliveHandle = BrowserDebugIframeHostHandle;

/**
 * Shared controller adapter for the web host. The iframe lifecycle and trust
 * boundary live in BrowserDebugIframeHost; only normalized host events cross
 * this boundary into Browser state.
 */
export const BrowserDebugKeepAliveHost = forwardRef<
  BrowserDebugKeepAliveHandle,
  BrowserDebugKeepAliveHostProps
>(function BrowserDebugKeepAliveHost(props, ref) {
  const { host: suppliedHost } = useBrowserDebugHost();
  const { browser } = props;
  const iframeRef = useRef<BrowserDebugIframeHostHandle>(null);
  const generationRef = useRef<number | null>(null);
  const onHostEvent = useCallback(
    (event: BrowserDebugHostEvent) => {
      const generation = acceptBrowserDebugHostEventGeneration(
        generationRef.current,
        event,
      );
      if (!generation.accepted) return;
      generationRef.current = generation.generation;
      applyBrowserDebugHostEvent(browser, event);
    },
    [browser],
  );

  useLayoutEffect(() => {
    generationRef.current = null;
  }, [suppliedHost]);

  useEffect(() => {
    if (!suppliedHost) return;
    suppliedHost.setTarget(props.browser.target);
    return () => suppliedHost.setTarget(null);
  }, [props.browser.target, suppliedHost]);

  useEffect(() => {
    if (!suppliedHost) return;
    return suppliedHost.subscribe(onHostEvent);
  }, [onHostEvent, suppliedHost]);

  useLayoutEffect(() => {
    if (!suppliedHost) return;
    const viewport = props.viewportRef.current;
    const stage = props.viewportStageRef?.current;
    const updateFrame = () => {
      const geometry = props.isViewportVisible
        ? getBrowserDebugViewportGeometry(
            props.viewportRef.current,
            props.viewportStageRef?.current,
          )
        : null;
      suppliedHost.setViewport(geometry?.visibleFrame ? geometry.frame : null);
    };
    updateFrame();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateFrame);
    if (viewport) observer?.observe(viewport);
    if (stage) observer?.observe(stage);
    stage?.addEventListener("scroll", updateFrame);
    window.addEventListener("resize", updateFrame);
    window.addEventListener("scroll", updateFrame, true);
    return () => {
      observer?.disconnect();
      stage?.removeEventListener("scroll", updateFrame);
      window.removeEventListener("resize", updateFrame);
      window.removeEventListener("scroll", updateFrame, true);
      suppliedHost.setViewport(null);
    };
  }, [
    props.isViewportVisible,
    props.viewportRef,
    props.viewportStageRef,
    props.viewportVersion,
    suppliedHost,
  ]);

  useImperativeHandle(ref, () => {
    const getHost = () => suppliedHost ?? iframeRef.current;
    return {
      setTarget: (target) => getHost()?.setTarget(target),
      setViewport: (viewport) => getHost()?.setViewport(viewport),
      command: (command) => getHost()?.command(command),
      subscribe: (listener) =>
        getHost()?.subscribe(listener) ?? (() => undefined),
      destroy: () => getHost()?.destroy(),
      startPicker: () => getHost()?.command("start-picker"),
      stopPicker: () => getHost()?.command("stop-picker"),
      goBack: () => getHost()?.command("go-back"),
      goForward: () => getHost()?.command("go-forward"),
      reload: () => getHost()?.command("reload"),
    };
  }, [suppliedHost]);

  if (suppliedHost) return null;

  return (
    <BrowserDebugIframeHost
      ref={iframeRef}
      browser={props.browser}
      viewportRef={props.viewportRef}
      viewportStageRef={props.viewportStageRef}
      viewportVersion={props.viewportVersion}
      isViewportVisible={props.isViewportVisible}
      onHostEvent={onHostEvent}
    />
  );
});
