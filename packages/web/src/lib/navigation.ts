import { LayoutDashboard, GitMerge, Settings, Package, Code2, type LucideIcon } from "lucide-react";

export type NavEntry = { 
  to: string; 
  icon: LucideIcon; 
  label: string 
};

export const BASE_NAV: NavEntry[] = [
  { to: "/", icon: LayoutDashboard, label: "DASHBOARD" },
  { to: "/workspace", icon: Code2, label: "WORKSPACE" },
  { to: "/git", icon: GitMerge, label: "GIT" },
  { to: "/agent-store", icon: Package, label: "AGENT STORE" },
  { to: "/settings", icon: Settings, label: "SETTINGS" },
];
