import { describe, expect, it, vi } from "vitest";
import {
  COMPACT_WORKSPACE_QUERY,
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
