import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelScheduledTerminalFit,
  fitAllTerminals,
  fitTerminalNow,
  scheduleTerminalFit,
  type TerminalFitTarget,
} from "./terminal-fit-scheduler.js";

function target(): TerminalFitTarget {
  return {
    fitAddon: { fit: vi.fn() },
    terminal: { focus: vi.fn() },
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

  it("runs immediate fits synchronously", () => {
    const terminal = target();
    fitTerminalNow(terminal, { focus: true });

    expect(terminal.fitAddon.fit).toHaveBeenCalledOnce();
    expect(terminal.terminal.focus).toHaveBeenCalledOnce();
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
});
