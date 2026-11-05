import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bot,
  Cable,
  Code2,
  Folder,
  FolderGit2,
  GitBranch,
  GitCompare,
  GitMerge,
  Globe,
  History,
  ListTodo,
  ScrollText,
  Search,
  Settings,
  Store,
  Terminal,
} from "lucide-react";
import type { OsAppId } from "./types.js";

/**
 * Exhaustive static mapping of all 17 OsAppId values to their Lucide SVG icons.
 * Adheres to Architecture Contract C6: 20px SVG, consistent 2px stroke, currentColor.
 */
export const APP_ICONS = {
  terminals: Terminal,
  editor: Code2,
  browser: Globe,
  files: Folder,
  search: Search,
  changes: GitCompare,
  git: GitBranch,
  "conflict-resolver": GitMerge,
  "session-changes": History,
  "workflow-plans": ListTodo,
  "ports-tunnels": Cable,
  "project-info": FolderGit2,
  "agent-store": Store,
  settings: Settings,
  "system-monitor": Activity,
  "agent-hub": Bot,
  recipes: ScrollText,
} as const satisfies Record<OsAppId, LucideIcon>;

export interface AppIconProps {
  appId: OsAppId;
  className?: string;
  size?: number;
  strokeWidth?: number;
  "aria-hidden"?: boolean | "true" | "false";
}

export function AppIcon({
  appId,
  className,
  size = 20,
  strokeWidth = 2,
  "aria-hidden": ariaHidden = true,
}: AppIconProps) {
  const IconComponent = APP_ICONS[appId];
  if (!IconComponent) {
    return null;
  }

  return (
    <IconComponent
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden={ariaHidden}
      color="currentColor"
    />
  );
}
