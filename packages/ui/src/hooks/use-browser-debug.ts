import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserSelectionV1 } from "@dam-hopper/browser-bridge";
import {
  useBrowserCapture,
  type BrowserCaptureStatus,
} from "@/hooks/use-browser-capture.js";
import { api, type TunnelInfo } from "@/api/client.js";
import { getTransport, getTransportGeneration } from "@/api/transport.js";
import {
  resolveBrowserDebugTarget,
  type BrowserDebugTarget,
} from "@/lib/browser-debug-origin.js";
import {
  loadBrowserDebugAddressHistory,
  recordBrowserDebugAddress,
} from "@/lib/browser-debug-address-history.js";
import type { CaptureRect } from "@/lib/browser-capture.js";
import {
  type BrowserDebugBridgeStatus,
  type BrowserDebugHostCapability,
} from "@/lib/browser-debug-host.js";
import {
  useBrowserExtensionPresence,
  type BrowserExtensionPresence,
} from "@/hooks/use-browser-extension-presence.js";
import { useTransportGeneration } from "@/hooks/use-transport-generation.js";

export type { BrowserDebugBridgeStatus } from "@/lib/browser-debug-host.js";

export type { BrowserCaptureStatus } from "@/hooks/use-browser-capture.js";

export interface BrowserConsoleEntry {
  id: number;
  level: "debug" | "log" | "info" | "warn" | "error";
  message: string;
}

export type BrowserConsolePreview = Omit<BrowserConsoleEntry, "id">;

const MAX_CONSOLE_ENTRIES = 100;

export interface BrowserDebugController {
  extensionPresence: BrowserExtensionPresence;
  inputUrl: string;
  addressHistory: string[];
  target: BrowserDebugTarget | null;
  bridgeStatus: BrowserDebugBridgeStatus;
  bridgeCapabilities: BrowserDebugHostCapability[];
  selection: BrowserSelectionV1 | null;
  pickerActive: boolean;
  captureStatus: BrowserCaptureStatus;
  captureMessage: string | null;
  manualImageName: string | null;
  captureImage: Blob | null;
  error: string | null;
  consoleEntries: BrowserConsoleEntry[];
  setInputUrl: (value: string) => void;
  navigate: () => void;
  navigateTo: (value: string, tunnels?: readonly TunnelInfo[]) => boolean;
  setBridgeStatus: (status: BrowserDebugBridgeStatus) => void;
  setSelection: (selection: BrowserSelectionV1 | null) => void;
  setPickerActive: (active: boolean) => void;
  setError: (message: string | null) => void;
  syncCurrentUrl: (url: string) => void;
  setBridgeCapabilities: (capabilities: BrowserDebugHostCapability[]) => void;
  appendConsoleEntry: (entry: BrowserConsolePreview) => void;
  clearConsole: () => void;
  startCapture: (targetFrame: CaptureRect | null) => Promise<void>;
  setManualImage: (file: Blob) => Promise<void>;
  stopCapture: () => void;
}

/** Owns Browser tool state while its iframe is kept alive outside tool shells. */
export function useBrowserDebug(): BrowserDebugController {
  const transportGeneration = useTransportGeneration();
  const extensionPresence = useBrowserExtensionPresence();
  const parentOrigin =
    typeof window === "undefined" ? undefined : window.location?.origin;
  const [inputUrl, setInputUrl] = useState("");
  const [addressHistory, setAddressHistory] = useState(
    loadBrowserDebugAddressHistory,
  );
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [target, setTarget] = useState<BrowserDebugTarget | null>(null);
  const targetRef = useRef<BrowserDebugTarget | null>(null);
  const [bridgeStatus, setBridgeStatus] =
    useState<BrowserDebugBridgeStatus>("idle");
  const [bridgeCapabilities, setBridgeCapabilities] = useState<
    BrowserDebugHostCapability[]
  >([]);
  const consoleEntryIdRef = useRef(0);
  const [selection, setSelection] = useState<BrowserSelectionV1 | null>(null);
  const [pickerActive, setPickerActive] = useState(false);
  const capture = useBrowserCapture(selection);
  const { stopCapture } = capture;
  const [error, setError] = useState<string | null>(null);
  const [consoleEntries, setConsoleEntries] = useState<BrowserConsoleEntry[]>(
    [],
  );

  const invalidateTarget = useCallback(
    (message: string) => {
      targetRef.current = null;
      setTarget(null);
      setSelection(null);
      setPickerActive(false);
      setBridgeCapabilities([]);
      stopCapture();
      setBridgeStatus("error");
      setError(message);
    },
    [stopCapture],
  );

  const refreshTunnels = useCallback(
    async (expectedGeneration = transportGeneration) => {
      try {
        const nextTunnels = await api.tunnels.list();
        if (getTransportGeneration() !== expectedGeneration) return;
        setTunnels(nextTunnels);
        const currentTarget = targetRef.current;
        if (
          currentTarget &&
          !resolveBrowserDebugTarget(
            currentTarget.url,
            nextTunnels,
            parentOrigin,
          )
        ) {
          invalidateTarget("The selected tunnel is no longer ready.");
        }
      } catch {
        if (getTransportGeneration() !== expectedGeneration) return;
        // Loopback targets remain usable when the tunnel query is unavailable.
        setTunnels([]);
        if (targetRef.current?.source === "tunnel") {
          invalidateTarget("The selected tunnel could no longer be verified.");
        }
      }
    },
    [invalidateTarget, parentOrigin, transportGeneration],
  );

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
  }, [refreshTunnels, transportGeneration]);

  const applyNavigationTarget = useCallback(
    (nextTarget: BrowserDebugTarget) => {
      setInputUrl(nextTarget.url);
      setAddressHistory(recordBrowserDebugAddress(nextTarget.url));
      targetRef.current = nextTarget;
      setTarget(nextTarget);
      setSelection(null);
      setPickerActive(false);
      stopCapture();
      setConsoleEntries([]);
      setBridgeCapabilities([]);
      setBridgeStatus("loading");
      setError(null);
    },
    [stopCapture],
  );

  const rejectNavigationTarget = useCallback(() => {
    targetRef.current = null;
    setTarget(null);
    setSelection(null);
    setPickerActive(false);
    setBridgeCapabilities([]);
    stopCapture();
    setBridgeStatus("error");
    setError("Enter an HTTP loopback URL or a URL on a ready tunnel.");
  }, [stopCapture]);

  const navigateTo = useCallback(
    (value: string, extraTunnels: readonly TunnelInfo[] = []) => {
      const nextTarget = resolveBrowserDebugTarget(
        value,
        [...extraTunnels, ...tunnels],
        parentOrigin,
      );
      if (!nextTarget) {
        rejectNavigationTarget();
        return false;
      }
      applyNavigationTarget(nextTarget);
      return true;
    },
    [applyNavigationTarget, parentOrigin, rejectNavigationTarget, tunnels],
  );

  const navigate = useCallback(() => {
    const nextTarget = resolveBrowserDebugTarget(
      inputUrl,
      tunnels,
      parentOrigin,
    );
    if (!nextTarget) {
      rejectNavigationTarget();
      return;
    }
    applyNavigationTarget(nextTarget);
  }, [
    applyNavigationTarget,
    inputUrl,
    parentOrigin,
    rejectNavigationTarget,
    tunnels,
  ]);

  const updateSelection = useCallback(
    (nextSelection: BrowserSelectionV1 | null) => {
      stopCapture();
      setSelection(nextSelection);
    },
    [stopCapture],
  );

  const syncCurrentUrl = useCallback((url: string) => {
    const currentTarget = targetRef.current;
    try {
      if (currentTarget && new URL(url).origin === currentTarget.origin)
        setInputUrl(url);
    } catch {
      // The trusted protocol parser rejects control characters; malformed URLs
      // still never replace the address displayed to the user.
    }
  }, []);

  const appendConsoleEntry = useCallback((entry: BrowserConsolePreview) => {
    setConsoleEntries((current) => [
      ...current.slice(-(MAX_CONSOLE_ENTRIES - 1)),
      { ...entry, id: ++consoleEntryIdRef.current },
    ]);
  }, []);

  const clearConsole = useCallback(() => setConsoleEntries([]), []);

  return {
    extensionPresence,
    inputUrl,
    addressHistory,
    target,
    bridgeStatus,
    bridgeCapabilities,
    selection,
    pickerActive,
    captureStatus: capture.captureStatus,
    captureMessage: capture.captureMessage,
    manualImageName: capture.manualImageName,
    captureImage: capture.captureImage,
    error,
    consoleEntries,
    setInputUrl,
    navigate,
    navigateTo,
    setBridgeStatus,
    setBridgeCapabilities,
    setSelection: updateSelection,
    setPickerActive,
    setError,
    syncCurrentUrl,
    appendConsoleEntry,
    clearConsole,
    startCapture: capture.startCapture,
    setManualImage: capture.setManualImage,
    stopCapture,
  };
}
