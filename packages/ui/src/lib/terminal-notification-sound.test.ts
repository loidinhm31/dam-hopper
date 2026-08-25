import { describe, expect, it, vi } from "vitest";
import { TerminalNotificationSound } from "./terminal-notification-sound.js";

function createAudioContext(state: AudioContextState = "running") {
  const oscillators: Array<ReturnType<typeof createOscillator>> = [];
  const gains: Array<ReturnType<typeof createGain>> = [];
  const rawContext = {
    createGain: vi.fn(() => {
      const gain = createGain();
      gains.push(gain);
      return gain;
    }),
    createOscillator: vi.fn(() => {
      const oscillator = createOscillator();
      oscillators.push(oscillator);
      return oscillator;
    }),
    currentTime: 2,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    state,
  };

  return {
    context: rawContext as unknown as AudioContext,
    gains,
    oscillators,
    rawContext,
  };
}

function createOscillator() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    frequency: { setValueAtTime: vi.fn() },
    onended: null as (() => void) | null,
    start: vi.fn(),
    stop: vi.fn(),
    type: "sine",
  };
}

function createGain() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: {
      exponentialRampToValueAtTime: vi.fn(),
      setValueAtTime: vi.fn(),
    },
  };
}

describe("TerminalNotificationSound", () => {
  it("preserves the default chime schedule and reuses its context", () => {
    const { context, gains, oscillators } = createAudioContext();
    const contextFactory = vi.fn(() => context);
    const sound = new TerminalNotificationSound({
      createAudioContext: contextFactory,
    });

    sound.play(50);
    sound.play("default", 50);

    expect(contextFactory).toHaveBeenCalledTimes(1);
    expect(oscillators).toHaveLength(2);
    expect(oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(
      880,
      2,
    );
    expect(gains[0].gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      0.12,
      2.01,
    );
    expect(gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 2);
    expect(gains[0].gain.exponentialRampToValueAtTime).toHaveBeenLastCalledWith(
      0.0001,
      2.32,
    );
    expect(oscillators[0].start).toHaveBeenCalledWith(2);
    expect(oscillators[0].stop).toHaveBeenCalledWith(2.32);
    expect(oscillators[0].connect).toHaveBeenCalledWith(gains[0]);
  });

  it.each([
    ["soft", [660], [2], [2.24], ["sine"], [0.066]],
    [
      "two-tone",
      [660, 880],
      [2, 2.18],
      [2.15, 2.33],
      ["sine", "sine"],
      [0.096, 0.096],
    ],
    [
      "urgent",
      [1046, 1046, 1046],
      [2, 2.12, 2.24],
      [2.08, 2.2, 2.32],
      ["square", "square", "square"],
      [0.12, 0.12, 0.12],
    ],
  ] as const)(
    "schedules the %s pattern with its fixed note sequence",
    (pattern, frequencies, startTimes, stopTimes, waveforms, peakGains) => {
      const { context, gains, oscillators } = createAudioContext();
      const sound = new TerminalNotificationSound({
        createAudioContext: () => context,
      });

      sound.play(pattern, 50);

      expect(oscillators.map(({ type }) => type)).toEqual(waveforms);
      expect(oscillators.map(({ start }) => start.mock.calls[0][0])).toEqual(
        startTimes,
      );
      expect(oscillators).toHaveLength(stopTimes.length);
      oscillators.forEach(({ stop }, index) => {
        expect(stop.mock.calls[0][0]).toBeCloseTo(stopTimes[index], 10);
      });
      gains.forEach(({ gain }, index) => {
        expect(gain.setValueAtTime).toHaveBeenCalledWith(
          0.0001,
          startTimes[index],
        );
        expect(gain.exponentialRampToValueAtTime.mock.calls[0][0]).toBeCloseTo(
          peakGains[index],
          10,
        );
        expect(gain.exponentialRampToValueAtTime.mock.calls[1]).toEqual([
          0.0001,
          expect.closeTo(stopTimes[index], 10),
        ]);
      });
      expect(
        oscillators.map(
          ({ frequency }) => frequency.setValueAtTime.mock.calls[0],
        ),
      ).toEqual(
        frequencies.map((frequency, index) => [frequency, startTimes[index]]),
      );
    },
  );

  it("resumes a suspended context before scheduling", async () => {
    const { context, oscillators, rawContext } =
      createAudioContext("suspended");
    context.resume = vi.fn(async () => {
      rawContext.state = "running";
    });
    const sound = new TerminalNotificationSound({
      createAudioContext: () => context,
    });

    sound.play("two-tone");
    await Promise.resolve();

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(oscillators).toHaveLength(2);
  });

  it("resumes a suspended context at zero volume without scheduling a chime", async () => {
    const { context, oscillators, rawContext } =
      createAudioContext("suspended");
    context.resume = vi.fn(async () => {
      rawContext.state = "running";
    });
    const sound = new TerminalNotificationSound({
      createAudioContext: () => context,
    });

    sound.play("urgent", 0);
    await Promise.resolve();

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(oscillators).toHaveLength(0);
  });

  it("disconnects scheduled nodes after playback and scheduling failures", () => {
    const { context, gains, oscillators } = createAudioContext();
    const sound = new TerminalNotificationSound({
      createAudioContext: () => context,
    });

    sound.play();
    oscillators[0].onended?.();

    expect(oscillators[0].disconnect).toHaveBeenCalledTimes(1);
    expect(gains[0].disconnect).toHaveBeenCalledTimes(1);

    const broken = createAudioContext();
    broken.rawContext.createOscillator.mockImplementationOnce(() => {
      const oscillator = createOscillator();
      oscillator.connect.mockImplementationOnce(() => {
        throw new Error("audio node failure");
      });
      broken.oscillators.push(oscillator);
      return oscillator;
    });
    const failingSound = new TerminalNotificationSound({
      createAudioContext: () => broken.context,
    });

    expect(() => failingSound.play()).not.toThrow();
    expect(broken.oscillators[0].disconnect).toHaveBeenCalledTimes(1);
    expect(broken.gains[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it("silently ignores unavailable and blocked audio APIs", async () => {
    const unavailable = new TerminalNotificationSound({
      createAudioContext: () => null,
    });
    const { context } = createAudioContext("suspended");
    context.resume = vi.fn(() => Promise.reject(new Error("blocked")));
    const blocked = new TerminalNotificationSound({
      createAudioContext: () => context,
    });
    const failing = new TerminalNotificationSound({
      createAudioContext: () => {
        throw new Error("unsupported");
      },
    });

    expect(() => unavailable.play()).not.toThrow();
    expect(() => blocked.play()).not.toThrow();
    expect(() => failing.play()).not.toThrow();
    await Promise.resolve();
  });
});
