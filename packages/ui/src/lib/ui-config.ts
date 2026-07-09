import type { UiConfig } from "@/api/client.js";
import {
  DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT,
  DEFAULT_SEARCH_FILENAME_SHORTCUT,
  DEFAULT_SEARCH_TEXT_SHORTCUT,
  DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT,
  DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
  formatShortcut,
} from "@/lib/shortcuts.js";

export const DEFAULT_UI_CONFIG: UiConfig = {
  systemFontSize: 14,
  editorFontSize: 14,
  editorZoomWheelEnabled: true,
  terminalSuggestionsEnabled: true,
  terminalCodexNotificationsEnabled: false,
  terminalScrollButtonsEnabled: false,
  terminalScrollStep: 3,
  explorerShowHidden: false,
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
  revealActiveFileShortcut: DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT,
};

export function withUiConfigDefaults(ui?: Partial<UiConfig> | null): UiConfig {
  const legacyTerminalAgentNotificationsEnabled = (
    ui as { terminalAgentNotificationsEnabled?: boolean } | null | undefined
  )?.terminalAgentNotificationsEnabled;

  return {
    ...DEFAULT_UI_CONFIG,
    ...ui,
    terminalOrder: ui?.terminalOrder ?? DEFAULT_UI_CONFIG.terminalOrder,
    projectOrder: ui?.projectOrder ?? DEFAULT_UI_CONFIG.projectOrder,
    projectCommandOrder:
      ui?.projectCommandOrder ?? DEFAULT_UI_CONFIG.projectCommandOrder,
    runtimeGroupOrder:
      ui?.runtimeGroupOrder ?? DEFAULT_UI_CONFIG.runtimeGroupOrder,
    runtimeItemOrder: ui?.runtimeItemOrder ?? DEFAULT_UI_CONFIG.runtimeItemOrder,
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
    revealActiveFileShortcut: formatShortcut(
      ui?.revealActiveFileShortcut ??
        DEFAULT_UI_CONFIG.revealActiveFileShortcut,
    ),
  };
}
