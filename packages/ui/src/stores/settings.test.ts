import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getGlobalConfig, updateUi } = vi.hoisted(() => ({
  getGlobalConfig: vi.fn(),
  updateUi: vi.fn(),
}));

vi.mock("@/api/client.js", () => ({
  api: {
    globalConfig: {
      get: getGlobalConfig,
      updateUi,
    },
  },
}));

import { useSettingsStore } from "./settings.js";

function resetSettingsStore() {
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
});
