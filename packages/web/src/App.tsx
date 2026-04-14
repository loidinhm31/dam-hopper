import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { DashboardPage } from "@/components/pages/DashboardPage.js";
import { GitPage } from "@/components/pages/GitPage.js";
import { SettingsPage } from "@/components/pages/SettingsPage.js";
import { AgentStorePage } from "@/components/pages/AgentStorePage.js";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary.js";
import { getTransport } from "@/api/transport.js";
import { useSettingsStore } from "@/stores/settings.js";
import { getServerUrl, buildAuthHeaders } from "@/api/server-config.js";
import { ServerSettingsDialog } from "@/components/organisms/ServerSettingsDialog.js";

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

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['auth-status'],
    queryFn: async () => {
      const res = await fetch(`${getServerUrl()}/api/auth/status`, {
        headers: buildAuthHeaders()
      });
      if (!res.ok) throw new Error("Not authenticated");
      return res.json();
    },
    retry: false
  });

  if (isLoading) return <>{LOADING_FALLBACK}</>;
  
  if (isError || !data?.authenticated) {
    return (
      <div className="h-screen w-screen bg-[var(--color-surface)] relative">
         <ServerSettingsDialog open={true} onClose={() => {}} closable={false} />
      </div>
    );
  }

  return <>{children}</>;
}

export function App() {
  const qc = useQueryClient();

  useEffect(() => {
    void useSettingsStore.getState().hydrate();
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
      <AuthGuard>
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
      </AuthGuard>
    </BrowserRouter>
  );
}
