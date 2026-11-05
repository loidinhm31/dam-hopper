import type {
  CognitoModeStyle,
  UiConfig,
  TerminalAgentNotificationPolicy,
  TerminalAgentNotifications,
  TerminalCodexNotificationSoundPattern,
} from "@/api/client.js";
import type { ExplorerLanguageFilter } from "@/api/fs-types.js";
import {
  DEFAULT_COGNITO_MODE_SHORTCUT,
  DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT,
  DEFAULT_GIT_PANEL_SHORTCUT,
  DEFAULT_PORTS_PANEL_SHORTCUT,
  DEFAULT_PROJECT_PANEL_SHORTCUT,
  DEFAULT_SEARCH_FILENAME_SHORTCUT,
  DEFAULT_SEARCH_TEXT_SHORTCUT,
  DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT,
  DEFAULT_TERMINAL_FONT_SIZE_DECREASE_SHORTCUT,
  DEFAULT_TERMINAL_FONT_SIZE_INCREASE_SHORTCUT,
  DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
  DEFAULT_OS_PALETTE_SHORTCUT,
  DEFAULT_OS_CYCLE_FOCUS_SHORTCUT,
  formatShortcut,
  normalizeCognitoModeShortcut,
} from "@/lib/shortcuts.js";

const DEFAULT_AGENT_POLICY: TerminalAgentNotificationPolicy = {
  enabled: false,
  toast: true,
  browser: true,
  sound: true,
  volume: 100,
  pattern: "default",
};

const LEGACY_AGENT_KEYS = [
  "terminalCodexNotificationsEnabled",
  "terminalCodexNotificationToastEnabled",
  "terminalCodexBrowserNotificationsEnabled",
  "terminalCodexNotificationSoundEnabled",
  "terminalCodexNotificationSoundVolume",
  "terminalCodexNotificationSoundPattern",
  "terminalAgentNotificationsEnabled",
] as const;

export function clampTerminalNotificationSoundVolume(volume: number): number {
  return Number.isFinite(volume)
    ? Math.min(100, Math.max(0, Math.round(volume)))
    : 100;
}

function isSoundPattern(
  value: unknown,
): value is TerminalCodexNotificationSoundPattern {
  return (
    value === "default" ||
    value === "soft" ||
    value === "two-tone" ||
    value === "urgent"
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function policyFrom(
  input: Record<string, unknown>,
  defaults: TerminalAgentNotificationPolicy,
): TerminalAgentNotificationPolicy {
  return {
    enabled:
      typeof input.enabled === "boolean" ? input.enabled : defaults.enabled,
    toast: typeof input.toast === "boolean" ? input.toast : defaults.toast,
    browser:
      typeof input.browser === "boolean" ? input.browser : defaults.browser,
    sound: typeof input.sound === "boolean" ? input.sound : defaults.sound,
    volume:
      typeof input.volume === "number" && Number.isFinite(input.volume)
        ? clampTerminalNotificationSoundVolume(input.volume)
        : defaults.volume,
    pattern: isSoundPattern(input.pattern) ? input.pattern : defaults.pattern,
  };
}

/** Normalize the server config or an offline preference snapshot; old fields only enter here. */
export function normalizeTerminalAgentNotifications(
  value: unknown,
): TerminalAgentNotifications {
  const input = asRecord(value);
  const raw = asRecord(input.terminalAgentNotifications);
  const hasCanonical = Object.hasOwn(input, "terminalAgentNotifications");
  if (hasCanonical && raw.version !== 1 && raw.version !== 2) {
    // Preserve the unsupported version so saves are refused, but never render
    // untrusted policy values as enabled channels.
    return {
      version: typeof raw.version === "number" ? raw.version : 0,
      agents: {
        codex: { ...DEFAULT_AGENT_POLICY },
        omp: { ...DEFAULT_AGENT_POLICY },
        claude: { ...DEFAULT_AGENT_POLICY },
      },
    };
  }
  const agents = hasCanonical ? asRecord(raw.agents) : {};
  const legacyCodex = {
    enabled:
      typeof input.terminalCodexNotificationsEnabled === "boolean"
        ? input.terminalCodexNotificationsEnabled
        : input.terminalAgentNotificationsEnabled,
    toast: input.terminalCodexNotificationToastEnabled,
    browser: input.terminalCodexBrowserNotificationsEnabled,
    sound: input.terminalCodexNotificationSoundEnabled,
    volume: input.terminalCodexNotificationSoundVolume,
    pattern: input.terminalCodexNotificationSoundPattern,
  };
  return {
    version: 2,
    agents: {
      codex: policyFrom(
        asRecord(agents.codex),
        hasCanonical
          ? DEFAULT_AGENT_POLICY
          : policyFrom(legacyCodex, DEFAULT_AGENT_POLICY),
      ),
      omp: policyFrom(asRecord(agents.omp), DEFAULT_AGENT_POLICY),
      claude: policyFrom(asRecord(agents.claude), DEFAULT_AGENT_POLICY),
    },
  };
}

export const DEFAULT_UI_CONFIG: UiConfig = {
  hostResourcePinnedMount: null,
  systemFontSize: 14,
  editorFontSize: 14,
  terminalFontSize: 13,
  editorZoomWheelEnabled: true,
  terminalSuggestionsEnabled: true,
  terminalAutoSwitchProjectEnabled: true,
  terminalAgentNotifications: {
    version: 2,
    agents: {
      codex: { ...DEFAULT_AGENT_POLICY },
      omp: { ...DEFAULT_AGENT_POLICY },
      claude: { ...DEFAULT_AGENT_POLICY },
    },
  },
  terminalScrollButtonsEnabled: false,
  terminalCommitStatusEnabled: false,
  terminalScrollStep: 3,
  explorerShowHidden: false,
  explorerLanguageFilter: "all",
  mobileCustomKeyboardEnabled: true,
  mobileCustomKeyboardFontSize: 11,
  mobileCustomKeyboardPadding: 6,
  mobileCustomKeyboardRowGap: 4,
  terminalOrder: [],
  projectOrder: [],
  projectCommandOrder: {},
  runtimeGroupOrder: [],
  runtimeItemOrder: {},
  searchTextShortcut: DEFAULT_SEARCH_TEXT_SHORTCUT,
  searchFilenameShortcut: DEFAULT_SEARCH_FILENAME_SHORTCUT,
  terminalWorkspaceShortcut: DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
  terminalFilePanelShortcut: DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT,
  projectPanelShortcut: DEFAULT_PROJECT_PANEL_SHORTCUT,
  revealActiveFileShortcut: DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT,
  gitPanelShortcut: DEFAULT_GIT_PANEL_SHORTCUT,
  portsPanelShortcut: DEFAULT_PORTS_PANEL_SHORTCUT,
  terminalFontSizeIncreaseShortcut:
    DEFAULT_TERMINAL_FONT_SIZE_INCREASE_SHORTCUT,
  terminalFontSizeDecreaseShortcut:
    DEFAULT_TERMINAL_FONT_SIZE_DECREASE_SHORTCUT,
  cognitoModeShortcut: DEFAULT_COGNITO_MODE_SHORTCUT,
  cognitoModeStyle: "heavy-blur",
  defaultWindowPlacement: "float",
  osPaletteShortcut: DEFAULT_OS_PALETTE_SHORTCUT,
  osCycleFocusShortcut: DEFAULT_OS_CYCLE_FOCUS_SHORTCUT,
  dockPadding: 8,
  dockItemSpacing: 6,
  dockOuterSpacing: 12,
  dockRadius: 18,
  cursorTheme: "system",
  appShortcuts: {},
};

export function clampDockPadding(val: unknown): number {
  if (typeof val !== "number" || !Number.isFinite(val)) return 8;
  return Math.min(16, Math.max(0, val));
}

export function clampDockItemSpacing(val: unknown): number {
  if (typeof val !== "number" || !Number.isFinite(val)) return 6;
  return Math.min(12, Math.max(0, val));
}

export function clampDockOuterSpacing(val: unknown): number {
  if (typeof val !== "number" || !Number.isFinite(val)) return 12;
  return Math.min(24, Math.max(0, val));
}

export function clampDockRadius(val: unknown): number {
  if (typeof val !== "number" || !Number.isFinite(val)) return 18;
  return Math.min(28, Math.max(0, val));
}

function resolveNullableShortcut(
  ui: Partial<UiConfig> | null | undefined,
  key: keyof UiConfig,
  fallback: string,
): string | null {
  if (ui && Object.prototype.hasOwnProperty.call(ui, key)) {
    const val = ui[key];
    if (val === null) return null;
    if (typeof val === "string") {
      const trimmed = val.trim();
      return trimmed.length > 0 ? formatShortcut(trimmed) : null;
    }
    return fallback;
  }
  return fallback;
}

function normalizeAppShortcuts(
  map: unknown,
): Record<string, string | null> {
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    return {};
  }
  const result: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
    if (v === null) {
      result[k] = null;
    } else if (typeof v === "string") {
      const trimmed = v.trim();
      result[k] = trimmed.length > 0 ? formatShortcut(trimmed) : null;
    }
  }
  return result;
}

export function isExplorerLanguageFilter(
  value: unknown,
): value is ExplorerLanguageFilter {
  return (
    value === "all" ||
    value === "rust" ||
    value === "javascript-typescript" ||
    value === "java"
  );
}

export function normalizeExplorerLanguageFilter(
  value: unknown,
): ExplorerLanguageFilter {
  return isExplorerLanguageFilter(value) ? value : "all";
}

export function isCognitoModeStyle(value: unknown): value is CognitoModeStyle {
  return value === "heavy-blur" || value === "black-screen";
}

export function normalizeCognitoModeStyle(value: unknown): CognitoModeStyle {
  return isCognitoModeStyle(value) ? value : "heavy-blur";
}

export function withUiConfigDefaults(ui?: Partial<UiConfig> | null): UiConfig {
  const canonicalUi: Record<string, unknown> = { ...ui };
  for (const key of LEGACY_AGENT_KEYS) delete canonicalUi[key];

  return {
    ...DEFAULT_UI_CONFIG,
    ...canonicalUi,
    defaultWindowPlacement:
      ui?.defaultWindowPlacement === "tile" ? "tile" : "float",
    hostResourcePinnedMount: ui?.hostResourcePinnedMount ?? null,
    explorerLanguageFilter: normalizeExplorerLanguageFilter(
      (ui as { explorerLanguageFilter?: unknown } | null | undefined)
        ?.explorerLanguageFilter,
    ),
    terminalAutoSwitchProjectEnabled:
      ui?.terminalAutoSwitchProjectEnabled ??
      DEFAULT_UI_CONFIG.terminalAutoSwitchProjectEnabled,
    terminalOrder: ui?.terminalOrder ?? DEFAULT_UI_CONFIG.terminalOrder,
    projectOrder: ui?.projectOrder ?? DEFAULT_UI_CONFIG.projectOrder,
    projectCommandOrder:
      ui?.projectCommandOrder ?? DEFAULT_UI_CONFIG.projectCommandOrder,
    runtimeGroupOrder:
      ui?.runtimeGroupOrder ?? DEFAULT_UI_CONFIG.runtimeGroupOrder,
    runtimeItemOrder:
      ui?.runtimeItemOrder ?? DEFAULT_UI_CONFIG.runtimeItemOrder,
    terminalScrollStep:
      ui?.terminalScrollStep ?? DEFAULT_UI_CONFIG.terminalScrollStep,
    mobileCustomKeyboardEnabled:
      ui?.mobileCustomKeyboardEnabled ??
      DEFAULT_UI_CONFIG.mobileCustomKeyboardEnabled,
    mobileCustomKeyboardFontSize:
      ui?.mobileCustomKeyboardFontSize ??
      DEFAULT_UI_CONFIG.mobileCustomKeyboardFontSize,
    mobileCustomKeyboardPadding:
      ui?.mobileCustomKeyboardPadding ??
      DEFAULT_UI_CONFIG.mobileCustomKeyboardPadding,
    mobileCustomKeyboardRowGap:
      ui?.mobileCustomKeyboardRowGap ??
      DEFAULT_UI_CONFIG.mobileCustomKeyboardRowGap,
    terminalAgentNotifications: normalizeTerminalAgentNotifications(ui),
    agentSettingsPaths: ui?.agentSettingsPaths,
    terminalFontSize:
      ui?.terminalFontSize ?? DEFAULT_UI_CONFIG.terminalFontSize,
    searchTextShortcut: resolveNullableShortcut(
      ui,
      "searchTextShortcut",
      DEFAULT_SEARCH_TEXT_SHORTCUT,
    ),
    searchFilenameShortcut: resolveNullableShortcut(
      ui,
      "searchFilenameShortcut",
      DEFAULT_SEARCH_FILENAME_SHORTCUT,
    ),
    terminalWorkspaceShortcut: resolveNullableShortcut(
      ui,
      "terminalWorkspaceShortcut",
      DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
    ),
    terminalFilePanelShortcut: resolveNullableShortcut(
      ui,
      "terminalFilePanelShortcut",
      DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT,
    ),
    projectPanelShortcut: resolveNullableShortcut(
      ui,
      "projectPanelShortcut",
      DEFAULT_PROJECT_PANEL_SHORTCUT,
    ),
    revealActiveFileShortcut: resolveNullableShortcut(
      ui,
      "revealActiveFileShortcut",
      DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT,
    ),
    gitPanelShortcut: resolveNullableShortcut(
      ui,
      "gitPanelShortcut",
      DEFAULT_GIT_PANEL_SHORTCUT,
    ),
    portsPanelShortcut: resolveNullableShortcut(
      ui,
      "portsPanelShortcut",
      DEFAULT_PORTS_PANEL_SHORTCUT,
    ),
    terminalFontSizeIncreaseShortcut: resolveNullableShortcut(
      ui,
      "terminalFontSizeIncreaseShortcut",
      DEFAULT_TERMINAL_FONT_SIZE_INCREASE_SHORTCUT,
    ),
    terminalFontSizeDecreaseShortcut: resolveNullableShortcut(
      ui,
      "terminalFontSizeDecreaseShortcut",
      DEFAULT_TERMINAL_FONT_SIZE_DECREASE_SHORTCUT,
    ),
    osPaletteShortcut: resolveNullableShortcut(
      ui,
      "osPaletteShortcut",
      DEFAULT_OS_PALETTE_SHORTCUT,
    ),
    osCycleFocusShortcut: resolveNullableShortcut(
      ui,
      "osCycleFocusShortcut",
      DEFAULT_OS_CYCLE_FOCUS_SHORTCUT,
    ),
    dockPadding: clampDockPadding(ui?.dockPadding),
    dockItemSpacing: clampDockItemSpacing(ui?.dockItemSpacing),
    dockOuterSpacing: clampDockOuterSpacing(ui?.dockOuterSpacing),
    dockRadius: clampDockRadius(ui?.dockRadius),
    cursorTheme: ui?.cursorTheme === "theme" ? "theme" : "system",
    appShortcuts: normalizeAppShortcuts(ui?.appShortcuts),
    cognitoModeShortcut: normalizeCognitoModeShortcut(
      (ui as { cognitoModeShortcut?: unknown } | null | undefined)
        ?.cognitoModeShortcut,
    ),
    cognitoModeStyle: normalizeCognitoModeStyle(
      (ui as { cognitoModeStyle?: unknown } | null | undefined)
        ?.cognitoModeStyle,
    ),
  };
}
