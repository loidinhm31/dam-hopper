import { useState } from "react";
import { Activity, AlertTriangle, Loader2 } from "lucide-react";
import { useHostMetrics } from "@/api/queries.js";
import type { HostMetrics } from "@/api/client.js";
import {
  formatBytes,
  formatCelsius,
  formatPercent,
  formatUsage,
} from "@/lib/host-metrics-format.js";
import { cn } from "@/lib/utils.js";

export function HostResourcePopover() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useHostMetrics(open);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "p-1.5 rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors",
          open
            ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
            : "hover:bg-[var(--color-surface-2)]",
        )}
        title="Host resources"
        aria-label="Host resources"
        aria-expanded={open}
      >
        <Activity size={16} />
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-[60] w-80 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl glass-card-blur p-3">
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-primary)]" />
              Sampling host
            </div>
          )}

          {isError && (
            <div className="flex items-center gap-2 text-xs text-[var(--color-danger)]">
              <AlertTriangle className="h-3.5 w-3.5" />
              Metrics unavailable
            </div>
          )}

          {data && <MetricsRows metrics={data} />}
        </div>
      )}
    </div>
  );
}

function MetricsRows({ metrics }: { metrics: HostMetrics }) {
  const temperatures = metrics.temperatures ?? [];
  const hottestTemperature = temperatures.reduce<
    HostMetrics["temperatures"][number] | null
  >((hottest, reading) => {
    if (!hottest || reading.celsius > hottest.celsius) return reading;
    return hottest;
  }, null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] pb-2">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
            {metrics.hostname || "Host"}
          </p>
          <p className="truncate text-[10px] text-[var(--color-text-muted)]/70">
            {metrics.osName || "System"}
          </p>
        </div>
        <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]/70">
          {new Date(metrics.sampledAt).toLocaleTimeString()}
        </span>
      </div>

      <MetricRow
        label="CPU"
        percent={metrics.cpu.usagePercent}
        detail={`${metrics.cpu.logicalCoreCount} logical${metrics.cpu.physicalCoreCount ? ` / ${metrics.cpu.physicalCoreCount} physical` : ""}`}
      />
      <MetricRow
        label="Memory"
        percent={metrics.memory.usagePercent}
        detail={formatUsage(
          metrics.memory.usedBytes,
          metrics.memory.totalBytes,
        )}
      />
      <MetricRow
        label="Disk"
        percent={metrics.disk.usagePercent}
        detail={`${formatBytes(metrics.disk.usedBytes)} used on ${metrics.disk.mountPoint || "workspace disk"}`}
      />
      {hottestTemperature && (
        <TemperatureRow
          value={formatCelsius(hottestTemperature.celsius)}
          detail={formatTemperatureDetail(temperatures)}
        />
      )}

      {metrics.cpu.loadAverage && (
        <p className="truncate text-[10px] text-[var(--color-text-muted)]/70">
          Load {metrics.cpu.loadAverage.one.toFixed(2)} /{" "}
          {metrics.cpu.loadAverage.five.toFixed(2)} /{" "}
          {metrics.cpu.loadAverage.fifteen.toFixed(2)}
        </p>
      )}
    </div>
  );
}

function TemperatureRow({ value, detail }: { value: string; detail: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text)]">
          Temperature
        </span>
        <span className="text-[11px] font-bold text-[var(--color-primary)]">
          {value}
        </span>
      </div>
      <p className="truncate text-[10px] text-[var(--color-text-muted)]">
        {detail}
      </p>
    </div>
  );
}

function MetricRow({
  label,
  percent,
  detail,
}: {
  label: string;
  percent: number;
  detail: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text)]">
          {label}
        </span>
        <span className="text-[11px] font-bold text-[var(--color-primary)]">
          {formatPercent(percent)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-sm bg-[var(--color-surface-2)]">
        <div
          className="h-full rounded-sm bg-[var(--color-primary)] transition-all duration-300"
          style={{ width: formatPercent(percent) }}
        />
      </div>
      <p className="truncate text-[10px] text-[var(--color-text-muted)]">
        {detail}
      </p>
    </div>
  );
}

function formatTemperatureDetail(
  temperatures: HostMetrics["temperatures"],
): string {
  return temperatures
    .map((reading) => `${reading.label} ${formatCelsius(reading.celsius)}`)
    .join(" / ");
}
