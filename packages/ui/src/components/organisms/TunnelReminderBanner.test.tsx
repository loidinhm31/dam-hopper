// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { TunnelReminderBanner } from "./TunnelReminderBanner.js";
import type { DueTunnelReminder } from "@/hooks/use-tunnel-reminders.js";

const mockStopTunnel = vi.fn();
const mockDismissReminder = vi.fn();
let mockReminders: DueTunnelReminder[] = [];

vi.mock("@/hooks/use-tunnel-reminders.js", () => ({
  useTunnelReminders: () => ({
    reminders: mockReminders,
    stopTunnel: mockStopTunnel,
    dismissReminder: mockDismissReminder,
  }),
}));

describe("TunnelReminderBanner", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    useCognitoModeStore.getState().reset();
    mockStopTunnel.mockReset().mockResolvedValue(undefined);
    mockDismissReminder.mockReset();

    mockReminders = [
      {
        tunnelId: "tun-active-1",
        profileId: "profile-main",
        port: 5173,
        url: "https://vite-app.trycloudflare.com",
        label: "vite",
        startedAt: 1000,
        capturedOwner: { profileId: "profile-main", generation: 1 },
      },
    ];

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  async function mountBanner(): Promise<void> {
    await act(async () => {
      root.render(createElement(TunnelReminderBanner));
      await Promise.resolve();
    });
  }


  it("is hidden and inert under Cognito mode (zero URL leakage above mask)", async () => {
    await mountBanner();
    expect(container.querySelector('a[href="https://vite-app.trycloudflare.com"]')).not.toBeNull();

    await act(async () => {
      useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
      await Promise.resolve();
    });

    expect(container.innerHTML).toBe("");
    expect(container.textContent).toBe("");
  });


  it("displays retryable error when stopTunnel fails", async () => {
    mockStopTunnel.mockRejectedValueOnce(new Error("Connection timeout"));
    await mountBanner();

    const stopButton = container.querySelector<HTMLButtonElement>(
      'button:not([aria-label^="Dismiss"])',
    );

    await act(async () => {
      stopButton?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Connection timeout");
    expect(container.textContent).toContain("Retry Stop");

    // Click retry
    mockStopTunnel.mockResolvedValueOnce(undefined);
    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Retry Stop"),
    );
    expect(retryButton).toBeDefined();

    await act(async () => {
      retryButton?.click();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Connection timeout");
    expect(container.querySelectorAll("button:disabled")).toHaveLength(0);
  });

});
