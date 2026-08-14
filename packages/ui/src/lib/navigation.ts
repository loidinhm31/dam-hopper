import {
  LayoutDashboard,
  GitMerge,
  Settings,
  Package,
  Code2,
  ChartNoAxesCombined,
  GitBranch,
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
  { to: "/usage", icon: ChartNoAxesCombined, label: "USAGE" },
  { to: "/agent-store", icon: Package, label: "AGENT STORE" },
  { to: "/settings", icon: Settings, label: "SETTINGS" },
];

const SSH_FORWARD_NAV: NavEntry = {
  to: "/ssh-forwarding",
  icon: GitBranch,
  label: "SSH FORWARDS",
};

export function getNavEntries({
  sshForwardHostAvailable,
}: {
  sshForwardHostAvailable: boolean;
}): NavEntry[] {
  return sshForwardHostAvailable ? [...BASE_NAV, SSH_FORWARD_NAV] : BASE_NAV;
}
