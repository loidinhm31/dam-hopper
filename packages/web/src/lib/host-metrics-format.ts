export function formatPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return "0%";
  const clamped = Math.min(Math.max(value ?? 0, 0), 100);
  return `${Math.round(clamped)}%`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatUsage(usedBytes: number, totalBytes: number): string {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return "unavailable";
  return `${formatBytes(usedBytes)} / ${formatBytes(totalBytes)}`;
}
