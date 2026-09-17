import { create } from "zustand";
import { persist } from "zustand/middleware";
import { subscribeToProfileChanges } from "@/api/server-config.js";
import { useHostResourceAlertPresentationStore } from "@/hooks/use-host-resource-alert-presentation.js";
export const SETTINGS_TARGET_STORAGE_KEY = "dam-hopper:settings-target:v1";

export type PreferencesStatus = "unset" | "active" | "source-removed";

function readInitialSettingsTarget(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SETTINGS_TARGET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : (parsed?.profileId ?? null);
  } catch {
    return null;
  }
}

function persistSettingsTarget(profileId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (profileId) {
      localStorage.setItem(
        SETTINGS_TARGET_STORAGE_KEY,
        JSON.stringify({ profileId }),
      );
    } else {
      localStorage.removeItem(SETTINGS_TARGET_STORAGE_KEY);
    }
  } catch {}
}

export interface WorkbenchSelectionsState {
  preferencesProfileId: string | null;
  preferencesStatus: PreferencesStatus;
  preferencesSnapshot: Record<string, unknown> | null;
  settingsProfileId: string | null;
  browserTargetProfileId: string | null;

  setPreferencesProfileId: (
    profileId: string | null,
    snapshot?: Record<string, unknown> | object,
  ) => void;
  updatePreferencesSnapshot: (
    snapshot: Record<string, unknown> | object,
  ) => void;
  setSettingsProfileId: (profileId: string | null) => void;
  setBrowserTargetProfileId: (profileId: string | null) => void;
  handleProfileRemoved: (profileId: string) => void;
}

export const useWorkbenchSelectionsStore = create<WorkbenchSelectionsState>()(
  persist(
    (set, get) => ({
      preferencesProfileId: null,
      preferencesStatus: "unset",
      preferencesSnapshot: null,
      settingsProfileId: readInitialSettingsTarget(),
      browserTargetProfileId: null,

      setPreferencesProfileId: (profileId, snapshot) => {
        if (!profileId) {
          set({
            preferencesProfileId: null,
            preferencesStatus: "unset",
            preferencesSnapshot: null,
          });
          return;
        }

        set({
          preferencesProfileId: profileId,
          preferencesStatus: "active",
          preferencesSnapshot:
            (snapshot as Record<string, unknown>) ?? get().preferencesSnapshot,
        });
      },

      updatePreferencesSnapshot: (snapshot) => {
        set({ preferencesSnapshot: snapshot as Record<string, unknown> });
      },

      setSettingsProfileId: (profileId) => {
        persistSettingsTarget(profileId);
        set({ settingsProfileId: profileId });
      },

      setBrowserTargetProfileId: (profileId) => {
        set({ browserTargetProfileId: profileId });
      },

      handleProfileRemoved: (profileId) => {
        const state = get();
        // Removing a new-version preference source retains its cached snapshot
        // with source-removed status until explicit replacement.
        if (state.preferencesProfileId === profileId) {
          set({
            preferencesStatus: "source-removed",
          });
        }
        if (state.settingsProfileId === profileId) {
          persistSettingsTarget(null);
          set({ settingsProfileId: null });
        }
        if (state.browserTargetProfileId === profileId) {
          set({ browserTargetProfileId: null });
        }
      },
    }),
    {
      name: "dam-hopper:preferences-source:v1",
      partialize: (state) => ({
        preferencesProfileId: state.preferencesProfileId,
        preferencesStatus: state.preferencesStatus,
        preferencesSnapshot: state.preferencesSnapshot,
        settingsProfileId: state.settingsProfileId,
        browserTargetProfileId: state.browserTargetProfileId,
      }),
    },
  ),
);

// Subscribe to profile changes so that deletions automatically trigger handleProfileRemoved
if (typeof window !== "undefined") {
  subscribeToProfileChanges((event) => {
    if (event.type === "deleted") {
      useWorkbenchSelectionsStore
        .getState()
        .handleProfileRemoved(event.deletedProfileId);
      useHostResourceAlertPresentationStore
        .getState()
        .reset(event.deletedProfileId);
    }
  });
}
