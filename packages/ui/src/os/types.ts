import type { TileNode } from "@/types/tile-tree.js";

export type OsAppId =
  | "terminals"
  | "editor"
  | "browser"
  | "files"
  | "search"
  | "changes"
  | "project-info"
  | "git"
  | "conflict-resolver"
  | "session-changes"
  | "workflow-plans"
  | "ports-tunnels"
  | "agent-store"
  | "settings"
  | "system-monitor";

export interface WindowContext {
  profileId: string;
  generation?: number;
  projectId?: string;
  worktreeId?: string;
  gitRootId?: string;
  operation?: string;
}

export type WindowMode = "tile" | "float";

export interface FloatBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RestorePlacement {
  mode: WindowMode;
  desktopId: string;
  floatBounds?: FloatBounds;
}

export interface OsWindow {
  id: string;
  appId: OsAppId;
  title: string;
  ctx: WindowContext;
  mode: WindowMode;
  desktopId: string;
  maximized: boolean;
  minimized: boolean;
  floatBounds?: FloatBounds;
  restorePlacement?: RestorePlacement;
  appState?: Record<string, unknown>;
}

export interface OsDesktop {
  id: string;
  name: string;
  defaultCtx?: WindowContext;
  tree: TileNode<string> | null; // Tiled window IDs
  floatingWindowIds: string[];
  focusedWindowId: string | null;
}

export interface OsSessionV1 {
  schema: 1;
  activeDesktopId: string;
  desktops: OsDesktop[];
  windows: Record<string, OsWindow>;
}

export interface ResourceClaimKey {
  resourceKind:
    | "terminal"
    | "editor"
    | "browser"
    | "conflict-resolver"
    | "session-changes"
    | string;
  resourceId: string;
  profileId: string;
  generation: number;
  incarnation?: number;
  epoch?: number;
}

export interface AppManifest {
  appId: OsAppId;
  displayName: string;
  instancing:
    | "single-instance"
    | "multi-instance"
    | "profile-instance"
    | "project-instance"
    | "worktree-instance"
    | "tuple-instance";
  minimumCtx: "none" | "profile" | "project";
  defaultPlacement: WindowMode;
  minSize: { width: number; height: number };
  intents?: string[];
}
