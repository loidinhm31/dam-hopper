// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { bindTerminalTouchScroll } from "./terminal-touch-scroll.js";

describe("bindTerminalTouchScroll", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("scrolls the xterm buffer from a coarse-pointer swipe", () => {
    const fixture = createFixture();
    const release = bindTerminalTouchScroll(fixture.root, fixture.terminal);

    fixture.root.dispatchEvent(
      touchEvent("touchstart", [touch(1, 120)], undefined, 10),
    );
    const move = touchEvent("touchmove", [touch(1, 60)], undefined, 20);
    fixture.root.dispatchEvent(move);
    fixture.animationFrames.shift()?.(20);

    expect(fixture.scrollLines).toHaveBeenCalledWith(3);
    expect(move.defaultPrevented).toBe(false);
    release();
    expect(fixture.removeEventListener).toHaveBeenCalledTimes(4);
  });

  it("does not bind when no coarse pointer is available", () => {
    const fixture = createFixture(false);
    const release = bindTerminalTouchScroll(fixture.root, fixture.terminal);

    fixture.root.dispatchEvent(
      touchEvent("touchstart", [touch(1, 120)], undefined, 10),
    );
    fixture.root.dispatchEvent(
      touchEvent("touchmove", [touch(1, 60)], undefined, 20),
    );

    expect(fixture.matchMedia).toHaveBeenCalledWith("(any-pointer: coarse)");
    expect(fixture.scrollLines).not.toHaveBeenCalled();
    release();
    expect(fixture.removeEventListener).not.toHaveBeenCalled();
  });

  it("cancels an active gesture when a second touch starts", () => {
    const fixture = createFixture();
    const release = bindTerminalTouchScroll(fixture.root, fixture.terminal);
    const first = touch(1, 120);
    const second = touch(2, 120);

    fixture.root.dispatchEvent(touchEvent("touchstart", [first], undefined, 10));
    fixture.root.dispatchEvent(
      touchEvent("touchmove", [touch(1, 60)], undefined, 20),
    );
    fixture.root.dispatchEvent(
      touchEvent("touchstart", [first, second], [second], 30),
    );
    fixture.animationFrames.shift()?.(30);
    fixture.root.dispatchEvent(touchEvent("touchend", [second], [first], 40));

    expect(fixture.scrollLines).not.toHaveBeenCalled();
    expect(fixture.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(fixture.cancelAnimationFrame).toHaveBeenCalledWith(1);
    release();
  });

  it("ignores unrelated touch endings and handles touchcancel", () => {
    const fixture = createFixture();
    const release = bindTerminalTouchScroll(fixture.root, fixture.terminal);
    const first = touch(1, 120);
    const unrelated = touch(2, 120);

    fixture.root.dispatchEvent(touchEvent("touchstart", [first], undefined, 10));
    fixture.root.dispatchEvent(
      touchEvent("touchend", [], [unrelated], 20),
    );
    fixture.root.dispatchEvent(
      touchEvent("touchmove", [touch(1, 60)], undefined, 30),
    );
    fixture.animationFrames.shift()?.(30);
    expect(fixture.scrollLines).toHaveBeenCalledWith(3);

    fixture.root.dispatchEvent(touchEvent("touchcancel", [], [first], 40));
    expect(fixture.requestAnimationFrame).toHaveBeenCalledTimes(1);
    release();
  });

  it("continues a fling and cancels it during cleanup", () => {
    const fixture = createFixture();
    vi.spyOn(performance, "now").mockReturnValue(100);
    const release = bindTerminalTouchScroll(fixture.root, fixture.terminal);

    fixture.root.dispatchEvent(
      touchEvent("touchstart", [touch(1, 120)], undefined, 10),
    );
    fixture.root.dispatchEvent(
      touchEvent("touchmove", [touch(1, 60)], undefined, 20),
    );
    fixture.animationFrames.shift()?.(20);
    fixture.root.dispatchEvent(touchEvent("touchend", [], [touch(1, 60)], 30));

    fixture.animationFrames.shift()?.(116);
    fixture.animationFrames.shift()?.(132);
    expect(fixture.scrollLines).toHaveBeenCalledWith(1);

    release();
    expect(fixture.cancelAnimationFrame).toHaveBeenCalled();
  });

  it("keeps null cleanup safe", () => {
    expect(() => bindTerminalTouchScroll(null)()).not.toThrow();
  });
});

function createFixture(matches = true) {
  const root = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  vi.spyOn(screen, "getBoundingClientRect").mockReturnValue({
    height: 200,
  } as DOMRect);
  root.append(screen);

  const animationFrames: FrameRequestCallback[] = [];
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  });
  const cancelAnimationFrame = vi.fn();
  const matchMedia = vi.fn(() => ({ matches } as MediaQueryList));
  const scrollLines = vi.fn();
  vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
  vi.stubGlobal("matchMedia", matchMedia);

  return {
    root,
    animationFrames,
    requestAnimationFrame,
    cancelAnimationFrame,
    matchMedia,
    scrollLines,
    terminal: { rows: 10, scrollLines },
    removeEventListener: vi.spyOn(root, "removeEventListener"),
  };
}

function touch(identifier: number, clientY: number): Touch {
  return { identifier, clientY } as Touch;
}

function touchEvent(
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  touches: Touch[],
  changedTouches: Touch[] | undefined = touches,
  timeStamp = 0,
): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    changedTouches: { value: changedTouches },
    targetTouches: { value: touches },
    timeStamp: { value: timeStamp },
    touches: { value: touches },
  });
  return event as TouchEvent;
}
