import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalAgentNotificationSettings } from "@/components/molecules/TerminalAgentNotificationSettings.js";
import { TerminalNotificationCenter } from "@/components/organisms/TerminalNotificationCenter.js";
import { TerminalNotificationToastViewport } from "@/components/organisms/TerminalNotificationToastViewport.js";
import { subscribeToTerminalNotificationSelection } from "@/lib/terminal-notification-navigation.js";
import type { TerminalAgentNotification } from "@/lib/terminal-notification-signal-parser.js";
import { useTerminalNotificationsStore } from "@/stores/terminal-notifications.js";
import "@/index.css";

function event(
  receivedAt: number,
  title = "Codex is ready",
): TerminalAgentNotification {
  return {
    source: "osc9",
    sessionId: `terminal-${receivedAt}`,
    project: "web",
    agent: "codex",
    title,
    body: "Review the completed task.",
    status: "needs-attention",
    receivedAt,
  };
}

describe("terminal notification UI in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    useTerminalNotificationsStore.setState({ notifications: [], toasts: [] });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useTerminalNotificationsStore.setState({ notifications: [], toasts: [] });
    vi.useRealTimers();
  });

  async function render(node: React.ReactNode): Promise<void> {
    await act(async () => root.render(node));
  }

  it("shows unread history and selects one notification", async () => {
    const firstId = useTerminalNotificationsStore
      .getState()
      .addNotification(event(1_000));
    useTerminalNotificationsStore
      .getState()
      .addNotification(event(2_000, "Second task"));
    let selectedSessionId: string | undefined;
    const unsubscribe = subscribeToTerminalNotificationSelection(
      (sessionId) => {
        selectedSessionId = sessionId;
      },
    );

    await render(<TerminalNotificationCenter />);
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    expect(trigger?.getAttribute("aria-label")).toContain("2 unread");

    await act(async () => trigger?.click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    const firstItem = [
      ...container.querySelectorAll<HTMLButtonElement>("li button"),
    ].find((button) => button.textContent?.includes("Codex is ready"));
    await act(async () => firstItem?.click());

    expect(selectedSessionId).toBe("terminal-1000");
    expect(
      useTerminalNotificationsStore
        .getState()
        .notifications.find((item) => item.id === firstId)?.read,
    ).toBe(true);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    unsubscribe();
  });

  it("marks all read and restores trigger focus on Escape", async () => {
    useTerminalNotificationsStore.getState().addNotification(event(1_000));
    await render(<TerminalNotificationCenter />);
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );

    await act(async () => trigger?.click());
    const markAll = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Mark all terminal notifications as read"]',
    );
    await act(async () => markAll?.click());
    expect(trigger?.getAttribute("aria-label")).toContain("0 unread");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      vi.runAllTimers();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on outside interaction, preserves target focus, and clears history", async () => {
    useTerminalNotificationsStore.getState().addNotification(event(1_000));
    let outsideClicks = 0;
    await render(
      <>
        <TerminalNotificationCenter />
        <button
          type="button"
          data-testid="outside-target"
          onClick={() => {
            outsideClicks += 1;
          }}
        >
          Outside
        </button>
      </>,
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    const outside = container.querySelector<HTMLButtonElement>(
      '[data-testid="outside-target"]',
    );

    await act(async () => trigger?.click());
    outside?.focus();
    await act(async () => {
      outside?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
      outside?.click();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
    expect(outsideClicks).toBe(1);

    await act(async () => trigger?.click());
    const clear = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear terminal notifications"]',
    );
    await act(async () => clear?.click());
    expect(container.textContent).toContain("No notifications yet");
    expect(useTerminalNotificationsStore.getState().notifications).toEqual([]);
  });

  it("auto-dismisses a toast without marking history read", async () => {
    const id = useTerminalNotificationsStore
      .getState()
      .addNotification(event(1_000));
    await render(<TerminalNotificationToastViewport />);
    expect(container.textContent).toContain("Codex is ready");

    await act(async () => vi.advanceTimersByTime(6_000));
    const state = useTerminalNotificationsStore.getState();
    expect(state.toasts).toEqual([]);
    expect(state.notifications.find((item) => item.id === id)?.read).toBe(
      false,
    );
    expect(container.textContent).not.toContain("Codex is ready");
  });

  it("keeps bell history visible when an event opts out of the transient toast", async () => {
    useTerminalNotificationsStore
      .getState()
      .addNotification(event(1_000), { showToast: false });
    await render(
      <>
        <TerminalNotificationCenter />
        <TerminalNotificationToastViewport />
      </>,
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    expect(trigger?.getAttribute("aria-label")).toContain("1 unread");
    expect(container.querySelector("article")).toBeNull();
    await act(async () => trigger?.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      "Codex is ready",
    );
  });

  it("saves independent in-app and browser delivery choices", async () => {
    const onSave = vi.fn();
    await render(
      <TerminalAgentNotificationSettings
        enabled
        toastEnabled
        browserEnabled
        soundEnabled
        soundPattern="default"
        soundVolume={100}
        onSave={onSave}
      />,
    );
    const toast = container.querySelector<HTMLButtonElement>(
      '[aria-label="Enable in-app toast"]',
    );
    const browser = container.querySelector<HTMLButtonElement>(
      '[aria-label="Enable browser popup"]',
    );

    await act(async () => toast?.click());
    await act(async () => browser?.click());

    expect(onSave).toHaveBeenNthCalledWith(1, {
      terminalCodexNotificationToastEnabled: false,
    });
    expect(onSave).toHaveBeenNthCalledWith(2, {
      terminalCodexBrowserNotificationsEnabled: false,
    });
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("manual toast dismissal also preserves unread state", async () => {
    const id = useTerminalNotificationsStore
      .getState()
      .addNotification(event(1_000));
    await render(<TerminalNotificationToastViewport />);
    const dismiss = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Dismiss Codex is ready"]',
    );

    await act(async () => dismiss?.click());
    const state = useTerminalNotificationsStore.getState();
    expect(state.toasts).toEqual([]);
    expect(state.notifications.find((item) => item.id === id)?.read).toBe(
      false,
    );
  });

  it("keeps a polite live region mounted and selects a toast", async () => {
    let selectedSessionId: string | undefined;
    const unsubscribe = subscribeToTerminalNotificationSelection(
      (sessionId) => {
        selectedSessionId = sessionId;
      },
    );
    await render(<TerminalNotificationToastViewport />);
    const liveRegion = container.querySelector<HTMLElement>(
      '[aria-live="polite"]',
    );
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.textContent).toBe("");

    let id = "";
    await act(async () => {
      id = useTerminalNotificationsStore
        .getState()
        .addNotification(event(1_000));
    });
    const openTerminal = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Codex is ready. Open terminal"]',
    );
    await act(async () => openTerminal?.click());

    const state = useTerminalNotificationsStore.getState();
    expect(selectedSessionId).toBe("terminal-1000");
    expect(state.notifications.find((item) => item.id === id)?.read).toBe(true);
    expect(state.toasts).toEqual([]);
    unsubscribe();
  });

  it("keeps the header notification panel clickable above active toasts", async () => {
    useTerminalNotificationsStore.getState().addNotification(event(1_000));
    await render(
      <>
        <div
          data-testid="header-stacking-context"
          style={{
            display: "flex",
            position: "fixed",
            right: 0,
            top: 0,
            zIndex: 50,
          }}
        >
          <TerminalNotificationCenter />
        </div>
        <TerminalNotificationToastViewport />
      </>,
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    await act(async () => trigger?.click());

    const panel = container.querySelector<HTMLElement>('[role="dialog"]');
    const toast = container.querySelector<HTMLElement>("article");
    expect(panel).not.toBeNull();
    expect(toast).not.toBeNull();
    const initialPanelRect = panel?.getBoundingClientRect();
    if (toast && initialPanelRect) {
      toast.style.position = "fixed";
      toast.style.right = "0px";
      toast.style.top = `${initialPanelRect.top + 4}px`;
      toast.style.width = `${Math.min(300, initialPanelRect.width)}px`;
    }
    const panelRect = panel?.getBoundingClientRect();
    const toastRect = toast?.getBoundingClientRect();
    const overlapLeft = Math.max(panelRect?.left ?? 0, toastRect?.left ?? 0);
    const overlapTop = Math.max(panelRect?.top ?? 0, toastRect?.top ?? 0);
    const overlapRight = Math.min(panelRect?.right ?? 0, toastRect?.right ?? 0);
    const overlapBottom = Math.min(
      panelRect?.bottom ?? 0,
      toastRect?.bottom ?? 0,
    );
    expect(overlapRight).toBeGreaterThan(overlapLeft);
    expect(overlapBottom).toBeGreaterThan(overlapTop);

    const hitTarget = document.elementFromPoint(
      (overlapLeft + overlapRight) / 2,
      (overlapTop + overlapBottom) / 2,
    );
    expect(panel?.contains(hitTarget)).toBe(true);
  });
});
