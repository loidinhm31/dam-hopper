// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsAppearanceSection } from "./SettingsAppearanceSection.js";
import { CognitoModeOverlay } from "./CognitoModeOverlay.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import type { CognitoModeStyle } from "@/api/client.js";

const saveDebounced = vi.fn((patch: Partial<typeof settingsStore>) => {
  Object.assign(settingsStore, patch);
});
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
    version: 2 as const,
    agents: {
      codex: {
        enabled: true,
        toast: true,
        browser: true,
        sound: true,
        style: "subtle" as const,
        volume: 35,
      },
      claude: {
        enabled: true,
        toast: true,
        browser: true,
        sound: true,
        style: "subtle" as const,
        volume: 35,
      },
      omp: {
        enabled: true,
        toast: true,
        browser: true,
        sound: true,
        style: "subtle" as const,
        volume: 35,
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
  cognitoModeShortcut: "Mod+Alt+KeyB",
  cognitoModeStyle: "heavy-blur" as CognitoModeStyle,
  saveDebounced,
  saveAgentNotificationPolicy,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

describe("SettingsAppearanceSection", () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView ??= vi.fn();
    window.HTMLElement.prototype.hasPointerCapture ??= vi.fn();
    window.HTMLElement.prototype.setPointerCapture ??= vi.fn();
    window.HTMLElement.prototype.releasePointerCapture ??= vi.fn();
    mockPolicy.enabled = false;
    settingsStore.systemFontSize = 14;
    settingsStore.editorFontSize = 14;
    settingsStore.terminalFontSize = 13;
    settingsStore.mobileCustomKeyboardEnabled = true;
    settingsStore.terminalAutoSwitchProjectEnabled = true;
    settingsStore.cognitoModeShortcut = "Mod+Alt+KeyB";
    settingsStore.cognitoModeStyle = "heavy-blur";
    saveDebounced.mockClear();
    useCognitoModeStore.getState().reset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    document.body.innerHTML = "";
    useCognitoModeStore.getState().reset();
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
    await act(async () => {
      root?.render(<SettingsAppearanceSection />);
    });

    const toggle = container?.querySelector<HTMLButtonElement>(
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

  it("renders the Cognito Mode style setting row with accessible label and options", async () => {
    await act(async () => {
      root?.render(<SettingsAppearanceSection />);
    });

    const trigger = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Cognito Mode style"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toBe("Heavy Blur");
  });

  it("saves the selected Cognito Mode style via saveDebounced", async () => {
    await act(async () => {
      root?.render(<SettingsAppearanceSection />);
    });

    const trigger = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Cognito Mode style"]',
    );
    expect(trigger).not.toBeNull();

    // Open the Radix UI select dropdown
    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });

    const blackScreenOption = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((el) => el.textContent?.includes("Black Screen"));

    expect(blackScreenOption).toBeDefined();

    await act(async () => {
      blackScreenOption?.click();
    });

    expect(saveDebounced).toHaveBeenCalledWith({
      cognitoModeStyle: "black-screen",
    });
    expect(settingsStore.cognitoModeStyle).toBe("black-screen");
  });

  it("preserves unrelated settings and updates CognitoModeOverlay style", async () => {
    function TestCombined() {
      return (
        <>
          <SettingsAppearanceSection />
          <CognitoModeOverlay />
        </>
      );
    }

    await act(async () => {
      root?.render(<TestCombined />);
    });

    // Activate Cognito mode
    await act(async () => {
      useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    });

    expect(useCognitoModeStore.getState().active).toBe(true);

    let overlay = document.querySelector("[data-cognito-mode-overlay]");
    expect(overlay).not.toBeNull();
    expect(overlay?.classList.contains("cognito-mode-overlay--heavy-blur")).toBe(
      true,
    );

    const trigger = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Cognito Mode style"]',
    );

    // Change to Black Screen
    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });

    const blackScreenOption = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((el) => el.textContent?.includes("Black Screen"));

    await act(async () => {
      blackScreenOption?.click();
    });

    // Re-render to reflect new store state in overlay
    await act(async () => {
      root?.render(<TestCombined />);
    });

    overlay = document.querySelector("[data-cognito-mode-overlay]");
    expect(
      overlay?.classList.contains("cognito-mode-overlay--black-screen"),
    ).toBe(true);

    // Verify unrelated preferences remain untouched
    expect(settingsStore.systemFontSize).toBe(14);
    expect(settingsStore.editorFontSize).toBe(14);
    expect(settingsStore.terminalFontSize).toBe(13);
    expect(settingsStore.cognitoModeShortcut).toBe("Mod+Alt+KeyB");
  });
});
