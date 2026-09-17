import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  subscribeToProfileChanges,
  getProfiles,
} from "@/api/server-config.js";

export type PreferencesStatus = "unset" | "active" | "source-removed";

interface PreferencesSourceRecord {
  profileId: string | null;
  status: PreferencesStatus;
  snapshot: Record<string, unknown> | null;
}

interface SettingsTargetRecord {
  profileId: string | null;
}

interface BrowserTargetRecord {
  profileId: string | null;
}

export interface WorkbenchSelectionsState {
  preferencesProfileId: string | null;
  preferencesStatus: PreferencesStatus;
  preferencesSnapshot: Record<string, unknown> | null;
  settingsProfileId: string | null;
  browserTargetProfileId: string | null;

  setPreferencesProfileId: (
    profileId: string | null,
    snapshot?: Record<string, unknown>,
  ) => void;
  updatePreferencesSnapshot: (snapshot: Record<string, unknown>) => void;
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
      settingsProfileId: null,
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
          preferencesSnapshot: snapshot ?? get().preferencesSnapshot,
        });
      },

      updatePreferencesSnapshot: (snapshot) => {
        set({ preferencesSnapshot: snapshot });
      },

      setSettingsProfileId: (profileId) => {
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
    }
  });
}
