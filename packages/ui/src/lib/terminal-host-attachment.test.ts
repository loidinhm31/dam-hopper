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
  return { flush: () => callbacks.splice(0).forEach((callback) => callback(0)) };
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

function entryFixture(events: string[], element: HTMLElement): TerminalEntry {
  return {
    fitAddon: { fit: () => events.push("fit") },
    terminal: {
      element,
      focus: () => events.push("focus"),
    },
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
      "visibility:hidden",
      "append",
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

    expect(events).toEqual(["append", "display:none", "visibility:"]);
  });
});
