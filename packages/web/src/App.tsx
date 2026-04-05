import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { DashboardPage } from "@/pages/DashboardPage.js";
import { GitPage } from "@/pages/GitPage.js";
import { SettingsPage } from "@/pages/SettingsPage.js";
import { TerminalsPage } from "@/pages/TerminalsPage.js";
import { WelcomePage } from "@/pages/WelcomePage.js";
import { AgentStorePage } from "@/pages/AgentStorePage.js";
import { LoginPage } from "@/pages/LoginPage.js";
import { useWorkspaceStatus } from "@/api/queries.js";
import { getTransport, isWebMode } from "@/api/transport.js";

/** Registers Ctrl+` as a global shortcut to open a new free terminal. */
function GlobalShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.code === "Backquote") {
        e.preventDefault();
        navigate("/terminals?action=new-terminal");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  return null;
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <GlobalShortcuts />
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/terminals" element={<TerminalsPage />} />
        <Route path="/git" element={<GitPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/agent-store" element={<AgentStorePage />} />
      </Routes>
    </BrowserRouter>
  );
}

function AuthenticatedApp() {
  const qc = useQueryClient();
  const { data: status, isLoading } = useWorkspaceStatus();

  useEffect(() => {
    const transport = getTransport();
    return transport.onEvent("workspace:changed", () => {
      void qc.invalidateQueries({ queryKey: ["workspace-status"] });
    });
  }, [qc]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)]">
        <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
      </div>
    );
  }

  if (!status?.ready) {
    return (
      <WelcomePage
        onReady={() => void qc.invalidateQueries({ queryKey: ["workspace-status"] })}
      />
    );
  }

  return <AppRoutes />;
}

export function App() {
  const qc = useQueryClient();

  // Auth state for web mode
  const [authChecked, setAuthChecked] = useState(!isWebMode());
  const [authenticated, setAuthenticated] = useState(!isWebMode());

  // In web mode: check auth status on mount
  useEffect(() => {
    if (!isWebMode()) return;
    fetch("/api/auth/status")
      .then((r) => r.json() as Promise<{ authenticated: boolean }>)
      .then(({ authenticated: ok }) => {
        setAuthenticated(ok);
        setAuthChecked(true);
      })
      .catch(() => {
        setAuthenticated(false);
        setAuthChecked(true);
      });
  }, []);

  // Electron mode: subscribe to workspace events at top level
  useEffect(() => {
    if (isWebMode()) return;
    const transport = getTransport();
    return transport.onEvent("workspace:changed", () => {
      void qc.invalidateQueries({ queryKey: ["workspace-status"] });
    });
  }, [qc]);

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)]">
        <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
      </div>
    );
  }

  if (isWebMode() && !authenticated) {
    return (
      <LoginPage
        onLogin={() => setAuthenticated(true)}
      />
    );
  }

  return <AuthenticatedApp />;
}
