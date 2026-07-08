import type { UiConfig } from "@/api/client.js";
import {
  DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT,
  DEFAULT_SEARCH_FILENAME_SHORTCUT,
  DEFAULT_SEARCH_TEXT_SHORTCUT,
  DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT,
  DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
  formatShortcut,
} from "@/lib/shortcuts.js";
import {
  DEFAULT_TERMINAL_AGENT_NOTIFICATION_POLICY,
  DEFAULT_TERMINAL_AGENT_QUIET_TIMEOUT_MS,
  getDefaultTerminalAgentCommandPatterns,
  normalizeAgentCommandPatterns,
} from "@/lib/terminal-agent-notification-settings.js";

export const DEFAULT_UI_CONFIG: UiConfig = {
  systemFontSize: 14,
  editorFontSize: 14,
  editorZoomWheelEnabled: true,
  terminalSuggestionsEnabled: true,
  terminalAgentNotificationsEnabled: false,
  terminalAgentNotificationPolicy: DEFAULT_TERMINAL_AGENT_NOTIFICATION_POLICY,
  terminalAgentSignalsEnabled: true,
  terminalAgentQuietTrackingEnabled: true,
  terminalAgentQuietTimeoutMs: DEFAULT_TERMINAL_AGENT_QUIET_TIMEOUT_MS,
  terminalAgentCommandPatterns: getDefaultTerminalAgentCommandPatterns(),
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
    terminalAgentNotificationsEnabled:
      ui?.terminalAgentNotificationsEnabled ??
      DEFAULT_UI_CONFIG.terminalAgentNotificationsEnabled,
    terminalAgentNotificationPolicy:
      ui?.terminalAgentNotificationPolicy ??
      DEFAULT_UI_CONFIG.terminalAgentNotificationPolicy,
    terminalAgentSignalsEnabled:
      ui?.terminalAgentSignalsEnabled ??
      DEFAULT_UI_CONFIG.terminalAgentSignalsEnabled,
    terminalAgentQuietTrackingEnabled:
      ui?.terminalAgentQuietTrackingEnabled ??
      DEFAULT_UI_CONFIG.terminalAgentQuietTrackingEnabled,
    terminalAgentQuietTimeoutMs:
      ui?.terminalAgentQuietTimeoutMs ??
      DEFAULT_UI_CONFIG.terminalAgentQuietTimeoutMs,
    terminalAgentCommandPatterns: normalizeAgentCommandPatterns(
      ui?.terminalAgentCommandPatterns,
    ),
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
