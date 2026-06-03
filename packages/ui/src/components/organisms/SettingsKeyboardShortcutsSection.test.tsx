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
  saveDebounced,
};

describe("SettingsKeyboardShortcutsSection", () => {
  it("renders the file panel shortcut setting", () => {
    const markup = renderToStaticMarkup(<SettingsKeyboardShortcutsSection />);

    expect(markup).toContain("File panel");
    expect(markup).toContain("Open or close the floating file explorer");
  });
});
