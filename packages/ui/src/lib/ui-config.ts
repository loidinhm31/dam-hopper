import type { UiConfig } from "@/api/client.js";
import type { ExplorerLanguageFilter } from "@/api/fs-types.js";
import {
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
} from "@/lib/shortcuts.js";

export const DEFAULT_UI_CONFIG: UiConfig = {
  hostResourcePinnedMount: null,
  systemFontSize: 14,
  editorFontSize: 14,
  terminalFontSize: 13,
  editorZoomWheelEnabled: true,
  terminalSuggestionsEnabled: true,
  terminalAutoSwitchProjectEnabled: true,
  terminalCodexNotificationsEnabled: false,
  terminalCodexNotificationToastEnabled: true,
  terminalCodexBrowserNotificationsEnabled: true,
  terminalCodexNotificationSoundEnabled: true,
  terminalCodexNotificationSoundVolume: 100,
  terminalCodexNotificationSoundPattern: "default",
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

export function withUiConfigDefaults(ui?: Partial<UiConfig> | null): UiConfig {
  const legacyTerminalAgentNotificationsEnabled = (
    ui as { terminalAgentNotificationsEnabled?: boolean } | null | undefined
  )?.terminalAgentNotificationsEnabled;

  return {
    ...DEFAULT_UI_CONFIG,
    ...ui,
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
    terminalCodexNotificationsEnabled:
      ui?.terminalCodexNotificationsEnabled ??
      legacyTerminalAgentNotificationsEnabled ??
      DEFAULT_UI_CONFIG.terminalCodexNotificationsEnabled,
    terminalCodexNotificationToastEnabled:
      ui?.terminalCodexNotificationToastEnabled ??
      DEFAULT_UI_CONFIG.terminalCodexNotificationToastEnabled,
    terminalCodexBrowserNotificationsEnabled:
      ui?.terminalCodexBrowserNotificationsEnabled ??
      DEFAULT_UI_CONFIG.terminalCodexBrowserNotificationsEnabled,
    terminalCodexNotificationSoundEnabled:
      ui?.terminalCodexNotificationSoundEnabled ??
      DEFAULT_UI_CONFIG.terminalCodexNotificationSoundEnabled,
    terminalCodexNotificationSoundVolume:
      ui?.terminalCodexNotificationSoundVolume ??
      DEFAULT_UI_CONFIG.terminalCodexNotificationSoundVolume,
    terminalCodexNotificationSoundPattern:
      ui?.terminalCodexNotificationSoundPattern ??
      DEFAULT_UI_CONFIG.terminalCodexNotificationSoundPattern,
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
  };
}
