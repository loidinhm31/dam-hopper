// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsApp } from "./SettingsApp.js";
import type { OsWindow } from "../types.js";
import { useWindowStore } from "../window-store.js";
import { createDefaultOsSession } from "../window-ops.js";

vi.mock("@/components/pages/SettingsPage.js", () => ({
  SettingsPage: ({ requestedSection, deliveryId }: { requestedSection?: string; deliveryId?: string }) => (
    <div data-testid="mock-settings-page" data-section={requestedSection} data-delivery={deliveryId}>
      Mock Settings Page
    </div>
  ),
}));

vi.mock("@/components/pages/DevicesPage.js", () => ({
  DevicesPage: ({ noLayout, profileId, onProfileChange }: { noLayout?: boolean; profileId?: string | null; onProfileChange?: (id: string | null) => void }) => (
    <div data-testid="mock-devices-page" data-no-layout={String(noLayout)} data-profile-id={profileId ?? ""}>
      <button onClick={() => onProfileChange?.("chosen")}>Choose profile</button>
    </div>
  ),
}));

describe("SettingsApp", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useWindowStore.getState().setSession(createDefaultOsSession());
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders General Settings by default and allows switching to Devices", () => {
    const window: OsWindow = {
      id: "win-settings-1",
      appId: "settings",
      title: "Settings",
      ctx: { profileId: "default" },
      mode: "float",
      desktopId: "desktop-1",
      maximized: false,
      minimized: false,
    };

    act(() => {
      root.render(<SettingsApp window={window} />);
    });

    expect(container.querySelector('[data-testid="mock-settings-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mock-devices-page"]')).toBeNull();

    // Click Login Devices tab
    const devicesBtn = [...container.querySelectorAll("button")].find((button) => button.textContent === "Login Devices")!;
    act(() => {
      devicesBtn.click();
    });

    expect(container.querySelector('[data-testid="mock-devices-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mock-settings-page"]')).toBeNull();
  });

  it("embeds the explicit target and stores profile changes in window state", () => {
    const window: OsWindow = {
      id: "win-target", appId: "settings", title: "Settings", ctx: { profileId: "ambient" },
      mode: "float", desktopId: "desktop-1", maximized: false, minimized: false,
      appState: { activeTab: "devices", targetProfileId: "selected" },
    };
    const session = createDefaultOsSession();
    session.windows[window.id] = window;
    useWindowStore.getState().setSession(session);
    act(() => root.render(<SettingsApp window={window} />));
    const page = container.querySelector('[data-testid="mock-devices-page"]')!;
    expect(page.getAttribute("data-no-layout")).toBe("true");
    expect(page.getAttribute("data-profile-id")).toBe("selected");
    act(() => page.querySelector<HTMLButtonElement>("button")!.click());
    expect(useWindowStore.getState().session.windows[window.id]?.appState?.targetProfileId).toBe("chosen");
  });

  it("switches to General tab and passes requestedSection when Appearance delivery arrives", () => {
    const window: OsWindow = {
      id: "win-settings-1",
      appId: "settings",
      title: "Settings",
      ctx: { profileId: "default" },
      mode: "float",
      desktopId: "desktop-1",
      maximized: false,
      minimized: false,
      appState: {
        activeTab: "devices",
        settingsSection: "appearance",
        deliveryId: "token-appearance-1",
      },
    };

    act(() => {
      root.render(<SettingsApp window={window} />);
    });

    // Automatically selects General settings tab
    const settingsPage = container.querySelector('[data-testid="mock-settings-page"]');
    expect(settingsPage).not.toBeNull();
    expect(settingsPage?.getAttribute("data-section")).toBe("appearance");
    expect(settingsPage?.getAttribute("data-delivery")).toBe("token-appearance-1");
  });
});
