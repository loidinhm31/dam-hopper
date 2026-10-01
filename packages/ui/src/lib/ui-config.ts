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
  DEFAULT_FLEET_TERMINAL_SHORTCUT,
  DEFAULT_GIT_PANEL_SHORTCUT,
  DEFAULT_PORTS_PANEL_SHORTCUT,
  DEFAULT_PROJECT_PANEL_SHORTCUT,
  DEFAULT_SEARCH_FILENAME_SHORTCUT,
  DEFAULT_SEARCH_TEXT_SHORTCUT,
  DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT,
  DEFAULT_TERMINAL_FONT_SIZE_DECREASE_SHORTCUT,
  DEFAULT_TERMINAL_FONT_SIZE_INCREASE_SHORTCUT,
  DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
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
  fleetTerminalShortcut: DEFAULT_FLEET_TERMINAL_SHORTCUT,
  terminalFontSizeIncreaseShortcut:
    DEFAULT_TERMINAL_FONT_SIZE_INCREASE_SHORTCUT,
  terminalFontSizeDecreaseShortcut:
    DEFAULT_TERMINAL_FONT_SIZE_DECREASE_SHORTCUT,
  cognitoModeShortcut: DEFAULT_COGNITO_MODE_SHORTCUT,
  cognitoModeStyle: "heavy-blur",
};

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
    searchTextShortcut: formatShortcut(
      ui?.searchTextShortcut ?? DEFAULT_UI_CONFIG.searchTextShortcut,
    ),
    searchFilenameShortcut: formatShortcut(
      ui?.searchFilenameShortcut ?? DEFAULT_UI_CONFIG.searchFilenameShortcut,
    ),
    terminalWorkspaceShortcut: formatShortcut(
      ui?.terminalWorkspaceShortcut ??
        DEFAULT_UI_CONFIG.terminalWorkspaceShortcut,
    ),
    terminalFilePanelShortcut: formatShortcut(
      ui?.terminalFilePanelShortcut ??
        DEFAULT_UI_CONFIG.terminalFilePanelShortcut,
    ),
    projectPanelShortcut: formatShortcut(
      ui?.projectPanelShortcut ?? DEFAULT_UI_CONFIG.projectPanelShortcut,
    ),
    revealActiveFileShortcut: formatShortcut(
      ui?.revealActiveFileShortcut ??
        DEFAULT_UI_CONFIG.revealActiveFileShortcut,
    ),
    gitPanelShortcut: formatShortcut(
      ui?.gitPanelShortcut ?? DEFAULT_UI_CONFIG.gitPanelShortcut,
    ),
    portsPanelShortcut: formatShortcut(
      ui?.portsPanelShortcut ?? DEFAULT_UI_CONFIG.portsPanelShortcut,
    ),
    fleetTerminalShortcut: formatShortcut(
      ui?.fleetTerminalShortcut ?? DEFAULT_UI_CONFIG.fleetTerminalShortcut,
    ),
    terminalFontSizeIncreaseShortcut: formatShortcut(
      ui?.terminalFontSizeIncreaseShortcut ??
        DEFAULT_TERMINAL_FONT_SIZE_INCREASE_SHORTCUT,
    ),
    terminalFontSizeDecreaseShortcut: formatShortcut(
      ui?.terminalFontSizeDecreaseShortcut ??
        DEFAULT_TERMINAL_FONT_SIZE_DECREASE_SHORTCUT,
    ),
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
