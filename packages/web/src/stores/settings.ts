/**
 * Settings store — persists UI appearance preferences to server global config.
 *
 * Hydrated once on app boot from /api/global-config.
 * saveDebounced coalesces rapid changes (wheel zoom) into a single write.
 */
import { create } from "zustand";
import { api } from "@/api/client.js";

const FONT_MIN = 10;
const FONT_MAX = 32;

export function clampFont(size: number): number {
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(size)));
}

interface SettingsState {
  systemFontSize: number;
  editorFontSize: number;
  editorZoomWheelEnabled: boolean;
  terminalSuggestionsEnabled: boolean;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  set: (partial: Partial<Pick<SettingsState, "systemFontSize" | "editorFontSize" | "editorZoomWheelEnabled" | "terminalSuggestionsEnabled">>) => void;
  saveDebounced: (partial: Partial<Pick<SettingsState, "systemFontSize" | "editorFontSize" | "editorZoomWheelEnabled" | "terminalSuggestionsEnabled">>) => void;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  systemFontSize: 14,
  editorFontSize: 14,
  editorZoomWheelEnabled: true,
  terminalSuggestionsEnabled: true,
  hydrated: false,

  hydrate: async () => {
    try {
      const config = await api.globalConfig.get();
      const ui = config.ui;
      set({
        systemFontSize: ui?.systemFontSize ?? 14,
        editorFontSize: ui?.editorFontSize ?? 14,
        editorZoomWheelEnabled: ui?.editorZoomWheelEnabled ?? true,
        terminalSuggestionsEnabled: ui?.terminalSuggestionsEnabled ?? true,
        hydrated: true,
      });
    } catch {
      // Keep defaults; mark hydrated so app doesn't wait forever
      set({ hydrated: true });
    }
  },

  set: (partial) => {
    const clamped: Partial<SettingsState> = {};
    if (partial.systemFontSize !== undefined) clamped.systemFontSize = clampFont(partial.systemFontSize);
    if (partial.editorFontSize !== undefined) clamped.editorFontSize = clampFont(partial.editorFontSize);
    if (partial.editorZoomWheelEnabled !== undefined) clamped.editorZoomWheelEnabled = partial.editorZoomWheelEnabled;
    if (partial.terminalSuggestionsEnabled !== undefined) clamped.terminalSuggestionsEnabled = partial.terminalSuggestionsEnabled;
    set(clamped);
  },

  saveDebounced: (partial) => {
    get().set(partial);
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const { systemFontSize, editorFontSize, editorZoomWheelEnabled, terminalSuggestionsEnabled } = get();
      void api.globalConfig.updateUi({ systemFontSize, editorFontSize, editorZoomWheelEnabled, terminalSuggestionsEnabled });
    }, 500);
  },
}));
