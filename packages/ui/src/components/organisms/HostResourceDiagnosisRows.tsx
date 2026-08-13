import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Availability, DiskMetrics, HostMetrics } from "@/api/client.js";
import { formatAvailability } from "@/lib/host-resource-state.js";
import {
  formatBytes,
  formatCelsius,
  formatPercent,
} from "@/lib/host-metrics-format.js";
import { cn } from "@/lib/utils.js";

export function HostResourceMetric({
  label,
  value,
  detail,
  availability,
  percent,
}: {
  label: string;
  value: string;
  detail: string;
  availability: Availability;
  percent?: number;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text)]">
          {label}
        </span>
        <span className="text-[11px] font-bold text-[var(--color-primary)]">
          {value}
        </span>
      </div>
      {percent !== undefined && (
        <div className="h-1.5 overflow-hidden rounded-sm bg-[var(--color-surface-2)]">
          <div
            className="h-full rounded-sm bg-[var(--color-primary)]"
            style={{ width: formatPercent(percent) }}
          />
        </div>
      )}
      <p className="text-[10px] text-[var(--color-text-muted)]">
        {detail} · {formatAvailability(availability)}
      </p>
    </section>
  );
}

export function HostResourceSummaryCell({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded border border-[var(--color-border)] px-2 py-1.5">
      <p className="uppercase tracking-widest text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-0.5 font-bold text-[var(--color-text)]">{value}</p>
    </div>
  );
}

export function HostResourceInfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-[var(--color-text-muted)]">{label}</span>
      <span className="min-w-0 text-right text-[var(--color-text)]">
        {value}
      </span>
    </div>
  );
}

export function HostResourceLegacyMetrics({
  metrics,
}: {
  metrics: HostMetrics;
}) {
  const [storageOpen, setStorageOpen] = useState(false);
  const buttonId = useId();
  const panelId = useId();
  const disks = metrics.disks?.length ? metrics.disks : [metrics.disk];
  const temperatures = Array.isArray(metrics.temperatures)
    ? metrics.temperatures
    : [];
  const hasTemperature = temperatures.some((temperature) =>
    Number.isFinite(temperature?.celsius),
  );

  return (
    <div className="space-y-3">
      <section className="grid grid-cols-2 gap-2 text-[10px]">
        <HostResourceSummaryCell
          label="CPU"
          value={formatPercent(metrics.cpu.usagePercent)}
        />
        <HostResourceSummaryCell
          label="Disk"
          value={formatPercent(metrics.disk.usagePercent)}
        />
      </section>

      <section
        aria-label="Temperatures"
        className="space-y-1.5 border-t border-[var(--color-border)] pt-3 text-[10px]"
      >
        <p className="font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
          Temperatures
        </p>
        {!hasTemperature ? (
          <p className="text-[var(--color-text-muted)]">
            Temperature sensors unavailable
          </p>
        ) : (
          <ul className="space-y-1" aria-label="Temperature sensors">
            {temperatures.map((temperature, index) => {
              const identity =
                temperature.label || temperature.source || "Sensor";
              return (
                <li
                  key={`${temperature.source || "sensor"}-${index}`}
                  className="flex min-w-0 justify-between gap-3"
                >
                  <span
                    className="min-w-0 truncate text-[var(--color-text-muted)]"
                    title={`${identity} (${temperature.source || "source unavailable"})`}
                  >
                    {identity}
                  </span>
                  <span className="shrink-0 text-[var(--color-text)]">
                    {formatCelsius(temperature.celsius)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="border-t border-[var(--color-border)] pt-3 text-[10px]">
        <h3>
          <button
            id={buttonId}
            type="button"
            className={cn(
              "flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 text-left font-bold uppercase tracking-widest text-[var(--color-text-muted)]",
              "focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]",
            )}
            aria-expanded={storageOpen}
            aria-controls={panelId}
            onClick={() => setStorageOpen((current) => !current)}
          >
            <span>Host storage</span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "h-4 w-4 shrink-0 transition-transform",
                storageOpen && "rotate-180 text-[var(--color-primary)]",
              )}
            />
          </button>
        </h3>
        <div id={panelId} hidden={!storageOpen} aria-labelledby={buttonId}>
          <ul className="mt-2 space-y-2" aria-label="Host storage disks">
            {disks.map((disk, index) => (
              <HostResourceDiskRow
                key={`${disk.mountPoint || "mount"}-${disk.name || "disk"}-${index}`}
                disk={disk}
              />
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function HostResourceDiskRow({ disk }: { disk: DiskMetrics }) {
  const identity = `${disk.name || "Disk"} · ${disk.mountPoint || "mount unavailable"}`;
  const percent = Number.isFinite(disk.usagePercent)
    ? Math.min(Math.max(disk.usagePercent, 0), 100)
    : undefined;
  const usage =
    Number.isFinite(disk.usedBytes) &&
    disk.usedBytes >= 0 &&
    Number.isFinite(disk.totalBytes) &&
    disk.totalBytes > 0
      ? `${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}`
      : "unavailable";

  return (
    <li className="min-w-0 space-y-1">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span
          className="min-w-0 truncate text-[var(--color-text)]"
          title={identity}
          aria-label={identity}
        >
          {identity}
        </span>
        <span className="shrink-0 text-[var(--color-text-muted)]">
          {percent === undefined ? "unavailable" : formatPercent(percent)}
        </span>
      </div>
      {percent !== undefined && (
        <div
          className="h-1.5 overflow-hidden rounded-sm bg-[var(--color-surface-2)]"
          role="progressbar"
          aria-label={`${identity} usage`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className="h-full rounded-sm bg-[var(--color-primary)]"
            style={{ width: formatPercent(percent) }}
          />
        </div>
      )}
      <p className="text-[var(--color-text-muted)]">{usage}</p>
    </li>
  );
}
