import { NavLink } from "react-router-dom";
import { LayoutDashboard, TerminalSquare, GitMerge, Settings, Folder, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { ConnectionDot } from "@/components/atoms/ConnectionDot.js";
import { useIpc } from "@/hooks/useSSE.js";
import { WorkspaceSwitcher } from "@/components/organisms/WorkspaceSwitcher.js";

const nav = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/terminals", icon: TerminalSquare, label: "Terminals" },
  { to: "/git", icon: GitMerge, label: "Git" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export function Sidebar({ collapsed = false, onToggle }: SidebarProps) {
  const { status } = useIpc();

  return (
    <aside
      className={cn(
        "flex h-full flex-col bg-[var(--color-surface)] border-r border-[var(--color-border)] shrink-0 transition-[width] duration-200 ease-in-out overflow-hidden",
        collapsed ? "w-12" : "w-60",
      )}
    >
      {/* Workspace switcher */}
      <div className={cn("border-b border-[var(--color-border)]", collapsed ? "px-2 py-4 flex justify-center" : "px-4 py-4")}>
        {!collapsed ? (
          <WorkspaceSwitcher />
        ) : (
          <Folder className="h-4 w-4 text-[var(--color-text-muted)]" />
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                "flex items-center rounded px-3 py-2 text-sm transition-colors mb-0.5",
                collapsed ? "justify-center" : "gap-3",
                isActive
                  ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Toggle + Connection status */}
      <div className="border-t border-[var(--color-border)] px-2 py-2 flex flex-col gap-1">
        <div className={cn(collapsed && "flex justify-center")}>
          <button
            onClick={onToggle}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="p-2 hover:bg-[var(--color-surface-2)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        </div>
        <div className={cn(collapsed ? "flex justify-center px-0 py-1" : "px-2 py-1")}>
          <ConnectionDot status={status} />
        </div>
      </div>
    </aside>
  );
}
