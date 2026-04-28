import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { Menu, X, ServerCog } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { ConnectionDot } from "@/components/atoms/ConnectionDot.js";
import { Logo } from "@/components/atoms/Logo.js";
import { useIpc } from "@/hooks/useSSE.js";
import { WorkspaceSwitcher } from "@/components/organisms/WorkspaceSwitcher.js";
import { ServerSettingsDialog } from "@/components/organisms/ServerSettingsDialog.js";
import { ServerProfilesDialog } from "@/components/organisms/ServerProfilesDialog.js";
import { getActiveProfile, getServerUrl, buildAuthHeaders, type ServerProfile } from "@/api/server-config.js";
import { BASE_NAV } from "@/lib/navigation.js";

interface TopNavProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export function TopNav({ collapsed = true, onToggle }: TopNavProps) {
  const { status } = useIpc();
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [profilesDialogOpen, setProfilesDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ServerProfile | null | undefined>(undefined);
  const [isDevMode, setIsDevMode] = useState(false);
  
  const activeProfile = getActiveProfile();

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
      } catch { }
    };
    void checkDevMode();
  }, [status]);

  return (
    <header className="shrink-0 glass-card border-b border-[var(--color-border)] px-4 h-12 flex items-center justify-between z-50">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Logo size="sm" />
          <span className="text-[10px] text-[var(--color-primary)] font-bold tracking-widest opacity-70 hidden sm:inline">
            DAM-HOPPER
          </span>
        </div>
        
        <button
          onClick={onToggle}
          className="p-1.5 hover:bg-[var(--color-surface-2)] rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          title={collapsed ? "Show menu" : "Hide menu"}
        >
          {collapsed ? <Menu size={16} /> : <X size={16} />}
        </button>

        {/* Inline Menu */}
        <nav className={cn(
          "flex items-center gap-1 overflow-hidden transition-all duration-300 ease-in-out",
          collapsed ? "max-w-0 opacity-0 pointer-events-none" : "max-w-[1000px] opacity-100 ml-2"
        )}>
          {BASE_NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs font-bold transition-all whitespace-nowrap",
                  isActive
                    ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)] border-b border-[var(--color-primary)]"
                    : "text-[var(--color-text)] opacity-50 hover:opacity-100 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] border-b border-transparent",
                )
              }
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="tracking-widest text-[10px]">{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <WorkspaceSwitcher variant="compact" />
        
        <div className="h-4 w-[1px] bg-[var(--color-border)]" />
        
        <button
          onClick={() => setProfilesDialogOpen(true)}
          className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-[var(--color-surface-2)] transition-colors"
          title={activeProfile?.name || "Server connection"}
        >
          <ConnectionDot status={status} collapsed={false} devMode={isDevMode} />
          {activeProfile && (
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] tracking-wider uppercase hidden md:inline">
              {activeProfile.name}
            </span>
          )}
        </button>
        
        <button
          onClick={() => setProfilesDialogOpen(true)}
          className="p-1.5 hover:bg-[var(--color-surface-2)] rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          title="Manage server connections"
        >
          <ServerCog size={16} />
        </button>
      </div>

      <ServerSettingsDialog 
        open={serverSettingsOpen} 
        onClose={() => { setServerSettingsOpen(false); setEditingProfile(undefined); }}
        profile={editingProfile}
        onSaved={() => { setServerSettingsOpen(false); setEditingProfile(undefined); }}
      />
      <ServerProfilesDialog
        open={profilesDialogOpen}
        onClose={() => setProfilesDialogOpen(false)}
        onEditProfile={(p) => { setProfilesDialogOpen(false); setEditingProfile(p); setServerSettingsOpen(true); }}
        onSwitchProfile={() => {}}
      />
    </header>
  );
}
