/**
 * Settings store — persists UI appearance preferences to server global config.
 *
 * Hydrated once on app boot from /api/global-config.
 * saveDebounced coalesces rapid changes (wheel zoom) into a single write.
 */
import { create } from "zustand";
import { api, type ApiClient } from "@/api/client.js";
import type { TerminalCodexNotificationSoundPattern } from "@/api/client.js";
import type { ExplorerLanguageFilter } from "@/api/fs-types.js";
import type { ConnectionRef, ProfileId } from "@/api/ownership.js";
import {
  getConnectionSnapshot,
  captureConnection,
  getApi,
} from "@/api/connections.js";
import { useWorkbenchSelectionsStore } from "./workbench-selections.js";
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
  sourceUnset: boolean;

  hydrate: (options?: { owner?: ConnectionRef; profileId?: ProfileId }) => Promise<void>;
  set: (partial: Partial<PersistedSettingsState>) => void;
  saveDebounced: (partial: Partial<PersistedSettingsState>) => void;
  switchPreferenceSource: (profileId: ProfileId | null) => Promise<void>;
}

interface PreferenceSourceTransaction {
  profileId: ProfileId;
  generation: number;
  editId: number;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedSettings: PersistedSettingsState | null = null;
let pendingPersistedPatch: Partial<PersistedSettingsState> = {};
let latestLocalEditId = 0;
let activeTransaction: PreferenceSourceTransaction | null = null;
let saveChain: Promise<void> = Promise.resolve();

export function getBoundPreferenceClient(): {
  owner: ConnectionRef;
  api: Pick<ApiClient["globalConfig"], "get" | "updateUi">;
} | null {
  const profileId = useWorkbenchSelectionsStore.getState().preferencesProfileId;
  if (!profileId) return null;
  const snap = getConnectionSnapshot(profileId);
  if (snap) {
    if (snap.status !== "connected") return null;
    try {
      const owner = captureConnection(profileId);
      return {
        owner,
        api: getApi(owner).globalConfig,
      };
    } catch {
      return null;
    }
  }
  // In unit test environment without connection registry
  return {
    owner: { profileId, generation: 1 },
    api: api.globalConfig,
  };
}

function applySnapshotToStore(
  snapshot: Record<string, unknown> | Partial<PersistedSettingsState>,
  set: (partial: Partial<SettingsState>) => void,
): void {
  const clamped: Partial<SettingsState> = {};
  if (typeof snapshot.systemFontSize === "number")
    clamped.systemFontSize = clampFont(snapshot.systemFontSize);
  if (typeof snapshot.editorFontSize === "number")
    clamped.editorFontSize = clampFont(snapshot.editorFontSize);
  if (typeof snapshot.terminalFontSize === "number")
    clamped.terminalFontSize = clampFont(snapshot.terminalFontSize);
  if (typeof snapshot.editorZoomWheelEnabled === "boolean")
    clamped.editorZoomWheelEnabled = snapshot.editorZoomWheelEnabled;
  if (typeof snapshot.searchTextShortcut === "string")
    clamped.searchTextShortcut = snapshot.searchTextShortcut;
  if (typeof snapshot.searchFilenameShortcut === "string")
    clamped.searchFilenameShortcut = snapshot.searchFilenameShortcut;
  if (typeof snapshot.terminalWorkspaceShortcut === "string")
    clamped.terminalWorkspaceShortcut = snapshot.terminalWorkspaceShortcut;
  if (typeof snapshot.terminalFilePanelShortcut === "string")
    clamped.terminalFilePanelShortcut = snapshot.terminalFilePanelShortcut;
  if (typeof snapshot.projectPanelShortcut === "string")
    clamped.projectPanelShortcut = snapshot.projectPanelShortcut;
  if (typeof snapshot.revealActiveFileShortcut === "string")
    clamped.revealActiveFileShortcut = snapshot.revealActiveFileShortcut;
  if (typeof snapshot.gitPanelShortcut === "string")
    clamped.gitPanelShortcut = snapshot.gitPanelShortcut;
  if (typeof snapshot.portsPanelShortcut === "string")
    clamped.portsPanelShortcut = snapshot.portsPanelShortcut;
  if (typeof snapshot.fleetTerminalShortcut === "string")
    clamped.fleetTerminalShortcut = snapshot.fleetTerminalShortcut;
  if (typeof snapshot.terminalFontSizeIncreaseShortcut === "string")
    clamped.terminalFontSizeIncreaseShortcut =
      snapshot.terminalFontSizeIncreaseShortcut;
  if (typeof snapshot.terminalFontSizeDecreaseShortcut === "string")
    clamped.terminalFontSizeDecreaseShortcut =
      snapshot.terminalFontSizeDecreaseShortcut;
  if (typeof snapshot.terminalSuggestionsEnabled === "boolean")
    clamped.terminalSuggestionsEnabled = snapshot.terminalSuggestionsEnabled;
  if (typeof snapshot.terminalAutoSwitchProjectEnabled === "boolean")
    clamped.terminalAutoSwitchProjectEnabled =
      snapshot.terminalAutoSwitchProjectEnabled;
  if (typeof snapshot.terminalCodexNotificationsEnabled === "boolean")
    clamped.terminalCodexNotificationsEnabled =
      snapshot.terminalCodexNotificationsEnabled;
  if (typeof snapshot.terminalCodexNotificationToastEnabled === "boolean")
    clamped.terminalCodexNotificationToastEnabled =
      snapshot.terminalCodexNotificationToastEnabled;
  if (typeof snapshot.terminalCodexBrowserNotificationsEnabled === "boolean")
    clamped.terminalCodexBrowserNotificationsEnabled =
      snapshot.terminalCodexBrowserNotificationsEnabled;
  if (typeof snapshot.terminalCodexNotificationSoundEnabled === "boolean")
    clamped.terminalCodexNotificationSoundEnabled =
      snapshot.terminalCodexNotificationSoundEnabled;
  if (typeof snapshot.terminalCodexNotificationSoundVolume === "number")
    clamped.terminalCodexNotificationSoundVolume =
      clampTerminalNotificationSoundVolume(
        snapshot.terminalCodexNotificationSoundVolume,
      );
  if (
    snapshot.terminalCodexNotificationSoundPattern === "default" ||
    snapshot.terminalCodexNotificationSoundPattern === "soft" ||
    snapshot.terminalCodexNotificationSoundPattern === "two-tone" ||
    snapshot.terminalCodexNotificationSoundPattern === "urgent"
  )
    clamped.terminalCodexNotificationSoundPattern =
      snapshot.terminalCodexNotificationSoundPattern;
  if (typeof snapshot.terminalScrollButtonsEnabled === "boolean")
    clamped.terminalScrollButtonsEnabled = snapshot.terminalScrollButtonsEnabled;
  if (typeof snapshot.terminalCommitStatusEnabled === "boolean")
    clamped.terminalCommitStatusEnabled = snapshot.terminalCommitStatusEnabled;
  if (typeof snapshot.terminalScrollStep === "number")
    clamped.terminalScrollStep = Math.min(
      50,
      Math.max(1, snapshot.terminalScrollStep),
    );
  if (typeof snapshot.explorerShowHidden === "boolean")
    clamped.explorerShowHidden = snapshot.explorerShowHidden;
  if (
    typeof snapshot.explorerLanguageFilter === "string" &&
    isExplorerLanguageFilter(snapshot.explorerLanguageFilter)
  )
    clamped.explorerLanguageFilter = snapshot.explorerLanguageFilter;
  if (typeof snapshot.mobileCustomKeyboardEnabled === "boolean")
    clamped.mobileCustomKeyboardEnabled = snapshot.mobileCustomKeyboardEnabled;
  if (typeof snapshot.mobileCustomKeyboardFontSize === "number")
    clamped.mobileCustomKeyboardFontSize = clampKeyboardFont(
      snapshot.mobileCustomKeyboardFontSize,
    );
  if (typeof snapshot.mobileCustomKeyboardPadding === "number")
    clamped.mobileCustomKeyboardPadding = clampKeyboardPadding(
      snapshot.mobileCustomKeyboardPadding,
    );
  if (typeof snapshot.mobileCustomKeyboardRowGap === "number")
    clamped.mobileCustomKeyboardRowGap = clampKeyboardRowGap(
      snapshot.mobileCustomKeyboardRowGap,
    );
  set(clamped);
}
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
  sourceUnset: true,

  hydrate: async (options?: { owner?: ConnectionRef; profileId?: ProfileId }) => {
    const targetProfileId =
      options?.profileId ??
      options?.owner?.profileId ??
      useWorkbenchSelectionsStore.getState().preferencesProfileId;

    if (!targetProfileId) {
      const offline = useWorkbenchSelectionsStore.getState().preferencesSnapshot;
      if (offline) {
        applySnapshotToStore(offline, set);
      }
      set({ hydrated: true, sourceUnset: true });
      lastSavedSettings = pickPersistedSettings(get());
      return;
    }

    let boundClient: Pick<ApiClient["globalConfig"], "get"> | null = null;
    let capturedOwner: ConnectionRef | null = options?.owner ?? null;

    const snap = getConnectionSnapshot(targetProfileId);
    if (snap) {
      if (snap.status === "connected") {
        try {
          capturedOwner = capturedOwner ?? captureConnection(targetProfileId);
          boundClient = getApi(capturedOwner).globalConfig;
        } catch {
          boundClient = null;
        }
      }
    } else {
      boundClient = api.globalConfig;
      capturedOwner = capturedOwner ?? { profileId: targetProfileId, generation: 1 };
    }

    if (!boundClient) {
      const offline = useWorkbenchSelectionsStore.getState().preferencesSnapshot;
      if (offline) {
        applySnapshotToStore(offline, set);
      }
      set({ hydrated: true, sourceUnset: false });
      lastSavedSettings = pickPersistedSettings(get());
      return;
    }

    try {
      const config = await boundClient.get();
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
        sourceUnset: false,
      });
      lastSavedSettings = pickPersistedSettings(get());
      useWorkbenchSelectionsStore
        .getState()
        .updatePreferencesSnapshot(lastSavedSettings);
    } catch {
      const offline = useWorkbenchSelectionsStore.getState().preferencesSnapshot;
      if (offline) {
        applySnapshotToStore(offline, set);
      }
      set({ hydrated: true, sourceUnset: false });
      lastSavedSettings = pickPersistedSettings(get());
    }
  },

  switchPreferenceSource: async (profileId: ProfileId | null) => {
    clearTimeout(debounceTimer!);
    debounceTimer = null;
    pendingPersistedPatch = {};
    latestLocalEditId++;
    activeTransaction = null;
    useWorkbenchSelectionsStore.getState().setPreferencesProfileId(profileId);
    await get().hydrate({ profileId: profileId ?? undefined });
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
    get().set(partial);
    const persistedPatch = pickPersistedSettingsPatch(partial, get());
    if (Object.keys(persistedPatch).length === 0) return;

    useWorkbenchSelectionsStore
      .getState()
      .updatePreferencesSnapshot(pickPersistedSettings(get()));

    const bound = getBoundPreferenceClient();
    if (!bound) {
      clearTimeout(debounceTimer!);
      debounceTimer = null;
      pendingPersistedPatch = {};
      return;
    }

    const editId = ++latestLocalEditId;
    activeTransaction = {
      profileId: bound.owner.profileId,
      generation: bound.owner.generation,
      editId,
    };
    const currentTx = activeTransaction;
    const boundApi = bound.api;

    pendingPersistedPatch = {
      ...pendingPersistedPatch,
      ...persistedPatch,
    };

    clearTimeout(debounceTimer!);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const payload = pendingPersistedPatch;
      pendingPersistedPatch = {};

      saveChain = saveChain
        .catch(() => {})
        .then(async () => {
          try {
            await boundApi.updateUi(payload);
            const currentPrefProfileId =
              useWorkbenchSelectionsStore.getState().preferencesProfileId;
            if (currentPrefProfileId === currentTx.profileId) {
              lastSavedSettings = {
                ...(lastSavedSettings ?? pickPersistedSettings(get())),
                ...payload,
              };
              if (currentTx.editId === latestLocalEditId) {
                set(lastSavedSettings);
                useWorkbenchSelectionsStore
                  .getState()
                  .updatePreferencesSnapshot(lastSavedSettings);
              }
            }
          } catch (error) {
            const currentPrefProfileId =
              useWorkbenchSelectionsStore.getState().preferencesProfileId;
            if (
              currentPrefProfileId === currentTx.profileId &&
              currentTx.editId === latestLocalEditId &&
              lastSavedSettings
            ) {
              set(lastSavedSettings);
              useWorkbenchSelectionsStore
                .getState()
                .updatePreferencesSnapshot(lastSavedSettings);
            }
            recordClientDiagnostic(
              "custom",
              "settings-store",
              "settings update rejected",
              {
                error: error instanceof Error ? error.message : String(error),
                profileId: currentTx.profileId,
                generation: currentTx.generation,
              },
            );
          }
        });
    }, 500);
  },
}));

lastSavedSettings = pickPersistedSettings(useSettingsStore.getState());

export function __resetSettingsStoreTestState(): void {
  clearTimeout(debounceTimer!);
  debounceTimer = null;
  latestLocalEditId = 0;
  activeTransaction = null;
  pendingPersistedPatch = {};
  saveChain = Promise.resolve();
  lastSavedSettings = pickPersistedSettings(useSettingsStore.getState());
}
