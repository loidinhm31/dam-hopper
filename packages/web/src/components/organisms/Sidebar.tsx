import { useState, type ComponentType } from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, GitMerge, Settings, Folder, ChevronsLeft, ChevronsRight, Package, ServerCog, Code2 } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { ConnectionDot } from "@/components/atoms/ConnectionDot.js";
import { useIpc } from "@/hooks/useSSE.js";
import { WorkspaceSwitcher } from "@/components/organisms/WorkspaceSwitcher.js";
import { ServerSettingsDialog } from "@/components/organisms/ServerSettingsDialog.js";

type NavEntry = { to: string; icon: ComponentType<{ className?: string }>; label: string };

const BASE_NAV: NavEntry[] = [
  { to: "/", icon: LayoutDashboard, label: "DASHBOARD" },
  { to: "/workspace", icon: Code2, label: "WORKSPACE" },
  { to: "/git", icon: GitMerge, label: "GIT" },
  { to: "/agent-store", icon: Package, label: "AGENT STORE" },
  { to: "/settings", icon: Settings, label: "SETTINGS" },
];

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export function Sidebar({ collapsed = false, onToggle }: SidebarProps) {
  const { status } = useIpc();
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);

  const nav: NavEntry[] = BASE_NAV;

  return (
    <aside
      className={cn(
        "flex h-full flex-col glass-card border-r border-[var(--color-border)] shrink-0 transition-[width] duration-200 ease-in-out overflow-hidden",
        collapsed ? "w-12" : "w-56",
      )}
    >
      {/* Workspace header */}
      <div className={cn(
        "border-b border-[var(--color-border)]",
        collapsed ? "px-2 py-3 flex justify-center" : "px-3 py-3",
      )}>
        {!collapsed ? (
          <div>
            <p className="text-[10px] text-[var(--color-primary)] font-bold tracking-widest mb-1 opacity-70">
              ┌─ WORKSPACE
            </p>
            <WorkspaceSwitcher />
          </div>
        ) : (
          <Folder className="h-4 w-4 text-[var(--color-primary)]" />
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-1.5 py-2">
        {!collapsed && (
          <p className="px-2 pb-1.5 text-[10px] text-[var(--color-text-muted)] font-semibold tracking-widest uppercase opacity-60">
            └─ navigate
          </p>
        )}
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                "flex items-center rounded-sm px-2 py-2 text-xs font-bold transition-all mb-0.5 group",
                collapsed ? "justify-center" : "gap-2",
                isActive
                  ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)] border-l-2 border-[var(--color-primary)]"
                  : "text-[var(--color-text)] opacity-50 hover:opacity-100 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] border-l-2 border-transparent",
              )
            }
          >
            {({ isActive }) => (
              <>
                {!collapsed && (
                  <span className={cn(
                    "text-[11px] w-4 shrink-0 font-black",
                    isActive ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)] opacity-50",
                  )}>
                    {isActive ? ">" : "·"}
                  </span>
                )}
                <Icon className={cn(
                  "h-4 w-4 shrink-0",
                  isActive ? "text-[var(--color-primary)]" : "",
                )} />
                {!collapsed && (
                  <span className="tracking-widest text-[11px]">{label}</span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-[var(--color-border)] px-2 py-2 flex flex-col gap-1.5">
        <div className={cn("flex", collapsed ? "justify-center" : "justify-between items-center")}>
          <button
            onClick={onToggle}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="p-1.5 hover:bg-[var(--color-surface-2)] rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
          </button>
          {!collapsed && (
            <button
              onClick={() => setServerSettingsOpen(true)}
              title="Server connection settings"
              className="p-1.5 hover:bg-[var(--color-surface-2)] rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <ServerCog size={14} />
            </button>
          )}
        </div>
        <div className={cn(collapsed ? "flex justify-center px-0 py-0.5" : "px-1 py-0.5")}>
          <ConnectionDot status={status} collapsed={collapsed} />
        </div>
        {collapsed && (
          <button
            onClick={() => setServerSettingsOpen(true)}
            title="Server connection settings"
            className="flex justify-center p-1.5 hover:bg-[var(--color-surface-2)] rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <ServerCog size={14} />
          </button>
        )}
      </div>

      <ServerSettingsDialog open={serverSettingsOpen} onClose={() => setServerSettingsOpen(false)} />
    </aside>
  );
}
