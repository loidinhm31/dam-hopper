import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsKeyboardShortcutsSection } from "./SettingsKeyboardShortcutsSection.js";

const saveDebounced = vi.fn();

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (selector?: (state: typeof settingsStore) => unknown) =>
    selector ? selector(settingsStore) : settingsStore,
}));

const settingsStore = {
  searchTextShortcut: "mod+shift+f",
  searchFilenameShortcut: "mod+p",
  terminalWorkspaceShortcut: "mod+`",
  terminalFilePanelShortcut: "mod+shift+e",
  revealActiveFileShortcut: "alt+f1",
  gitPanelShortcut: "ctrl+shift+g",
  portsPanelShortcut: "ctrl+shift+p",
  fleetTerminalShortcut: "ctrl+shift+m",
  saveDebounced,
};

describe("SettingsKeyboardShortcutsSection", () => {
  it("renders the file panel and reveal-active-file shortcut settings", () => {
    const markup = renderToStaticMarkup(<SettingsKeyboardShortcutsSection />);

    expect(markup).toContain("File panel");
    expect(markup).toContain("Open or close the floating file explorer");
    expect(markup).toContain("Reveal active file");
    expect(markup).toContain("Reveal the active editor file in Explorer");
    expect(markup).toContain("Git panel");
    expect(markup).toContain("Ports panel");
    expect(markup).toContain("Fleet Terminal");
  });
});
