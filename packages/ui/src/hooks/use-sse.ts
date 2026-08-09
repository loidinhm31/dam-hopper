// Event bridge — routes backend push events into the in-memory listener bus.
// Forwards WebSocket push events via WsTransport.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getTransport } from "../api/transport.js";
import type {
  AlertSeverity,
  AlertState,
  HostResourceAlert,
  HostResourceSnapshotV1,
} from "../api/client.js";
import type { ConnectionStatus } from "../components/atoms/ConnectionDot.js";

export type IpcStatus = ConnectionStatus;

export interface IpcEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

export interface HostResourceAlertChangedEvent extends IpcEvent {
  type: "host:alertChanged";
  data: HostResourceAlert;
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

export function invalidateHostResourceQueries(
  qc: Pick<ReturnType<typeof useQueryClient>, "invalidateQueries">,
) {
  void qc.invalidateQueries({ queryKey: ["system", "resource-snapshot"] });
  void qc.invalidateQueries({ queryKey: ["system", "resource-alerts"] });
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
    hasValidOptionalPercent(alert.evidence.psiFullAvg10)
    ? (event as HostResourceAlertChangedEvent)
    : null;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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
  return (
    value == null || (isNonNegativeFiniteNumber(value) && value <= 100)
  );
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

export function useIpc(): { status: IpcStatus } {
  const qc = useQueryClient();

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
        void qc.invalidateQueries();
        void qc.invalidateQueries({ queryKey: ["known-workspaces"] });
      }),

      subscribeIpc("terminal:changed", () => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
      }),

      subscribeIpc("host:alertChanged", (event) => {
        const alertEvent = asHostResourceAlertChangedEvent(event);
        if (!alertEvent) return;
        qc.setQueryData<HostResourceSnapshotV1>(
          ["system", "resource-snapshot"],
          (snapshot) =>
            snapshot ? { ...snapshot, alert: alertEvent.data } : snapshot,
        );
        invalidateHostResourceQueries(qc);
      }),

      subscribeIpc("host:alertsInvalidated", () =>
        invalidateHostResourceQueries(qc),
      ),
    ];

    initTransportListeners();

    return () => unsubs.forEach((fn) => fn());
  }, [qc]);

  return { status: wsStatus };
}
