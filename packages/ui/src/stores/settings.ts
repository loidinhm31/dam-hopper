/**
 * Settings store — persists UI appearance preferences to server global config.
 *
 * Hydrated once on app boot from /api/global-config.
 * saveDebounced coalesces rapid changes (wheel zoom) into a single write.
 */
import { create } from "zustand";
import { api } from "@/api/client.js";
import { withUiConfigDefaults } from "@/lib/ui-config.js";

const FONT_MIN = 10;
const FONT_MAX = 32;

export function clampFont(size: number): number {
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(size)));
}

interface SettingsState {
  systemFontSize: number;
  editorFontSize: number;
  editorZoomWheelEnabled: boolean;
  searchTextShortcut: string;
  searchFilenameShortcut: string;
  terminalWorkspaceShortcut: string;
  terminalSuggestionsEnabled: boolean;
  explorerShowHidden: boolean;
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
        | "terminalSuggestionsEnabled"
        | "explorerShowHidden"
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
        | "terminalSuggestionsEnabled"
        | "explorerShowHidden"
      >
    >,
  ) => void;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  systemFontSize: 14,
  editorFontSize: 14,
  editorZoomWheelEnabled: true,
  searchTextShortcut: "Mod+Shift+KeyF",
  searchFilenameShortcut: "DoubleShift",
  terminalWorkspaceShortcut: "Mod+Shift+Backquote",
  terminalSuggestionsEnabled: true,
  explorerShowHidden: false,
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
        terminalSuggestionsEnabled: ui.terminalSuggestionsEnabled ?? true,
        explorerShowHidden: ui.explorerShowHidden ?? false,
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
    if (partial.terminalSuggestionsEnabled !== undefined)
      clamped.terminalSuggestionsEnabled = partial.terminalSuggestionsEnabled;
    if (partial.explorerShowHidden !== undefined)
      clamped.explorerShowHidden = partial.explorerShowHidden;
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
        terminalSuggestionsEnabled,
        explorerShowHidden,
      } = get();
      void api.globalConfig.updateUi({
        systemFontSize,
        editorFontSize,
        editorZoomWheelEnabled,
        searchTextShortcut,
        searchFilenameShortcut,
        terminalWorkspaceShortcut,
        terminalSuggestionsEnabled,
        explorerShowHidden,
      });
    }, 500);
  },
}));
