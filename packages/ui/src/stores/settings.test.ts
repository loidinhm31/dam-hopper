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
    terminalAgentNotificationsEnabled: false,
    terminalAgentNotificationPolicy: "always",
    terminalAgentSignalsEnabled: true,
    terminalAgentQuietTrackingEnabled: true,
    terminalAgentQuietTimeoutMs: 30000,
    terminalAgentCommandPatterns: [
      {
        id: "codex",
        label: "Codex",
        kind: "literal",
        pattern: "codex",
        agent: "codex",
        enabled: true,
      },
      {
        id: "claude",
        label: "Claude",
        kind: "literal",
        pattern: "claude",
        agent: "claude",
        enabled: true,
      },
      {
        id: "claude-code",
        label: "Claude Code",
        kind: "literal",
        pattern: "claude-code",
        agent: "claude",
        enabled: true,
      },
      {
        id: "antigravity",
        label: "Antigravity",
        kind: "literal",
        pattern: "antigravity",
        agent: "antigravity",
        enabled: true,
      },
    ],
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
    expect(state.terminalAgentNotificationsEnabled).toBe(false);
    expect(state.terminalAgentNotificationPolicy).toBe("always");
    expect(state.terminalAgentQuietTimeoutMs).toBe(30000);
    expect(state.terminalAgentCommandPatterns).toHaveLength(4);
  });

  it("clamps quiet timeout and persists new notification fields", async () => {
    updateUi.mockResolvedValue({ updated: true });

    useSettingsStore.getState().saveDebounced({
      terminalAgentNotificationsEnabled: true,
      terminalAgentQuietTimeoutMs: 1,
      terminalAgentCommandPatterns: [
        {
          id: "codexnsb",
          label: "Codex NSB",
          kind: "regex",
          pattern: "^CODEXNSB$",
          agent: "codex",
          enabled: true,
        },
      ],
    });

    await vi.advanceTimersByTimeAsync(500);

    const state = useSettingsStore.getState();
    expect(state.terminalAgentQuietTimeoutMs).toBe(5000);
    expect(updateUi).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalAgentNotificationsEnabled: true,
        terminalAgentQuietTimeoutMs: 5000,
        terminalAgentCommandPatterns: [
          {
            id: "codexnsb",
            label: "Codex NSB",
            kind: "regex",
            pattern: "^CODEXNSB$",
            agent: "codex",
            enabled: true,
          },
        ],
      }),
    );
  });

  it("marks hydrate complete when global config load fails", async () => {
    getGlobalConfig.mockRejectedValue(new Error("boom"));

    await useSettingsStore.getState().hydrate();

    const state = useSettingsStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.terminalAgentNotificationsEnabled).toBe(false);
    expect(state.terminalAgentQuietTimeoutMs).toBe(30000);
  });

  it("rolls back optimistic settings when updateUi rejects", async () => {
    updateUi.mockRejectedValue(new Error("invalid regex"));

    useSettingsStore.getState().saveDebounced({
      terminalAgentCommandPatterns: [
        {
          id: "codex",
          label: "Codex",
          kind: "regex",
          pattern: "(?<bad>oops)",
          agent: "codex",
          enabled: true,
        },
      ],
    });

    expect(useSettingsStore.getState().terminalAgentCommandPatterns).toEqual([
      {
        id: "codex",
        label: "Codex",
        kind: "regex",
        pattern: "(?<bad>oops)",
        agent: "codex",
        enabled: true,
      },
    ]);

    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();

    expect(useSettingsStore.getState().terminalAgentCommandPatterns).toHaveLength(
      4,
    );
    expect(recordClientDiagnostic).toHaveBeenCalledWith(
      "custom",
      "settings-store",
      "settings update rejected",
      expect.objectContaining({ error: "invalid regex" }),
    );
    expect(useSettingsStore.getState().terminalAgentCommandPatterns[0]).toEqual({
      id: "codex",
      label: "Codex",
      kind: "literal",
      pattern: "codex",
      agent: "codex",
      enabled: true,
    });
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
