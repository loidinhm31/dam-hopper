// Event bridge — routes backend push events into the in-memory listener bus.
// Forwards WebSocket push events via WsTransport.

import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
  getTransport,
  getTransportGeneration,
  subscribeTransportChanges,
} from "../api/transport.js";
import type {
  AlertSeverity,
  AlertState,
  HostResourceAlert,
  HostResourceResourceAlert,
  HostResourceSnapshotV1,
} from "../api/client.js";
import type { ConnectionStatus } from "../components/atoms/ConnectionDot.js";
import { removeExplorerLanguageScanCaches } from "@/lib/explorer-language-scan.js";
import {
  acceptsTerminalSessionIncarnation,
  resetTerminalSessionIncarnations,
} from "@/lib/terminal-incarnation-state.js";
import { useEditorStore } from "@/stores/editor.js";

export type IpcStatus = ConnectionStatus;

export interface IpcEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

export interface HostResourceAlertChangedEvent extends IpcEvent {
  type: "host:alertChanged";
  data: HostResourceAlert | HostResourceResourceAlert;
}

export interface TerminalTargetUnavailableEvent {
  sessionId: string;
  incarnation: number;
  project: string;
  worktreePath: string;
  targetUnavailable: true;
  willRestart: false;
}

const ALERT_STATES = new Set<AlertState>([
  "healthy",
  "reclaimableCacheHigh",
  "elevatedNoPressure",
  "memoryPressure",
  "oomRisk",
  "limitedData",
]);
const ALERT_SEVERITIES = new Set<AlertSeverity>([
  "info",
  "warning",
  "critical",
]);
const ALERT_CONFIDENCES = new Set(["low", "medium", "high"]);
const ALERT_SCOPE = "host";
const MAX_ALERT_TEXT_LENGTH = 256;
const MAX_INCIDENT_ID_LENGTH = 64;
const MAX_CURRENT_RESOURCE_ALERTS = 50;
const IPC_STATUSES = new Set<IpcStatus>([
  "connected",
  "connecting",
  "disconnected",
  "error",
]);

type Listener = (event: IpcEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeIpc(type: string, cb: Listener): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)!.add(cb);
  return () => listeners.get(type)?.delete(cb);
}

function dispatch(type: string, data: unknown) {
  const event: IpcEvent = { type, data, timestamp: Date.now() };
  listeners.get(type)?.forEach((cb) => cb(event));
  listeners.get("*")?.forEach((cb) => cb(event));
}

/** Relay the active WebSocket status through the stable listener bus. */
export function publishTransportStatus(status: unknown): void {
  if (typeof status === "string" && IPC_STATUSES.has(status as IpcStatus)) {
    dispatch("transport:status", status);
  }
}

const PUSH_EVENT_CHANNELS = [
  "git:progress",
  "status:changed",
  "config:changed",
  "workspace:changed",
  "terminal:changed",
  "terminal:target-unavailable",
  "port:discovered",
  "port:lost",
  "tunnel:created",
  "tunnel:ready",
  "tunnel:failed",
  "tunnel:stopped",
  "install:progress",
  "install:done",
  "install:failed",
  "host:alertChanged",
  "host:alertsInvalidated",
] as const;

export function asTerminalTargetUnavailableEvent(
  value: unknown,
): TerminalTargetUnavailableEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const event = value as Partial<TerminalTargetUnavailableEvent>;
  return typeof event.sessionId === "string" &&
    event.sessionId.length > 0 &&
    typeof event.incarnation === "number" &&
    Number.isSafeInteger(event.incarnation) &&
    event.incarnation >= 0 &&
    typeof event.project === "string" &&
    event.project.length > 0 &&
    typeof event.worktreePath === "string" &&
    event.worktreePath.length > 0 &&
    event.targetUnavailable === true &&
    event.willRestart === false
    ? {
        sessionId: event.sessionId,
        incarnation: event.incarnation,
        project: event.project,
        worktreePath: event.worktreePath,
        targetUnavailable: true,
        willRestart: false,
      }
    : null;
}

export function handleTerminalTargetUnavailable(value: unknown): boolean {
  const target = asTerminalTargetUnavailableEvent(value);
  if (!target) return false;
  if (
    !acceptsTerminalSessionIncarnation(target.sessionId, target.incarnation)
  ) {
    return false;
  }
  useEditorStore.getState().markTargetUnavailable({
    project: target.project,
    worktreePath: target.worktreePath,
  });
  return true;
}

export function invalidateHostResourceQueries(
  qc: Pick<ReturnType<typeof useQueryClient>, "invalidateQueries">,
) {
  void qc.invalidateQueries({ queryKey: ["system", "resource-snapshot"] });
  void qc.invalidateQueries({ queryKey: ["system", "resource-alerts"] });
}

export function applyHostResourceAlert(
  snapshot: HostResourceSnapshotV1 | undefined,
  alert: HostResourceAlert | HostResourceResourceAlert,
): HostResourceSnapshotV1 | undefined {
  if (!snapshot) return snapshot;
  if ("kind" in alert) {
    const currentAlerts = (snapshot.currentAlerts ?? []).filter(
      (item) => item.incidentId !== alert.incidentId,
    );
    return {
      ...snapshot,
      currentAlerts:
        alert.resolvedAt != null
          ? currentAlerts
          : [...currentAlerts, alert].slice(-MAX_CURRENT_RESOURCE_ALERTS),
    };
  }
  return { ...snapshot, alert };
}

export function asHostResourceAlertChangedEvent(
  event: IpcEvent,
): HostResourceAlertChangedEvent | null {
  if (
    event.type !== "host:alertChanged" ||
    typeof event.data !== "object" ||
    event.data === null
  ) {
    return null;
  }
  const alert = event.data as Partial<HostResourceAlert>;
  return Number.isFinite(event.timestamp) &&
    event.timestamp >= 0 &&
    typeof alert.state === "string" &&
    ALERT_STATES.has(alert.state as AlertState) &&
    typeof alert.severity === "string" &&
    ALERT_SEVERITIES.has(alert.severity as AlertSeverity) &&
    isNonNegativeFiniteNumber(alert.updatedAt) &&
    isNonNegativeFiniteNumber(alert.durationSeconds) &&
    alert.scope === ALERT_SCOPE &&
    typeof alert.confidence === "string" &&
    ALERT_CONFIDENCES.has(alert.confidence) &&
    isBoundedText(alert.threshold) &&
    isBoundedText(alert.nextAction) &&
    hasValidOptionalIncidentId(alert.incidentId) &&
    hasValidOptionalTimestamp(alert.openedAt) &&
    typeof alert.evidence === "object" &&
    alert.evidence !== null &&
    typeof alert.evidence.cgroupOomDelta === "boolean" &&
    hasValidOptionalPercent(alert.evidence.availablePercent) &&
    hasValidOptionalPercent(alert.evidence.reclaimablePercent) &&
    hasValidOptionalPercent(alert.evidence.psiSomeAvg10) &&
    hasValidOptionalPercent(alert.evidence.psiFullAvg10) &&
    hasOnlyKeys(alert.evidence, [
      "cgroupOomDelta",
      "availablePercent",
      "reclaimablePercent",
      "psiSomeAvg10",
      "psiFullAvg10",
    ])
    ? (event as HostResourceAlertChangedEvent)
    : asHostResourceResourceAlertChangedEvent(event);
}

function asHostResourceResourceAlertChangedEvent(
  event: IpcEvent,
): HostResourceAlertChangedEvent | null {
  if (event.type !== "host:alertChanged" || !isRecord(event.data)) return null;
  const alert = event.data as Partial<HostResourceResourceAlert>;
  const isTemperature = alert.kind === "temperature";
  const isDisk = alert.kind === "disk";
  const evidence = isRecord(alert.evidence) ? alert.evidence : null;
  const validEvidence =
    (isTemperature &&
      hasOnlyKeys(evidence, [
        "temperatureSource",
        "temperatureLabel",
        "temperatureCelsius",
      ]) &&
      isBoundedText(evidence.temperatureSource) &&
      (evidence.temperatureLabel == null ||
        isBoundedText(evidence.temperatureLabel)) &&
      isFiniteNumber(evidence.temperatureCelsius)) ||
    (isDisk &&
      hasOnlyKeys(evidence, [
        "diskMountPoint",
        "diskName",
        "diskUsagePercent",
      ]) &&
      isBoundedText(evidence.diskMountPoint) &&
      (evidence.diskName == null || isBoundedText(evidence.diskName)) &&
      isNonNegativeFiniteNumber(evidence.diskUsagePercent) &&
      evidence.diskUsagePercent <= 100);
  return Number.isFinite(event.timestamp) &&
    event.timestamp >= 0 &&
    ((isTemperature && alert.state === "temperatureHigh") ||
      (isDisk && alert.state === "diskFull")) &&
    typeof alert.severity === "string" &&
    ALERT_SEVERITIES.has(alert.severity as AlertSeverity) &&
    isBoundedText(alert.key) &&
    isBoundedText(alert.incidentId) &&
    isNonNegativeFiniteNumber(alert.openedAt) &&
    isNonNegativeFiniteNumber(alert.updatedAt) &&
    isNonNegativeFiniteNumber(alert.durationSeconds) &&
    isBoundedText(alert.scope) &&
    isBoundedText(alert.threshold) &&
    isBoundedText(alert.nextAction) &&
    hasValidOptionalTimestamp(alert.resolvedAt) &&
    validEvidence
    ? (event as HostResourceAlertChangedEvent)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    isRecord(value) && Object.keys(value).every((key) => keys.includes(key))
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isBoundedText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_ALERT_TEXT_LENGTH
  );
}

function hasValidOptionalIncidentId(value: unknown): boolean {
  return (
    value == null ||
    (typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_INCIDENT_ID_LENGTH)
  );
}

function hasValidOptionalTimestamp(value: unknown): boolean {
  return value == null || isNonNegativeFiniteNumber(value);
}

function hasValidOptionalPercent(value: unknown): boolean {
  return value == null || (isNonNegativeFiniteNumber(value) && value <= 100);
}

let initialized = false;
const unsubscribers: Array<() => void> = [];

export function initTransportListeners(): void {
  if (initialized) return;
  initialized = true;

  const transport = getTransport();
  for (const channel of PUSH_EVENT_CHANNELS) {
    const unsub = transport.onEvent(channel, (data) => dispatch(channel, data));
    unsubscribers.push(unsub);
  }
  if (hasWsStatus(transport)) {
    unsubscribers.push(
      transport.onStatusChange((status) => publishTransportStatus(status)),
    );
    publishTransportStatus(transport.getStatus());
  }
}

/**
 * Reset transport listeners — call before reconfigureTransport() so the new
 * transport gets fresh subscriptions when useIpc() re-runs.
 */
export function resetTransportListeners(): void {
  unsubscribers.forEach((fn) => fn());
  unsubscribers.length = 0;
  initialized = false;
  resetTerminalSessionIncarnations();
}

/** Duck-type interface for WsTransport status methods. Avoids a hard import cycle. */
export interface HasWsStatus {
  getStatus(): IpcStatus;
  onStatusChange(cb: (status: IpcStatus) => void): () => void;
}

export function hasWsStatus(t: unknown): t is HasWsStatus {
  return (
    typeof t === "object" &&
    t !== null &&
    "getStatus" in t &&
    "onStatusChange" in t
  );
}

export function handleIpcStatusChange(
  status: IpcStatus,
  setStatus: (status: IpcStatus) => void,
  invalidateTerminalSessions: () => void,
): void {
  setStatus(status);
  if (status === "connected") {
    invalidateTerminalSessions();
  }
}

export function handleWorkspaceChanged(
  queryClient: Pick<
    QueryClient,
    "invalidateQueries" | "removeQueries" | "resetQueries" | "setQueriesData"
  >,
): Promise<void> {
  return removeExplorerLanguageScanCaches(queryClient).then(() => {
    void queryClient.invalidateQueries();
    void queryClient.invalidateQueries({ queryKey: ["known-workspaces"] });
  });
}

export function useIpc(): { status: IpcStatus } {
  const qc = useQueryClient();
  const transportGeneration = useSyncExternalStore(
    subscribeTransportChanges,
    getTransportGeneration,
    getTransportGeneration,
  );

  const [wsStatus, setWsStatus] = useState<IpcStatus>(() => {
    try {
      const t = getTransport();
      return hasWsStatus(t) ? t.getStatus() : "connecting";
    } catch {
      return "connecting";
    }
  });

  useEffect(() => {
    const unsubs = [
      subscribeIpc("transport:status", (event) => {
        if (
          typeof event.data !== "string" ||
          !IPC_STATUSES.has(event.data as IpcStatus)
        ) {
          return;
        }
        handleIpcStatusChange(event.data as IpcStatus, setWsStatus, () => {
          void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
          invalidateHostResourceQueries(qc);
        });
      }),
      subscribeIpc("status:changed", (e) => {
        try {
          const { projectName } = e.data as { projectName: string };
          void qc.invalidateQueries({
            queryKey: ["project-status", projectName],
          });
          void qc.invalidateQueries({ queryKey: ["projects"] });
        } catch {
          void qc.invalidateQueries({ queryKey: ["projects"] });
        }
      }),

      subscribeIpc("config:changed", () => {
        void qc.invalidateQueries({ queryKey: ["config"] });
        void qc.invalidateQueries({ queryKey: ["workspace"] });
        void qc.invalidateQueries({ queryKey: ["projects"] });
      }),

      subscribeIpc("workspace:changed", () => {
        void handleWorkspaceChanged(qc);
      }),

      subscribeIpc("terminal:changed", () => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
      }),

      subscribeIpc("terminal:target-unavailable", (event) => {
        if (!handleTerminalTargetUnavailable(event.data)) return;
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        const target = asTerminalTargetUnavailableEvent(event.data);
        if (target) {
          void qc.invalidateQueries({
            queryKey: ["worktrees", target.project],
          });
        }
      }),

      subscribeIpc("host:alertChanged", (event) => {
        const alertEvent = asHostResourceAlertChangedEvent(event);
        if (!alertEvent) return;
        qc.setQueryData<HostResourceSnapshotV1>(
          ["system", "resource-snapshot"],
          (snapshot) => applyHostResourceAlert(snapshot, alertEvent.data),
        );
        invalidateHostResourceQueries(qc);
      }),

      subscribeIpc("host:alertsInvalidated", () =>
        invalidateHostResourceQueries(qc),
      ),
    ];

    initTransportListeners();

    return () => unsubs.forEach((fn) => fn());
  }, [qc, transportGeneration]);

  useEffect(() => {
    try {
      const t = getTransport();
      if (!hasWsStatus(t)) return;
      let cancelled = false;
      const unsubscribe = t.onStatusChange((status) =>
        handleIpcStatusChange(status as IpcStatus, setWsStatus, () => {
          void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        }),
      );
      queueMicrotask(() => {
        if (!cancelled) setWsStatus(t.getStatus());
      });
      return () => {
        cancelled = true;
        unsubscribe();
      };
    } catch {
      return;
    }
  }, [qc, transportGeneration]);

  return { status: wsStatus };
}
