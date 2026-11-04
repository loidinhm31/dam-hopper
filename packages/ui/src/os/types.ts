import type { FsTargetRef } from "@/api/ownership.js";
import type { TileNode } from "@/types/tile-tree.js";
import type { TerminalTarget, ReviewTarget } from "../api/terminal-session-contract.js";

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
  | "system-monitor"
  | "agent-hub"
  | "recipes";

export interface WindowContext {
  profileId: string;
  generation?: number;
  projectId?: string;
  worktreeId?: string;
  gitRootId?: string;
  operation?: string;
  target?: FsTargetRef;
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

export type OsWindowRuntimeIdentity =
  | { readonly kind: "terminal"; readonly target: TerminalTarget }
  | { readonly kind: "review"; readonly target: ReviewTarget };

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
  /**
   * In-memory runtime identity for active terminal or review sessions.
   *
   * CRITICAL SAFETY INVARIANT:
   * - Runtime identity MUST NEVER be serialized as trusted portable layout in OsSessionV1 or localStorage.
   * - P07 supplies explicit persistence projection/revalidation; upon layout restoration,
   *   windows start unverified and must resolve against active owner observations.
   */
  runtimeIdentity?: OsWindowRuntimeIdentity;
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
  incarnation?: number | string;
  epoch?: number | string;
  authority?: string;
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

// ============================================================================
// Shell Seam & Geometry Signatures
// ============================================================================

export type CalculateNextFloatBoundsFn = (
  session: OsSessionV1,
  desktopId: string,
  viewport: { width: number; height: number },
) => FloatBounds;

export type ProjectFloatBoundsFn = (
  saved: FloatBounds,
  viewport: { width: number; height: number },
) => FloatBounds;

export interface WindowStoreModeActions {
  toggleWindowMode: (windowId: string) => void;
}

export type ShellNonmodalSurface =
  | "target-selector"
  | "window-list"
  | "notification-center";

export type ShellModalSurface =
  | "command-palette"
  | "server-profiles-dialog"
  | "server-settings-dialog"
  | "confirm-dialog";

export type ShellNamedSurface = ShellNonmodalSurface | ShellModalSurface;

/** Token returned when a modal or child dialog mounts to track nested depth. */
export type ModalMountToken = string;

export interface ShellInputState {
  readonly cognitoActive: boolean;
  readonly activeNonmodal: ShellNonmodalSurface | null;
  readonly activePalette: boolean;
  readonly modalDepth: number;
  readonly activeModalTokens: readonly ModalMountToken[];
}

export interface ShellModalCallbacks {
  /** Request opening or closing named shell surfaces (Palette, Notification Center, etc.) */
  readonly setSurfaceOpen: (surface: ShellNamedSurface, open: boolean) => void;
  /**
   * Registers a mounted modal dialog or nested confirmation, returning a balanced cleanup unmount token.
   * Radix retains nested focus/dismissal ownership; this maintains explicit modal depth accounting.
   */
  readonly registerModalMount: (surface: ShellModalSurface) => () => void;
}
