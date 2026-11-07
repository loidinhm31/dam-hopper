import type { ConnectionRef, FsTargetRef } from "@/api/ownership.js";
import type { OsActionId, ExtraActionId, ScalarActionId } from "./actions.js";
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

// ============================================================================
// Re-exported Action IDs
// ============================================================================

export type { OsActionId, ExtraActionId, ScalarActionId };

// ============================================================================
// Geometry & Work Area Presentation (Architecture Contract C7)
// ============================================================================

export interface CanvasWorkArea {
  readonly width: number;
  readonly height: number;
}

export type WindowPresentationKind = "tile" | "float" | "maximized";

// ============================================================================
// Action Context & Payloads (Architecture Contracts C1 & C12)
// ============================================================================

export type ActionContext =
  | {
      readonly kind: "desktop";
      readonly desktopId: string;
      readonly windowContext?: WindowContext;
      readonly owner?: ConnectionRef | null;
      readonly target?: FsTargetRef;
    }
  | {
      readonly kind: "editor";
      readonly desktopId: string;
      readonly windowId: string;
      readonly resourceId: string;
      readonly windowContext: WindowContext;
      readonly owner: ConnectionRef;
      readonly target: FsTargetRef;
      readonly selectedText?: string;
      readonly filePath?: string;
      readonly worktreeId?: string;
    }
  | {
      readonly kind: "running-window";
      readonly desktopId: string;
      readonly windowId: string;
      readonly windowContext: WindowContext;
      readonly owner?: ConnectionRef | null;
      readonly runtimeIdentity?: OsWindowRuntimeIdentity;
      readonly target?: FsTargetRef;
    }
  | {
      readonly kind: "shell";
      readonly desktopId?: string;
      readonly windowContext?: WindowContext;
      readonly owner?: ConnectionRef | null;
      readonly target?: FsTargetRef;
    };

export type TerminalDirectoryKind =
  | "explicit-folder"
  | "target-root"
  | "profile-default";

export type TerminalCreatePayload = Readonly<{
  target: FsTargetRef;
  cwd: string | null;
  directoryKind: TerminalDirectoryKind;
  requestedTerminalId?: string;
  sourceWindowId?: string;
  owner: ConnectionRef;
  destinationDesktopId: string;
  windowContext: WindowContext;
}>;

export interface ConflictTargetRef {
  readonly projectId: string;
  readonly gitRootId: string;
  readonly operation: string;
}

// ============================================================================
// Action Request & Result (Architecture Contracts C1 & C13)
// ============================================================================

export type ActionRequest =
  | {
      readonly id: OsActionId;
      readonly context: ActionContext;
    }
  | {
      readonly id: "app.settings.open";
      readonly context: ActionContext;
      readonly settingsSection?: "appearance" | string;
    }
  | {
      readonly id: "app.terminals.new-window";
      readonly context: ActionContext;
      readonly terminalCreate?: TerminalCreatePayload;
    };

export type ActionResult =
  | { readonly kind: "focused"; readonly windowId: string }
  | { readonly kind: "opened"; readonly windowId: string }
  | { readonly kind: "executed" }
  | { readonly kind: "disabled"; readonly reason: string }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "uncertain"; readonly attemptId: string; readonly reason: string };

// ============================================================================
// Chooser & Target Selection Presentation (Architecture Contract C10)
// ============================================================================

export type ChooserPresentationState =
  | {
      readonly kind: "choose-target";
      readonly capturedContext: ActionContext;
      readonly ownerGeneration: number;
      readonly destinationDesktopId: string;
      readonly deliveryToken: string;
    }
  | {
      readonly kind: "resource";
      readonly target: FsTargetRef;
      readonly filePath?: string;
      readonly documentId?: string;
      readonly url?: string;
    };

export interface SettingsDeliveryState {
  readonly section: "appearance" | string;
  readonly deliveryId: string;
}
