/**
 * Settings store — persists UI appearance preferences to server global config.
 *
 * Hydrated once on app boot from /api/global-config.
 * saveDebounced coalesces rapid changes (wheel zoom) into a single write.
 */
import { create } from "zustand";
import { api } from "@/api/client.js";
import { withUiConfigDefaults } from "@/lib/ui-config.js";
import {
  DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT,
  DEFAULT_SEARCH_FILENAME_SHORTCUT,
  DEFAULT_SEARCH_TEXT_SHORTCUT,
  DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT,
  DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
} from "@/lib/shortcuts.js";

const FONT_MIN = 10;
const FONT_MAX = 32;
const KEYBOARD_FONT_MIN = 9;
const KEYBOARD_FONT_MAX = 18;
const KEYBOARD_PADDING_MIN = 2;
const KEYBOARD_PADDING_MAX = 14;
const KEYBOARD_ROW_GAP_MIN = 2;
const KEYBOARD_ROW_GAP_MAX = 12;

export function clampFont(size: number): number {
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(size)));
}

function clampKeyboardFont(size: number): number {
  return Math.min(
    KEYBOARD_FONT_MAX,
    Math.max(KEYBOARD_FONT_MIN, Math.round(size)),
  );
}

function clampKeyboardPadding(size: number): number {
  return Math.min(
    KEYBOARD_PADDING_MAX,
    Math.max(KEYBOARD_PADDING_MIN, Math.round(size)),
  );
}

function clampKeyboardRowGap(size: number): number {
  return Math.min(
    KEYBOARD_ROW_GAP_MAX,
    Math.max(KEYBOARD_ROW_GAP_MIN, Math.round(size)),
  );
}

interface SettingsState {
  systemFontSize: number;
  editorFontSize: number;
  editorZoomWheelEnabled: boolean;
  searchTextShortcut: string;
  searchFilenameShortcut: string;
  terminalWorkspaceShortcut: string;
  terminalFilePanelShortcut: string;
  revealActiveFileShortcut: string;
  terminalSuggestionsEnabled: boolean;
  terminalScrollButtonsEnabled: boolean;
  terminalScrollStep: number;
  explorerShowHidden: boolean;
  mobileCustomKeyboardEnabled: boolean;
  mobileCustomKeyboardFontSize: number;
  mobileCustomKeyboardPadding: number;
  mobileCustomKeyboardRowGap: number;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  set: (
    partial: Partial<
      Pick<
        SettingsState,
        | "systemFontSize"
        | "editorFontSize"
        | "editorZoomWheelEnabled"
        | "searchTextShortcut"
        | "searchFilenameShortcut"
        | "terminalWorkspaceShortcut"
        | "terminalFilePanelShortcut"
        | "revealActiveFileShortcut"
        | "terminalSuggestionsEnabled"
        | "terminalScrollButtonsEnabled"
        | "terminalScrollStep"
        | "explorerShowHidden"
        | "mobileCustomKeyboardEnabled"
        | "mobileCustomKeyboardFontSize"
        | "mobileCustomKeyboardPadding"
        | "mobileCustomKeyboardRowGap"
      >
    >,
  ) => void;
  saveDebounced: (
    partial: Partial<
      Pick<
        SettingsState,
        | "systemFontSize"
        | "editorFontSize"
        | "editorZoomWheelEnabled"
        | "searchTextShortcut"
        | "searchFilenameShortcut"
        | "terminalWorkspaceShortcut"
        | "terminalFilePanelShortcut"
        | "revealActiveFileShortcut"
        | "terminalSuggestionsEnabled"
        | "terminalScrollButtonsEnabled"
        | "terminalScrollStep"
        | "explorerShowHidden"
        | "mobileCustomKeyboardEnabled"
        | "mobileCustomKeyboardFontSize"
        | "mobileCustomKeyboardPadding"
        | "mobileCustomKeyboardRowGap"
      >
    >,
  ) => void;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  systemFontSize: 14,
  editorFontSize: 14,
  editorZoomWheelEnabled: true,
  searchTextShortcut: DEFAULT_SEARCH_TEXT_SHORTCUT,
  searchFilenameShortcut: DEFAULT_SEARCH_FILENAME_SHORTCUT,
  terminalWorkspaceShortcut: DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
  terminalFilePanelShortcut: DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT,
  revealActiveFileShortcut: DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT,
  terminalSuggestionsEnabled: true,
  terminalScrollButtonsEnabled: false,
  terminalScrollStep: 3,
  explorerShowHidden: false,
  mobileCustomKeyboardEnabled: true,
  mobileCustomKeyboardFontSize: 11,
  mobileCustomKeyboardPadding: 6,
  mobileCustomKeyboardRowGap: 4,
  hydrated: false,

  hydrate: async () => {
    try {
      const config = await api.globalConfig.get();
      const ui = withUiConfigDefaults(config.ui);
      set({
        systemFontSize: ui.systemFontSize,
        editorFontSize: ui.editorFontSize,
        editorZoomWheelEnabled: ui.editorZoomWheelEnabled,
        searchTextShortcut: ui.searchTextShortcut,
        searchFilenameShortcut: ui.searchFilenameShortcut,
        terminalWorkspaceShortcut: ui.terminalWorkspaceShortcut,
        terminalFilePanelShortcut: ui.terminalFilePanelShortcut,
        revealActiveFileShortcut: ui.revealActiveFileShortcut,
        terminalSuggestionsEnabled: ui.terminalSuggestionsEnabled ?? true,
        terminalScrollButtonsEnabled: ui.terminalScrollButtonsEnabled ?? false,
        terminalScrollStep: ui.terminalScrollStep ?? 3,
        explorerShowHidden: ui.explorerShowHidden ?? false,
        mobileCustomKeyboardEnabled: ui.mobileCustomKeyboardEnabled ?? true,
        mobileCustomKeyboardFontSize: ui.mobileCustomKeyboardFontSize ?? 11,
        mobileCustomKeyboardPadding: ui.mobileCustomKeyboardPadding ?? 6,
        mobileCustomKeyboardRowGap: ui.mobileCustomKeyboardRowGap ?? 4,
        hydrated: true,
      });
    } catch {
      // Keep defaults; mark hydrated so app doesn't wait forever
      set({ hydrated: true });
    }
  },

  set: (partial) => {
    const clamped: Partial<SettingsState> = {};
    if (partial.systemFontSize !== undefined)
      clamped.systemFontSize = clampFont(partial.systemFontSize);
    if (partial.editorFontSize !== undefined)
      clamped.editorFontSize = clampFont(partial.editorFontSize);
    if (partial.editorZoomWheelEnabled !== undefined)
      clamped.editorZoomWheelEnabled = partial.editorZoomWheelEnabled;
    if (partial.searchTextShortcut !== undefined)
      clamped.searchTextShortcut = partial.searchTextShortcut;
    if (partial.searchFilenameShortcut !== undefined)
      clamped.searchFilenameShortcut = partial.searchFilenameShortcut;
    if (partial.terminalWorkspaceShortcut !== undefined)
      clamped.terminalWorkspaceShortcut = partial.terminalWorkspaceShortcut;
    if (partial.terminalFilePanelShortcut !== undefined)
      clamped.terminalFilePanelShortcut = partial.terminalFilePanelShortcut;
    if (partial.revealActiveFileShortcut !== undefined)
      clamped.revealActiveFileShortcut = partial.revealActiveFileShortcut;
    if (partial.terminalSuggestionsEnabled !== undefined)
      clamped.terminalSuggestionsEnabled = partial.terminalSuggestionsEnabled;
    if (partial.terminalScrollButtonsEnabled !== undefined)
      clamped.terminalScrollButtonsEnabled = partial.terminalScrollButtonsEnabled;
    if (partial.terminalScrollStep !== undefined)
      clamped.terminalScrollStep = Math.min(50, Math.max(1, partial.terminalScrollStep));
    if (partial.explorerShowHidden !== undefined)
      clamped.explorerShowHidden = partial.explorerShowHidden;
    if (partial.mobileCustomKeyboardEnabled !== undefined)
      clamped.mobileCustomKeyboardEnabled =
        partial.mobileCustomKeyboardEnabled;
    if (partial.mobileCustomKeyboardFontSize !== undefined)
      clamped.mobileCustomKeyboardFontSize = clampKeyboardFont(
        partial.mobileCustomKeyboardFontSize,
      );
    if (partial.mobileCustomKeyboardPadding !== undefined)
      clamped.mobileCustomKeyboardPadding = clampKeyboardPadding(
        partial.mobileCustomKeyboardPadding,
      );
    if (partial.mobileCustomKeyboardRowGap !== undefined)
      clamped.mobileCustomKeyboardRowGap = clampKeyboardRowGap(
        partial.mobileCustomKeyboardRowGap,
      );
    set(clamped);
  },

  saveDebounced: (partial) => {
    get().set(partial);
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const {
        systemFontSize,
        editorFontSize,
        editorZoomWheelEnabled,
        searchTextShortcut,
        searchFilenameShortcut,
        terminalWorkspaceShortcut,
        terminalFilePanelShortcut,
        revealActiveFileShortcut,
        terminalSuggestionsEnabled,
        terminalScrollButtonsEnabled,
        terminalScrollStep,
        explorerShowHidden,
        mobileCustomKeyboardEnabled,
        mobileCustomKeyboardFontSize,
        mobileCustomKeyboardPadding,
        mobileCustomKeyboardRowGap,
      } = get();
      void api.globalConfig.updateUi({
        systemFontSize,
        editorFontSize,
        editorZoomWheelEnabled,
        searchTextShortcut,
        searchFilenameShortcut,
        terminalWorkspaceShortcut,
        terminalFilePanelShortcut,
        revealActiveFileShortcut,
        terminalSuggestionsEnabled,
        terminalScrollButtonsEnabled,
        terminalScrollStep,
        explorerShowHidden,
        mobileCustomKeyboardEnabled,
        mobileCustomKeyboardFontSize,
        mobileCustomKeyboardPadding,
        mobileCustomKeyboardRowGap,
      });
    }, 500);
  },
}));
