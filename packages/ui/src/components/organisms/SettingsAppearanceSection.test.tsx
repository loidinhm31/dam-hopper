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

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (selector?: (state: typeof settingsStore) => unknown) =>
    selector ? selector(settingsStore) : settingsStore,
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
  dockPadding: 8,
  dockItemSpacing: 6,
  dockOuterSpacing: 12,
  dockRadius: 18,
  cursorTheme: "system" as "system" | "theme",
  sourceUnset: false,
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
    settingsStore.systemFontSize = 14;
    settingsStore.editorFontSize = 14;
    settingsStore.terminalFontSize = 13;
    settingsStore.mobileCustomKeyboardEnabled = true;
    settingsStore.terminalAutoSwitchProjectEnabled = true;
    settingsStore.cognitoModeShortcut = "Mod+Alt+KeyB";
    settingsStore.cognitoModeStyle = "heavy-blur";
    settingsStore.dockPadding = 8;
    settingsStore.dockItemSpacing = 6;
    settingsStore.dockOuterSpacing = 12;
    settingsStore.dockRadius = 18;
    settingsStore.cursorTheme = "system";
    settingsStore.sourceUnset = false;
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

  it("renders dock layout, cursor theme, explanatory note, and handles stepper changes", async () => {
    await act(async () => {
      root?.render(<SettingsAppearanceSection />);
    });

    const dockPaddingInput = container?.querySelector<HTMLInputElement>(
      'input[aria-label="dock padding in pixels"]',
    );
    expect(dockPaddingInput).not.toBeNull();
    expect(dockPaddingInput?.value).toBe("8");

    const increaseDockPaddingBtn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Increase dock padding"]',
    );
    await act(async () => {
      increaseDockPaddingBtn?.click();
    });

    expect(saveDebounced).toHaveBeenCalledWith({ dockPadding: 9 });

    // Explanatory note
    expect(container?.textContent).toContain(
      "Dock layout and cursor style are workbench preferences saved to the server configuration. Dock app pins are stored locally in this browser.",
    );
  });

  it("resets appearance defaults on reset button click", async () => {
    await act(async () => {
      root?.render(<SettingsAppearanceSection />);
    });

    const resetBtn = Array.from(
      container?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((b) => b.textContent?.includes("Reset appearance defaults"));
    expect(resetBtn).toBeDefined();

    await act(async () => {
      resetBtn?.click();
    });

    expect(saveDebounced).toHaveBeenCalledWith({
      dockPadding: 8,
      dockItemSpacing: 6,
      dockOuterSpacing: 12,
      dockRadius: 18,
      cursorTheme: "system",
    });
  });

  it("displays honest sourceUnset warning banner when no preference source is connected", async () => {
    settingsStore.sourceUnset = true;
    await act(async () => {
      root?.render(<SettingsAppearanceSection />);
    });

    const statusBanner = container?.querySelector('[role="status"]');
    expect(statusBanner).not.toBeNull();
    expect(statusBanner?.textContent).toContain(
      "No preference source connected",
    );
  });
});
