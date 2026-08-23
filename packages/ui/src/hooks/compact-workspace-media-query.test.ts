import { describe, expect, it, vi } from "vitest";
import {
  COMPACT_WORKSPACE_QUERY,
  getCompactWorkspaceEffectiveWidth,
  readCompactWorkspaceMatch,
  subscribeToCompactWorkspace,
} from "./compact-workspace-media-query.js";

describe("compact workspace media query helpers", () => {
  it("reads the current match state from the configured media query", () => {
    const matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    expect(readCompactWorkspaceMatch({ matchMedia })).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(COMPACT_WORKSPACE_QUERY);
  });

  it("uses app zoom to calculate the logical responsive width", () => {
    const target = {
      innerWidth: 700,
      matchMedia: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    };

    expect(getCompactWorkspaceEffectiveWidth(target, 100)).toBe(700);
    expect(getCompactWorkspaceEffectiveWidth(target, 50)).toBe(1400);
    expect(readCompactWorkspaceMatch(target, 100)).toBe(true);
    expect(readCompactWorkspaceMatch(target, 50)).toBe(false);
  });

  it("switches at the logical breakpoint boundary", () => {
    const target = {
      innerWidth: 639,
      matchMedia: vi.fn(() => ({ matches: true })),
    };

    expect(readCompactWorkspaceMatch(target, 50)).toBe(true);

    target.innerWidth = 640;
    expect(readCompactWorkspaceMatch(target, 50)).toBe(true);

    target.innerWidth = 641;
    expect(readCompactWorkspaceMatch(target, 50)).toBe(false);
  });

  it("keeps a narrow phone compact at the minimum zoom", () => {
    const target = {
      innerWidth: 390,
      matchMedia: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    };

    expect(readCompactWorkspaceMatch(target, 50)).toBe(true);
  });

  it("subscribes with modern media query listeners and cleans up", () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mediaQuery = {
      matches: false,
      addEventListener: vi.fn(
        (_type: "change", listener: (event: MediaQueryListEvent) => void) => {
          listeners.add(listener);
        },
      ),
      removeEventListener: vi.fn(
        (_type: "change", listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener);
        },
      ),
    };
    const updates: boolean[] = [];

    const cleanup = subscribeToCompactWorkspace(
      (matches) => updates.push(matches),
      { matchMedia: vi.fn(() => mediaQuery) },
    );

    expect(updates).toEqual([false]);
    expect(mediaQuery.addEventListener).toHaveBeenCalledOnce();

    for (const listener of listeners) {
      listener({ matches: true } as MediaQueryListEvent);
    }
    expect(updates).toEqual([false, true]);

    cleanup();
    expect(mediaQuery.removeEventListener).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it("recomputes the logical match when the viewport resizes", () => {
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const resizeListeners = new Set<EventListener>();
    const target = {
      innerWidth: 700,
      matchMedia: vi.fn(() => mediaQuery),
      addEventListener: vi.fn(
        (_type: "resize", listener: EventListener) => {
          resizeListeners.add(listener);
        },
      ),
      removeEventListener: vi.fn(
        (_type: "resize", listener: EventListener) => {
          resizeListeners.delete(listener);
        },
      ),
    };
    const updates: boolean[] = [];

    const cleanup = subscribeToCompactWorkspace(
      (matches) => updates.push(matches),
      target,
      50,
    );

    expect(updates).toEqual([false]);
    expect(target.addEventListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
    );

    target.innerWidth = 639;
    for (const listener of resizeListeners) listener(new Event("resize"));
    expect(updates).toEqual([false, true]);

    cleanup();
    expect(target.removeEventListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
    );
    expect(resizeListeners.size).toBe(0);
  });

  it("falls back to legacy media query listeners when needed", () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mediaQuery = {
      matches: false,
      addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      }),
      removeListener: vi.fn(
        (listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener);
        },
      ),
    };
    const updates: boolean[] = [];

    const cleanup = subscribeToCompactWorkspace(
      (matches) => updates.push(matches),
      { matchMedia: vi.fn(() => mediaQuery) },
    );

    expect(updates).toEqual([false]);
    expect(mediaQuery.addListener).toHaveBeenCalledOnce();

    for (const listener of listeners) {
      listener({ matches: true } as MediaQueryListEvent);
    }
    expect(updates).toEqual([false, true]);

    cleanup();
    expect(mediaQuery.removeListener).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });
});
