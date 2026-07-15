import { describe, expect, it, vi } from "vitest";
import {
  activateTerminalAfterNavigation,
  dispatchTerminalNotificationSelection,
  isTerminalNotificationTargetAvailable,
  navigateToTerminalNotification,
  subscribeToTerminalNotificationSelection,
} from "./terminal-notification-navigation.js";

describe("terminal notification navigation", () => {
  it("publishes the stable session ID and unsubscribes cleanly", () => {
    const target = new EventTarget();
    const listener = vi.fn();
    const unsubscribe = subscribeToTerminalNotificationSelection(
      listener,
      target,
    );

    dispatchTerminalNotificationSelection("terminal:web:_:1", target);
    expect(listener).toHaveBeenCalledWith("terminal:web:_:1");

    unsubscribe();
    dispatchTerminalNotificationSelection("terminal:web:_:2", target);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("accepts only mounted terminals confirmed to be live", () => {
    const mounted = ["live", "pending"];

    expect(isTerminalNotificationTargetAvailable("live", mounted, true)).toBe(
      true,
    );
    expect(
      isTerminalNotificationTargetAvailable("pending", mounted, undefined),
    ).toBe(false);
    expect(isTerminalNotificationTargetAvailable("live", mounted, false)).toBe(
      false,
    );
    expect(isTerminalNotificationTargetAvailable("closed", mounted, true)).toBe(
      false,
    );
  });

  it("reveals, selects, and focuses the available terminal", () => {
    const calls: string[] = [];

    expect(
      navigateToTerminalNotification({
        sessionId: "live",
        mountedSessionIds: ["live"],
        alive: true,
        focusWindow: () => calls.push("window"),
        revealTerminal: () => calls.push("reveal"),
        selectSession: (sessionId) => calls.push(`select:${sessionId}`),
        focusTerminal: (sessionId) => calls.push(`focus:${sessionId}`),
      }),
    ).toBe(true);
    expect(calls).toEqual(["window", "reveal", "select:live", "focus:live"]);
  });

  it("does nothing for a stale terminal selection", () => {
    const action = vi.fn();

    expect(
      navigateToTerminalNotification({
        sessionId: "closed",
        mountedSessionIds: ["live"],
        alive: false,
        focusWindow: action,
        revealTerminal: action,
        selectSession: action,
        focusTerminal: action,
      }),
    ).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it("waits for a replacement terminal registry entry after navigation", () => {
    let frame: (() => void) | undefined;
    let registryListener: ((sessionId: string) => void) | undefined;
    const registered = new Set<string>(["live"]);
    const activateTerminal = vi.fn();
    const unsubscribe = vi.fn();

    activateTerminalAfterNavigation({
      sessionId: "live",
      hasTerminal: (sessionId) => registered.has(sessionId),
      activateTerminal,
      subscribeToTerminal: (listener) => {
        registryListener = listener;
        return unsubscribe;
      },
      requestFrame: (callback) => {
        frame = callback;
        return 1;
      },
      setTimer: vi.fn(() => 1),
      clearTimer: vi.fn(),
    });

    frame?.();
    expect(activateTerminal).toHaveBeenCalledWith("live");
    expect(unsubscribe).not.toHaveBeenCalled();

    activateTerminal.mockClear();
    registered.delete("live");
    registered.add("live");
    registryListener?.("live");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(activateTerminal).toHaveBeenCalledWith("live");
  });

  it("cancels deferred activation before the animation frame runs", () => {
    let frame: (() => void) | undefined;
    const cancelFrame = vi.fn();
    const activateTerminal = vi.fn();
    const subscribeToTerminal = vi.fn(() => vi.fn());

    const cancel = activateTerminalAfterNavigation({
      sessionId: "live",
      hasTerminal: () => true,
      activateTerminal,
      subscribeToTerminal,
      requestFrame: (callback) => {
        frame = callback;
        return 7;
      },
      cancelFrame,
    });

    cancel();
    frame?.();
    expect(cancelFrame).toHaveBeenCalledWith(7);
    expect(subscribeToTerminal).not.toHaveBeenCalled();
    expect(activateTerminal).not.toHaveBeenCalled();
  });
});
