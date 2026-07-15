import { describe, expect, it, vi } from "vitest";
import { TerminalNotificationSound } from "./terminal-notification-sound.js";

function createAudioContext(state: AudioContextState = "running") {
  const oscillator = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    frequency: { setValueAtTime: vi.fn() },
    onended: null as (() => void) | null,
    start: vi.fn(),
    stop: vi.fn(),
    type: "sine",
  };
  const gain = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: {
      exponentialRampToValueAtTime: vi.fn(),
      setValueAtTime: vi.fn(),
    },
  };
  const rawContext = {
    createGain: vi.fn(() => gain),
    createOscillator: vi.fn(() => oscillator),
    currentTime: 2,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    state,
  };
  const context = rawContext as unknown as AudioContext;

  return { context, gain, oscillator, rawContext };
}

describe("TerminalNotificationSound", () => {
  it("schedules a short low-volume chime and reuses its context", () => {
    const { context, gain, oscillator } = createAudioContext();
    const contextFactory = vi.fn(() => context);
    const sound = new TerminalNotificationSound({
      createAudioContext: contextFactory,
    });

    sound.play();
    sound.play();

    expect(contextFactory).toHaveBeenCalledTimes(1);
    expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(880, 2);
    expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      0.06,
      2.01,
    );
    expect(oscillator.start).toHaveBeenCalledWith(2);
    expect(oscillator.stop).toHaveBeenCalledWith(2.16);
    expect(oscillator.connect).toHaveBeenCalledWith(gain);
  });

  it("resumes a suspended context before scheduling", async () => {
    const { context, oscillator, rawContext } = createAudioContext("suspended");
    context.resume = vi.fn(async () => {
      rawContext.state = "running";
    });
    const sound = new TerminalNotificationSound({
      createAudioContext: () => context,
    });

    sound.play();
    await Promise.resolve();

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(oscillator.start).toHaveBeenCalledWith(2);
  });

  it("silently ignores unavailable and failing audio APIs", async () => {
    const unavailable = new TerminalNotificationSound({
      createAudioContext: () => null,
    });
    const { context } = createAudioContext("suspended");
    context.resume = vi.fn(() => Promise.reject(new Error("blocked")));
    const blocked = new TerminalNotificationSound({
      createAudioContext: () => context,
    });
    const { context: brokenContext } = createAudioContext();
    brokenContext.createOscillator = vi.fn(() => {
      throw new Error("audio node failure");
    });
    const broken = new TerminalNotificationSound({
      createAudioContext: () => brokenContext,
    });
    const failing = new TerminalNotificationSound({
      createAudioContext: () => {
        throw new Error("unsupported");
      },
    });

    expect(() => unavailable.play()).not.toThrow();
    expect(() => blocked.play()).not.toThrow();
    expect(() => broken.play()).not.toThrow();
    expect(() => failing.play()).not.toThrow();
    await Promise.resolve();
  });
});
