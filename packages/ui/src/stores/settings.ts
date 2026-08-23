/**
 * Settings store — persists UI appearance preferences to server global config.
 *
 * Hydrated once on app boot from /api/global-config.
 * saveDebounced coalesces rapid changes (wheel zoom) into a single write.
 */
import { create } from "zustand";
import { api } from "@/api/client.js";
import type { TerminalCodexNotificationSoundPattern } from "@/api/client.js";
import type { ExplorerLanguageFilter } from "@/api/fs-types.js";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";
import {
  isExplorerLanguageFilter,
  withUiConfigDefaults,
} from "@/lib/ui-config.js";
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
} from "@/lib/shortcuts.js";

const FONT_MIN = 10;
const FONT_MAX = 32;
const KEYBOARD_FONT_MIN = 9;
const KEYBOARD_FONT_MAX = 18;
const KEYBOARD_PADDING_MIN = 2;
const KEYBOARD_PADDING_MAX = 14;
const KEYBOARD_ROW_GAP_MIN = 2;
const KEYBOARD_ROW_GAP_MAX = 12;
const TERMINAL_NOTIFICATION_SOUND_VOLUME_MIN = 0;
const TERMINAL_NOTIFICATION_SOUND_VOLUME_MAX = 100;

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

export function clampTerminalNotificationSoundVolume(volume: number): number {
  return Math.min(
    TERMINAL_NOTIFICATION_SOUND_VOLUME_MAX,
    Math.max(TERMINAL_NOTIFICATION_SOUND_VOLUME_MIN, Math.round(volume)),
  );
}

interface PersistedSettingsState {
  systemFontSize: number;
  editorFontSize: number;
  terminalFontSize: number;
  editorZoomWheelEnabled: boolean;
  searchTextShortcut: string;
  searchFilenameShortcut: string;
  terminalWorkspaceShortcut: string;
  terminalFilePanelShortcut: string;
  projectPanelShortcut: string;
  revealActiveFileShortcut: string;
  gitPanelShortcut: string;
  portsPanelShortcut: string;
  fleetTerminalShortcut: string;
  terminalFontSizeIncreaseShortcut: string;
  terminalFontSizeDecreaseShortcut: string;
  terminalSuggestionsEnabled: boolean;
  terminalAutoSwitchProjectEnabled: boolean;
  terminalCodexNotificationsEnabled: boolean;
  terminalCodexNotificationToastEnabled: boolean;
  terminalCodexBrowserNotificationsEnabled: boolean;
  terminalCodexNotificationSoundEnabled: boolean;
  terminalCodexNotificationSoundVolume: number;
  terminalCodexNotificationSoundPattern: TerminalCodexNotificationSoundPattern;
  terminalScrollButtonsEnabled: boolean;
  terminalCommitStatusEnabled: boolean;
  terminalScrollStep: number;
  explorerShowHidden: boolean;
  explorerLanguageFilter: ExplorerLanguageFilter;
  mobileCustomKeyboardEnabled: boolean;
  mobileCustomKeyboardFontSize: number;
  mobileCustomKeyboardPadding: number;
  mobileCustomKeyboardRowGap: number;
}

interface SettingsState extends PersistedSettingsState {
  hydrated: boolean;

  hydrate: () => Promise<void>;
  set: (partial: Partial<PersistedSettingsState>) => void;
  saveDebounced: (partial: Partial<PersistedSettingsState>) => void;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedSettings: PersistedSettingsState | null = null;
let pendingPersistedPatch: Partial<PersistedSettingsState> = {};
let latestLocalEditId = 0;
let saveChain: Promise<void> = Promise.resolve();

function pickPersistedSettings(
  state: PersistedSettingsState | SettingsState,
): PersistedSettingsState {
  return {
    systemFontSize: state.systemFontSize,
    editorFontSize: state.editorFontSize,
    terminalFontSize: state.terminalFontSize,
    editorZoomWheelEnabled: state.editorZoomWheelEnabled,
    searchTextShortcut: state.searchTextShortcut,
    searchFilenameShortcut: state.searchFilenameShortcut,
    terminalWorkspaceShortcut: state.terminalWorkspaceShortcut,
    terminalFilePanelShortcut: state.terminalFilePanelShortcut,
    projectPanelShortcut: state.projectPanelShortcut,
    revealActiveFileShortcut: state.revealActiveFileShortcut,
    gitPanelShortcut: state.gitPanelShortcut,
    portsPanelShortcut: state.portsPanelShortcut,
    fleetTerminalShortcut: state.fleetTerminalShortcut,
    terminalFontSizeIncreaseShortcut: state.terminalFontSizeIncreaseShortcut,
    terminalFontSizeDecreaseShortcut: state.terminalFontSizeDecreaseShortcut,
    terminalSuggestionsEnabled: state.terminalSuggestionsEnabled,
    terminalAutoSwitchProjectEnabled: state.terminalAutoSwitchProjectEnabled,
    terminalCodexNotificationsEnabled: state.terminalCodexNotificationsEnabled,
    terminalCodexNotificationToastEnabled:
      state.terminalCodexNotificationToastEnabled,
    terminalCodexBrowserNotificationsEnabled:
      state.terminalCodexBrowserNotificationsEnabled,
    terminalCodexNotificationSoundEnabled:
      state.terminalCodexNotificationSoundEnabled,
    terminalCodexNotificationSoundVolume:
      state.terminalCodexNotificationSoundVolume,
    terminalCodexNotificationSoundPattern:
      state.terminalCodexNotificationSoundPattern,
    terminalScrollButtonsEnabled: state.terminalScrollButtonsEnabled,
    terminalCommitStatusEnabled: state.terminalCommitStatusEnabled,
    terminalScrollStep: state.terminalScrollStep,
    explorerShowHidden: state.explorerShowHidden,
    explorerLanguageFilter: state.explorerLanguageFilter,
    mobileCustomKeyboardEnabled: state.mobileCustomKeyboardEnabled,
    mobileCustomKeyboardFontSize: state.mobileCustomKeyboardFontSize,
    mobileCustomKeyboardPadding: state.mobileCustomKeyboardPadding,
    mobileCustomKeyboardRowGap: state.mobileCustomKeyboardRowGap,
  };
}

function pickPersistedSettingsPatch(
  partial: Partial<PersistedSettingsState>,
  state: PersistedSettingsState | SettingsState,
): Partial<PersistedSettingsState> {
  const persisted = pickPersistedSettings(state);
  const keys = Object.keys(partial).filter(
    (key) =>
      key !== "explorerLanguageFilter" ||
      isExplorerLanguageFilter(partial.explorerLanguageFilter),
  );
  return Object.fromEntries(
    keys.map((key) => [key, persisted[key as keyof PersistedSettingsState]]),
  ) as Partial<PersistedSettingsState>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  systemFontSize: 14,
  editorFontSize: 14,
  terminalFontSize: 13,
  editorZoomWheelEnabled: true,
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
  hydrated: false,

  hydrate: async () => {
    try {
      const config = await api.globalConfig.get();
      const ui = withUiConfigDefaults(config.ui);
      set({
        systemFontSize: ui.systemFontSize,
        editorFontSize: ui.editorFontSize,
        terminalFontSize: clampFont(ui.terminalFontSize ?? 13),
        editorZoomWheelEnabled: ui.editorZoomWheelEnabled,
        searchTextShortcut: ui.searchTextShortcut,
        searchFilenameShortcut: ui.searchFilenameShortcut,
        terminalWorkspaceShortcut: ui.terminalWorkspaceShortcut,
        terminalFilePanelShortcut: ui.terminalFilePanelShortcut,
        projectPanelShortcut: ui.projectPanelShortcut,
        revealActiveFileShortcut: ui.revealActiveFileShortcut,
        gitPanelShortcut: ui.gitPanelShortcut,
        portsPanelShortcut: ui.portsPanelShortcut,
        fleetTerminalShortcut: ui.fleetTerminalShortcut,
        terminalFontSizeIncreaseShortcut:
          ui.terminalFontSizeIncreaseShortcut ??
          DEFAULT_TERMINAL_FONT_SIZE_INCREASE_SHORTCUT,
        terminalFontSizeDecreaseShortcut:
          ui.terminalFontSizeDecreaseShortcut ??
          DEFAULT_TERMINAL_FONT_SIZE_DECREASE_SHORTCUT,
        terminalSuggestionsEnabled: ui.terminalSuggestionsEnabled ?? true,
        terminalAutoSwitchProjectEnabled:
          ui.terminalAutoSwitchProjectEnabled ?? true,
        terminalCodexNotificationsEnabled:
          ui.terminalCodexNotificationsEnabled ??
          (ui as { terminalAgentNotificationsEnabled?: boolean } | undefined)
            ?.terminalAgentNotificationsEnabled ??
          false,
        terminalCodexNotificationToastEnabled:
          ui.terminalCodexNotificationToastEnabled ?? true,
        terminalCodexBrowserNotificationsEnabled:
          ui.terminalCodexBrowserNotificationsEnabled ?? true,
        terminalCodexNotificationSoundEnabled:
          ui.terminalCodexNotificationSoundEnabled ?? true,
        terminalCodexNotificationSoundVolume:
          clampTerminalNotificationSoundVolume(
            ui.terminalCodexNotificationSoundVolume ?? 100,
          ),
        terminalCodexNotificationSoundPattern:
          ui.terminalCodexNotificationSoundPattern ?? "default",
        terminalScrollButtonsEnabled: ui.terminalScrollButtonsEnabled ?? false,
        terminalCommitStatusEnabled: ui.terminalCommitStatusEnabled ?? false,
        terminalScrollStep: ui.terminalScrollStep ?? 3,
        explorerShowHidden: ui.explorerShowHidden ?? false,
        explorerLanguageFilter: ui.explorerLanguageFilter ?? "all",
        mobileCustomKeyboardEnabled: ui.mobileCustomKeyboardEnabled ?? true,
        mobileCustomKeyboardFontSize: ui.mobileCustomKeyboardFontSize ?? 11,
        mobileCustomKeyboardPadding: ui.mobileCustomKeyboardPadding ?? 6,
        mobileCustomKeyboardRowGap: ui.mobileCustomKeyboardRowGap ?? 4,
        hydrated: true,
      });
      lastSavedSettings = pickPersistedSettings(get());
    } catch {
      // Keep defaults; mark hydrated so app doesn't wait forever
      set({ hydrated: true });
      lastSavedSettings = pickPersistedSettings(get());
    }
  },

  set: (partial) => {
    const clamped: Partial<SettingsState> = {};
    if (partial.systemFontSize !== undefined)
      clamped.systemFontSize = clampFont(partial.systemFontSize);
    if (partial.editorFontSize !== undefined)
      clamped.editorFontSize = clampFont(partial.editorFontSize);
    if (partial.terminalFontSize !== undefined)
      clamped.terminalFontSize = clampFont(partial.terminalFontSize);
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
    if (partial.projectPanelShortcut !== undefined)
      clamped.projectPanelShortcut = partial.projectPanelShortcut;
    if (partial.revealActiveFileShortcut !== undefined)
      clamped.revealActiveFileShortcut = partial.revealActiveFileShortcut;
    if (partial.gitPanelShortcut !== undefined)
      clamped.gitPanelShortcut = partial.gitPanelShortcut;
    if (partial.portsPanelShortcut !== undefined)
      clamped.portsPanelShortcut = partial.portsPanelShortcut;
    if (partial.fleetTerminalShortcut !== undefined)
      clamped.fleetTerminalShortcut = partial.fleetTerminalShortcut;
    if (partial.terminalFontSizeIncreaseShortcut !== undefined)
      clamped.terminalFontSizeIncreaseShortcut =
        partial.terminalFontSizeIncreaseShortcut;
    if (partial.terminalFontSizeDecreaseShortcut !== undefined)
      clamped.terminalFontSizeDecreaseShortcut =
        partial.terminalFontSizeDecreaseShortcut;
    if (partial.terminalSuggestionsEnabled !== undefined)
      clamped.terminalSuggestionsEnabled = partial.terminalSuggestionsEnabled;
    if (partial.terminalAutoSwitchProjectEnabled !== undefined)
      clamped.terminalAutoSwitchProjectEnabled =
        partial.terminalAutoSwitchProjectEnabled;
    if (partial.terminalCodexNotificationsEnabled !== undefined)
      clamped.terminalCodexNotificationsEnabled =
        partial.terminalCodexNotificationsEnabled;
    if (partial.terminalCodexNotificationToastEnabled !== undefined)
      clamped.terminalCodexNotificationToastEnabled =
        partial.terminalCodexNotificationToastEnabled;
    if (partial.terminalCodexBrowserNotificationsEnabled !== undefined)
      clamped.terminalCodexBrowserNotificationsEnabled =
        partial.terminalCodexBrowserNotificationsEnabled;
    if (partial.terminalCodexNotificationSoundEnabled !== undefined)
      clamped.terminalCodexNotificationSoundEnabled =
        partial.terminalCodexNotificationSoundEnabled;
    if (partial.terminalCodexNotificationSoundVolume !== undefined)
      clamped.terminalCodexNotificationSoundVolume =
        clampTerminalNotificationSoundVolume(
          partial.terminalCodexNotificationSoundVolume,
        );
    if (partial.terminalCodexNotificationSoundPattern !== undefined)
      clamped.terminalCodexNotificationSoundPattern =
        partial.terminalCodexNotificationSoundPattern;
    if (partial.terminalScrollButtonsEnabled !== undefined)
      clamped.terminalScrollButtonsEnabled =
        partial.terminalScrollButtonsEnabled;
    if (partial.terminalCommitStatusEnabled !== undefined)
      clamped.terminalCommitStatusEnabled = partial.terminalCommitStatusEnabled;
    if (partial.terminalScrollStep !== undefined)
      clamped.terminalScrollStep = Math.min(
        50,
        Math.max(1, partial.terminalScrollStep),
      );
    if (partial.explorerShowHidden !== undefined)
      clamped.explorerShowHidden = partial.explorerShowHidden;
    if (
      partial.explorerLanguageFilter !== undefined &&
      isExplorerLanguageFilter(partial.explorerLanguageFilter)
    )
      clamped.explorerLanguageFilter = partial.explorerLanguageFilter;
    if (partial.mobileCustomKeyboardEnabled !== undefined)
      clamped.mobileCustomKeyboardEnabled = partial.mobileCustomKeyboardEnabled;
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
    const localEditId = ++latestLocalEditId;
    get().set(partial);
    const persistedPatch = pickPersistedSettingsPatch(partial, get());
    if (Object.keys(persistedPatch).length === 0) return;
    pendingPersistedPatch = {
      ...pendingPersistedPatch,
      ...persistedPatch,
    };
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const payload = pendingPersistedPatch;
      pendingPersistedPatch = {};
      saveChain = saveChain
        .catch(() => {})
        .then(async () => {
          try {
            await api.globalConfig.updateUi(payload);
            lastSavedSettings = {
              ...(lastSavedSettings ?? pickPersistedSettings(get())),
              ...payload,
            };
            if (localEditId === latestLocalEditId) {
              set(lastSavedSettings);
            }
          } catch (error) {
            if (localEditId === latestLocalEditId && lastSavedSettings) {
              set(lastSavedSettings);
            }
            recordClientDiagnostic(
              "custom",
              "settings-store",
              "settings update rejected",
              {
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        });
    }, 500);
  },
}));

lastSavedSettings = pickPersistedSettings(useSettingsStore.getState());

export function __resetSettingsStoreTestState(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  latestLocalEditId = 0;
  pendingPersistedPatch = {};
  saveChain = Promise.resolve();
  lastSavedSettings = pickPersistedSettings(useSettingsStore.getState());
}
