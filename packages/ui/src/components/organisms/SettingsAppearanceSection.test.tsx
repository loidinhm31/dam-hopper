// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsAppearanceSection } from "./SettingsAppearanceSection.js";

const saveDebounced = vi.fn();
const saveAgentNotificationPolicy = vi.fn();
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
  terminalFontSize: 13,
  editorZoomWheelEnabled: true,
  terminalSuggestionsEnabled: true,
  terminalAutoSwitchProjectEnabled: true,
  terminalAgentNotifications: {
    version: 1 as const,
    agents: {
      codex: {
        enabled: true,
        toast: true,
        browser: true,
        sound: true,
        volume: 100,
        pattern: "default" as const,
      },
      omp: {
        enabled: false,
        toast: true,
        browser: true,
        sound: true,
        volume: 100,
        pattern: "default" as const,
      },
    },
  },
  terminalScrollButtonsEnabled: false,
  terminalCommitStatusEnabled: false,
  terminalScrollStep: 3,
  explorerShowHidden: false,
  mobileCustomKeyboardEnabled: true,
  mobileCustomKeyboardFontSize: 11,
  mobileCustomKeyboardPadding: 6,
  mobileCustomKeyboardRowGap: 4,
  saveDebounced,
  saveAgentNotificationPolicy,
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
