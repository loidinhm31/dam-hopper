import {
  LayoutDashboard,
  GitMerge,
  Settings,
  Package,
  Code2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export type NavEntry = {
  to: string;
  icon: LucideIcon;
  label: string;
};

export const BASE_NAV: NavEntry[] = [
  { to: "/", icon: LayoutDashboard, label: "DASHBOARD" },
  { to: "/workspace", icon: Code2, label: "WORKSPACE" },
  { to: "/git", icon: GitMerge, label: "GIT" },
  { to: "/agent-store", icon: Package, label: "AGENT STORE" },
  { to: "/devices", icon: ShieldCheck, label: "DEVICES" },
  { to: "/settings", icon: Settings, label: "SETTINGS" },
];

export function getNavEntries(): NavEntry[] {
  return BASE_NAV;
}
