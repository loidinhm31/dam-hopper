import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsAppearanceSection } from "./SettingsAppearanceSection.js";

const saveDebounced = vi.fn();

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (selector?: (state: typeof settingsStore) => unknown) =>
    selector ? selector(settingsStore) : settingsStore,
}));

const settingsStore = {
  systemFontSize: 14,
  editorFontSize: 14,
  editorZoomWheelEnabled: true,
  terminalSuggestionsEnabled: true,
  terminalCodexNotificationsEnabled: true,
  terminalScrollButtonsEnabled: false,
  terminalScrollStep: 3,
  explorerShowHidden: false,
  mobileCustomKeyboardEnabled: true,
  mobileCustomKeyboardFontSize: 11,
  mobileCustomKeyboardPadding: 6,
  mobileCustomKeyboardRowGap: 4,
  saveDebounced,
};

describe("SettingsAppearanceSection", () => {
  it("renders the terminal agent notification controls", () => {
    const markup = renderToStaticMarkup(<SettingsAppearanceSection />);

    expect(markup).toContain("Codex terminal notifications");
    expect(markup).toContain("Local command history");
    expect(markup).toContain("Clear local command history");
    expect(markup).toContain("Stored only in this browser");
    expect(markup).toContain("Request permission");
    expect(markup).toContain("Enable Codex notifications");
    expect(markup).not.toContain("Quiet tracking");
    expect(markup).not.toContain("Command patterns");
  });
});
