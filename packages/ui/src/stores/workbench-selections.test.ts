// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from "vitest";
import { useWorkbenchSelectionsStore } from "./workbench-selections.js";

describe("workbench-selections store", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkbenchSelectionsStore.setState({
      preferencesProfileId: null,
      preferencesStatus: "unset",
      preferencesSnapshot: null,
      settingsProfileId: null,
      browserTargetProfileId: null,
    });
  });

  it("starts preferencesProfileId, settingsProfileId, and browserTargetProfileId unset", () => {
    const state = useWorkbenchSelectionsStore.getState();
    expect(state.preferencesProfileId).toBeNull();
    expect(state.preferencesStatus).toBe("unset");
    expect(state.preferencesSnapshot).toBeNull();
    expect(state.settingsProfileId).toBeNull();
    expect(state.browserTargetProfileId).toBeNull();
  });

  it("sets preferences source with active status and snapshot", () => {
    const store = useWorkbenchSelectionsStore.getState();
    store.setPreferencesProfileId("profile-1", { theme: "dark", fontSize: 14 });

    const state = useWorkbenchSelectionsStore.getState();
    expect(state.preferencesProfileId).toBe("profile-1");
    expect(state.preferencesStatus).toBe("active");
    expect(state.preferencesSnapshot).toEqual({ theme: "dark", fontSize: 14 });
  });

  it("retains snapshot with source-removed status when preference source profile is removed", () => {
    const store = useWorkbenchSelectionsStore.getState();
    store.setPreferencesProfileId("profile-target", { theme: "dark" });
    store.setSettingsProfileId("profile-target");
    store.setBrowserTargetProfileId("profile-target");

    store.handleProfileRemoved("profile-target");

    const state = useWorkbenchSelectionsStore.getState();
    // Preferences source retains its cached snapshot with source-removed status until explicit replacement
    expect(state.preferencesProfileId).toBe("profile-target");
    expect(state.preferencesStatus).toBe("source-removed");
    expect(state.preferencesSnapshot).toEqual({ theme: "dark" });

    // Settings and browser targets are cleared
    expect(state.settingsProfileId).toBeNull();
    expect(state.browserTargetProfileId).toBeNull();
  });

  it("clears preferences snapshot when explicitly set to null", () => {
    const store = useWorkbenchSelectionsStore.getState();
    store.setPreferencesProfileId("p1", { font: 12 });
    expect(useWorkbenchSelectionsStore.getState().preferencesStatus).toBe("active");

    store.setPreferencesProfileId(null);
    const state = useWorkbenchSelectionsStore.getState();
    expect(state.preferencesProfileId).toBeNull();
    expect(state.preferencesStatus).toBe("unset");
    expect(state.preferencesSnapshot).toBeNull();
  });
});
