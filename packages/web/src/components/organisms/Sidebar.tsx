import { useState, useEffect, type ComponentType } from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, GitMerge, Settings, ChevronsLeft, ChevronsRight, Package, ServerCog, Code2 } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { ConnectionDot } from "@/components/atoms/ConnectionDot.js";
import { Logo } from "@/components/atoms/Logo.js";
import { useIpc } from "@/hooks/useSSE.js";
import { WorkspaceSwitcher } from "@/components/organisms/WorkspaceSwitcher.js";
import { ServerSettingsDialog } from "@/components/organisms/ServerSettingsDialog.js";
import { ServerProfilesDialog } from "@/components/organisms/ServerProfilesDialog.js";
import { getActiveProfile, getServerUrl, buildAuthHeaders, type ServerProfile } from "@/api/server-config.js";
import { PortsPanel } from "@/components/organisms/PortsPanel.js";

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
  const [profilesDialogOpen, setProfilesDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ServerProfile | null | undefined>(undefined);
  const [isDevMode, setIsDevMode] = useState(false);
  
  const activeProfile = getActiveProfile();

  // Check if server is in dev mode
  useEffect(() => {
    if (status !== "connected") {
      setIsDevMode(false);
      return;
    }
    
    const checkDevMode = async () => {
      try {
        const res = await fetch(`${getServerUrl()}/api/auth/status`, {
          headers: buildAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          setIsDevMode(!!data.dev_mode);
        }
      } catch {
        // Ignore errors
      }
    };
    
    void checkDevMode();
  }, [status]);

  const nav: NavEntry[] = BASE_NAV;
  
  function handleOpenProfiles() {
    setProfilesDialogOpen(true);
  }
  
  function handleEditProfile(profile: ServerProfile | null) {
    setProfilesDialogOpen(false);
    setEditingProfile(profile);
    setServerSettingsOpen(true);
  }
  
  function handleSwitchProfile(_profile: ServerProfile) {
    // Page will reload automatically via ServerProfilesDialog
  }
  
  function handleCloseSettings() {
    setServerSettingsOpen(false);
    setEditingProfile(undefined);
  }

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
            <div className="flex items-center gap-2 mb-2">
              <Logo size="sm" />
              <p className="text-[10px] text-[var(--color-primary)] font-bold tracking-widest opacity-70">
                ┌─ WORKSPACE
              </p>
            </div>
            <WorkspaceSwitcher />
          </div>
        ) : (
          <Logo size="md" />
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

      {/* Ports panel */}
      {!collapsed && <PortsPanel />}

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
              onClick={handleOpenProfiles}
              title="Manage server connections"
              className="p-1.5 hover:bg-[var(--color-surface-2)] rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <ServerCog size={14} />
            </button>
          )}
        </div>
        <button
          onClick={handleOpenProfiles}
          className={cn(
            "flex items-center gap-2 rounded-sm hover:bg-[var(--color-surface-2)] transition-colors",
            collapsed ? "justify-center px-0 py-1" : "px-1 py-1"
          )}
          title={collapsed ? (activeProfile?.name || "Server connection") : undefined}
        >
          <ConnectionDot status={status} collapsed={collapsed} devMode={isDevMode} />
          {!collapsed && activeProfile && (
            <span className="text-xs text-[var(--color-text-muted)] truncate flex-1 text-left">
              {activeProfile.name}
            </span>
          )}
        </button>
        {collapsed && (
          <button
            onClick={handleOpenProfiles}
            title="Manage server connections"
            className="flex justify-center p-1.5 hover:bg-[var(--color-surface-2)] rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <ServerCog size={14} />
          </button>
        )}
      </div>

      <ServerSettingsDialog 
        open={serverSettingsOpen} 
        onClose={handleCloseSettings}
        profile={editingProfile}
        onSaved={() => {
          handleCloseSettings();
        }}
      />
      <ServerProfilesDialog
        open={profilesDialogOpen}
        onClose={() => setProfilesDialogOpen(false)}
        onEditProfile={handleEditProfile}
        onSwitchProfile={handleSwitchProfile}
      />
    </aside>
  );
}
