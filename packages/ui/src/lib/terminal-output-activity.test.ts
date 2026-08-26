import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TERMINAL_OUTPUT_ACTIVITY_WINDOW_MS,
  getTerminalOutputActivitySnapshot,
  registerTerminalOutputActivity,
  subscribeToTerminalOutputActivity,
} from "./terminal-output-activity.js";

describe("terminal output activity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps snapshots and notifications isolated by session ID", () => {
    const first = registerTerminalOutputActivity("activity-a");
    const second = registerTerminalOutputActivity("activity-b");
    first.markOutput();
    expect(getTerminalOutputActivitySnapshot("activity-a")).toEqual({
      recentOutput: false,
      streamReady: false,
    });
    first.setStreamReady(true);
    second.setStreamReady(true);
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const unsubscribeFirst = subscribeToTerminalOutputActivity(
      "activity-a",
      firstListener,
    );
    const unsubscribeSecond = subscribeToTerminalOutputActivity(
      "activity-b",
      secondListener,
    );

    first.markOutput();
    first.markOutput();

    const activeSnapshot = getTerminalOutputActivitySnapshot("activity-a");
    expect(activeSnapshot).toEqual({
      recentOutput: true,
      streamReady: true,
    });
    expect(Object.isFrozen(activeSnapshot)).toBe(true);
    expect(getTerminalOutputActivitySnapshot("activity-a")).toBe(
      activeSnapshot,
    );
    expect(getTerminalOutputActivitySnapshot("activity-b")).toEqual({
      recentOutput: false,
      streamReady: true,
    });
    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).not.toHaveBeenCalled();

    first.dispose();
    second.dispose();
    unsubscribeFirst();
    unsubscribeSecond();
  });

  it("refreshes a burst without repeated recent notifications and expires from the latest chunk", () => {
    const activity = registerTerminalOutputActivity("activity-burst");
    activity.setStreamReady(true);
    const listener = vi.fn();
    const unsubscribe = subscribeToTerminalOutputActivity(
      "activity-burst",
      listener,
    );

    activity.markOutput();
    vi.advanceTimersByTime(1_000);
    activity.markOutput();
    expect(listener).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(1_999);
    expect(
      getTerminalOutputActivitySnapshot("activity-burst").recentOutput,
    ).toBe(true);
    vi.advanceTimersByTime(1);
    expect(
      getTerminalOutputActivitySnapshot("activity-burst").recentOutput,
    ).toBe(true);
    vi.advanceTimersByTime(999);
    expect(listener).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);

    expect(getTerminalOutputActivitySnapshot("activity-burst")).toEqual({
      recentOutput: false,
      streamReady: true,
    });
    expect(listener).toHaveBeenCalledTimes(2);

    activity.dispose();
    unsubscribe();
  });

  it("reschedules a delayed timer from the timestamp instead of callback time", () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(0);
    const activity = registerTerminalOutputActivity("activity-delayed");
    activity.setStreamReady(true);
    const unsubscribe = subscribeToTerminalOutputActivity(
      "activity-delayed",
      vi.fn(),
    );
    activity.markOutput();

    vi.advanceTimersByTime(3_000);
    expect(
      getTerminalOutputActivitySnapshot("activity-delayed").recentOutput,
    ).toBe(true);
    now.mockReturnValue(2_000);
    vi.advanceTimersByTime(3_000);
    expect(
      getTerminalOutputActivitySnapshot("activity-delayed").recentOutput,
    ).toBe(true);
    now.mockReturnValue(3_000);
    vi.advanceTimersByTime(1_000);
    expect(
      getTerminalOutputActivitySnapshot("activity-delayed").recentOutput,
    ).toBe(false);

    activity.dispose();
    unsubscribe();
  });

  it("notifies only for externally visible transitions", () => {
    const activity = registerTerminalOutputActivity("activity-transitions");
    const listener = vi.fn();
    const unsubscribe = subscribeToTerminalOutputActivity(
      "activity-transitions",
      listener,
    );

    activity.markOutput();
    expect(listener).not.toHaveBeenCalled();

    activity.setStreamReady(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(getTerminalOutputActivitySnapshot("activity-transitions")).toEqual({
      recentOutput: false,
      streamReady: true,
    });

    activity.markOutput();
    activity.markOutput();
    expect(listener).toHaveBeenCalledTimes(2);

    activity.setStreamReady(false);
    activity.setStreamReady(false);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(getTerminalOutputActivitySnapshot("activity-transitions")).toEqual({
      recentOutput: false,
      streamReady: false,
    });

    activity.setStreamReady(true);
    expect(listener).toHaveBeenCalledTimes(4);

    activity.dispose();
    unsubscribe();
  });

  it("cancels the expiry timer and removes state after owner cleanup", () => {
    const activity = registerTerminalOutputActivity("activity-cleanup");
    activity.setStreamReady(true);
    activity.markOutput();
    const unsubscribe = subscribeToTerminalOutputActivity(
      "activity-cleanup",
      vi.fn(),
    );

    activity.dispose();
    expect(vi.getTimerCount()).toBe(0);
    unsubscribe();

    expect(getTerminalOutputActivitySnapshot("activity-cleanup")).toEqual({
      recentOutput: false,
      streamReady: false,
    });
    vi.advanceTimersByTime(TERMINAL_OUTPUT_ACTIVITY_WINDOW_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears recent activity and prevents an obsolete owner from clearing a replacement", () => {
    const original = registerTerminalOutputActivity("activity-owner");
    original.setStreamReady(true);
    original.markOutput();
    const replacement = registerTerminalOutputActivity("activity-owner");
    const unsubscribe = subscribeToTerminalOutputActivity(
      "activity-owner",
      vi.fn(),
    );

    original.setStreamReady(true);
    original.markOutput();

    expect(getTerminalOutputActivitySnapshot("activity-owner")).toEqual({
      recentOutput: false,
      streamReady: false,
    });
    original.dispose();
    replacement.setStreamReady(true);
    replacement.markOutput();
    expect(
      getTerminalOutputActivitySnapshot("activity-owner").recentOutput,
    ).toBe(true);

    replacement.dispose();
    unsubscribe();
    expect(getTerminalOutputActivitySnapshot("activity-owner")).toEqual({
      recentOutput: false,
      streamReady: false,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
