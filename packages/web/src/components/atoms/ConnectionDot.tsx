import { cn } from "@/lib/utils.js";

// IPC is always connected — status is always "connected"
interface Props {
  status: "connected";
}

export function ConnectionDot({ status }: Props) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          status === "connected" && "bg-[var(--color-success)]",
        )}
      />
      Connected
    </span>
  );
}
