import { APP_MANIFESTS } from "./app-registry.js";
import type { OsAppId, WindowMode } from "./types.js";
import {
  DEFAULT_COGNITO_MODE_SHORTCUT,
  DEFAULT_GIT_PANEL_SHORTCUT,
  DEFAULT_OS_CYCLE_FOCUS_SHORTCUT,
  DEFAULT_OS_PALETTE_SHORTCUT,
  DEFAULT_PORTS_PANEL_SHORTCUT,
  DEFAULT_PROJECT_PANEL_SHORTCUT,
  DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT,
  DEFAULT_SEARCH_FILENAME_SHORTCUT,
  DEFAULT_SEARCH_TEXT_SHORTCUT,
  DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT,
  DEFAULT_TERMINAL_FONT_SIZE_DECREASE_SHORTCUT,
  DEFAULT_TERMINAL_FONT_SIZE_INCREASE_SHORTCUT,
  DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
} from "../lib/shortcuts.js";

// ============================================================================
// Action IDs & Categories
// ============================================================================

export type ScalarActionId =
  | "app.terminals.open"
  | "app.files.open"
  | "app.search.open"
  | "app.git.open"
  | "app.ports-tunnels.open"
  | "app.project-info.open"
  | "search.filename"
  | "file.reveal-active"
  | "terminal.font-increase"
  | "terminal.font-decrease"
  | "privacy.cognito"
  | "os.palette"
  | "os.cycle-focus";

export type ExtraActionId =
  | "app.editor.open"
  | "app.browser.open"
  | "app.changes.open"
  | "app.conflict-resolver.open"
  | "app.session-changes.open"
  | "app.workflow-plans.open"
  | "app.agent-store.open"
  | "app.settings.open"
  | "app.system-monitor.open"
  | "app.agent-hub.open"
  | "app.recipes.open"
  | "app.terminals.new-window"
  | "app.editor.new-window"
  | "app.browser.new-window";

export type OsActionId = ScalarActionId | ExtraActionId;

export type ActionLaunchMode = "focus-or-open" | "new-window" | "action";

export type ActionContextRequirement =
  | "none"
  | "profile"
  | "project"
  | "worktree"
  | "exact-filesystem"
  | "review-target"
  | "conflict-target";

export type BindingValue = string | null;

// ============================================================================
// Settings Projection for Binding Resolution
// ============================================================================

export interface ActionBindingsSettingsProjection {
  readonly terminalWorkspaceShortcut?: string | null;
  readonly terminalFilePanelShortcut?: string | null;
  readonly searchTextShortcut?: string | null;
  readonly gitPanelShortcut?: string | null;
  readonly portsPanelShortcut?: string | null;
  readonly projectPanelShortcut?: string | null;
  readonly searchFilenameShortcut?: string | null;
  readonly revealActiveFileShortcut?: string | null;
  readonly terminalFontSizeIncreaseShortcut?: string | null;
  readonly terminalFontSizeDecreaseShortcut?: string | null;
  readonly cognitoModeShortcut?: string | null;
  readonly osPaletteShortcut?: string | null;
  readonly osCycleFocusShortcut?: string | null;
  readonly appShortcuts?: Readonly<Record<string, string | null>> | null;
}

export type ActionBindingSource =
  | {
      readonly kind: "scalar";
      readonly property: keyof Omit<ActionBindingsSettingsProjection, "appShortcuts">;
    }
  | {
      readonly kind: "extra";
      readonly extraId: ExtraActionId;
    };
export interface ActionDescriptor {
  readonly id: OsActionId;
  readonly appId?: OsAppId;
  readonly label: string;
  readonly launchMode: ActionLaunchMode;
  readonly contextRequirement: ActionContextRequirement;
  readonly bindingSource: ActionBindingSource;
  readonly defaultBinding: string | null;
  readonly supportedModes?: readonly WindowMode[];
  readonly enabledExplanation?: string;
}

// ============================================================================
// ID Sets & Guard Functions
// ============================================================================

const EXTRA_ACTION_IDS: Record<ExtraActionId, true> = {
  "app.editor.open": true,
  "app.browser.open": true,
  "app.changes.open": true,
  "app.conflict-resolver.open": true,
  "app.session-changes.open": true,
  "app.workflow-plans.open": true,
  "app.agent-store.open": true,
  "app.settings.open": true,
  "app.system-monitor.open": true,
  "app.agent-hub.open": true,
  "app.recipes.open": true,
  "app.terminals.new-window": true,
  "app.editor.new-window": true,
  "app.browser.new-window": true,
};

export function isExtraActionId(id: string): id is ExtraActionId {
  return Object.prototype.hasOwnProperty.call(EXTRA_ACTION_IDS, id);
}

// ============================================================================
// Action Catalog Derived from APP_MANIFESTS and Architecture Contract C1
// ============================================================================

function buildActionCatalog(): Record<OsActionId, ActionDescriptor> {
  const descriptors: Partial<Record<OsActionId, ActionDescriptor>> = {};

  // 1. App Open/Focus Actions (derived from APP_MANIFESTS)
  const appEntries: Array<{
    appId: OsAppId;
    requirement: ActionContextRequirement;
    bindingSource: ActionBindingSource;
    defaultBinding: string | null;
    enabledExplanation?: string;
  }> = [
    {
      appId: "terminals",
      requirement: "profile",
      bindingSource: { kind: "scalar", property: "terminalWorkspaceShortcut" },
      defaultBinding: DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
    },
    {
      appId: "editor",
      requirement: "exact-filesystem",
      bindingSource: { kind: "extra", extraId: "app.editor.open" },
      defaultBinding: null,
      enabledExplanation: "Requires authorized workspace or project file context",
    },
    {
      appId: "browser",
      requirement: "profile",
      bindingSource: { kind: "extra", extraId: "app.browser.open" },
      defaultBinding: null,
    },
    {
      appId: "files",
      requirement: "worktree",
      bindingSource: { kind: "scalar", property: "terminalFilePanelShortcut" },
      defaultBinding: DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT,
      enabledExplanation: "Requires project, worktree, or authorized workspace target",
    },
    {
      appId: "search",
      requirement: "worktree",
      bindingSource: { kind: "scalar", property: "searchTextShortcut" },
      defaultBinding: DEFAULT_SEARCH_TEXT_SHORTCUT,
      enabledExplanation: "Requires project, worktree, or authorized workspace target",
    },
    {
      appId: "changes",
      requirement: "worktree",
      bindingSource: { kind: "extra", extraId: "app.changes.open" },
      defaultBinding: null,
      enabledExplanation: "Requires project or worktree context",
    },
    {
      appId: "git",
      requirement: "worktree",
      bindingSource: { kind: "scalar", property: "gitPanelShortcut" },
      defaultBinding: DEFAULT_GIT_PANEL_SHORTCUT,
      enabledExplanation: "Requires project or worktree context",
    },
    {
      appId: "conflict-resolver",
      requirement: "conflict-target",
      bindingSource: { kind: "extra", extraId: "app.conflict-resolver.open" },
      defaultBinding: null,
      enabledExplanation: "Requires real merge/rebase conflict operation and git root",
    },
    {
      appId: "session-changes",
      requirement: "review-target",
      bindingSource: { kind: "extra", extraId: "app.session-changes.open" },
      defaultBinding: null,
      enabledExplanation: "Requires active review target session tuple",
    },
    {
      appId: "workflow-plans",
      requirement: "project",
      bindingSource: { kind: "extra", extraId: "app.workflow-plans.open" },
      defaultBinding: null,
      enabledExplanation: "Requires project context",
    },
    {
      appId: "ports-tunnels",
      requirement: "profile",
      bindingSource: { kind: "scalar", property: "portsPanelShortcut" },
      defaultBinding: DEFAULT_PORTS_PANEL_SHORTCUT,
    },
    {
      appId: "project-info",
      requirement: "project",
      bindingSource: { kind: "scalar", property: "projectPanelShortcut" },
      defaultBinding: DEFAULT_PROJECT_PANEL_SHORTCUT,
      enabledExplanation: "Requires project context",
    },
    {
      appId: "agent-store",
      requirement: "profile",
      bindingSource: { kind: "extra", extraId: "app.agent-store.open" },
      defaultBinding: null,
    },
    {
      appId: "settings",
      requirement: "none",
      bindingSource: { kind: "extra", extraId: "app.settings.open" },
      defaultBinding: null,
    },
    {
      appId: "system-monitor",
      requirement: "none",
      bindingSource: { kind: "extra", extraId: "app.system-monitor.open" },
      defaultBinding: null,
    },
    {
      appId: "agent-hub",
      requirement: "none",
      bindingSource: { kind: "extra", extraId: "app.agent-hub.open" },
      defaultBinding: null,
    },
    {
      appId: "recipes",
      requirement: "none",
      bindingSource: { kind: "extra", extraId: "app.recipes.open" },
      defaultBinding: null,
    },
  ];

  for (const entry of appEntries) {
    const manifest = APP_MANIFESTS[entry.appId];
    const actionId = `app.${entry.appId}.open` as OsActionId;
    descriptors[actionId] = {
      id: actionId,
      appId: entry.appId,
      label: manifest.displayName,
      launchMode: "focus-or-open",
      contextRequirement: entry.requirement,
      bindingSource: entry.bindingSource,
      defaultBinding: entry.defaultBinding,
      supportedModes: ["tile", "float"],
      enabledExplanation: entry.enabledExplanation,
    };
  }

  // 2. New Window Actions (ONLY 3: terminals, editor, browser)
  descriptors["app.terminals.new-window"] = {
    id: "app.terminals.new-window",
    appId: "terminals",
    label: "New Terminal Window",
    launchMode: "new-window",
    contextRequirement: "profile",
    bindingSource: { kind: "extra", extraId: "app.terminals.new-window" },
    defaultBinding: null,
    supportedModes: ["tile", "float"],
  };

  descriptors["app.editor.new-window"] = {
    id: "app.editor.new-window",
    appId: "editor",
    label: "New Editor Window",
    launchMode: "new-window",
    contextRequirement: "exact-filesystem",
    bindingSource: { kind: "extra", extraId: "app.editor.new-window" },
    defaultBinding: null,
    supportedModes: ["tile", "float"],
    enabledExplanation: "Opens target chooser or creates independent editor window",
  };

  descriptors["app.browser.new-window"] = {
    id: "app.browser.new-window",
    appId: "browser",
    label: "New Browser Window",
    launchMode: "new-window",
    contextRequirement: "profile",
    bindingSource: { kind: "extra", extraId: "app.browser.new-window" },
    defaultBinding: null,
    supportedModes: ["tile", "float"],
  };

  // 3. Additional Stable Action IDs (7)
  descriptors["search.filename"] = {
    id: "search.filename",
    label: "Search by Filename",
    launchMode: "action",
    contextRequirement: "worktree",
    bindingSource: { kind: "scalar", property: "searchFilenameShortcut" },
    defaultBinding: DEFAULT_SEARCH_FILENAME_SHORTCUT,
  };

  descriptors["file.reveal-active"] = {
    id: "file.reveal-active",
    label: "Reveal Active File",
    launchMode: "action",
    contextRequirement: "worktree",
    bindingSource: { kind: "scalar", property: "revealActiveFileShortcut" },
    defaultBinding: DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT,
  };

  descriptors["terminal.font-increase"] = {
    id: "terminal.font-increase",
    label: "Increase Terminal Font Size",
    launchMode: "action",
    contextRequirement: "none",
    bindingSource: { kind: "scalar", property: "terminalFontSizeIncreaseShortcut" },
    defaultBinding: DEFAULT_TERMINAL_FONT_SIZE_INCREASE_SHORTCUT,
  };

  descriptors["terminal.font-decrease"] = {
    id: "terminal.font-decrease",
    label: "Decrease Terminal Font Size",
    launchMode: "action",
    contextRequirement: "none",
    bindingSource: { kind: "scalar", property: "terminalFontSizeDecreaseShortcut" },
    defaultBinding: DEFAULT_TERMINAL_FONT_SIZE_DECREASE_SHORTCUT,
  };

  descriptors["privacy.cognito"] = {
    id: "privacy.cognito",
    label: "Toggle Cognito Mode",
    launchMode: "action",
    contextRequirement: "none",
    bindingSource: { kind: "scalar", property: "cognitoModeShortcut" },
    defaultBinding: DEFAULT_COGNITO_MODE_SHORTCUT,
  };

  descriptors["os.palette"] = {
    id: "os.palette",
    label: "Open Command Palette",
    launchMode: "action",
    contextRequirement: "none",
    bindingSource: { kind: "scalar", property: "osPaletteShortcut" },
    defaultBinding: DEFAULT_OS_PALETTE_SHORTCUT,
  };

  descriptors["os.cycle-focus"] = {
    id: "os.cycle-focus",
    label: "Cycle Window Focus",
    launchMode: "action",
    contextRequirement: "none",
    bindingSource: { kind: "scalar", property: "osCycleFocusShortcut" },
    defaultBinding: DEFAULT_OS_CYCLE_FOCUS_SHORTCUT,
  };

  return descriptors as Record<OsActionId, ActionDescriptor>;
}

export const ACTION_DESCRIPTORS: Record<OsActionId, ActionDescriptor> =
  buildActionCatalog();

export function isOsActionId(id: string): id is OsActionId {
  return Object.prototype.hasOwnProperty.call(ACTION_DESCRIPTORS, id);
}

export function getActionDescriptor(id: OsActionId): ActionDescriptor {
  const descriptor = ACTION_DESCRIPTORS[id];
  if (!descriptor) {
    throw new Error(`Unknown action ID: ${id}`);
  }
  return descriptor;
}

export function listActionDescriptors(): readonly ActionDescriptor[] {
  return Object.values(ACTION_DESCRIPTORS);
}

// ============================================================================
// Pure Presence-Aware Binding Resolution
// ============================================================================

/**
 * Resolves the effective keyboard shortcut binding for a given action ID
 * against a readonly structural projection of Workbench settings.
 *
 * Invariants (Architecture Contracts C1 & C4):
 * - Missing scalar property in settings projection -> descriptor default.
 * - Explicit `null` in settings projection -> `null` (unbound).
 * - Explicit string in settings projection -> configured replacement chord.
 * - Missing extra action in appShortcuts map -> descriptor default (null).
 * - Explicit `null` in appShortcuts map -> `null` (unbound).
 * - Explicit string in appShortcuts map -> configured replacement chord.
 * - Cognito exception: Non-empty valid keyboard chord is strictly required;
 *   cannot be unbound or set to DoubleShift/wheel. Falling back to default on invalid/null.
 */
export function resolveActionBinding(
  id: OsActionId,
  settings?: ActionBindingsSettingsProjection | null,
): BindingValue {
  const descriptor = getActionDescriptor(id);

  if (descriptor.bindingSource.kind === "scalar") {
    const prop = descriptor.bindingSource.property;

    // Cognito exception: cannot unbind or assign invalid chords
    if (id === "privacy.cognito") {
      if (settings && Object.prototype.hasOwnProperty.call(settings, prop)) {
        const val = settings[prop];
        if (
          typeof val === "string" &&
          val.trim().length > 0 &&
          val !== "DoubleShift" &&
          val !== "Mod+Wheel"
        ) {
          return val;
        }
      }
      return descriptor.defaultBinding;
    }

    // Standard scalar resolution with presence-awareness
    if (settings && Object.prototype.hasOwnProperty.call(settings, prop)) {
      const val = settings[prop];
      if (val === null) return null;
      if (typeof val === "string") return val;
      return descriptor.defaultBinding;
    }
    return descriptor.defaultBinding;
  }

  // Extra action resolution via appShortcuts map
  const extraId = descriptor.bindingSource.extraId;
  if (
    settings &&
    settings.appShortcuts &&
    typeof settings.appShortcuts === "object" &&
    Object.prototype.hasOwnProperty.call(settings.appShortcuts, extraId)
  ) {
    const val = settings.appShortcuts[extraId];
    if (val === null) return null;
    if (typeof val === "string") return val;
    return descriptor.defaultBinding;
  }

  return descriptor.defaultBinding;
}
