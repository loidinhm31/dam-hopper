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
  terminalCodexNotificationToastEnabled: true,
  terminalCodexBrowserNotificationsEnabled: true,
  terminalCodexNotificationSoundEnabled: true,
  terminalCodexNotificationSoundVolume: 100,
  terminalCodexNotificationSoundPattern: "default" as const,
  terminalScrollButtonsEnabled: false,
  terminalCommitStatusEnabled: false,
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
    expect(markup).toContain("In-app toast");
    expect(markup).toContain("bell and notification history");
    expect(markup).toContain("Browser popup");
    expect(markup).toContain(
      "Browser or OS popup sound is controlled by the browser",
    );
    expect(markup).toContain("Notification sound");
    expect(markup).toContain("Sound style");
    expect(markup).toContain("Volume");
    expect(markup).toContain("Play sound");
    expect(markup).toContain("Show latest commit in terminal");
    expect(markup).toContain("Play sound");
    expect(markup).not.toContain("Quiet tracking");
    expect(markup).not.toContain("Command patterns");
  });
});
