import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getGlobalConfig, updateUi, recordClientDiagnostic } = vi.hoisted(() => ({
  getGlobalConfig: vi.fn(),
  updateUi: vi.fn(),
  recordClientDiagnostic: vi.fn(),
}));

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

import {
  __resetSettingsStoreTestState,
  useSettingsStore,
} from "./settings.js";

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
    terminalSuggestionsEnabled: true,
    terminalCodexNotificationsEnabled: false,
    terminalScrollButtonsEnabled: false,
    terminalScrollStep: 3,
    explorerShowHidden: false,
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

    await useSettingsStore.getState().hydrate();

    const state = useSettingsStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.systemFontSize).toBe(16);
    expect(state.terminalCodexNotificationsEnabled).toBe(false);
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

  it("marks hydrate complete when global config load fails", async () => {
    getGlobalConfig.mockRejectedValue(new Error("boom"));

    await useSettingsStore.getState().hydrate();

    const state = useSettingsStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.terminalCodexNotificationsEnabled).toBe(false);
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
});
