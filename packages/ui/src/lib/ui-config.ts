import type { UiConfig } from "@/api/client.js";
import {
  DEFAULT_SEARCH_FILENAME_SHORTCUT,
  DEFAULT_SEARCH_TEXT_SHORTCUT,
  DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
  formatShortcut,
} from "@/lib/shortcuts.js";

export const DEFAULT_UI_CONFIG: UiConfig = {
  systemFontSize: 14,
  editorFontSize: 14,
  editorZoomWheelEnabled: true,
  terminalSuggestionsEnabled: true,
  explorerShowHidden: false,
  mobileCustomKeyboardEnabled: true,
  mobileCustomKeyboardFontSize: 11,
  mobileCustomKeyboardPadding: 6,
  terminalOrder: [],
  projectOrder: [],
  projectCommandOrder: {},
  runtimeGroupOrder: [],
  runtimeItemOrder: {},
  searchTextShortcut: DEFAULT_SEARCH_TEXT_SHORTCUT,
  searchFilenameShortcut: DEFAULT_SEARCH_FILENAME_SHORTCUT,
  terminalWorkspaceShortcut: DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
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
    mobileCustomKeyboardEnabled:
      ui?.mobileCustomKeyboardEnabled ??
      DEFAULT_UI_CONFIG.mobileCustomKeyboardEnabled,
    mobileCustomKeyboardFontSize:
      ui?.mobileCustomKeyboardFontSize ??
      DEFAULT_UI_CONFIG.mobileCustomKeyboardFontSize,
    mobileCustomKeyboardPadding:
      ui?.mobileCustomKeyboardPadding ??
      DEFAULT_UI_CONFIG.mobileCustomKeyboardPadding,
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
  };
}
