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

import { TerminalAgentNotificationSettings } from "./TerminalAgentNotificationSettings.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const defaultProps = {
  notifications: {
    version: 2 as const,
    agents: {
      codex: {
        enabled: true,
        toast: true,
        browser: true,
        sound: true,
        pattern: "default" as const,
        volume: 100,
      },
      omp: {
        enabled: false,
        toast: true,
        browser: true,
        sound: true,
        pattern: "default" as const,
        volume: 100,
      },
      claude: {
        enabled: false,
        toast: true,
        browser: true,
        sound: true,
        pattern: "default" as const,
        volume: 100,
      },
    },
  },
};

async function mount(
  props: Partial<ComponentProps<typeof TerminalAgentNotificationSettings>> = {},
): Promise<ReturnType<typeof vi.fn>> {
  const onSave = vi.fn();
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
      ["codex", { toast: false }],
      ["codex", { browser: false }],
      ["codex", { sound: false }],
      ["codex", { pattern: "urgent" }],
      ["codex", { volume: 45 }],
    ]);
    expect(requestBrowserNotificationPermission).not.toHaveBeenCalled();
  });

  it("previews the current in-app sound without requesting browser permission", async () => {
    await mount({
      notifications: {
        ...defaultProps.notifications,
        agents: {
          ...defaultProps.notifications.agents,
          codex: {
            ...defaultProps.notifications.agents.codex,
            pattern: "two-tone",
            volume: 45,
          },
        },
      },
    });
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
      notifications: {
        ...defaultProps.notifications,
        agents: {
          ...defaultProps.notifications.agents,
          codex: {
            ...defaultProps.notifications.agents.codex,
            enabled: false,
            toast: false,
            browser: false,
            pattern: "urgent",
            volume: 45,
          },
        },
      },
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
  it("keeps OMP disabled by default and saves OMP controls without changing Codex", async () => {
    const onSave = await mount();
    const ompToast = document.querySelector<HTMLButtonElement>(
      '[aria-label="OMP Enable in-app toast"]',
    );
    expect(ompToast?.disabled).toBe(true);
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[aria-label="Enable OMP notifications"]',
        )
        ?.click(),
    );
    expect(onSave).toHaveBeenCalledWith("omp", { enabled: true });

    await act(async () => {
      root?.render(
        <TerminalAgentNotificationSettings
          notifications={{
            ...defaultProps.notifications,
            agents: {
              ...defaultProps.notifications.agents,
              omp: { ...defaultProps.notifications.agents.omp, enabled: true },
            },
          }}
          onSave={onSave}
        />,
      );
    });
    await act(async () => ompToast?.click());
    expect(onSave).toHaveBeenCalledWith("omp", { toast: false });
    expect(
      document
        .querySelector<HTMLButtonElement>('[aria-label="Enable in-app toast"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("renders an unsupported version notice and disables editing when version !== 2", async () => {
    const onSave = await mount({
      notifications: {
        version: 3,
        agents: defaultProps.notifications.agents,
      },
    });
    expect(container?.textContent).toContain(
      "Unsupported notification preferences version (3)",
    );
    expect(
      container?.querySelector('[aria-label="Enable Codex notifications"]'),
    ).toBeNull();
    expect(
      container?.querySelector('[aria-label="Enable OMP notifications"]'),
    ).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });
});
