import { useEffect } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { DashboardPage } from "@/components/pages/DashboardPage.js";
import { GitPage } from "@/components/pages/GitPage.js";
import { SettingsPage } from "@/components/pages/SettingsPage.js";
import { TerminalsPage } from "@/components/pages/TerminalsPage.js";
import { AgentStorePage } from "@/components/pages/AgentStorePage.js";
import { getTransport } from "@/api/transport.js";

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

export function App() {
  const qc = useQueryClient();

  useEffect(() => {
    const transport = getTransport();
    return transport.onEvent("workspace:changed", () => {
      void qc.invalidateQueries({ queryKey: ["workspace-status"] });
    });
  }, [qc]);

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
