import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { DashboardPage } from "@/pages/DashboardPage.js";
import { GitPage } from "@/pages/GitPage.js";
import { SettingsPage } from "@/pages/SettingsPage.js";
import { TerminalsPage } from "@/pages/TerminalsPage.js";
import { WelcomePage } from "@/pages/WelcomePage.js";
import { useWorkspaceStatus } from "@/api/queries.js";

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/terminals" element={<TerminalsPage />} />
        <Route path="/git" element={<GitPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export function App() {
  const qc = useQueryClient();
  const { data: status, isLoading } = useWorkspaceStatus();

  // Invalidate workspace-status when workspace:changed fires (auto-resolve or user selection)
  useEffect(() => {
    return window.devhub.on("workspace:changed", () => {
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
