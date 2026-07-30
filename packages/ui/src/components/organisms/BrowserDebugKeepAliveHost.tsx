import { forwardRef, useCallback, useRef, type RefObject } from "react";
import type { BrowserDebugController } from "@/hooks/use-browser-debug.js";
import {
  acceptBrowserDebugHostEventGeneration,
  applyBrowserDebugHostEvent,
  type BrowserDebugHostEvent,
} from "@/lib/browser-debug-host.js";
import {
  BrowserDebugIframeHost,
  type BrowserDebugIframeHostHandle,
} from "./BrowserDebugIframeHost.js";

export interface BrowserDebugKeepAliveHostProps {
  browser: BrowserDebugController;
  viewportRef: RefObject<HTMLDivElement | null>;
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
  const generationRef = useRef<number | null>(null);
  const onHostEvent = useCallback(
    (event: BrowserDebugHostEvent) => {
      const generation = acceptBrowserDebugHostEventGeneration(
        generationRef.current,
        event,
      );
      if (!generation.accepted) return;
      generationRef.current = generation.generation;
      applyBrowserDebugHostEvent(props.browser, event);
    },
    [props.browser],
  );

  return (
    <BrowserDebugIframeHost ref={ref} {...props} onHostEvent={onHostEvent} />
  );
});
