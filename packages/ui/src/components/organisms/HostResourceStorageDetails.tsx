import type { DiskMetrics, HostMetrics } from "@/api/client.js";
import {
  formatAvailability,
  normalizeProgressPercent,
  resolveHostResourceStorage,
} from "@/lib/host-resource-state.js";
import { formatBytes, formatPercent } from "@/lib/host-metrics-format.js";

interface Props {
  metrics?: HostMetrics;
  pinnedMount?: string | null;
  onPin: (mountPoint: string | null) => void;
  isPending?: boolean;
  error?: Error | null;
}

export function HostResourceStorageDetails({
  metrics,
  pinnedMount,
  onPin,
  isPending = false,
  error,
}: Props) {
  const resolution = resolveHostResourceStorage(metrics, pinnedMount);
  const disks = metrics
    ? Array.isArray(metrics.disks) && metrics.disks.length > 0
      ? metrics.disks
      : metrics.disk
        ? [metrics.disk]
        : []
    : [];

  return (
    <section
      aria-label="Storage details"
      className="space-y-2 border-t border-[var(--color-border)] pt-3"
    >
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
          Storage
        </h3>
        <span className="min-w-0 text-right text-[10px] text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
          {formatSelection(resolution)}
        </span>
      </div>

      {resolution.state === "missing" && (
        <div className="space-y-2 rounded border border-[var(--color-warning)] bg-[var(--color-background)] p-2 text-[10px]">
          <p className="min-w-0 [overflow-wrap:anywhere] text-[var(--color-warning)]">
            Saved mount {resolution.savedMount} is missing; no other mount was
            selected.
          </p>
          <button
            type="button"
            className="min-h-11 min-w-11 rounded px-2 text-left text-[var(--color-text)] underline decoration-[var(--color-border)] underline-offset-2 hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--color-ring)] disabled:cursor-wait disabled:opacity-60"
            disabled={isPending}
            onClick={() => onPin(null)}
            aria-label={`Clear saved storage pin ${resolution.savedMount}`}
          >
            Use default disk
          </button>
        </div>
      )}

      {resolution.state === "unavailable" && (
        <div className="space-y-2 rounded border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-[10px]">
          <p className="min-w-0 [overflow-wrap:anywhere] text-[var(--color-text-muted)]">
            {resolution.savedMount
              ? `Saved mount ${resolution.savedMount} cannot be verified without storage inventory.`
              : "Storage inventory unavailable"}
          </p>
          {resolution.savedMount && (
            <button
              type="button"
              className="min-h-11 min-w-11 rounded px-2 text-left text-[var(--color-text)] underline decoration-[var(--color-border)] underline-offset-2 hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--color-ring)] disabled:cursor-wait disabled:opacity-60"
              disabled={isPending}
              onClick={() => onPin(null)}
              aria-label={`Clear saved storage pin ${resolution.savedMount}`}
            >
              Use default disk
            </button>
          )}
        </div>
      )}

      {disks.length > 0 && (
        <ul className="space-y-2" aria-label="Storage disks">
          {disks.map((disk, index) => (
            <StorageRow
              key={`${disk.mountPoint || "mount"}-${disk.name || "disk"}-${index}`}
              disk={disk}
              selectedMount={
                resolution.state === "pinned"
                  ? resolution.selected.mountPoint
                  : undefined
              }
              isPending={isPending}
              onPin={onPin}
            />
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-[10px] text-[var(--color-danger)]">
          Could not save storage preference. Try again.
        </p>
      )}
      {metrics && (
        <p className="text-[10px] text-[var(--color-text-muted)]">
          {formatAvailability({
            state: "available",
            sampledAt: metrics.sampledAt,
          })}
          {isPending ? " · Saving…" : ""}
        </p>
      )}
    </section>
  );
}

function StorageRow({
  disk,
  selectedMount,
  isPending,
  onPin,
}: {
  disk: DiskMetrics;
  selectedMount?: string;
  isPending: boolean;
  onPin: (mountPoint: string | null) => void;
}) {
  const usage = normalizeProgressPercent(disk.usagePercent);
  const identity = `${disk.name || "Disk"} · ${disk.mountPoint || "mount unavailable"}`;
  const selected = disk.mountPoint === selectedMount;
  const size =
    Number.isFinite(disk.usedBytes) &&
    disk.usedBytes >= 0 &&
    Number.isFinite(disk.totalBytes) &&
    disk.totalBytes > 0
      ? `${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}`
      : "Unavailable size";

  return (
    <li className="min-w-0 space-y-1.5 rounded border border-[var(--color-border)] p-2 text-[10px]">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="min-w-0 [overflow-wrap:anywhere] text-[var(--color-text)]">
            {identity}
          </p>
          <p className="text-[var(--color-text-muted)]">
            {usage ? formatPercent(usage.value) : "Unavailable"} · {size}
          </p>
        </div>
        <button
          type="button"
          className="min-h-11 min-w-11 shrink-0 rounded px-2 text-[var(--color-text)] hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--color-ring)] disabled:cursor-wait disabled:opacity-60"
          aria-label={`${selected ? "Unpin" : "Pin"} storage mount ${disk.mountPoint || "unavailable"}`}
          aria-pressed={selected}
          disabled={isPending || !disk.mountPoint}
          onClick={() => onPin(selected ? null : disk.mountPoint)}
        >
          {selected ? "Pinned" : "Pin"}
        </button>
      </div>
      {usage && (
        <meter
          min={0}
          max={100}
          value={usage.value}
          aria-label={`${identity} usage`}
          className="h-1.5 w-full accent-[var(--color-primary)]"
        />
      )}
    </li>
  );
}

function formatSelection(
  resolution: ReturnType<typeof resolveHostResourceStorage>,
): string {
  if (resolution.state === "missing") return "Saved mount missing";
  if (resolution.state === "unavailable") return "Unavailable";
  return resolution.state === "pinned" ? "Pinned mount" : "Default disk";
}
