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
  terminalAgentNotificationsEnabled: true,
  terminalAgentSignalsEnabled: true,
  terminalAgentQuietTrackingEnabled: true,
  terminalAgentQuietTimeoutMs: 30000,
  terminalAgentCommandPatterns: [
    {
      id: "codex",
      label: "Codex",
      kind: "literal" as const,
      pattern: "codex",
      agent: "codex" as const,
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
  saveDebounced,
};

describe("SettingsAppearanceSection", () => {
  it("renders the terminal agent notification controls", () => {
    const markup = renderToStaticMarkup(<SettingsAppearanceSection />);

    expect(markup).toContain("Terminal agent notifications");
    expect(markup).toContain("Request permission");
    expect(markup).toContain("Quiet tracking");
    expect(markup).toContain("Command patterns");
  });
});
