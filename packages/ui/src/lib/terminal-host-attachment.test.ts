import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachTerminalsToHost } from "./terminal-host-attachment.js";
import type { TerminalEntry } from "./terminal-registry.js";

function animationFrameFixture() {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return {
    flush: () => callbacks.splice(0).forEach((callback) => callback(0)),
  };
}

function elementFixture(events: string[]) {
  const style = {
    width: "",
    height: "",
    position: "",
    inset: "",
    set display(value: string) {
      events.push(`display:${value}`);
    },
    set visibility(value: string) {
      events.push(`visibility:${value}`);
    },
  };
  return { style, parentElement: null } as unknown as HTMLElement;
}

function entryFixture(
  events: string[],
  element: HTMLElement,
  attachmentElement?: HTMLElement,
): TerminalEntry {
  return {
    fitAddon: { fit: () => events.push("fit") },
    findController: { close: () => events.push("close-find") },
    terminal: {
      element,
      focus: () => events.push("focus"),
    },
    attachmentElement,
    invalidateSuggestionGeometry: () => events.push("invalidate-geometry"),
  } as unknown as TerminalEntry;
}

describe("attachTerminalsToHost", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("hides, moves, fits, reveals, and settles the active terminal", () => {
    const frames = animationFrameFixture();
    const events: string[] = [];
    const element = elementFixture(events);
    const entry = entryFixture(events, element);
    const host = {
      appendChild: (child: HTMLElement) => {
        events.push("append");
        Object.defineProperty(child, "parentElement", { value: host });
      },
    } as unknown as HTMLElement;

    attachTerminalsToHost({
      host,
      sessionIds: ["active"],
      activeSessionId: "active",
      resolveTerminal: () => entry,
    });

    expect(events).toEqual([
      "close-find",
      "visibility:hidden",
      "append",
      "invalidate-geometry",
      "display:block",
      "fit",
      "visibility:",
    ]);
    frames.flush();
    expect(events.slice(-2)).toEqual(["fit", "focus"]);
  });

  it("keeps inactive terminals mounted but hidden without fitting", () => {
    animationFrameFixture();
    const events: string[] = [];
    const element = elementFixture(events);
    const entry = entryFixture(events, element);
    const host = {
      appendChild: (child: HTMLElement) => {
        events.push("append");
        Object.defineProperty(child, "parentElement", { value: host });
      },
    } as unknown as HTMLElement;

    attachTerminalsToHost({
      host,
      sessionIds: ["inactive"],
      activeSessionId: null,
      resolveTerminal: () => entry,
    });

    expect(events).toEqual([
      "close-find",
      "append",
      "invalidate-geometry",
      "display:none",
      "visibility:",
    ]);
  });

  it("closes search before moving an active terminal to another host", () => {
    animationFrameFixture();
    const events: string[] = [];
    const element = elementFixture(events);
    const oldHost = {} as HTMLElement;
    Object.defineProperty(element, "parentElement", { value: oldHost });
    const entry = entryFixture(events, element);
    const controller = entry.findController;
    const newHost = {
      appendChild: (child: HTMLElement) => {
        events.push("append");
        Object.defineProperty(child, "parentElement", { value: newHost });
      },
    } as unknown as HTMLElement;

    attachTerminalsToHost({
      host: newHost,
      sessionIds: ["active"],
      activeSessionId: "active",
      resolveTerminal: () => entry,
    });

    expect(events[0]).toBe("close-find");
    expect(events).toContain("invalidate-geometry");
    expect(entry.terminal.element).toBe(element);
    expect(entry.findController).toBe(controller);
  });

  it("resets host scroll offsets before fitting the active terminal", () => {
    animationFrameFixture();
    const events: string[] = [];
    const element = elementFixture(events);
    const entry = entryFixture(events, element);
    const host = {
      scrollLeft: 24,
      scrollTop: 18,
      appendChild: (child: HTMLElement) => {
        Object.defineProperty(child, "parentElement", { value: host });
      },
    } as unknown as HTMLElement;

    attachTerminalsToHost({
      host,
      sessionIds: ["active"],
      activeSessionId: "active",
      resolveTerminal: () => entry,
    });

    expect(host.scrollLeft).toBe(0);
    expect(host.scrollTop).toBe(0);
  });

  it("reparents the terminal attachment boundary instead of the xterm element", () => {
    animationFrameFixture();
    const events: string[] = [];
    const terminalElement = elementFixture(events);
    const attachmentElement = elementFixture(events);
    const entry = entryFixture(events, terminalElement, attachmentElement);
    const host = {
      appendChild: (child: HTMLElement) => {
        events.push(
          child === attachmentElement ? "append-boundary" : "append-xterm",
        );
        Object.defineProperty(child, "parentElement", { value: host });
      },
    } as unknown as HTMLElement;

    attachTerminalsToHost({
      host,
      sessionIds: ["active"],
      activeSessionId: "active",
      resolveTerminal: () => entry,
    });

    expect(events).toContain("append-boundary");
    expect(events).not.toContain("append-xterm");
    expect(entry.terminal.element).toBe(terminalElement);
  });
});
