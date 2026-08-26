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
  terminalFontSizeIncreaseShortcut: "ctrl+alt+shift+equal",
  terminalFontSizeDecreaseShortcut: "ctrl+alt+minus",
  terminalFilePanelShortcut: "mod+shift+e",
  revealActiveFileShortcut: "alt+f1",
  gitPanelShortcut: "ctrl+shift+g",
  portsPanelShortcut: "ctrl+shift+p",
  projectPanelShortcut: "mod+shift+b",
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
    expect(markup).toContain("Project panel");
    expect(markup).toContain("Open or close the floating Project panel");
    expect(markup).toContain("Fleet Terminal");
    expect(markup).toContain("Increase terminal font size");
    expect(markup).toContain("Decrease terminal font size");
    expect(markup).toContain("the + key");
    expect(markup).toContain(
      'aria-label="Set shortcut for Increase terminal font size"',
    );
    expect(markup).toContain(
      'aria-label="Reset Decrease terminal font size shortcut to default"',
    );
  });
});
