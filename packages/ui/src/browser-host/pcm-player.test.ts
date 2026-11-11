// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PcmPlayer, PCM_SAMPLE_RATE } from "./pcm-player.js";

function encodePcm16LeBase64(samples: number[]): string {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(i * 2, samples[i], true);
  }
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

class MockAudioBufferSourceNode {
  public buffer: { duration: number; length: number; sampleRate: number } | null = null;
  public onended: (() => void) | null = null;
  public connect = vi.fn();
  public start = vi.fn();
  public stop = vi.fn();
  public disconnect = vi.fn();
}

class MockGainNode {
  public gain = {
    value: 1,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn((v: number) => {
      this.gain.value = v;
    }),
  };
  public connect = vi.fn();
  public disconnect = vi.fn();
}

class MockAudioContext {
  public static instances: MockAudioContext[] = [];
  public state: AudioContextState = "running";
  public currentTime = 1.0;
  public destination = {};
  public onstatechange: (() => void) | null = null;
  public sources: MockAudioBufferSourceNode[] = [];
  public gains: MockGainNode[] = [];
  public buffers: { data: Float32Array; sampleRate: number }[] = [];
  public resumeImpl: () => Promise<void> = async () => {
    this.state = "running";
  };
  public resume = vi.fn(() => this.resumeImpl());
  public close = vi.fn(async () => {
    this.state = "closed";
  });

  constructor() {
    MockAudioContext.instances.push(this);
  }

  public createGain(): GainNode {
    const gain = new MockGainNode();
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }

  public createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    expect(channels).toBe(1);
    const data = new Float32Array(length);
    this.buffers.push({ data, sampleRate });
    return {
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => data,
    } as unknown as AudioBuffer;
  }

  public createBufferSource(): AudioBufferSourceNode {
    const src = new MockAudioBufferSourceNode();
    this.sources.push(src);
    return src as unknown as AudioBufferSourceNode;
  }
}

describe("PcmPlayer", () => {
  beforeEach(() => {
    MockAudioContext.instances = [];
    vi.stubGlobal("AudioContext", MockAudioContext);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("decodes signed PCM16LE samples accurately and schedules adjacent chunks gaplessly", () => {
    const player = new PcmPlayer();
    const chunk1 = encodePcm16LeBase64([0, -32768, 32767, 16384]);
    const chunk2 = encodePcm16LeBase64(new Array(240).fill(8192)); // 10ms @ 24kHz

    player.enqueue(chunk1);
    player.enqueue(chunk2);

    const ctx = MockAudioContext.instances[0];
    expect(ctx).toBeDefined();
    expect(ctx.buffers).toHaveLength(2);
    expect(ctx.buffers[0].sampleRate).toBe(PCM_SAMPLE_RATE);
    expect(ctx.buffers[0].data[0]).toBeCloseTo(0, 5);
    expect(ctx.buffers[0].data[1]).toBeCloseTo(-1, 5);
    expect(ctx.buffers[0].data[2]).toBeCloseTo(32767 / 32768, 5);
    expect(ctx.buffers[0].data[3]).toBeCloseTo(0.5, 5);

    const start1 = ctx.sources[0].start.mock.calls[0][0] as number;
    const start2 = ctx.sources[1].start.mock.calls[0][0] as number;
    expect(start1).toBeCloseTo(1.02, 5);
    expect(start2).toBeCloseTo(start1 + 4 / PCM_SAMPLE_RATE, 6);
  });

  it("synchronously zeroes gain and stops all active sources on flush without delayed fade", () => {
    const player = new PcmPlayer();
    player.enqueue(encodePcm16LeBase64(new Array(480).fill(4096)));
    player.enqueue(encodePcm16LeBase64(new Array(480).fill(4096)));

    const ctx = MockAudioContext.instances[0];
    expect(ctx.sources).toHaveLength(2);

    player.flush();

    expect(ctx.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, ctx.currentTime);
    expect(ctx.sources[0].stop).toHaveBeenCalledTimes(1);
    expect(ctx.sources[0].disconnect).toHaveBeenCalledTimes(1);
    expect(ctx.sources[1].stop).toHaveBeenCalledTimes(1);
    expect(ctx.sources[1].disconnect).toHaveBeenCalledTimes(1);
    expect(player.queuedSeconds()).toBe(0);
  });

  it("enforces 500ms queue bound by flushing stale backlog before admitting newest chunk", () => {
    const player = new PcmPlayer();
    // 6 chunks of 100ms (2400 samples each) = 600ms > 500ms ceiling
    const chunk100ms = encodePcm16LeBase64(new Array(2400).fill(2048));
    for (let i = 0; i < 5; i++) {
      player.enqueue(chunk100ms);
    }
    const ctx = MockAudioContext.instances[0];
    // 5th chunk pushed queuedSeconds over 0.5s (because of 0.02s initial lead), flushed prior 4, and scheduled the 5th chunk on a fresh masterGain
    expect(ctx.sources[0].stop).toHaveBeenCalledTimes(1);
    expect(ctx.sources).toHaveLength(5);
    expect(ctx.sources[4].start).toHaveBeenCalledTimes(1);
    expect(ctx.sources[4].stop).not.toHaveBeenCalled();
    expect(player.queuedSeconds()).toBeGreaterThan(0.1);
    expect(player.queuedSeconds()).toBeLessThanOrEqual(0.5);
  });

  it("fences pending suspended chunks on flush/canPlay, keeps single-flight resume, and tracks autoplay block", async () => {
    let allowed = true;
    const blockedEvents: boolean[] = [];
    const player = new PcmPlayer({
      canPlay: () => allowed,
      onAutoplayBlockedChange: (b) => blockedEvents.push(b),
    });
    let resumeCalls = 0;
    let rejectResume = false;
    const { promise, resolve } = Promise.withResolvers<void>();
    vi.stubGlobal(
      "AudioContext",
      class extends MockAudioContext {
        constructor() {
          super();
          this.state = "suspended";
          this.resumeImpl = () => {
            resumeCalls++;
            if (rejectResume) return Promise.reject(new Error("NotAllowedError"));
            return promise.then(() => {
              this.state = "running";
            });
          };
        }
      },
    );

    player.enqueue(encodePcm16LeBase64(new Array(480).fill(4096)));
    // Suspended context immediately surfaces autoplayBlocked cue while resume is pending
    expect(player.isAutoplayBlocked()).toBe(true);
    player.flush();
    player.enqueue(encodePcm16LeBase64(new Array(480).fill(4096)));
    // Single-flight non-gesture resume: flush did not spawn a second concurrent non-gesture resume()
    expect(resumeCalls).toBe(1);
    // Direct user gesture prime() is allowed to invoke resume() even while non-gesture resume is pending
    player.prime();
    expect(resumeCalls).toBe(2);

    // Flipping canPlay false before resume resolves prevents draining pending samples
    allowed = false;
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    const ctx = MockAudioContext.instances[0];
    expect(ctx.sources).toHaveLength(0);
    expect(player.isAutoplayBlocked()).toBe(false);

    // Simulate suspended autoplay rejection -> keeps autoplayBlocked true and stops non-gesture retries
    allowed = true;
    ctx.state = "suspended";
    rejectResume = true;
    player.enqueue(encodePcm16LeBase64(new Array(480).fill(4096)));
    await Promise.resolve();
    await Promise.resolve();
    expect(player.isAutoplayBlocked()).toBe(true);
    const callsAfterReject = resumeCalls;
    player.enqueue(encodePcm16LeBase64(new Array(480).fill(4096)));
    expect(resumeCalls).toBe(callsAfterReject);

    // Gesture prime() clears autoplayBlocked when resume succeeds
    rejectResume = false;
    player.prime();
    await Promise.resolve();
    await Promise.resolve();
    expect(player.isAutoplayBlocked()).toBe(false);
    expect(blockedEvents).toEqual([true, false, true, false]);
  });

  it("rejects malformed base64, odd byte counts, and refuses work after dispose()", () => {
    const player = new PcmPlayer();
    player.enqueue("");
    player.enqueue("not-valid-base64!!!");
    player.enqueue(btoa("odd")); // 3 bytes (odd)
    expect(MockAudioContext.instances).toHaveLength(0);

    player.prime();
    expect(MockAudioContext.instances).toHaveLength(1);
    player.dispose();
    expect(MockAudioContext.instances[0].close).toHaveBeenCalledTimes(1);

    player.enqueue(encodePcm16LeBase64([100, 200]));
    expect(MockAudioContext.instances).toHaveLength(1);
  });
});
