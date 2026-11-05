import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimContextMenu,
  releaseContextMenu,
  isContextMenuOpen,
  getContextMenuSnapshot,
  subscribeContextMenu,
  dismissContextMenu,
} from "./context-menu-coordinator.js";

describe("context-menu-coordinator", () => {
  beforeEach(() => {
    dismissContextMenu();
  });

  it("updates snapshot and notifies subscribers on claim and release", () => {
    const subscriber = vi.fn();
    const unsubscribe = subscribeContextMenu(subscriber);

    expect(isContextMenuOpen()).toBe(false);
    expect(getContextMenuSnapshot()).toBe(false);

    const close1 = vi.fn();
    claimContextMenu(close1);

    expect(isContextMenuOpen()).toBe(true);
    expect(getContextMenuSnapshot()).toBe(true);
    expect(subscriber).toHaveBeenCalledWith(true);

    releaseContextMenu(close1);
    expect(isContextMenuOpen()).toBe(false);
    expect(getContextMenuSnapshot()).toBe(false);
    expect(subscriber).toHaveBeenCalledWith(false);

    unsubscribe();
  });

  it("handles replacement by closing previous and keeping snapshot true", () => {
    const close1 = vi.fn();
    const close2 = vi.fn();

    claimContextMenu(close1);
    expect(isContextMenuOpen()).toBe(true);

    claimContextMenu(close2);
    expect(close1).toHaveBeenCalledTimes(1);
    expect(close2).not.toHaveBeenCalled();
    expect(isContextMenuOpen()).toBe(true);

    // Stale release from close1 should not release close2
    releaseContextMenu(close1);
    expect(isContextMenuOpen()).toBe(true);

    releaseContextMenu(close2);
    expect(isContextMenuOpen()).toBe(false);
  });

  it("dismisses active menu synchronously via dismissContextMenu", () => {
    const close = vi.fn();
    claimContextMenu(close);
    expect(isContextMenuOpen()).toBe(true);

    dismissContextMenu();
    expect(close).toHaveBeenCalledTimes(1);
    expect(isContextMenuOpen()).toBe(false);
  });
});
