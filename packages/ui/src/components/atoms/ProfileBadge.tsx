import { cn } from "@/lib/utils.js";

export const PROFILE_COLOR_PALETTES = [
  "bg-sky-500/15 text-sky-400 border-sky-500/30",
  "bg-violet-500/15 text-violet-400 border-violet-500/30",
  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "bg-rose-500/15 text-rose-400 border-rose-500/30",
  "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  "bg-teal-500/15 text-teal-400 border-teal-500/30",
  "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
] as const;

export function hashProfileColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % PROFILE_COLOR_PALETTES.length;
  return PROFILE_COLOR_PALETTES[index];
}

export interface ProfileBadgeProps {
  name: string;
  profileId?: string;
  className?: string;
}

export function ProfileBadge({
  name,
  profileId,
  className,
}: ProfileBadgeProps) {
  const seed = profileId || name;
  const colorClass = hashProfileColor(seed);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9px] font-mono font-medium tracking-wide lowercase border shrink-0",
        colorClass,
        className,
      )}
      title={`Server profile: ${name}`}
    >
      {name}
    </span>
  );
}
