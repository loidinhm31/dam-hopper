import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { DashboardPage } from "@/components/pages/DashboardPage.js";
import { GitPage } from "@/components/pages/GitPage.js";
import { SettingsPage } from "@/components/pages/SettingsPage.js";
import { AgentStorePage } from "@/components/pages/AgentStorePage.js";
import { getTransport } from "@/api/transport.js";

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

export function App() {
  const qc = useQueryClient();

  useEffect(() => {
    const transport = getTransport();
    return transport.onEvent("workspace:changed", () => {
      void qc.invalidateQueries({ queryKey: ["workspace-status"] });
    });
  }, [qc]);

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <GlobalShortcuts />
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route
          path="/workspace"
          element={
            <Suspense fallback={LOADING_FALLBACK}>
              <WorkspacePage />
            </Suspense>
          }
        />
        {/* Backward-compat redirects — preserve search params for deep-links */}
        <Route path="/terminals" element={<LegacyRedirect to="/workspace" />} />
        <Route path="/ide" element={<LegacyRedirect to="/workspace" />} />
        <Route path="/git" element={<GitPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/agent-store" element={<AgentStorePage />} />
      </Routes>
    </BrowserRouter>
  );
}
