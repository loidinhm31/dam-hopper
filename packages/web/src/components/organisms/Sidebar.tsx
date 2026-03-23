import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  FolderGit2,
  GitMerge,
  Hammer,
  Activity,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import { ConnectionDot } from "@/components/atoms/ConnectionDot.js";
import { useIpc } from "@/hooks/useSSE.js";
import { WorkspaceSwitcher } from "@/components/organisms/WorkspaceSwitcher.js";

const nav = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/projects", icon: FolderGit2, label: "Projects" },
  { to: "/git", icon: GitMerge, label: "Git" },
  { to: "/build", icon: Hammer, label: "Build" },
  { to: "/processes", icon: Activity, label: "Processes" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const { status } = useIpc();

  return (
    <aside className="flex h-full w-60 flex-col bg-[var(--color-surface)] border-r border-[var(--color-border)]">
      {/* Workspace switcher */}
      <div className="px-4 py-4 border-b border-[var(--color-border)]">
        <WorkspaceSwitcher />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors mb-0.5",
                isActive
                  ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Connection status */}
      <div className="px-4 py-3 border-t border-[var(--color-border)]">
        <ConnectionDot status={status} />
      </div>
    </aside>
  );
}
