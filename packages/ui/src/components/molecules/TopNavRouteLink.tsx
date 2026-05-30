import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils.js";
import type { NavEntry } from "@/lib/navigation.js";

interface TopNavRouteLinkProps {
  entry: NavEntry;
  compactTextClass: string;
  compactLabelClass: string;
  isCompactWorkspace: boolean;
  mobileGrid?: boolean;
  fullWidth?: boolean;
}

export function TopNavRouteLink({
  entry,
  compactTextClass,
  compactLabelClass,
  isCompactWorkspace,
  mobileGrid = false,
  fullWidth = false,
}: TopNavRouteLinkProps) {
  const { to, icon: Icon, label } = entry;

  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          mobileGrid
            ? "flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 font-bold transition-colors"
            : "flex items-center gap-2 rounded-sm border-b px-2 py-1.5 font-bold whitespace-nowrap transition-all sm:px-2.5",
          isCompactWorkspace ? compactTextClass : "text-xs",
          mobileGrid && fullWidth && "col-span-2",
          isActive
            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
            : mobileGrid
              ? "border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
              : "border-transparent text-[var(--color-text)] opacity-50 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] hover:opacity-100",
        )
      }
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span
        className={cn(
          mobileGrid
            ? "min-w-0 truncate tracking-widest"
            : "hidden tracking-widest lg:inline",
          isCompactWorkspace ? compactLabelClass : "text-[10px]",
        )}
      >
        {label}
      </span>
    </NavLink>
  );
}
