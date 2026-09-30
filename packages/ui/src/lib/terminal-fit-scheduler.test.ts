import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelScheduledTerminalFit,
  fitAllTerminals,
  fitTerminalNow,
  scheduleTerminalFit,
  type TerminalFitTarget,
} from "./terminal-fit-scheduler.js";

function measurableElement(overrides: Partial<HTMLElement> = {}): HTMLElement {
  return {
    isConnected: true,
    style: { display: "block" },
    parentElement: {
      style: { display: "block" },
      closest: () => null,
    },
    closest: () => null,
    getBoundingClientRect: () => ({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
    }),
    ...overrides,
  } as unknown as HTMLElement;
}

function target(element: HTMLElement = measurableElement()): TerminalFitTarget {
  return {
    fitAddon: { fit: vi.fn() },
    terminal: { focus: vi.fn(), element },
    attachmentElement: element,
  };
}

function animationFrameFixture() {
  let nextFrame = 1;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));

  return {
    frames,
    flush: () => {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(0);
      }
    },
  };
}

describe("terminal fit scheduler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("coalesces repeated requests into one frame and preserves focus", () => {
    const frames = animationFrameFixture();
    const terminal = target();

    scheduleTerminalFit(terminal);
    scheduleTerminalFit(terminal, { focus: true });
    scheduleTerminalFit(terminal);

    expect(frames.frames).toHaveLength(1);
    frames.flush();
    expect(terminal.fitAddon.fit).toHaveBeenCalledOnce();
    expect(terminal.terminal.focus).toHaveBeenCalledOnce();
  });

  it("lets a later explicit focus false revoke a queued focus request", () => {
    const frames = animationFrameFixture();
    const terminal = target();

    scheduleTerminalFit(terminal, { focus: true });
    scheduleTerminalFit(terminal, { focus: false });
    frames.flush();

    expect(terminal.fitAddon.fit).toHaveBeenCalledOnce();
    expect(terminal.terminal.focus).not.toHaveBeenCalled();
  });

  it("runs immediate fits synchronously", () => {
    const terminal = target();
    fitTerminalNow(terminal, { focus: true });

    expect(terminal.fitAddon.fit).toHaveBeenCalledOnce();
    expect(terminal.terminal.focus).toHaveBeenCalledOnce();
  });

  it("refreshes rendered rows without focusing when requested", () => {
    const element = measurableElement();
    const terminal = {
      fitAddon: { fit: vi.fn() },
      terminal: {
        rows: 24,
        refresh: vi.fn(),
        focus: vi.fn(),
        element,
      },
      attachmentElement: element,
    } satisfies TerminalFitTarget;

    fitTerminalNow(terminal, { refresh: true });

    expect(terminal.terminal.refresh).toHaveBeenCalledWith(0, 23);
    expect(terminal.terminal.focus).not.toHaveBeenCalled();
  });

  it("schedules each target in fit-all", () => {
    const frames = animationFrameFixture();
    const first = target();
    const second = target();

    fitAllTerminals([first, second]);
    frames.flush();

    expect(first.fitAddon.fit).toHaveBeenCalledOnce();
    expect(second.fitAddon.fit).toHaveBeenCalledOnce();
  });

  it("ignores cancelled and disposed terminals", () => {
    const frames = animationFrameFixture();
    const cancelled = target();
    const disposed = target();
    disposed.fitAddon.fit = vi.fn(() => {
      throw new Error("disposed");
    });

    scheduleTerminalFit(cancelled);
    cancelScheduledTerminalFit(cancelled);
    scheduleTerminalFit(disposed);

    expect(() => frames.flush()).not.toThrow();
    expect(cancelled.fitAddon.fit).not.toHaveBeenCalled();
    expect(() => fitTerminalNow(disposed)).not.toThrow();
  });

  it("commits desired renderer before calling fitAddon.fit", () => {
    const events: string[] = [];
    const element = measurableElement();
    const terminal: TerminalFitTarget = {
      fitAddon: {
        fit: vi.fn(() => events.push("fit")),
      },
      terminal: {
        focus: vi.fn(),
        element,
      },
      attachmentElement: element,
      commitDesiredRenderer: vi.fn(() => events.push("commit-renderer")),
    };

    fitTerminalNow(terminal);

    expect(events).toEqual(["commit-renderer", "fit"]);
  });

  it("skips fit for hidden or parked terminals, preserving existing dimensions", () => {
    const hiddenTerminal: TerminalFitTarget = {
      fitAddon: { fit: vi.fn() },
      terminal: { focus: vi.fn() },
      attachmentElement: measurableElement({
        style: { display: "none" } as unknown as CSSStyleDeclaration,
      }),
    };

    fitTerminalNow(hiddenTerminal);

    expect(hiddenTerminal.fitAddon.fit).not.toHaveBeenCalled();
  });

  it("skips fit when element has zero dimensions", () => {
    const terminal: TerminalFitTarget = {
      fitAddon: { fit: vi.fn() },
      terminal: { focus: vi.fn() },
      attachmentElement: measurableElement({
        getBoundingClientRect: () => ({
          width: 0,
          height: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }),
      }),
    };

    fitTerminalNow(terminal);

    expect(terminal.fitAddon.fit).not.toHaveBeenCalled();
  });

  it("fitAllTerminals skips ineligible terminals", () => {
    const frames = animationFrameFixture();
    const visible = target();
    const hidden = target(
      measurableElement({
        style: { display: "none" } as unknown as CSSStyleDeclaration,
      }),
    );

    fitAllTerminals([visible, hidden]);
    frames.flush();

    expect(visible.fitAddon.fit).toHaveBeenCalledOnce();
    expect(hidden.fitAddon.fit).not.toHaveBeenCalled();
  });
});
