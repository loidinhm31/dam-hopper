import type {
  HostResourceAlertIncident,
  HostResourceSnapshotV1,
} from "@/api/client.js";
import {
  formatAlertState,
  formatOptionalPercent,
  severityClass,
} from "@/lib/host-resource-state.js";
import { cn } from "@/lib/utils.js";
import { HostResourceInfoRow } from "./HostResourceDiagnosisRows.js";

interface Props {
  snapshot: HostResourceSnapshotV1;
  alerts: HostResourceAlertIncident[];
}

export function HostResourceIncidentDetails({ snapshot, alerts }: Props) {
  const alert = snapshot.alert;
  return (
    <div className="space-y-3">
      {alert && (
        <section
          aria-label="Current host alert"
          className="rounded border border-[var(--color-border)] border-l-2 bg-[var(--color-surface)] p-2.5"
        >
          <p className={cn("text-xs font-bold", severityClass(alert.severity))}>
            {formatAlertState(alert.state)}
          </p>
          <p className="mt-1 min-w-0 [overflow-wrap:anywhere] text-[10px] text-[var(--color-text-muted)]">
            {alert.durationSeconds}s · {alert.confidence} confidence ·{" "}
            {alert.scope} scope
          </p>
          <p className="mt-1.5 min-w-0 [overflow-wrap:anywhere] text-[10px] text-[var(--color-text-muted)]">
            Operator guidance: {alert.nextAction}
          </p>
          <div className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
            <HostResourceInfoRow label="Threshold" value={alert.threshold} />
            <HostResourceInfoRow
              label="Available"
              value={formatOptionalPercent(alert.evidence.availablePercent)}
            />
            <HostResourceInfoRow
              label="Reclaimable"
              value={formatOptionalPercent(alert.evidence.reclaimablePercent)}
            />
            <HostResourceInfoRow
              label="PSI some / full"
              value={`${formatOptionalPercent(alert.evidence.psiSomeAvg10)} / ${formatOptionalPercent(alert.evidence.psiFullAvg10)}`}
            />
            <HostResourceInfoRow
              label="Cgroup OOM event"
              value={
                alert.evidence.cgroupOomDelta ? "Observed" : "Not observed"
              }
            />
          </div>
        </section>
      )}

      {snapshot.currentAlerts && snapshot.currentAlerts.length > 0 && (
        <section
          aria-label="Current resource incidents"
          className="space-y-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5"
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
            Current resource incidents
          </p>
          <ul className="space-y-1.5">
            {snapshot.currentAlerts.slice(0, 5).map((incident) => (
              <li
                key={incident.incidentId}
                className="min-w-0 space-y-0.5 text-[10px]"
              >
                <p
                  className={cn(
                    "min-w-0 [overflow-wrap:anywhere] font-medium",
                    severityClass(incident.severity),
                  )}
                >
                  {formatAlertState(incident.state)} · {incident.scope}
                </p>
                <p className="min-w-0 [overflow-wrap:anywhere] text-[var(--color-text-muted)]">
                  Evidence: {formatResourceEvidence(incident)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {alerts.length > 0 && (
        <section className="space-y-1.5 border-t border-[var(--color-border)] pt-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
            Recent incidents
          </p>
          <ul className="space-y-1" aria-label="Recent host incidents">
            {alerts.slice(0, 5).map((incident) => (
              <li
                key={incident.incidentId}
                className="flex min-w-0 flex-wrap items-baseline justify-between gap-3 text-[10px]"
              >
                <span
                  className={cn(
                    "min-w-0 [overflow-wrap:anywhere] font-medium",
                    severityClass(incident.severity),
                  )}
                >
                  {formatAlertState(incident.state)}
                </span>
                <span className="shrink-0 [overflow-wrap:anywhere] text-[var(--color-text-muted)]">
                  {incident.resolvedAt != null
                    ? "resolved"
                    : `${incident.durationSeconds}s`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function formatResourceEvidence(
  incident: NonNullable<HostResourceSnapshotV1["currentAlerts"]>[number],
): string {
  if (incident.kind === "temperature") {
    const source = incident.evidence.temperatureSource ?? "source unavailable";
    const value = Number.isFinite(incident.evidence.temperatureCelsius)
      ? `${Math.round(incident.evidence.temperatureCelsius as number)}°C`
      : "unavailable";
    return `${incident.evidence.temperatureLabel ?? source} · ${value}`;
  }
  const mount = incident.evidence.diskMountPoint ?? "mount unavailable";
  const percent = Number.isFinite(incident.evidence.diskUsagePercent)
    ? `${Math.round(incident.evidence.diskUsagePercent as number)}% used`
    : "usage unavailable";
  return `${incident.evidence.diskName ?? mount} · ${mount} · ${percent}`;
}
