import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  label: string;
  value: number | string;
  color?: string;
}

export function OverviewCard({
  icon: Icon,
  label,
  value,
  color = "var(--color-primary)",
}: Props) {
  const slug = label.toLowerCase().replace(/\s+/g, "_");
  return (
    <div className="rounded glass-card p-3 group hover:border-[var(--color-primary)]/30 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div
          className="flex h-7 w-7 items-center justify-center rounded"
          style={{ backgroundColor: `${color}18` }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color }} />
        </div>
        <span className="text-[10px] text-[var(--color-text-muted)]/50 tracking-widest">{"{}"}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
      <p className="text-[10px] text-[var(--color-text-muted)] tracking-widest uppercase mt-0.5">
        // {slug}
      </p>
    </div>
  );
}
