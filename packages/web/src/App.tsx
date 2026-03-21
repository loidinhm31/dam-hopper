import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DashboardPage } from "@/pages/DashboardPage.js";
import { ProjectsPage } from "@/pages/ProjectsPage.js";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage.js";
import { GitPage } from "@/pages/GitPage.js";
import { BuildPage } from "@/pages/BuildPage.js";
import { ProcessesPage } from "@/pages/ProcessesPage.js";
import { SettingsPage } from "@/pages/SettingsPage.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:name" element={<ProjectDetailPage />} />
        <Route path="/git" element={<GitPage />} />
        <Route path="/build" element={<BuildPage />} />
        <Route path="/processes" element={<ProcessesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
