import { describe, expect, it } from "vitest";
import { withUiConfigDefaults } from "./ui-config.js";

describe("withUiConfigDefaults", () => {
  it("hydrates new shortcut defaults when ui config is absent", () => {
    const ui = withUiConfigDefaults();
    expect(ui.searchTextShortcut).toBe("Mod+Shift+KeyF");
    expect(ui.searchFilenameShortcut).toBe("DoubleShift");
    expect(ui.terminalWorkspaceShortcut).toBe("Mod+Shift+Backquote");
    expect(ui.terminalFilePanelShortcut).toBe("Mod+Shift+KeyE");
    expect(ui.revealActiveFileShortcut).toBe("Alt+F1");
    expect(ui.terminalAgentNotificationsEnabled).toBe(false);
    expect(ui.terminalAgentNotificationPolicy).toBe("always");
    expect(ui.terminalAgentSignalsEnabled).toBe(true);
    expect(ui.terminalAgentQuietTrackingEnabled).toBe(true);
    expect(ui.terminalAgentQuietTimeoutMs).toBe(30000);
    expect(ui.terminalAgentCommandPatterns).toHaveLength(4);
    expect(ui.terminalAgentCommandPatterns?.[0]?.pattern).toBe("codex");
    expect(ui.mobileCustomKeyboardEnabled).toBe(true);
    expect(ui.mobileCustomKeyboardFontSize).toBe(11);
    expect(ui.mobileCustomKeyboardPadding).toBe(6);
    expect(ui.mobileCustomKeyboardRowGap).toBe(4);
    expect(ui.terminalScrollButtonsEnabled).toBe(false);
    expect(ui.runtimeGroupOrder).toEqual([]);
    expect(ui.runtimeItemOrder).toEqual({});
  });

  it("preserves existing fields while normalizing provided shortcuts", () => {
    const ui = withUiConfigDefaults({
      editorFontSize: 18,
      terminalOrder: ["one"],
      runtimeGroupOrder: ["web", "__free__"],
      runtimeItemOrder: { web: ["session:one"] },
      searchTextShortcut: "ctrl+shift+p",
      searchFilenameShortcut: "doubleShift",
      terminalWorkspaceShortcut: "ctrl+shift+backquote",
      terminalFilePanelShortcut: "ctrl+shift+e",
      revealActiveFileShortcut: "alt+f1",
      terminalAgentNotificationsEnabled: true,
      terminalAgentSignalsEnabled: false,
      terminalAgentQuietTrackingEnabled: false,
      terminalAgentQuietTimeoutMs: 45000,
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
      mobileCustomKeyboardEnabled: false,
      mobileCustomKeyboardFontSize: 14,
      mobileCustomKeyboardPadding: 9,
      mobileCustomKeyboardRowGap: 7,
    });

    expect(ui.editorFontSize).toBe(18);
    expect(ui.terminalOrder).toEqual(["one"]);
    expect(ui.runtimeGroupOrder).toEqual(["web", "__free__"]);
    expect(ui.runtimeItemOrder).toEqual({ web: ["session:one"] });
    expect(ui.searchTextShortcut).toBe("Ctrl+Shift+KeyP");
    expect(ui.searchFilenameShortcut).toBe("DoubleShift");
    expect(ui.terminalWorkspaceShortcut).toBe("Ctrl+Shift+Backquote");
    expect(ui.terminalFilePanelShortcut).toBe("Ctrl+Shift+KeyE");
    expect(ui.revealActiveFileShortcut).toBe("Alt+F1");
    expect(ui.terminalAgentNotificationsEnabled).toBe(true);
    expect(ui.terminalAgentSignalsEnabled).toBe(false);
    expect(ui.terminalAgentQuietTrackingEnabled).toBe(false);
    expect(ui.terminalAgentQuietTimeoutMs).toBe(45000);
    expect(ui.terminalAgentCommandPatterns).toEqual([
      {
        id: "codexnsb",
        label: "Codex NSB",
        kind: "regex",
        pattern: "^CODEXNSB$",
        agent: "codex",
        enabled: true,
      },
    ]);
    expect(ui.mobileCustomKeyboardEnabled).toBe(false);
    expect(ui.mobileCustomKeyboardFontSize).toBe(14);
    expect(ui.mobileCustomKeyboardPadding).toBe(9);
    expect(ui.mobileCustomKeyboardRowGap).toBe(7);
  });
});
