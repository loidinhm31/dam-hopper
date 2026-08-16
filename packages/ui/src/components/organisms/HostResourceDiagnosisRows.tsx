import type { Availability } from "@/api/client.js";
import { formatAvailability } from "@/lib/host-resource-state.js";
import { formatPercent } from "@/lib/host-metrics-format.js";

export function HostResourceMetric({
  label,
  value,
  detail,
  availability,
  progress,
}: {
  label: string;
  value: string;
  detail: string;
  availability: Availability;
  progress?: { value: number };
}) {
  return (
    <section className="min-w-0 space-y-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0 [overflow-wrap:anywhere] text-[10px] font-bold uppercase tracking-widest text-[var(--color-text)]">
          {label}
        </span>
        <span className="min-w-0 text-right [overflow-wrap:anywhere] text-[11px] font-bold text-[var(--color-primary)]">
          {value}
        </span>
      </div>
      {progress && <HostResourceProgress label={label} progress={progress} />}
      <p className="min-w-0 [overflow-wrap:anywhere] text-[10px] text-[var(--color-text-muted)]">
        {detail} · {formatAvailability(availability)}
      </p>
    </section>
  );
}

function HostResourceProgress({
  label,
  progress,
}: {
  label: string;
  progress: { value: number };
}) {
  return (
    <div
      className="h-1.5 overflow-hidden rounded-sm bg-[var(--color-surface-2)]"
      role="progressbar"
      aria-label={`${label} percentage`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress.value}
    >
      <div
        className="h-full rounded-sm bg-[var(--color-primary)]"
        style={{ width: formatPercent(progress.value) }}
      />
    </div>
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
    <div className="min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
      <p className="min-w-0 [overflow-wrap:anywhere] uppercase tracking-widest text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-0.5 min-w-0 [overflow-wrap:anywhere] font-bold text-[var(--color-text)]">
        {value}
      </p>
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
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="min-w-0 [overflow-wrap:anywhere] text-[var(--color-text-muted)]">
        {label}
      </span>
      <span className="min-w-0 text-right [overflow-wrap:anywhere] text-[var(--color-text)]">
        {value}
      </span>
    </div>
  );
}
