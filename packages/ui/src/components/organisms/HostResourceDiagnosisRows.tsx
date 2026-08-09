import type { Availability } from "@/api/client.js";
import { formatAvailability } from "@/lib/host-resource-state.js";
import { formatPercent } from "@/lib/host-metrics-format.js";

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
