import { afterEach, describe, expect, it, vi } from "vitest";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { TerminalFindController } from "./terminal-find-controller.js";
import {
  registerTerminal,
  removeTerminal,
} from "./terminal-registry.js";
import {
  invalidateTerminalsForAppZoom,
  subscribeToTerminalAppZoomChanges,
} from "./terminal-zoom-invalidation.js";

const sessionId = "zoom:terminal";

function animationFrameFixture() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return { flush: () => frames.splice(0).forEach((callback) => callback(0)) };
}

afterEach(() => {
  removeTerminal(sessionId);
  vi.unstubAllGlobals();
});

describe("terminal zoom invalidation", () => {
  it("refits, refreshes, and invalidates terminal geometry without focus", () => {
    const frames = animationFrameFixture();
    const fit = vi.fn();
    const refresh = vi.fn();
    const focus = vi.fn();
    const invalidateSuggestionGeometry = vi.fn();
    registerTerminal(
      sessionId,
      {
        rows: 24,
        refresh,
        focus,
      } as unknown as Terminal,
      { fit } as unknown as FitAddon,
      {} as TerminalFindController,
    ).invalidateSuggestionGeometry = invalidateSuggestionGeometry;

    invalidateTerminalsForAppZoom();
    expect(fit).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(invalidateSuggestionGeometry).toHaveBeenCalledOnce();

    frames.flush();
    expect(fit).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith(0, 23);
    expect(focus).not.toHaveBeenCalled();
  });

  it("subscribes and removes the app-zoom listener", () => {
    const frames = animationFrameFixture();
    const fit = vi.fn();
    const refresh = vi.fn();
    const focus = vi.fn();
    registerTerminal(
      sessionId,
      { rows: 12, refresh, focus } as unknown as Terminal,
      { fit } as unknown as FitAddon,
      {} as TerminalFindController,
    );
    const listeners = new Set<EventListener>();
    const target = {
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        listeners.add(listener);
      }),
      removeEventListener: vi.fn((_type: string, listener: EventListener) => {
        listeners.delete(listener);
      }),
    };

    const cleanup = subscribeToTerminalAppZoomChanges(target);
    expect(target.addEventListener).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(1);

    for (const listener of listeners) listener(new Event("app-zoom-change"));
    frames.flush();
    expect(fit).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith(0, 11);
    expect(focus).not.toHaveBeenCalled();

    cleanup();
    expect(target.removeEventListener).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });
});
