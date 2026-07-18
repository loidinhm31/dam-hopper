// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getBrowserNotificationPermissionState,
  requestBrowserNotificationPermission,
  playTerminalNotificationSound,
  recordClientDiagnostic,
} = vi.hoisted(() => ({
  getBrowserNotificationPermissionState: vi.fn(() => "granted"),
  requestBrowserNotificationPermission: vi.fn(async () => "granted"),
  playTerminalNotificationSound: vi.fn(),
  recordClientDiagnostic: vi.fn(),
}));

vi.mock("@/lib/browser-notification-service.js", () => ({
  getBrowserNotificationPermissionState,
  requestBrowserNotificationPermission,
}));
vi.mock("@/lib/diagnostics-client.js", () => ({ recordClientDiagnostic }));
vi.mock("@/lib/terminal-notification-sound.js", () => ({
  playTerminalNotificationSound,
}));

import {
  TerminalAgentNotificationSettings,
  type TerminalAgentNotificationSettingsPatch,
} from "./TerminalAgentNotificationSettings.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const defaultProps = {
  enabled: true,
  toastEnabled: true,
  browserEnabled: true,
  soundEnabled: true,
  soundPattern: "default" as const,
  soundVolume: 100,
};

async function mount(
  props: Partial<ComponentProps<typeof TerminalAgentNotificationSettings>> = {},
): Promise<ReturnType<typeof vi.fn>> {
  const onSave =
    vi.fn<(partial: TerminalAgentNotificationSettingsPatch) => void>();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <TerminalAgentNotificationSettings
        {...defaultProps}
        {...props}
        onSave={onSave}
      />,
    );
  });
  return onSave;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  getBrowserNotificationPermissionState.mockReset();
  getBrowserNotificationPermissionState.mockReturnValue("granted");
  requestBrowserNotificationPermission.mockReset();
  requestBrowserNotificationPermission.mockResolvedValue("granted");
  playTerminalNotificationSound.mockReset();
  recordClientDiagnostic.mockReset();
});

describe("TerminalAgentNotificationSettings", () => {
  it("announces the runtime browser permission state", async () => {
    await mount();

    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Granted",
    );
    expect(
      document.querySelector('[role="status"]')?.getAttribute("aria-live"),
    ).toBe("polite");
  });

  it("saves independent toast, browser, sound, style, and volume preferences", async () => {
    const onSave = await mount();
    const toast = document.querySelector<HTMLButtonElement>(
      '[aria-label="Enable in-app toast"]',
    );
    const browser = document.querySelector<HTMLButtonElement>(
      '[aria-label="Enable browser popup"]',
    );
    const sound = document.querySelector<HTMLButtonElement>(
      '[aria-label="Enable notification sound"]',
    );
    const style = document.querySelector<HTMLSelectElement>(
      '[aria-label="Sound style"]',
    );
    const volume = document.querySelector<HTMLInputElement>(
      '[aria-label="Notification sound volume"]',
    );

    await act(async () => toast?.click());
    await act(async () => browser?.click());
    await act(async () => sound?.click());
    if (style) {
      style.value = "urgent";
      await act(async () =>
        style.dispatchEvent(new Event("change", { bubbles: true })),
      );
    }
    if (volume) {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(volume, "45");
      await act(async () =>
        volume.dispatchEvent(new Event("input", { bubbles: true })),
      );
    }

    expect(onSave.mock.calls).toEqual([
      [{ terminalCodexNotificationToastEnabled: false }],
      [{ terminalCodexBrowserNotificationsEnabled: false }],
      [{ terminalCodexNotificationSoundEnabled: false }],
      [{ terminalCodexNotificationSoundPattern: "urgent" }],
      [{ terminalCodexNotificationSoundVolume: 45 }],
    ]);
    expect(requestBrowserNotificationPermission).not.toHaveBeenCalled();
  });

  it("previews the current in-app sound without requesting browser permission", async () => {
    await mount({ soundPattern: "two-tone", soundVolume: 45 });
    const playButton = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Play sound");

    await act(async () => playButton?.click());
    expect(playTerminalNotificationSound).toHaveBeenCalledExactlyOnceWith(
      "two-tone",
      45,
    );
    expect(requestBrowserNotificationPermission).not.toHaveBeenCalled();
  });

  it("disables child controls while preserving their rendered values when master is off", async () => {
    await mount({
      enabled: false,
      toastEnabled: false,
      browserEnabled: false,
      soundPattern: "urgent",
      soundVolume: 45,
    });

    expect(
      document.querySelector<HTMLButtonElement>(
        '[aria-label="Enable in-app toast"]',
      )?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>(
        '[aria-label="Enable browser popup"]',
      )?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>(
        '[aria-label="Enable notification sound"]',
      )?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLSelectElement>('[aria-label="Sound style"]')
        ?.value,
    ).toBe("urgent");
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="Notification sound volume"]',
      )?.value,
    ).toBe("45");
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Play sound",
      )?.disabled,
    ).toBe(true);
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Request permission",
      )?.disabled,
    ).toBe(true);
  });
});
