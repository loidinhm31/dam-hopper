import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type RefObject,
} from "react";
import type { BrowserDebugController } from "@/hooks/use-browser-debug.js";
import {
  acceptBrowserDebugHostEventGeneration,
  applyBrowserDebugHostEvent,
  type BrowserDebugHostEvent,
} from "@/lib/browser-debug-host.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
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
  profileId?: string | null;
}

export type BrowserDebugKeepAliveHandle = BrowserDebugIframeHostHandle;

/**
 * Shared controller adapter for browser-debug web iframe host.
 */
export const BrowserDebugKeepAliveHost = forwardRef<
  BrowserDebugKeepAliveHandle,
  BrowserDebugKeepAliveHostProps
>(function BrowserDebugKeepAliveHost(props, ref) {
  const { browser } = props;
  const iframeRef = useRef<BrowserDebugIframeHostHandle>(null);
  const generationRef = useRef<number | null>(null);
  const isCognitoActive = useCognitoModeStore((state) => state.active);
  const effectiveViewportVisible = props.isViewportVisible && !isCognitoActive;
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

  useImperativeHandle(ref, () => {
    return {
      setTarget: (target) => iframeRef.current?.setTarget(target),
      setViewport: (viewport) => iframeRef.current?.setViewport(viewport),
      command: (command) => iframeRef.current?.command(command),
      subscribe: (listener) =>
        iframeRef.current?.subscribe(listener) ?? (() => undefined),
      destroy: () => iframeRef.current?.destroy(),
      startPicker: () => iframeRef.current?.command("start-picker"),
      stopPicker: () => iframeRef.current?.command("stop-picker"),
      goBack: () => iframeRef.current?.command("go-back"),
      goForward: () => iframeRef.current?.command("go-forward"),
      reload: () => iframeRef.current?.command("reload"),
    };
  }, []);

  return (
    <BrowserDebugIframeHost
      ref={iframeRef}
      browser={props.browser}
      viewportRef={props.viewportRef}
      profileId={props.profileId}
      viewportStageRef={props.viewportStageRef}
      viewportVersion={props.viewportVersion}
      isViewportVisible={effectiveViewportVisible}
      onHostEvent={onHostEvent}
    />
  );
});
