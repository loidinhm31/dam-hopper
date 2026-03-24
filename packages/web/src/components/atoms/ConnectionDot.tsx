import { cn } from "@/lib/utils.js";

// IPC is always connected — status is always "connected"
interface Props {
  status: "connected";
  collapsed?: boolean;
}

export function ConnectionDot({ status, collapsed = false }: Props) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] tracking-wide">
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full status-glow-green shrink-0",
          status === "connected" && "bg-[var(--color-success)]",
        )}
      />
      {!collapsed && (
        <span className="text-[var(--color-success)]/70 uppercase text-[10px] tracking-widest">online</span>
      )}
    </span>
  );
}
