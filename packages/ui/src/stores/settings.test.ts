import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getGlobalConfig, updateUi, recordClientDiagnostic } = vi.hoisted(
  () => ({
    getGlobalConfig: vi.fn(),
    updateUi: vi.fn(),
    recordClientDiagnostic: vi.fn(),
  }),
);

vi.mock("@/api/client.js", () => ({
  api: {
    globalConfig: {
      get: getGlobalConfig,
      updateUi,
    },
  },
}));

vi.mock("@/lib/diagnostics-client.js", () => ({
  recordClientDiagnostic,
}));

import { __resetSettingsStoreTestState, useSettingsStore } from "./settings.js";
import { useWorkbenchSelectionsStore } from "./workbench-selections.js";

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function resetSettingsStore() {
  useWorkbenchSelectionsStore
    .getState()
    .setPreferencesProfileId("test-profile");
  useWorkbenchSelectionsStore.getState().updatePreferencesSnapshot(null);
  useSettingsStore.setState({
    systemFontSize: 14,
    editorFontSize: 14,
    terminalFontSize: 13,
    editorZoomWheelEnabled: true,
    searchTextShortcut: "Mod+Shift+KeyF",
    searchFilenameShortcut: "DoubleShift",
    terminalWorkspaceShortcut: "Mod+Shift+Backquote",
    terminalFilePanelShortcut: "Mod+Shift+KeyE",
    projectPanelShortcut: "Mod+Shift+KeyZ",
    revealActiveFileShortcut: "Alt+F1",
    gitPanelShortcut: "Mod+Shift+KeyG",
    portsPanelShortcut: "Mod+Shift+KeyP",
    fleetTerminalShortcut: "Mod+Shift+KeyM",
    terminalFontSizeIncreaseShortcut: "Ctrl+Alt+Shift+Equal",
    terminalFontSizeDecreaseShortcut: "Ctrl+Alt+Minus",
    terminalSuggestionsEnabled: true,
    terminalAutoSwitchProjectEnabled: true,
    terminalAgentNotifications: {
      version: 2,
      agents: {
        codex: {
          enabled: false,
          toast: true,
          browser: true,
          sound: true,
          volume: 100,
          pattern: "default",
        },
        omp: {
          enabled: false,
          toast: true,
          browser: true,
          sound: true,
          volume: 100,
          pattern: "default",
        },
        claude: {
          enabled: false,
          toast: true,
          browser: true,
          sound: true,
          volume: 100,
          pattern: "default",
        },
      },
    },
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
  });
  __resetSettingsStoreTestState();
}

describe("settings store terminal agent notification fields", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getGlobalConfig.mockReset();
    updateUi.mockReset();
    recordClientDiagnostic.mockReset();
    resetSettingsStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetSettingsStore();
  });

  it("hydrates missing notification fields from defaults", async () => {
    getGlobalConfig.mockResolvedValue({
      ui: {
        systemFontSize: 16,
      },
    });

    expect(useSettingsStore.getState().terminalAutoSwitchProjectEnabled).toBe(
      true,
    );

    await useSettingsStore.getState().hydrate();

    const state = useSettingsStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.systemFontSize).toBe(16);
    expect(state.terminalFontSize).toBe(13);
    expect(state.projectPanelShortcut).toBe("Mod+Shift+KeyZ");
    expect(state.terminalFontSizeIncreaseShortcut).toBe("Ctrl+Alt+Shift+Equal");
    expect(state.terminalFontSizeDecreaseShortcut).toBe("Ctrl+Alt+Minus");
    expect(state.terminalAgentNotifications).toEqual({
      version: 2,
      agents: {
        codex: {
          enabled: false,
          toast: true,
          browser: true,
          sound: true,
          volume: 100,
          pattern: "default",
        },
        omp: {
          enabled: false,
          toast: true,
          browser: true,
          sound: true,
          volume: 100,
          pattern: "default",
        },
        claude: {
          enabled: false,
          toast: true,
          browser: true,
          sound: true,
          volume: 100,
          pattern: "default",
        },
      },
    });
    expect(state.terminalCommitStatusEnabled).toBe(false);
    expect(state.terminalAutoSwitchProjectEnabled).toBe(true);
    expect(state.explorerLanguageFilter).toBe("all");
  });

  it("hydrates the terminal auto-switch preference when explicitly enabled", async () => {
    getGlobalConfig.mockResolvedValue({
      ui: {
        terminalAutoSwitchProjectEnabled: true,
      },
    });

    await useSettingsStore.getState().hydrate();

    expect(useSettingsStore.getState().terminalAutoSwitchProjectEnabled).toBe(
      true,
    );
  });

  it("hydrates the terminal auto-switch preference when explicitly disabled", async () => {
    getGlobalConfig.mockResolvedValue({
      ui: {
        terminalAutoSwitchProjectEnabled: false,
      },
    });

    await useSettingsStore.getState().hydrate();

    expect(useSettingsStore.getState().terminalAutoSwitchProjectEnabled).toBe(
      false,
    );
  });

  it("persists a complete canonical object when Codex master is changed", async () => {
    updateUi.mockResolvedValue({ updated: true });

    useSettingsStore
      .getState()
      .saveAgentNotificationPolicy("codex", { enabled: true });
    await vi.advanceTimersByTimeAsync(500);

    expect(updateUi).toHaveBeenCalledWith({
      terminalAgentNotifications: {
        version: 2,
        agents: {
          codex: {
            enabled: true,
            toast: true,
            browser: true,
            sound: true,
            volume: 100,
            pattern: "default",
          },
          omp: {
            enabled: false,
            toast: true,
            browser: true,
            sound: true,
            volume: 100,
            pattern: "default",
          },
          claude: {
            enabled: false,
            toast: true,
            browser: true,
            sound: true,
            volume: 100,
            pattern: "default",
          },
        },
      },
    });
  });

  it("persists the terminal commit-status preference", async () => {
    updateUi.mockResolvedValue({ updated: true });

    useSettingsStore.getState().saveDebounced({
      terminalCommitStatusEnabled: true,
    });

    await vi.advanceTimersByTimeAsync(500);

    expect(updateUi).toHaveBeenCalledWith(
      expect.objectContaining({ terminalCommitStatusEnabled: true }),
    );
  });

  it("hydrates and persists the Project panel shortcut", async () => {
    getGlobalConfig.mockResolvedValue({
      ui: { projectPanelShortcut: "ctrl+shift+keyq" },
    });
    updateUi.mockResolvedValue({ updated: true });

    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().projectPanelShortcut).toBe(
      "Ctrl+Shift+KeyQ",
    );

    useSettingsStore
      .getState()
      .saveDebounced({ projectPanelShortcut: "Mod+Shift+KeyZ" });
    await vi.advanceTimersByTimeAsync(500);

    expect(updateUi).toHaveBeenCalledWith({
      projectPanelShortcut: "Mod+Shift+KeyZ",
    });
  });

  it("hydrates and persists the explorer language filter", async () => {
    getGlobalConfig.mockResolvedValue({
      ui: { explorerLanguageFilter: "javascript-typescript" },
    });
    updateUi.mockResolvedValue({ updated: true });

    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().explorerLanguageFilter).toBe(
      "javascript-typescript",
    );

    useSettingsStore
      .getState()
      .saveDebounced({ explorerLanguageFilter: "java" });
    await vi.advanceTimersByTimeAsync(500);

    expect(updateUi).toHaveBeenCalledWith({
      explorerLanguageFilter: "java",
    });
  });

  it("does not persist an invalid runtime language filter", async () => {
    updateUi.mockResolvedValue({ updated: true });

    useSettingsStore.getState().saveDebounced({
      explorerLanguageFilter: "python" as never,
    });
    await vi.advanceTimersByTimeAsync(500);

    expect(updateUi).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().explorerLanguageFilter).toBe("all");
  });

  it("coalesces Codex and OMP edits without losing either policy and clamps volume", async () => {
    updateUi.mockResolvedValue({ updated: true });
    useSettingsStore
      .getState()
      .saveAgentNotificationPolicy("codex", { sound: false, volume: 140 });
    useSettingsStore.getState().saveAgentNotificationPolicy("omp", {
      enabled: true,
      toast: false,
      pattern: "two-tone",
    });
    await vi.advanceTimersByTimeAsync(500);

    expect(updateUi).toHaveBeenCalledWith({
      terminalAgentNotifications: {
        version: 2,
        agents: {
          codex: {
            enabled: false,
            toast: true,
            browser: true,
            sound: false,
            volume: 100,
            pattern: "default",
          },
          omp: {
            enabled: true,
            toast: false,
            browser: true,
            sound: true,
            volume: 100,
            pattern: "two-tone",
          },
          claude: {
            enabled: false,
            toast: true,
            browser: true,
            sound: true,
            volume: 100,
            pattern: "default",
          },
        },
      },
    });
  });

  it("preserves unsupported notification version on hydrate and refuses to overwrite on save", async () => {
    getGlobalConfig.mockResolvedValue({
      ui: {
        terminalAgentNotifications: {
          version: 3,
          agents: {
            codex: {
              enabled: true,
              toast: false,
              browser: true,
              sound: false,
              volume: 50,
              pattern: "soft",
            },
            omp: {
              enabled: true,
              toast: true,
              browser: false,
              sound: true,
              volume: 80,
              pattern: "urgent",
            },
          },
        },
      },
    });
    updateUi.mockResolvedValue({ updated: true });

    await useSettingsStore.getState().hydrate();
    const state = useSettingsStore.getState();
    expect(state.terminalAgentNotifications.version).toBe(3);
    expect(state.terminalAgentNotifications.agents.codex.enabled).toBe(false);
    expect(state.terminalAgentNotifications.agents.omp.enabled).toBe(false);

    // Attempt to save agent notification policy on unsupported version
    useSettingsStore
      .getState()
      .saveAgentNotificationPolicy("codex", { enabled: false });
    await vi.advanceTimersByTimeAsync(500);
    expect(updateUi).not.toHaveBeenCalled();

    // Attempt to saveDebounced with unsupported version
    useSettingsStore.getState().saveDebounced({
      systemFontSize: 16,
      terminalAgentNotifications: {
        version: 3,
        agents: state.terminalAgentNotifications.agents,
      },
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(updateUi).toHaveBeenCalledWith({
      systemFontSize: 16,
    });
  });

  it("migrates canonical v1 terminalAgentNotifications on hydrate", async () => {
    getGlobalConfig.mockResolvedValue({
      ui: {
        terminalAgentNotifications: {
          version: 1,
          agents: {
            codex: {
              enabled: true,
              toast: false,
              browser: true,
              sound: false,
              volume: 60,
              pattern: "soft",
            },
            omp: {
              enabled: true,
              toast: true,
              browser: false,
              sound: true,
              volume: 90,
              pattern: "urgent",
            },
          },
        },
      },
    });

    await useSettingsStore.getState().hydrate();
    const state = useSettingsStore.getState();
    expect(state.terminalAgentNotifications.version).toBe(2);
    expect(state.terminalAgentNotifications.agents.codex.enabled).toBe(true);
    expect(state.terminalAgentNotifications.agents.codex.volume).toBe(60);
    expect(state.terminalAgentNotifications.agents.omp.enabled).toBe(true);
    expect(state.terminalAgentNotifications.agents.omp.volume).toBe(90);
    expect(state.terminalAgentNotifications.agents.claude.enabled).toBe(false);
  });

  it("marks hydrate complete when global config load fails", async () => {
    getGlobalConfig.mockRejectedValue(new Error("boom"));

    await useSettingsStore.getState().hydrate();

    const state = useSettingsStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.terminalAgentNotifications.agents.codex.enabled).toBe(false);
    expect(state.terminalAutoSwitchProjectEnabled).toBe(true);
  });

  it("persists only the terminal auto-switch preference patch", async () => {
    updateUi.mockResolvedValue({ updated: true });

    useSettingsStore.getState().saveDebounced({
      terminalAutoSwitchProjectEnabled: false,
    });

    await vi.advanceTimersByTimeAsync(500);

    expect(updateUi).toHaveBeenCalledWith({
      terminalAutoSwitchProjectEnabled: false,
    });
  });

  it("clamps and persists terminal font size changes", async () => {
    updateUi.mockResolvedValue({ updated: true });

    useSettingsStore.getState().saveDebounced({ terminalFontSize: 50 });
    expect(useSettingsStore.getState().terminalFontSize).toBe(32);

    await vi.advanceTimersByTimeAsync(500);

    expect(updateUi).toHaveBeenCalledWith({ terminalFontSize: 32 });
  });

  it("hydrates codex notifications from the legacy toggle when needed", async () => {
    getGlobalConfig.mockResolvedValue({
      ui: {
        terminalAgentNotificationsEnabled: true,
      },
    });

    await useSettingsStore.getState().hydrate();

    expect(
      useSettingsStore.getState().terminalAgentNotifications.agents.codex
        .enabled,
    ).toBe(true);
    expect(
      useSettingsStore.getState().terminalAgentNotifications.agents.omp.enabled,
    ).toBe(false);
  });

  it("roundtrips migrated values via canonical server config without reviving legacy fields", async () => {
    getGlobalConfig.mockResolvedValueOnce({
      ui: {
        terminalCodexNotificationsEnabled: true,
        terminalCodexNotificationSoundVolume: 45,
        terminalCodexNotificationSoundPattern: "urgent",
      },
    });
    updateUi.mockResolvedValue({ updated: true });

    await useSettingsStore.getState().hydrate();
    useSettingsStore
      .getState()
      .saveAgentNotificationPolicy("omp", { enabled: true, browser: false });
    await vi.advanceTimersByTimeAsync(500);
    const payload = updateUi.mock.calls[0]?.[0];
    expect(payload).toEqual({
      terminalAgentNotifications: {
        version: 2,
        agents: {
          codex: {
            enabled: true,
            toast: true,
            browser: true,
            sound: true,
            volume: 45,
            pattern: "urgent",
          },
          omp: {
            enabled: true,
            toast: true,
            browser: false,
            sound: true,
            volume: 100,
            pattern: "default",
          },
          claude: {
            enabled: false,
            toast: true,
            browser: true,
            sound: true,
            volume: 100,
            pattern: "default",
          },
        },
      },
    });
    getGlobalConfig.mockResolvedValueOnce({ ui: payload });
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().terminalAgentNotifications).toEqual(
      payload.terminalAgentNotifications,
    );
  });

  it("rolls back optimistic settings when updateUi rejects", async () => {
    updateUi.mockRejectedValue(new Error("invalid regex"));

    useSettingsStore
      .getState()
      .saveAgentNotificationPolicy("codex", { enabled: true });

    expect(
      useSettingsStore.getState().terminalAgentNotifications.agents.codex
        .enabled,
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();

    expect(
      useSettingsStore.getState().terminalAgentNotifications.agents.codex
        .enabled,
    ).toBe(false);
    expect(recordClientDiagnostic).toHaveBeenCalledWith(
      "custom",
      "settings-store",
      "settings update rejected",
      expect.objectContaining({ error: "invalid regex" }),
    );
  });

  it("rolls back to the latest confirmed save when a later queued save rejects", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    let rejectSecond: ((reason?: unknown) => void) | undefined;

    updateUi
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectSecond = reject;
          }),
      );

    useSettingsStore.getState().saveDebounced({ systemFontSize: 15 });
    await vi.advanceTimersByTimeAsync(500);

    useSettingsStore.getState().saveDebounced({ systemFontSize: 16 });
    await vi.advanceTimersByTimeAsync(500);

    resolveFirst?.({ updated: true });
    await flushMicrotasks();

    expect(rejectSecond).toBeTypeOf("function");
    rejectSecond?.(new Error("second failed"));
    await flushMicrotasks();

    expect(useSettingsStore.getState().systemFontSize).toBe(15);
    expect(recordClientDiagnostic).toHaveBeenCalledWith(
      "custom",
      "settings-store",
      "settings update rejected",
      expect.objectContaining({ error: "second failed" }),
    );
  });

  it("keeps newer optimistic edits when an older in-flight save resolves first", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;

    updateUi
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ updated: true });

    useSettingsStore.getState().saveDebounced({ systemFontSize: 15 });
    await vi.advanceTimersByTimeAsync(500);

    useSettingsStore.getState().saveDebounced({ systemFontSize: 16 });
    expect(useSettingsStore.getState().systemFontSize).toBe(16);

    resolveFirst?.({ updated: true });
    await flushMicrotasks();

    expect(useSettingsStore.getState().systemFontSize).toBe(16);

    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();

    expect(updateUi).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ systemFontSize: 16 }),
    );
    expect(useSettingsStore.getState().systemFontSize).toBe(16);
  });

  it("restores a rejected older patch when a newer patch succeeds", async () => {
    let rejectFirst: ((reason?: unknown) => void) | undefined;

    updateUi
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce({ updated: true });

    useSettingsStore.getState().saveDebounced({ systemFontSize: 15 });
    await vi.advanceTimersByTimeAsync(500);

    useSettingsStore.getState().saveDebounced({ editorFontSize: 16 });
    await vi.advanceTimersByTimeAsync(500);

    rejectFirst?.(new Error("first failed"));
    await flushMicrotasks();

    expect(updateUi).toHaveBeenNthCalledWith(2, { editorFontSize: 16 });
    expect(useSettingsStore.getState().systemFontSize).toBe(15);

    await flushMicrotasks();

    expect(useSettingsStore.getState().systemFontSize).toBe(14);
    expect(useSettingsStore.getState().editorFontSize).toBe(16);
  });

  it("leaves source-unset status and disables remote saving when preference source is unset", async () => {
    useWorkbenchSelectionsStore.getState().setPreferencesProfileId(null);
    await useSettingsStore.getState().hydrate();

    expect(getGlobalConfig).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().hydrated).toBe(true);
    expect(useSettingsStore.getState().sourceUnset).toBe(true);

    useSettingsStore.getState().saveDebounced({ systemFontSize: 18 });
    await vi.advanceTimersByTimeAsync(1000);

    expect(updateUi).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().systemFontSize).toBe(18);
    expect(
      useWorkbenchSelectionsStore.getState().preferencesSnapshot
        ?.systemFontSize,
    ).toBe(18);
  });

  it("clears undispatched debounce and prevents routing patches to new source on switchPreferenceSource", async () => {
    useWorkbenchSelectionsStore.getState().setPreferencesProfileId("profile-A");

    useSettingsStore.getState().saveDebounced({ systemFontSize: 20 });

    // Before 500ms debounce fires, switch to profile-B
    getGlobalConfig.mockResolvedValueOnce({
      ui: { systemFontSize: 12 },
    });
    await useSettingsStore.getState().switchPreferenceSource("profile-B");
    await vi.advanceTimersByTimeAsync(1000);
    await flushMicrotasks();

    // updateUi should NOT have been called with systemFontSize: 20
    expect(updateUi).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().systemFontSize).toBe(12);
  });

  it("does not roll back new source if previous source in-flight save rejects", async () => {
    useWorkbenchSelectionsStore.getState().setPreferencesProfileId("profile-A");
    const { promise, reject } = Promise.withResolvers<unknown>();
    updateUi.mockReturnValueOnce(promise);

    useSettingsStore.getState().saveDebounced({ systemFontSize: 18 });
    await vi.advanceTimersByTimeAsync(500);

    // Now save was dispatched for profile-A. Switch to profile-B
    getGlobalConfig.mockResolvedValueOnce({
      ui: { systemFontSize: 14 },
    });
    await useSettingsStore.getState().switchPreferenceSource("profile-B");

    // Reject profile-A's save
    reject(new Error("profile-A server error"));
    await flushMicrotasks();

    // profile-B should remain intact at 14, not rolled back
    expect(useSettingsStore.getState().systemFontSize).toBe(14);
  });

  it("hydrates from offline snapshot when remote source is unavailable", async () => {
    useWorkbenchSelectionsStore.getState().setPreferencesProfileId(null);
    useWorkbenchSelectionsStore.getState().updatePreferencesSnapshot({
      systemFontSize: 22,
      editorFontSize: 18,
    });

    await useSettingsStore.getState().hydrate();

    expect(getGlobalConfig).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().systemFontSize).toBe(22);
    expect(useSettingsStore.getState().editorFontSize).toBe(18);
  });
});
