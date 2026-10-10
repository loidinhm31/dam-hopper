import { cn } from "@/lib/utils.js";

export const HARNESS_COLOR_MAP: Record<string, string> = {
  OMP: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  Codex: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Claude: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

export interface AgentHarnessBadgeProps {
  harness: string;
  className?: string;
}

export function AgentHarnessBadge({
  harness,
  className,
}: AgentHarnessBadgeProps) {
  const trimmed = harness?.trim();
  if (!trimmed) return null;
  const colorClass =
    HARNESS_COLOR_MAP[trimmed] ??
    "bg-sky-500/15 text-sky-300 border-sky-500/30";

  return (
    <span
      role="status"
      aria-label={`Agent: ${trimmed}`}
      className={cn(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9px] font-mono font-medium tracking-wide uppercase border shrink-0",
        colorClass,
        className,
      )}
      title={`Agent: ${trimmed}`}
    >
      {trimmed}
    </span>
  );
}
