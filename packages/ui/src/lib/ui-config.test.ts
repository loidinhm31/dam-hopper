import { describe, expect, it } from "vitest";
import { withUiConfigDefaults } from "./ui-config.js";

describe("withUiConfigDefaults", () => {
  it("hydrates new shortcut defaults when ui config is absent", () => {
    const ui = withUiConfigDefaults();
    expect(ui.searchTextShortcut).toBe("Mod+Shift+KeyF");
    expect(ui.searchFilenameShortcut).toBe("DoubleShift");
    expect(ui.terminalWorkspaceShortcut).toBe("Mod+Shift+Backquote");
    expect(ui.terminalFilePanelShortcut).toBe("Mod+Shift+KeyE");
    expect(ui.projectPanelShortcut).toBe("Mod+Shift+KeyZ");
    expect(ui.revealActiveFileShortcut).toBe("Alt+F1");
    expect(ui.gitPanelShortcut).toBe("Mod+Shift+KeyG");
    expect(ui.portsPanelShortcut).toBe("Mod+Shift+KeyP");
    expect(ui.fleetTerminalShortcut).toBe("Mod+Shift+KeyM");
    expect(ui.terminalFontSize).toBe(13);
    expect(ui.terminalFontSizeIncreaseShortcut).toBe("Ctrl+Alt+Shift+Equal");
    expect(ui.terminalFontSizeDecreaseShortcut).toBe("Ctrl+Alt+Minus");
    expect(ui.terminalCodexNotificationsEnabled).toBe(false);
    expect(ui.terminalAutoSwitchProjectEnabled).toBe(true);
    expect(ui.terminalCodexNotificationToastEnabled).toBe(true);
    expect(ui.terminalCodexBrowserNotificationsEnabled).toBe(true);
    expect(ui.terminalCodexNotificationSoundEnabled).toBe(true);
    expect(ui.terminalCodexNotificationSoundVolume).toBe(100);
    expect(ui.terminalCodexNotificationSoundPattern).toBe("default");
    expect(ui.explorerLanguageFilter).toBe("all");
    expect(ui.mobileCustomKeyboardEnabled).toBe(true);
    expect(ui.mobileCustomKeyboardFontSize).toBe(11);
    expect(ui.mobileCustomKeyboardPadding).toBe(6);
    expect(ui.mobileCustomKeyboardRowGap).toBe(4);
    expect(ui.terminalScrollButtonsEnabled).toBe(false);
    expect(ui.terminalCommitStatusEnabled).toBe(false);
    expect(ui.runtimeGroupOrder).toEqual([]);
    expect(ui.runtimeItemOrder).toEqual({});
    expect(ui.hostResourcePinnedMount).toBeNull();
  });

  it("preserves existing fields while normalizing provided shortcuts", () => {
    const ui = withUiConfigDefaults({
      editorFontSize: 18,
      terminalFontSize: 17,
      terminalOrder: ["one"],
      runtimeGroupOrder: ["web", "__free__"],
      runtimeItemOrder: { web: ["session:one"] },
      searchTextShortcut: "ctrl+shift+p",
      searchFilenameShortcut: "doubleShift",
      terminalWorkspaceShortcut: "ctrl+shift+backquote",
      terminalFilePanelShortcut: "ctrl+shift+e",
      projectPanelShortcut: "ctrl+shift+b",
      revealActiveFileShortcut: "alt+f1",
      gitPanelShortcut: "ctrl+shift+g",
      portsPanelShortcut: "ctrl+shift+p",
      fleetTerminalShortcut: "ctrl+shift+m",
      terminalFontSizeIncreaseShortcut: "ctrl+alt+shift+equal",
      terminalFontSizeDecreaseShortcut: "ctrl+alt+minus",
      terminalCodexNotificationsEnabled: true,
      terminalCodexNotificationToastEnabled: false,
      terminalCodexBrowserNotificationsEnabled: false,
      terminalCodexNotificationSoundEnabled: false,
      terminalCodexNotificationSoundVolume: 45,
      terminalCodexNotificationSoundPattern: "urgent",
      explorerLanguageFilter: "java",
      mobileCustomKeyboardEnabled: false,
      mobileCustomKeyboardFontSize: 14,
      mobileCustomKeyboardPadding: 9,
      mobileCustomKeyboardRowGap: 7,
      hostResourcePinnedMount: "/data",
    });

    expect(ui.editorFontSize).toBe(18);
    expect(ui.terminalFontSize).toBe(17);
    expect(ui.terminalOrder).toEqual(["one"]);
    expect(ui.runtimeGroupOrder).toEqual(["web", "__free__"]);
    expect(ui.runtimeItemOrder).toEqual({ web: ["session:one"] });
    expect(ui.searchTextShortcut).toBe("Ctrl+Shift+KeyP");
    expect(ui.searchFilenameShortcut).toBe("DoubleShift");
    expect(ui.terminalWorkspaceShortcut).toBe("Ctrl+Shift+Backquote");
    expect(ui.terminalFilePanelShortcut).toBe("Ctrl+Shift+KeyE");
    expect(ui.projectPanelShortcut).toBe("Ctrl+Shift+KeyB");
    expect(ui.revealActiveFileShortcut).toBe("Alt+F1");
    expect(ui.gitPanelShortcut).toBe("Ctrl+Shift+KeyG");
    expect(ui.portsPanelShortcut).toBe("Ctrl+Shift+KeyP");
    expect(ui.fleetTerminalShortcut).toBe("Ctrl+Shift+KeyM");
    expect(ui.terminalFontSizeIncreaseShortcut).toBe("Ctrl+Alt+Shift+Equal");
    expect(ui.terminalFontSizeDecreaseShortcut).toBe("Ctrl+Alt+Minus");
    expect(ui.terminalCodexNotificationsEnabled).toBe(true);
    expect(ui.terminalCodexNotificationToastEnabled).toBe(false);
    expect(ui.terminalCodexBrowserNotificationsEnabled).toBe(false);
    expect(ui.terminalCodexNotificationSoundEnabled).toBe(false);
    expect(ui.terminalCodexNotificationSoundVolume).toBe(45);
    expect(ui.terminalCodexNotificationSoundPattern).toBe("urgent");
    expect(ui.explorerLanguageFilter).toBe("java");
    expect(ui.mobileCustomKeyboardEnabled).toBe(false);
    expect(ui.mobileCustomKeyboardFontSize).toBe(14);
    expect(ui.mobileCustomKeyboardPadding).toBe(9);
    expect(ui.mobileCustomKeyboardRowGap).toBe(7);
    expect(ui.hostResourcePinnedMount).toBe("/data");
  });

  it("normalizes an absent or null host resource pin to null", () => {
    expect(withUiConfigDefaults({}).hostResourcePinnedMount).toBeNull();
    expect(
      withUiConfigDefaults({ hostResourcePinnedMount: null })
        .hostResourcePinnedMount,
    ).toBeNull();
  });

  it("falls back to the legacy terminal agent toggle for codex notifications", () => {
    const ui = withUiConfigDefaults({
      terminalAgentNotificationsEnabled: true,
    });

    expect(ui.terminalCodexNotificationsEnabled).toBe(true);
  });

  it("normalizes missing and unknown language filters to all", () => {
    expect(
      withUiConfigDefaults({
        explorerLanguageFilter: "python" as never,
      }).explorerLanguageFilter,
    ).toBe("all");
    expect(withUiConfigDefaults().explorerLanguageFilter).toBe("all");
  });
});
