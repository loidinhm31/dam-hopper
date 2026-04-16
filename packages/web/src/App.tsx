import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { DashboardPage } from "@/components/pages/DashboardPage.js";
import { GitPage } from "@/components/pages/GitPage.js";
import { SettingsPage } from "@/components/pages/SettingsPage.js";
import { AgentStorePage } from "@/components/pages/AgentStorePage.js";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary.js";
import { getTransport } from "@/api/transport.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useWorkspaceStatus } from "@/api/queries.js";
import { 
  getServerUrl, 
  buildAuthHeaders, 
  migrateToProfiles, 
  getActiveProfile, 
  getAuthToken, 
  setAuthToken,
  getProfiles
} from "@/api/server-config.js";
import { ServerSettingsDialog } from "@/components/organisms/ServerSettingsDialog.js";
import { WorkspaceSetupWizard } from "@/components/organisms/WorkspaceSetupWizard.js";

// Wire CSS var outside React so it updates synchronously with store changes
useSettingsStore.subscribe((s) => {
  document.documentElement.style.setProperty("--app-font-size", `${s.systemFontSize}px`);
});

const WorkspacePage = lazy(() => import("@/components/pages/WorkspacePage.js"));

const LOADING_FALLBACK = (
  <div className="h-screen flex items-center justify-center text-xs text-[var(--color-text-muted)]">
    Loading…
  </div>
);

/** Redirect /terminals or /ide to /workspace, preserving search params. */
function LegacyRedirect({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

/** Registers Ctrl+` as a global shortcut to open a new free terminal in workspace. */
function GlobalShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.code === "Backquote") {
        e.preventDefault();
        navigate("/workspace?action=new-terminal");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  return null;
}

function ServerProfileGuard({ children }: { children: React.ReactNode }) {
  const profiles = getProfiles();
  const activeProfile = getActiveProfile();
  const needsSetup = profiles.length === 0 || !activeProfile;

  if (needsSetup) {
    return (
      <div className="h-screen w-screen bg-[var(--color-surface)] relative">
        <ServerSettingsDialog 
          open={true} 
          onClose={() => {}} 
          closable={false}
          profile={null}
          onSaved={() => {
            // Page will reload automatically via ServerSettingsDialog
          }}
        />
      </div>
    );
  }

  return <>{children}</>;
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);
  const profile = getActiveProfile();
  
  // Auto-login for "none" auth profiles if no token exists
  useEffect(() => {
    const attemptAutoLogin = async () => {
      if (autoLoginAttempted) return;
      if (!profile) return;
      if (profile.authType !== "none") return;
      if (getAuthToken()) {
        setAutoLoginAttempted(true);
        return;
      }
      
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(`${getServerUrl()}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          signal: controller.signal
        });
        clearTimeout(timeout);
        const data = await res.json();
        if (data.token) {
          setAuthToken(data.token);
        }
      } catch (err) {
        console.error('[AuthGuard] Auto-login failed:', err);
      }
      setAutoLoginAttempted(true);
    };
    
    void attemptAutoLogin();
  }, [profile, autoLoginAttempted]);
  
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['auth-status'],
    queryFn: async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(`${getServerUrl()}/api/auth/status`, {
          headers: buildAuthHeaders(),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!res.ok) throw new Error("Not authenticated");
        return res.json();
      } catch (err) {
        clearTimeout(timeout);
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('Server connection timeout');
        }
        throw err;
      }
    },
    retry: false,
    // Wait for auto-login attempt if needed
    enabled: !profile || profile.authType !== "none" || autoLoginAttempted
  });

  if (isLoading || (profile?.authType === "none" && !autoLoginAttempted)) {
    return <>{LOADING_FALLBACK}</>;
  }
  
  if (isError || !data?.authenticated) {
    return (
      <div className="h-screen w-screen bg-[var(--color-surface)] relative">
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-xs text-red-400">
          {error instanceof Error ? error.message : 'Connection failed'}
        </div>
        <ServerSettingsDialog open={true} onClose={() => {}} closable={false} />
      </div>
    );
  }

  return <>{children}</>;
}

function WorkspaceGuard({ children }: { children: React.ReactNode }) {
  const { data: status, isLoading, isError, error, refetch } = useWorkspaceStatus();
  const [setupComplete, setSetupComplete] = useState(false);

  if (isLoading) {
    return <>{LOADING_FALLBACK}</>;
  }
  
  // Show error if workspace status check failed
  if (isError) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4">
        <div className="text-sm text-red-400">
          {error instanceof Error ? error.message : 'Failed to check workspace status'}
        </div>
        <button
          onClick={() => void refetch()}
          className="px-4 py-2 rounded-lg text-xs font-semibold"
          style={{ background: "var(--color-primary)", color: "white" }}
        >
          Retry
        </button>
      </div>
    );
  }
  
  // If workspace is not ready and setup hasn't been completed, show setup wizard
  if (!status?.ready && !setupComplete) {
    return (
      <WorkspaceSetupWizard 
        onComplete={() => {
          setSetupComplete(true);
          void refetch();
        }} 
      />
    );
  }

  return <>{children}</>;
}

export function App() {
  const qc = useQueryClient();

  useEffect(() => {
    void useSettingsStore.getState().hydrate();
    // Migrate legacy single-server config to profile system
    migrateToProfiles();
  }, []);

  useEffect(() => {
    const transport = getTransport();
    return transport.onEvent("workspace:changed", () => {
      void qc.invalidateQueries({ queryKey: ["workspace-status"] });
    });
  }, [qc]);

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <GlobalShortcuts />
      <ServerProfileGuard>
        <AuthGuard>
          <WorkspaceGuard>
            <Routes>
            <Route path="/" element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
            <Route
              path="/workspace"
              element={
                <ErrorBoundary>
                  <Suspense fallback={LOADING_FALLBACK}>
                    <WorkspacePage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
            {/* Backward-compat redirects — preserve search params for deep-links */}
            <Route path="/terminals" element={<LegacyRedirect to="/workspace" />} />
            <Route path="/ide" element={<LegacyRedirect to="/workspace" />} />
            <Route path="/git" element={<ErrorBoundary><GitPage /></ErrorBoundary>} />
            <Route path="/settings" element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />
            <Route path="/agent-store" element={<ErrorBoundary><AgentStorePage /></ErrorBoundary>} />
            </Routes>
          </WorkspaceGuard>
        </AuthGuard>
      </ServerProfileGuard>
    </BrowserRouter>
  );
}
