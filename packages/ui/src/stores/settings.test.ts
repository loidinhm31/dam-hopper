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

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function resetSettingsStore() {
  __resetSettingsStoreTestState();
  useSettingsStore.setState({
    systemFontSize: 14,
    editorFontSize: 14,
    editorZoomWheelEnabled: true,
    searchTextShortcut: "Mod+Shift+KeyF",
    searchFilenameShortcut: "DoubleShift",
    terminalWorkspaceShortcut: "Mod+Shift+Backquote",
    terminalFilePanelShortcut: "Mod+Shift+KeyE",
    revealActiveFileShortcut: "Alt+F1",
    gitPanelShortcut: "Mod+Shift+KeyG",
    portsPanelShortcut: "Mod+Shift+KeyP",
    fleetTerminalShortcut: "Mod+Shift+KeyM",
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
  });
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
    expect(state.terminalCodexNotificationsEnabled).toBe(false);
    expect(state.terminalCodexNotificationToastEnabled).toBe(true);
    expect(state.terminalCodexBrowserNotificationsEnabled).toBe(true);
    expect(state.terminalCodexNotificationSoundEnabled).toBe(true);
    expect(state.terminalCodexNotificationSoundVolume).toBe(100);
    expect(state.terminalCodexNotificationSoundPattern).toBe("default");
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

  it("persists codex notification changes", async () => {
    updateUi.mockResolvedValue({ updated: true });

    useSettingsStore.getState().saveDebounced({
      terminalCodexNotificationsEnabled: true,
    });

    await vi.advanceTimersByTimeAsync(500);

    expect(updateUi).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalCodexNotificationsEnabled: true,
      }),
    );
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

  it("clamps and persists notification sound settings", async () => {
    updateUi.mockResolvedValue({ updated: true });

    useSettingsStore.getState().saveDebounced({
      terminalCodexNotificationSoundEnabled: false,
      terminalCodexNotificationSoundVolume: 140,
    });

    await vi.advanceTimersByTimeAsync(500);

    expect(updateUi).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalCodexNotificationSoundEnabled: false,
        terminalCodexNotificationSoundVolume: 100,
      }),
    );
  });

  it("persists delivery and sound pattern settings", async () => {
    updateUi.mockResolvedValue({ updated: true });

    useSettingsStore.getState().saveDebounced({
      terminalCodexNotificationToastEnabled: false,
      terminalCodexBrowserNotificationsEnabled: false,
      terminalCodexNotificationSoundPattern: "two-tone",
    });

    await vi.advanceTimersByTimeAsync(500);

    expect(updateUi).toHaveBeenCalledWith({
      terminalCodexNotificationToastEnabled: false,
      terminalCodexBrowserNotificationsEnabled: false,
      terminalCodexNotificationSoundPattern: "two-tone",
    });
  });

  it("marks hydrate complete when global config load fails", async () => {
    getGlobalConfig.mockRejectedValue(new Error("boom"));

    await useSettingsStore.getState().hydrate();

    const state = useSettingsStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.terminalCodexNotificationsEnabled).toBe(false);
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

  it("hydrates codex notifications from the legacy toggle when needed", async () => {
    getGlobalConfig.mockResolvedValue({
      ui: {
        terminalAgentNotificationsEnabled: true,
      },
    });

    await useSettingsStore.getState().hydrate();

    expect(useSettingsStore.getState().terminalCodexNotificationsEnabled).toBe(
      true,
    );
  });

  it("rolls back optimistic settings when updateUi rejects", async () => {
    updateUi.mockRejectedValue(new Error("invalid regex"));

    useSettingsStore.getState().saveDebounced({
      terminalCodexNotificationsEnabled: true,
    });

    expect(useSettingsStore.getState().terminalCodexNotificationsEnabled).toBe(
      true,
    );

    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();

    expect(useSettingsStore.getState().terminalCodexNotificationsEnabled).toBe(
      false,
    );
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
});
