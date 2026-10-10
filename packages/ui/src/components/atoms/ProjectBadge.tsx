import { cn } from "@/lib/utils.js";

export const PROJECT_COLOR_PALETTES = [
  "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "bg-teal-500/15 text-teal-400 border-teal-500/30",
  "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  "bg-slate-500/15 text-slate-300 border-slate-500/30",
  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "bg-sky-500/15 text-sky-400 border-sky-500/30",
  "bg-rose-500/15 text-rose-400 border-rose-500/30",
] as const;

export function hashProjectColor(seed?: string | null): string {
  const str = seed ?? "";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % PROJECT_COLOR_PALETTES.length;
  return PROJECT_COLOR_PALETTES[index];
}

export interface ProjectBadgeProps {
  name: string;
  className?: string;
}

export function ProjectBadge({ name, className }: ProjectBadgeProps) {
  const trimmedName = name?.trim();
  if (!trimmedName) return null;

  const colorClass = hashProjectColor(trimmedName);

  return (
    <span
      role="status"
      aria-label={`Project: ${trimmedName}`}
      className={cn(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9px] font-mono font-medium tracking-wide border shrink-0 max-w-[120px]",
        colorClass,
        className,
      )}
      title={`Project: ${trimmedName}`}
    >
      <span className="min-w-0 truncate">{trimmedName}</span>
    </span>
  );
}
