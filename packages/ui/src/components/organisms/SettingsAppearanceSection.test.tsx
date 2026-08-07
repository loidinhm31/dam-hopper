// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsAppearanceSection } from "./SettingsAppearanceSection.js";

const saveDebounced = vi.fn();
const mockPolicy = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (selector?: (state: typeof settingsStore) => unknown) =>
    selector ? selector(settingsStore) : settingsStore,
}));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

const settingsStore = {
  systemFontSize: 14,
  editorFontSize: 14,
  editorZoomWheelEnabled: true,
  terminalSuggestionsEnabled: true,
  terminalAutoSwitchProjectEnabled: true,
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

let root: Root | null = null;

describe("SettingsAppearanceSection", () => {
  beforeEach(() => {
    mockPolicy.enabled = false;
    settingsStore.mobileCustomKeyboardEnabled = true;
    settingsStore.terminalAutoSwitchProjectEnabled = true;
    saveDebounced.mockClear();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

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
    expect(markup).toContain("Switch project on terminal selection");
    expect(markup).toContain(
      "Selecting a terminal assigned to a project activates that project; free terminals leave the current project unchanged.",
    );
    expect(markup).toContain(
      'aria-label="Enable project switching on terminal selection"',
    );
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain("Play sound");
    expect(markup).not.toContain("Quiet tracking");
    expect(markup).not.toContain("Command patterns");
  });

  it("forces and disables the custom keyboard setting on Android Chrome", () => {
    mockPolicy.enabled = true;
    settingsStore.mobileCustomKeyboardEnabled = false;

    const markup = renderToStaticMarkup(<SettingsAppearanceSection />);

    expect(markup).toContain("Forced on Android Chrome");
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('disabled=""');
    expect(settingsStore.mobileCustomKeyboardEnabled).toBe(false);
  });

  it("renders the enabled terminal auto-switch state", () => {
    settingsStore.terminalAutoSwitchProjectEnabled = true;

    const markup = renderToStaticMarkup(<SettingsAppearanceSection />);

    expect(markup).toContain('aria-checked="true"');
  });

  it("saves the terminal auto-switch toggle value", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<SettingsAppearanceSection />);
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Enable project switching on terminal selection"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      toggle?.click();
    });

    expect(saveDebounced).toHaveBeenCalledTimes(1);
    expect(saveDebounced).toHaveBeenCalledWith({
      terminalAutoSwitchProjectEnabled: false,
    });
  });
});
