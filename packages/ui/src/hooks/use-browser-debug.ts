import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowserSelectionV1 } from "@dam-hopper/browser-bridge";
import {
  useBrowserCapture,
  type BrowserCaptureStatus,
} from "@/hooks/use-browser-capture.js";
import { api, type TunnelInfo } from "@/api/client.js";
import { getTransport, getTransportGeneration } from "@/api/transport.js";
import { getActiveProfileId } from "@/api/server-config.js";
import { getApi, getConnectionSnapshot, isCurrentConnection } from "@/api/connections.js";
import type { ConnectionRef, ProfileId } from "@/api/ownership.js";
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
import {
  isBrowserTerminalTargetReady,
  prepareBrowserTerminalArtifact,
  type BrowserTerminalTarget,
  type PreparedBrowserTerminalArtifact,
} from "@/lib/browser-terminal-handoff.js";
import { latestTerminalSessionIncarnation } from "@/lib/terminal-incarnation-state.js";

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
  prepareTerminalArtifact: (
    terminalTarget: BrowserTerminalTarget,
  ) => Promise<PreparedBrowserTerminalArtifact>;
  handoffTerminalArtifact: (
    terminalTarget: BrowserTerminalTarget,
    artifact: PreparedBrowserTerminalArtifact,
  ) => Promise<{ inserted: boolean }>;
}

/** Owns Browser tool state while its iframe is kept alive outside tool shells. */
export function useBrowserDebug(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}): BrowserDebugController {
  const transportGeneration = useTransportGeneration();
  const extensionPresence = useBrowserExtensionPresence();
  const parentOrigin =
    typeof window === "undefined" ? undefined : window.location?.origin;
  const profileId =
    options?.owner?.profileId ??
    options?.profileId ??
    getActiveProfileId() ??
    "default";
  const snap = getConnectionSnapshot(profileId);
  const rawOwnerProfileId = options?.owner?.profileId ?? snap?.owner.profileId ?? profileId;
  const rawOwnerGeneration = options?.owner?.generation ?? snap?.owner.generation ?? 0;
  const owner = useMemo<ConnectionRef>(
    () => ({
      profileId: rawOwnerProfileId,
      generation: rawOwnerGeneration,
    }),
    [rawOwnerProfileId, rawOwnerGeneration],
  );
  const boundApi = isCurrentConnection(owner) ? getApi(owner) : api;
  const targetRevisionRef = useRef(0);
  const [inputUrl, setInputUrl] = useState("");
  const [addressHistory, setAddressHistory] = useState(() =>
    loadBrowserDebugAddressHistory(owner.profileId),
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
        const nextTunnels = await boundApi.tunnels.list();
        if (getTransportGeneration() !== expectedGeneration) return;
        setTunnels(nextTunnels);
        const currentTarget = targetRef.current;
        if (
          currentTarget &&
          currentTarget.owner.profileId === owner.profileId &&
          !resolveBrowserDebugTarget(
            currentTarget.url,
            nextTunnels,
            currentTarget.owner,
            parentOrigin,
            currentTarget.revision,
          )
        ) {
          invalidateTarget("The selected tunnel is no longer ready.");
        }
      } catch {
        if (getTransportGeneration() !== expectedGeneration) return;
        setTunnels([]);
        if (
          targetRef.current?.source === "tunnel" &&
          targetRef.current.owner.profileId === owner.profileId
        ) {
          invalidateTarget("The selected tunnel could no longer be verified.");
        }
      }
    },
    [boundApi.tunnels, invalidateTarget, owner.profileId, parentOrigin, transportGeneration],
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
      targetRevisionRef.current += 1;
      const revisionedTarget: BrowserDebugTarget = {
        ...nextTarget,
        revision: targetRevisionRef.current,
      };
      setInputUrl(revisionedTarget.url);
      setAddressHistory(
        recordBrowserDebugAddress(
          revisionedTarget.url,
          revisionedTarget.owner.profileId,
        ),
      );
      targetRef.current = revisionedTarget;
      setTarget(revisionedTarget);
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
        owner,
        parentOrigin,
        targetRevisionRef.current + 1,
      );
      if (!nextTarget) {
        rejectNavigationTarget();
        return false;
      }
      applyNavigationTarget(nextTarget);
      return true;
    },
    [applyNavigationTarget, owner, parentOrigin, rejectNavigationTarget, tunnels],
  );

  const navigate = useCallback(() => {
    const nextTarget = resolveBrowserDebugTarget(
      inputUrl,
      tunnels,
      owner,
      parentOrigin,
      targetRevisionRef.current + 1,
    );
    if (!nextTarget) {
      rejectNavigationTarget();
      return;
    }
    applyNavigationTarget(nextTarget);
  }, [
    applyNavigationTarget,
    inputUrl,
    owner,
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

  const prepareTerminalArtifact = useCallback(
    async (terminalTarget: BrowserTerminalTarget): Promise<PreparedBrowserTerminalArtifact> => {
      if (!selection) {
        throw new Error("No browser selection available to prepare.");
      }
      const currentTarget = targetRef.current;
      if (!isBrowserTerminalTargetReady(terminalTarget, currentTarget)) {
        throw new Error("Selected terminal target is not ready.");
      }
      const incarnation =
        terminalTarget.incarnation ??
        latestTerminalSessionIncarnation({
          profileId: owner.profileId,
          id: terminalTarget.sessionId,
        });
      if (incarnation === undefined) {
        throw new Error("Selected terminal is missing incarnation.");
      }
      const capturedOwner = { ...owner };
      const capturedRevision = currentTarget?.revision;
      const artifact = await boundApi.browserDebug.createArtifact(
        terminalTarget.sessionId,
        incarnation,
        selection,
      );
      if (
        !targetRef.current ||
        targetRef.current.revision !== capturedRevision ||
        (isCurrentConnection(capturedOwner) === false &&
          getConnectionSnapshot(capturedOwner.profileId) !== null)
      ) {
        await Promise.resolve(
          boundApi.browserDebug.deleteArtifact(artifact.artifactId),
        ).catch(() => {});
        throw new Error("Target navigation or owner changed during artifact preparation.");
      }
      if (capture.captureImage) {
        const updated = await boundApi.browserDebug.uploadPng(
          artifact.artifactId,
          capture.captureImage,
        );
        return prepareBrowserTerminalArtifact(updated);
      }
      return prepareBrowserTerminalArtifact(artifact);
    },
    [boundApi.browserDebug, capture.captureImage, owner, selection],
  );

  const handoffTerminalArtifact = useCallback(
    async (
      terminalTarget: BrowserTerminalTarget,
      prepared: PreparedBrowserTerminalArtifact,
    ): Promise<{ inserted: boolean }> => {
      const currentTarget = targetRef.current;
      if (!isBrowserTerminalTargetReady(terminalTarget, currentTarget)) {
        throw new Error("Selected terminal closed before insertion.");
      }
      if (
        terminalTarget.incarnation !== undefined &&
        terminalTarget.incarnation !== prepared.artifact.terminalIncarnation
      ) {
        throw new Error("Selected terminal incarnation mismatch.");
      }
      return boundApi.browserDebug.handoff(prepared.artifact.artifactId);
    },
    [boundApi.browserDebug],
  );

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
    prepareTerminalArtifact,
    handoffTerminalArtifact,
  };
}
