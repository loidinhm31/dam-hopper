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
    expect(ui.terminalAgentNotifications).toEqual({
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
      terminalAgentNotifications: {
        version: 1,
        agents: {
          codex: {
            enabled: true,
            toast: false,
            browser: false,
            sound: false,
            volume: 45,
            pattern: "urgent",
          },
          omp: {
            enabled: true,
            toast: true,
            browser: false,
            sound: true,
            volume: 60,
            pattern: "soft",
          },
        },
      },
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
    expect(ui.terminalAgentNotifications?.agents.codex).toEqual({
      enabled: true,
      toast: false,
      browser: false,
      sound: false,
      volume: 45,
      pattern: "urgent",
    });
    expect(ui.terminalAgentNotifications?.agents.omp).toEqual({
      enabled: true,
      toast: true,
      browser: false,
      sound: true,
      volume: 60,
      pattern: "soft",
    });
    expect(ui.terminalAgentNotifications?.agents.claude).toEqual({
      enabled: false,
      toast: true,
      browser: true,
      sound: true,
      volume: 100,
      pattern: "default",
    });
    expect(ui.terminalAgentNotifications?.version).toBe(2);
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

  it("migrates legacy Codex fields and alias, then removes them from normalized config", () => {
    const ui = withUiConfigDefaults({
      terminalAgentNotificationsEnabled: true,
      terminalCodexNotificationToastEnabled: false,
      terminalCodexBrowserNotificationsEnabled: false,
      terminalCodexNotificationSoundEnabled: false,
      terminalCodexNotificationSoundVolume: 45,
      terminalCodexNotificationSoundPattern: "urgent",
    } as never);

    expect(ui.terminalAgentNotifications?.agents.codex).toEqual({
      enabled: true,
      toast: false,
      browser: false,
      sound: false,
      volume: 45,
      pattern: "urgent",
    });
    expect(ui.terminalAgentNotifications?.agents.omp.enabled).toBe(false);
    expect(ui.terminalAgentNotifications?.agents.claude.enabled).toBe(false);
    expect(ui.terminalAgentNotifications?.version).toBe(2);
    expect(
      Object.keys(ui).filter(
        (key) =>
          key.startsWith("terminalCodex") ||
          key === "terminalAgentNotificationsEnabled",
      ),
    ).toEqual([]);
  });

  it("prefers a present Codex scalar master over the older toggle", () => {
    const ui = withUiConfigDefaults({
      terminalCodexNotificationsEnabled: false,
      terminalAgentNotificationsEnabled: true,
    } as never);
    expect(ui.terminalAgentNotifications?.agents.codex.enabled).toBe(false);
  });

  it("lets explicit canonical values win over stale legacy fields, including partial policies", () => {
    const ui = withUiConfigDefaults({
      terminalCodexNotificationsEnabled: true,
      terminalCodexNotificationToastEnabled: false,
      terminalAgentNotifications: {
        version: 1,
        agents: {
          codex: { enabled: false, toast: true },
          omp: { enabled: true },
        },
      },
    } as never);
    expect(ui.terminalAgentNotifications?.agents.codex).toEqual({
      enabled: false,
      toast: true,
      browser: true,
      sound: true,
      volume: 100,
      pattern: "default",
    });
    expect(ui.terminalAgentNotifications?.agents.omp).toEqual({
      enabled: true,
      toast: true,
      browser: true,
      sound: true,
      volume: 100,
      pattern: "default",
    });
  });
  it("refuses unsupported canonical preferences without enabling untrusted channels", () => {
    const ui = withUiConfigDefaults({
      systemFontSize: 19,
      terminalCodexNotificationsEnabled: true,
      terminalCodexNotificationSoundVolume: 37,
      terminalAgentNotifications: {
        version: 3,
        agents: {
          codex: { enabled: true, volume: 37 },
          omp: { enabled: true },
        },
      },
    } as never);

    expect(ui.systemFontSize).toBe(19);
    expect(ui.terminalAgentNotifications.version).toBe(3);
    expect(ui.terminalAgentNotifications.agents.codex.enabled).toBe(false);
    expect(ui.terminalAgentNotifications.agents.omp.enabled).toBe(false);
    expect(ui.terminalAgentNotifications.agents.claude.enabled).toBe(false);
    expect("terminalCodexNotificationsEnabled" in ui).toBe(false);
  });

  it("migrates canonical v1 terminalAgentNotifications to v2, preserving policies and adding disabled Claude", () => {
    const ui = withUiConfigDefaults({
      terminalAgentNotifications: {
        version: 1,
        agents: {
          codex: {
            enabled: true,
            toast: false,
            browser: true,
            sound: false,
            volume: 70,
            pattern: "soft",
          },
          omp: {
            enabled: true,
            toast: true,
            browser: false,
            sound: true,
            volume: 85,
            pattern: "two-tone",
          },
        },
      },
    } as never);

    expect(ui.terminalAgentNotifications).toEqual({
      version: 2,
      agents: {
        codex: {
          enabled: true,
          toast: false,
          browser: true,
          sound: false,
          volume: 70,
          pattern: "soft",
        },
        omp: {
          enabled: true,
          toast: true,
          browser: false,
          sound: true,
          volume: 85,
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
    });
  });

  it("bounds malformed partial policies without enabling OMP or reviving legacy values", () => {
    const ui = withUiConfigDefaults({
      terminalCodexNotificationsEnabled: true,
      terminalAgentNotifications: {
        version: 1,
        agents: {
          codex: { volume: 150, pattern: "unrecognized", toast: false },
          omp: { enabled: "true", volume: -8, sound: false },
        },
      },
    } as never);
    expect(ui.terminalAgentNotifications?.agents.codex).toEqual({
      enabled: false,
      toast: false,
      browser: true,
      sound: true,
      volume: 100,
      pattern: "default",
    });
    expect(ui.terminalAgentNotifications?.agents.omp).toEqual({
      enabled: false,
      toast: true,
      browser: true,
      sound: false,
      volume: 0,
      pattern: "default",
    });
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
