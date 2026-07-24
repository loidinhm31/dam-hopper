import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserSelectionV1 } from "@dam-hopper/browser-bridge";
import {
  useBrowserCapture,
  type BrowserCaptureStatus,
} from "@/hooks/use-browser-capture.js";
import { api, type TunnelInfo } from "@/api/client.js";
import { getTransport } from "@/api/transport.js";
import {
  resolveBrowserDebugTarget,
  type BrowserDebugTarget,
} from "@/lib/browser-debug-origin.js";
import type { CaptureRect } from "@/lib/browser-capture.js";

export type BrowserDebugBridgeStatus =
  | "idle"
  | "loading"
  | "ready"
  | "unsupported"
  | "error";

export type { BrowserCaptureStatus } from "@/hooks/use-browser-capture.js";

export interface BrowserDebugController {
  inputUrl: string;
  target: BrowserDebugTarget | null;
  bridgeStatus: BrowserDebugBridgeStatus;
  selection: BrowserSelectionV1 | null;
  pickerActive: boolean;
  captureStatus: BrowserCaptureStatus;
  captureMessage: string | null;
  manualImageName: string | null;
  captureImage: Blob | null;
  error: string | null;
  setInputUrl: (value: string) => void;
  navigate: () => void;
  setBridgeStatus: (status: BrowserDebugBridgeStatus) => void;
  setSelection: (selection: BrowserSelectionV1 | null) => void;
  setPickerActive: (active: boolean) => void;
  setError: (message: string | null) => void;
  startCapture: (targetFrame: CaptureRect | null) => Promise<void>;
  setManualImage: (file: Blob) => Promise<void>;
  stopCapture: () => void;
}

/** Owns Browser tool state while its iframe is kept alive outside tool shells. */
export function useBrowserDebug(): BrowserDebugController {
  const parentOrigin =
    typeof window === "undefined" ? undefined : window.location?.origin;
  const [inputUrl, setInputUrl] = useState("");
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [target, setTarget] = useState<BrowserDebugTarget | null>(null);
  const targetRef = useRef<BrowserDebugTarget | null>(null);
  const [bridgeStatus, setBridgeStatus] =
    useState<BrowserDebugBridgeStatus>("idle");
  const [selection, setSelection] = useState<BrowserSelectionV1 | null>(null);
  const [pickerActive, setPickerActive] = useState(false);
  const capture = useBrowserCapture(selection);
  const [error, setError] = useState<string | null>(null);

  const invalidateTarget = useCallback(
    (message: string) => {
      targetRef.current = null;
      setTarget(null);
      setSelection(null);
      setPickerActive(false);
      capture.stopCapture();
      setBridgeStatus("error");
      setError(message);
    },
    [capture.stopCapture],
  );

  const refreshTunnels = useCallback(async () => {
    try {
      const nextTunnels = await api.tunnels.list();
      setTunnels(nextTunnels);
      const currentTarget = targetRef.current;
      if (
        currentTarget &&
        !resolveBrowserDebugTarget(currentTarget.url, nextTunnels, parentOrigin)
      ) {
        invalidateTarget("The selected tunnel is no longer ready.");
      }
    } catch {
      // Loopback targets remain usable when the tunnel query is unavailable.
      setTunnels([]);
      if (targetRef.current?.source === "tunnel") {
        invalidateTarget("The selected tunnel could no longer be verified.");
      }
    }
  }, [invalidateTarget, parentOrigin]);

  useEffect(() => {
    queueMicrotask(() => void refreshTunnels());
    try {
      const transport = getTransport();
      const refresh = () => void refreshTunnels();
      const unsubscribe = [
        transport.onEvent("tunnel:created", refresh),
        transport.onEvent("tunnel:ready", refresh),
        transport.onEvent("tunnel:failed", refresh),
        transport.onEvent("tunnel:stopped", refresh),
      ];
      return () => unsubscribe.forEach((listener) => listener());
    } catch {
      return;
    }
  }, [refreshTunnels]);

  const navigate = useCallback(() => {
    const nextTarget = resolveBrowserDebugTarget(
      inputUrl,
      tunnels,
      parentOrigin,
    );
    if (!nextTarget) {
      targetRef.current = null;
      setTarget(null);
      setSelection(null);
      setPickerActive(false);
      capture.stopCapture();
      setBridgeStatus("error");
      setError("Enter an exact HTTP loopback origin or a ready tunnel URL.");
      return;
    }
    setInputUrl(nextTarget.url);
    targetRef.current = nextTarget;
    setTarget(nextTarget);
    setSelection(null);
    setPickerActive(false);
    capture.stopCapture();
    setBridgeStatus("loading");
    setError(null);
  }, [capture.stopCapture, inputUrl, parentOrigin, tunnels]);

  const updateSelection = useCallback(
    (nextSelection: BrowserSelectionV1 | null) => {
      capture.stopCapture();
      setSelection(nextSelection);
    },
    [capture.stopCapture],
  );

  return {
    inputUrl,
    target,
    bridgeStatus,
    selection,
    pickerActive,
    captureStatus: capture.captureStatus,
    captureMessage: capture.captureMessage,
    manualImageName: capture.manualImageName,
    captureImage: capture.captureImage,
    error,
    setInputUrl,
    navigate,
    setBridgeStatus,
    setSelection: updateSelection,
    setPickerActive,
    setError,
    startCapture: capture.startCapture,
    setManualImage: capture.setManualImage,
    stopCapture: capture.stopCapture,
  };
}
