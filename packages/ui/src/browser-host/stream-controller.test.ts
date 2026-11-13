// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserStreamController } from "./stream-controller.js";
import { BrowserInputController } from "./input-controller.js";
import { packBhjfFrame } from "./frame-protocol.js";
import { createMockJpeg } from "./frame-protocol.test.js";
import {
  isValidMediaClientControl,
  MAX_CLIENT_DECODE_MS,
  MAX_HEARTBEAT_FRAME_COUNT,
  MAX_HEARTBEAT_SAMPLE_MS,
  MAX_MEDIA_CONTROL_BYTES,
  type TargetFrameHeader,
} from "../api/browser-host-types.js";
import type { ViewerAttachmentCredentials } from "../api/browser-host-client.js";

// Mock WebSocket
class MockWebSocket {
  public static OPEN = 1;
  public static CLOSED = 3;
  public static instances: MockWebSocket[] = [];
  public readyState = MockWebSocket.OPEN;
  public binaryType = "blob";
  public sentMessages: string[] = [];

  public onopen: (() => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: ((err: unknown) => void) | null = null;

  constructor(
    public readonly url: string,
    public readonly protocols?: string | string[],
  ) {
    MockWebSocket.instances.push(this);
  }

  public send(data: string | ArrayBuffer): void {
    if (typeof data === "string") {
      this.sentMessages.push(data);
    }
  }

  public close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe("stream-controller", () => {
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let controller: BrowserStreamController;
  let mockCreds: ViewerAttachmentCredentials;

  const makeHeader = (seq: string): TargetFrameHeader => ({
    browserSessionId: "12345678-1234-4234-8234-123456789abc",
    browserIncarnation: "abcdef01-2345-4678-8901-234567890abc",
    profileEpoch: "1",
    producerRun: "fedcba98-7654-4321-8901-abcdef012345",
    viewportEpoch: "1",
    frameSeq: seq,
    width: 640,
    height: 480,
    captureTimeUnixMs: 1700000000000,
    geometry: {
      cssWidth: 640,
      cssHeight: 480,
      offsetTop: 0,
      scrollX: 0,
      scrollY: 0,
      pageScale: 1,
      visualOffsetX: 0,
      visualOffsetY: 0,
      dpr: 1,
    },
    inputTrusted: true,
  });

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);

    canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    ctx = {
      fillStyle: "#000000",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(canvas, "getContext").mockReturnValue(ctx);

    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockImplementation(async () => ({
        width: 640,
        height: 480,
        close: vi.fn(),
      })),
    );

    controller = new BrowserStreamController({
      canvas,
    });

    mockCreds = {
      owner: { profileId: "profile-1", generation: 1 },
      browserSessionId: "12345678-1234-4234-8234-123456789abc",
      browserIncarnation: "abcdef01-2345-4678-8901-234567890abc",
      profileEpoch: 1,
      viewerId: "viewer-uuid-1",
      subscriptionEpoch: "sub-epoch-uuid-1",
      mediaTicket: "med-tok",
      controlTicket: "ctrl-tok",
      mediaWsUrl: "ws://127.0.0.1:4801/api/browser/media",
      controlWsUrl: "ws://127.0.0.1:4801/api/browser/control",
      mediaSubprotocols: ["damhopper.browser.media.v1", "damhopper.ticket.med-tok"],
      controlSubprotocols: [
        "damhopper.browser.control.v1",
        "damhopper.ticket.ctrl-tok",
      ],
    };
  });

  afterEach(() => {
    controller.dispose();
    vi.restoreAllMocks();
  });

  it("attaches WebSockets and handles open state and heartbeat", () => {
    vi.useFakeTimers();
    controller.attach(mockCreds);
    expect(controller.getStatus()).toBe("connecting");

    const mediaWs = MockWebSocket.instances[0];
    expect(mediaWs).toBeDefined();

    mediaWs.onopen?.();
    expect(controller.getStatus()).toBe("streaming");

    // Advance 5 seconds to trigger heartbeat
    vi.advanceTimersByTime(5000);
    expect(mediaWs.sentMessages.length).toBeGreaterThanOrEqual(1);
    const heartbeat = JSON.parse(mediaWs.sentMessages[0]);
    expect(heartbeat).toEqual({
      kind: "heartbeat",
      subscriptionEpoch: "sub-epoch-uuid-1",
      visible: true,
    });

    vi.useRealTimers();
  });

  it("delivers pushed session state with its captured owner and attachment identity", () => {
    const onControlEvent = vi.fn();
    controller.dispose();
    controller = new BrowserStreamController({ canvas, onControlEvent });
    controller.attach(mockCreds);
    const header = makeHeader("1");
    const event = { kind: "sessionUpdated", session: {
      browserSessionId: header.browserSessionId, browserIncarnation: header.browserIncarnation,
      profileEpoch: "1", navigationRevision: "9007199254740993", viewportEpoch: "1",
      url: "https://example.test/native", title: "Native", status: "running",
      geometry: header.geometry, inputAvailable: true,
    } };
    MockWebSocket.instances[1].onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(event) }),
    );
    expect(onControlEvent).toHaveBeenCalledExactlyOnceWith(event, mockCreds);
  });

  it.each(["hidden", "privacy", "rebound", "disposed"])(
    "rejects old socket snapshots after %s retirement",
    (retirement) => {
      const onControlEvent = vi.fn();
      controller.dispose();
      controller = new BrowserStreamController({ canvas, onControlEvent });
      controller.attach(mockCreds);
      const retiredMessage = MockWebSocket.instances[1].onmessage!;
      if (retirement === "hidden") controller.setVisibility(false);
      if (retirement === "privacy") controller.setPrivacyMode(true);
      if (retirement === "disposed") controller.dispose();
      if (retirement === "rebound") controller.attach({
        ...mockCreds, owner: { ...mockCreds.owner, generation: 2 }, subscriptionEpoch: "replacement",
      });
      retiredMessage(new MessageEvent("message", {
        data: JSON.stringify({ kind: "sessionUpdated", session: { url: "retired" } }),
      }));
      expect(onControlEvent).not.toHaveBeenCalled();
      if (retirement === "rebound") {
        MockWebSocket.instances[3].onmessage?.(new MessageEvent("message", {
          data: JSON.stringify({ kind: "status", inputAvailable: true }),
        }));
        expect(onControlEvent).toHaveBeenCalledTimes(1);
        expect(onControlEvent.mock.calls[0][1].owner.generation).toBe(2);
      }
    },
  );

  it("enforces 1 active decode + 1 pending frame, discarding intermediate pending frames", async () => {
    // Stub createImageBitmap to control decode resolution
    let resolveDecode1: ((bitmap: ImageBitmap) => void) | null = null;
    let resolveDecode3: ((bitmap: ImageBitmap) => void) | null = null;

    let decodeCount = 0;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockImplementation(() => {
        decodeCount++;
        const { promise, resolve } = Promise.withResolvers<ImageBitmap>();
        if (decodeCount === 1) {
          resolveDecode1 = resolve;
        } else if (decodeCount === 2) {
          resolveDecode3 = resolve;
        } else {
          resolve({
            width: 640,
            height: 480,
            close: vi.fn(),
          } as unknown as ImageBitmap);
        }
        return promise;
      }),
    );

    controller.attach(mockCreds);
    const mediaWs = MockWebSocket.instances[0];
    mediaWs.onopen?.();

    const jpeg = createMockJpeg(640, 480);
    const frame1 = packBhjfFrame(makeHeader("1"), jpeg);
    const frame2 = packBhjfFrame(makeHeader("2"), jpeg);
    const frame3 = packBhjfFrame(makeHeader("3"), jpeg);

    // Send Frame 1: starts active decode
    mediaWs.onmessage?.(new MessageEvent("message", { data: frame1.buffer }));
    expect(decodeCount).toBe(1);

    // Send Frame 2 while Frame 1 is decoding: queues Frame 2 as pending
    mediaWs.onmessage?.(new MessageEvent("message", { data: frame2.buffer }));
    // Still decoding Frame 1
    expect(decodeCount).toBe(1);
    expect(mediaWs.sentMessages.length).toBe(0);

    // Send Frame 3 while Frame 1 is still decoding: replaces Frame 2 as pending
    mediaWs.onmessage?.(new MessageEvent("message", { data: frame3.buffer }));
    expect(decodeCount).toBe(1);

    // Frame 2 MUST have received a frameDiscarded message with reason: 'replaced'
    expect(mediaWs.sentMessages.length).toBe(1);
    const discard2 = JSON.parse(mediaWs.sentMessages[0]);
    expect(discard2).toEqual({
      kind: "frameDiscarded",
      subscriptionEpoch: "sub-epoch-uuid-1",
      producerRun: "fedcba98-7654-4321-8901-abcdef012345",
      viewportEpoch: "1",
      frameSeq: "2",
      reason: "replaced",
    });

    // Now resolve Frame 1 decode
    const close1 = vi.fn();
    resolveDecode1!({
      width: 640,
      height: 480,
      close: close1,
    } as unknown as ImageBitmap);

    // Allow promise microtasks to run
    await Promise.resolve();
    await Promise.resolve();

    // Frame 1 should be drawn and ACKed
    expect(mediaWs.sentMessages.length).toBe(2);
    const ack1 = JSON.parse(mediaWs.sentMessages[1]);
    expect(ack1).toEqual({
      kind: "frameAck",
      subscriptionEpoch: "sub-epoch-uuid-1",
      producerRun: "fedcba98-7654-4321-8901-abcdef012345",
      viewportEpoch: "1",
      frameSeq: "1",
      decodeMs: expect.any(Number),
    });

    // Frame 3 should now start decoding
    expect(decodeCount).toBe(2);

    const close3 = vi.fn();
    resolveDecode3!({
      width: 640,
      height: 480,
      close: close3,
    } as unknown as ImageBitmap);

    await Promise.resolve();
    await Promise.resolve();

    // Frame 3 should be drawn and ACKed
    expect(mediaWs.sentMessages.length).toBe(3);
    const ack3 = JSON.parse(mediaWs.sentMessages[2]);
    expect(ack3.frameSeq).toBe("3");
    expect(ack3.kind).toBe("frameAck");
  });

  it("synchronously clears canvas and fences late decodes on privacy activation", async () => {
    let resolveDelayedDecode: ((bitmap: ImageBitmap) => void) | null = null;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockImplementation(() => {
        const { promise, resolve } = Promise.withResolvers<ImageBitmap>();
        resolveDelayedDecode = resolve;
        return promise;
      }),
    );

    controller.attach(mockCreds);
    const mediaWs = MockWebSocket.instances[0];

    const jpeg = createMockJpeg(640, 480);
    const frame = packBhjfFrame(makeHeader("1"), jpeg);

    // Send frame -> starts decode
    mediaWs.onmessage?.(new MessageEvent("message", { data: frame.buffer }));

    // Activate privacy mode BEFORE decode resolves
    const fillRectSpy = vi.spyOn(ctx, "fillRect");
    controller.setPrivacyMode(true);

    expect(controller.getStatus()).toBe("privacy");
    expect(fillRectSpy).toHaveBeenCalledWith(0, 0, 640, 480);

    // Now resolve the late decode
    const closeBitmap = vi.fn();
    resolveDelayedDecode!({
      width: 640,
      height: 480,
      close: closeBitmap,
    } as unknown as ImageBitmap);

    await Promise.resolve();
    await Promise.resolve();

    // Must close bitmap and never send on closed socket per contract §7
    expect(closeBitmap).toHaveBeenCalled();
    expect(mediaWs.readyState).toBe(MockWebSocket.CLOSED);
    expect(mediaWs.sentMessages.length).toBe(0);
  });

  it("handles pause and visibility changes", () => {
    controller.attach(mockCreds);
    const mediaWs = MockWebSocket.instances[0];
    mediaWs.onopen?.();

    controller.setVisibility(false);
    expect(controller.getStatus()).toBe("paused");
    expect(mediaWs.sentMessages.length).toBe(1);
    const pauseMsg = JSON.parse(mediaWs.sentMessages[0]);
    expect(pauseMsg).toEqual({
      kind: "pause",
      subscriptionEpoch: "sub-epoch-uuid-1",
    });

    expect(mediaWs.readyState).toBe(MockWebSocket.CLOSED);
    controller.setVisibility(true);
    // Resuming from hidden/paused detaches sockets and requires fresh attachment per C2
    expect(controller.getStatus()).toBe("disconnected");
  });
  it("preserves inputTrusted, viewportEpoch, and geometry across redrawCachedFrame", async () => {
    const fakeBitmap = {
      width: 640,
      height: 480,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn(async () => fakeBitmap));

    controller.attach(mockCreds);
    const mediaWs = MockWebSocket.instances[0];
    mediaWs.onopen?.();

    const header = {
      ...makeHeader("1"),
      viewportEpoch: "7",
      inputTrusted: true,
    };
    const frame = packBhjfFrame(header, createMockJpeg(640, 480));
    mediaWs.onmessage?.({ data: frame.buffer } as MessageEvent);
    await vi.waitFor(() => {
      expect(controller.getDrawnRect()).not.toBeNull();
    });
    expect(controller.getDrawnRect()?.inputTrusted).toBe(true);

    // Resize canvas and redraw cached frame (e.g. selection panel opens on static page)
    canvas.width = 640;
    canvas.height = 360;
    controller.redrawCachedFrame();

    const redrawn = controller.getDrawnRect();
    expect(redrawn).not.toBeNull();
    expect(redrawn?.inputTrusted).toBe(true);
    expect(redrawn?.viewportEpoch).toBe("7");
  });

  it.each([
    { localDpr: 1, remoteDpr: 2 },
    { localDpr: 1.5, remoteDpr: 1 },
    { localDpr: 2, remoteDpr: 1.5 },
  ])("maps displayed JPEG coordinates through letterboxing and resize at DPR $localDpr/$remoteDpr", async ({ localDpr, remoteDpr }) => {
    const bitmap = {
      width: 640,
      height: 480,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    let displayWidth = 400;
    let displayHeight = 300;
    vi.spyOn(canvas, "getBoundingClientRect").mockImplementation(() => ({
      left: 100, top: 50,
      width: displayWidth, height: displayHeight,
      right: 100 + displayWidth, bottom: 50 + displayHeight,
      x: 100, y: 50, toJSON: () => {},
    }));
    canvas.width = displayWidth * localDpr;
    canvas.height = displayHeight * localDpr;
    controller.attach(mockCreds);
    const mediaWs = MockWebSocket.instances[0];
    const header = makeHeader("1");
    // JPEG resolution and both devices' DPR are independent of the CSS input viewport.
    header.geometry = {
      ...header.geometry, cssWidth: 1280, cssHeight: 960, dpr: remoteDpr,
    };
    const frame = packBhjfFrame(header, createMockJpeg(640, 480));
    mediaWs.onmessage?.({ data: frame.buffer } as MessageEvent);
    await vi.waitFor(() => expect(controller.getDrawnRect()).not.toBeNull());

    const input = new BrowserInputController({
      getSessionId: () => header.browserSessionId,
      getIncarnation: () => header.browserIncarnation,
      getProfileEpoch: () => 1,
      getSubscriptionEpoch: () => mockCreds.subscriptionEpoch,
      getLeaseToken: () => "lease",
      getViewportEpoch: () => 1,
      getDrawnRect: () => controller.getDrawnRect(),
      getControlSocket: () => controller.getControlSocket(),
    });
    expect(input.mapClientToFractions(400, 125, canvas)).toEqual({ u: 0.75, v: 0.25 });

    // A wider canvas adds side bars, without changing the target's CSS viewport.
    displayWidth = 600;
    canvas.width = displayWidth * localDpr;
    controller.redrawCachedFrame();
    expect(input.mapClientToFractions(500, 125, canvas)).toEqual({ u: 0.75, v: 0.25 });
    expect(input.mapClientToFractions(200, 50, canvas)).toEqual({ u: 0, v: 0 });
    expect(input.mapClientToFractions(600, 350, canvas)).toEqual({ u: 1, v: 1 });
    expect(input.mapClientToFractions(150, 200, canvas)).toBeNull();
    expect(input.mapClientToFractions(650, 200, canvas)).toBeNull();

    // A taller canvas adds top/bottom bars. Pointer dispatch uses the redrawn image rect.
    displayWidth = 300;
    displayHeight = 400;
    canvas.width = displayWidth * localDpr;
    canvas.height = displayHeight * localDpr;
    controller.redrawCachedFrame();
    expect(input.mapClientToFractions(325, 193.75, canvas)).toEqual({ u: 0.75, v: 0.25 });
    expect(input.mapClientToFractions(100, 137.5, canvas)).toEqual({ u: 0, v: 0 });
    expect(input.mapClientToFractions(400, 362.5, canvas)).toEqual({ u: 1, v: 1 });
    expect(input.mapClientToFractions(250, 100, canvas)).toBeNull();
    expect(input.mapClientToFractions(250, 390, canvas)).toBeNull();
    expect(controller.getDrawnRect()?.geometry).toEqual(header.geometry);
    expect(input.handlePointerDown({
      currentTarget: canvas, clientX: 325, clientY: 193.75, button: 0,
      altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    } as unknown as PointerEvent)).toBe(true);
    const controlWs = MockWebSocket.instances[1];
    expect(JSON.parse(controlWs.sentMessages.at(-1)!)).toMatchObject({
      viewportEpoch: 1,
      event: { kind: "pointerDown", button: "left", u: 0.75, v: 0.25 },
    });
    input.dispose();
  });

  it("cleans up on dispose", () => {
    controller.attach(mockCreds);
    const mediaWs = MockWebSocket.instances[0];
    expect(mediaWs.readyState).toBe(MockWebSocket.OPEN);

    controller.dispose();
    expect(controller.getStatus()).toBe("disconnected");
    expect(mediaWs.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("delivers validated current-run audioChunk messages after frame authority and resets on sequence gaps or retirement", async () => {
    const onAudioChunk = vi.fn();
    const onAudioReset = vi.fn();
    controller.dispose();
    controller = new BrowserStreamController({
      canvas,
      onAudioChunk,
      onAudioReset,
    });
    controller.attach(mockCreds);
    const mediaWs = MockWebSocket.instances[0];
    mediaWs.onopen?.();
    onAudioReset.mockClear();

    const validPcmB64 = btoa(String.fromCharCode(0x10, 0x20, 0x30, 0x40));
    const makeAudioMsg = (overrides: Record<string, unknown> = {}) =>
      JSON.stringify({
        kind: "audioChunk",
        browserSessionId: mockCreds.browserSessionId,
        browserIncarnation: mockCreds.browserIncarnation,
        profileEpoch: "1",
        producerRun: "fedcba98-7654-4321-8901-abcdef012345",
        subscriptionEpoch: mockCreds.subscriptionEpoch,
        docEpoch: "1",
        audioSeq: "1",
        sampleRate: 24000,
        channels: 1,
        encoding: "pcm16le",
        data: validPcmB64,
        ...overrides,
      });

    // 1. Audio arriving before validated BHJF frame establishes producerRun is ignored
    mediaWs.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ audioSeq: "1" }) }));
    expect(onAudioChunk).not.toHaveBeenCalled();

    // 2. Valid BHJF frame establishes currentProducerRun
    const jpeg = createMockJpeg(640, 480);
    const frame1 = packBhjfFrame(makeHeader("1"), jpeg);
    mediaWs.onmessage?.(new MessageEvent("message", { data: frame1.buffer }));

    // 3. Valid audioChunk for current run is delivered
    mediaWs.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ audioSeq: "1" }) }));
    expect(onAudioChunk).toHaveBeenCalledTimes(1);
    expect(onAudioChunk.mock.calls[0][0]).toMatchObject({
      kind: "audioChunk",
      audioSeq: "1",
      sampleRate: 24000,
      channels: 1,
      encoding: "pcm16le",
    });

    // 4. Duplicate or out-of-order audioSeq is dropped without resetting
    mediaWs.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ audioSeq: "1" }) }));
    expect(onAudioChunk).toHaveBeenCalledTimes(1);
    expect(onAudioReset).not.toHaveBeenCalled();

    // 5. Sequence gap (1 -> 3) triggers synchronous onAudioReset before delivering fresh chunk
    mediaWs.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ audioSeq: "3" }) }));
    expect(onAudioReset).toHaveBeenCalledTimes(1);
    expect(onAudioChunk).toHaveBeenCalledTimes(2);

    // 6. Foreign subscription, wrong session, malformed JSON, or odd-byte base64 are ignored and never affect video credits
    mediaWs.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ audioSeq: "4", subscriptionEpoch: "foreign" }) }));
    mediaWs.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ audioSeq: "4", sampleRate: 48000 }) }));
    mediaWs.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ audioSeq: "4", data: btoa("odd") }) }));
    mediaWs.onmessage?.(new MessageEvent("message", { data: "{malformed" }));
    expect(onAudioChunk).toHaveBeenCalledTimes(2);

    // 7. Producer run change flushes audio and retires the old run
    onAudioReset.mockClear();
    const nextRun = "11111111-2222-4333-8444-555555555555";
    const frameNextRun = packBhjfFrame({ ...makeHeader("2"), producerRun: nextRun }, jpeg);
    mediaWs.onmessage?.(new MessageEvent("message", { data: frameNextRun.buffer }));
    expect(onAudioReset).toHaveBeenCalledTimes(1);

    // Old run audio is rejected
    mediaWs.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ audioSeq: "4" }) }));
    expect(onAudioChunk).toHaveBeenCalledTimes(2);

    // New run audio starting at seq 1 is accepted
    mediaWs.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ producerRun: nextRun, audioSeq: "1" }) }));
    expect(onAudioChunk).toHaveBeenCalledTimes(3);

    // 8. Privacy and visibility false synchronously reset audio without blacklisting live producerRun on reattach
    onAudioReset.mockClear();
    controller.setPrivacyMode(true);
    expect(onAudioReset).toHaveBeenCalled();
    controller.setPrivacyMode(false);

    const reattachedCreds = {
      ...mockCreds,
      subscriptionEpoch: "sub-epoch-reattached-2",
    };
    controller.attach(reattachedCreds);
    const mediaWs2 = MockWebSocket.instances[2];
    mediaWs2.onopen?.();

    // Frame with wrong profileEpoch is rejected with ownerChanged and does not establish producerRun
    const badEpochFrame = packBhjfFrame({ ...makeHeader("3"), producerRun: nextRun, profileEpoch: "99" }, jpeg);
    mediaWs2.onmessage?.(new MessageEvent("message", { data: badEpochFrame.buffer }));
    mediaWs2.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ producerRun: nextRun, subscriptionEpoch: reattachedCreds.subscriptionEpoch, audioSeq: "2" }) }));
    expect(onAudioChunk).toHaveBeenCalledTimes(3);

    // Frame with valid profileEpoch and SAME live producerRun (kept alive by another viewer) restores audio authority
    const validReattachFrame = packBhjfFrame({ ...makeHeader("4"), producerRun: nextRun }, jpeg);
    mediaWs2.onmessage?.(new MessageEvent("message", { data: validReattachFrame.buffer }));
    mediaWs2.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ producerRun: nextRun, subscriptionEpoch: reattachedCreds.subscriptionEpoch, audioSeq: "2" }) }));
    expect(onAudioChunk).toHaveBeenCalledTimes(4);

    // 9. Navigation resetAudioAuthority(navRev) is idempotent across repeated calls (store listener + control callback + layout effect)
    //    and fences queued old-document PCM even after a queued same-run BHJF frame arrives
    onAudioReset.mockClear();
    controller.resetAudioAuthority("2");
    controller.resetAudioAuthority("2");
    controller.resetAudioAuthority("2");
    expect(onAudioReset).toHaveBeenCalledTimes(1);
    // Queued pre-navigation BHJF frame arrives after resetAudioAuthority(): video continues and restores run authority
    const queuedPreNavFrame = packBhjfFrame({ ...makeHeader("5"), producerRun: nextRun }, jpeg);
    mediaWs2.onmessage?.(new MessageEvent("message", { data: queuedPreNavFrame.buffer }));
    // Missing docEpoch is rejected
    const noDocEpoch = JSON.parse(makeAudioMsg({ producerRun: nextRun, subscriptionEpoch: reattachedCreds.subscriptionEpoch, audioSeq: "3" })) as Record<string, unknown>;
    delete noDocEpoch.docEpoch;
    mediaWs2.onmessage?.(new MessageEvent("message", { data: JSON.stringify(noDocEpoch) }));
    expect(onAudioChunk).toHaveBeenCalledTimes(4);
    // Previously unseen pre-navigation audioChunk (audioSeq: "3", docEpoch: "1") arriving AFTER the BHJF frame is still rejected!
    mediaWs2.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ producerRun: nextRun, subscriptionEpoch: reattachedCreds.subscriptionEpoch, docEpoch: "1", audioSeq: "3" }) }));
    expect(onAudioChunk).toHaveBeenCalledTimes(4);
    // Post-navigation audioChunk with advanced docEpoch ("2") and monotonic audioSeq ("4") is accepted
    mediaWs2.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ producerRun: nextRun, subscriptionEpoch: reattachedCreds.subscriptionEpoch, docEpoch: "2", audioSeq: "4" }) }));
    expect(onAudioChunk).toHaveBeenCalledTimes(5);

    // 9b. Media-before-control ordering: new-document audio (docEpoch: "3") arrives BEFORE control resetAudioAuthority("3")
    onAudioReset.mockClear();
    mediaWs2.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ producerRun: nextRun, subscriptionEpoch: reattachedCreds.subscriptionEpoch, docEpoch: "3", audioSeq: "5" }) }));
    expect(onAudioReset).toHaveBeenCalledTimes(1);
    expect(onAudioChunk).toHaveBeenCalledTimes(6);
    onAudioReset.mockClear();
    controller.resetAudioAuthority("3");
    expect(onAudioReset).not.toHaveBeenCalled();
    mediaWs2.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ producerRun: nextRun, subscriptionEpoch: reattachedCreds.subscriptionEpoch, docEpoch: "3", audioSeq: "6" }) }));
    expect(onAudioChunk).toHaveBeenCalledTimes(7);

    // 9c. Silent intermediate document (doc 3 -> doc 4 silent -> doc 5) retires doc 4 and admits doc 5
    controller.resetAudioAuthority("4");
    controller.resetAudioAuthority("5");
    const postNavFrame5 = packBhjfFrame({ ...makeHeader("6"), producerRun: nextRun }, jpeg);
    mediaWs2.onmessage?.(new MessageEvent("message", { data: postNavFrame5.buffer }));
    mediaWs2.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ producerRun: nextRun, subscriptionEpoch: reattachedCreds.subscriptionEpoch, docEpoch: "4", audioSeq: "7" }) }));
    expect(onAudioChunk).toHaveBeenCalledTimes(7);
    mediaWs2.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ producerRun: nextRun, subscriptionEpoch: reattachedCreds.subscriptionEpoch, docEpoch: "5", audioSeq: "8" }) }));
    expect(onAudioChunk).toHaveBeenCalledTimes(8);

    // 10. Control socket close permanently retires audio attachment authority even if media frames continue
    const controlWs2 = MockWebSocket.instances[3];
    onAudioReset.mockClear();
    controlWs2.onclose?.();
    expect(onAudioReset).toHaveBeenCalledTimes(1);
    const frameAfterControlClose = packBhjfFrame({ ...makeHeader("7"), producerRun: nextRun }, jpeg);
    mediaWs2.onmessage?.(new MessageEvent("message", { data: frameAfterControlClose.buffer }));
    mediaWs2.onmessage?.(new MessageEvent("message", { data: makeAudioMsg({ producerRun: nextRun, subscriptionEpoch: reattachedCreds.subscriptionEpoch, docEpoch: "5", audioSeq: "9" }) }));
    expect(onAudioChunk).toHaveBeenCalledTimes(8);
  });

  it("attaches bounded decodeMs to frameAck, aggregates heartbeat telemetry, and resets on identity changes", async () => {
    vi.useFakeTimers();
    let resolveDecode1: ((bitmap: ImageBitmap) => void) | null = null;
    let resolveDecode3: ((bitmap: ImageBitmap) => void) | null = null;
    let callIdx = 0;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockImplementation(() => {
        callIdx += 1;
        const { promise, resolve } = Promise.withResolvers<ImageBitmap>();
        if (callIdx === 1) {
          resolveDecode1 = resolve;
        } else {
          resolveDecode3 = resolve;
        }
        return promise;
      }),
    );

    controller.attach(mockCreds);
    const mediaWs = MockWebSocket.instances[0];
    mediaWs.onopen?.();

    const jpeg = createMockJpeg(640, 480);
    const frame1 = packBhjfFrame(makeHeader("1"), jpeg);
    const frame2 = packBhjfFrame(makeHeader("2"), jpeg);
    const frame3 = packBhjfFrame(makeHeader("3"), jpeg);
    const wrongOwnerFrame = packBhjfFrame(
      { ...makeHeader("4"), profileEpoch: "99" },
      jpeg,
    );

    // Frame 1 starts decoding; Frame 2 queues as pending; Frame 3 replaces Frame 2 (congestion replacement)
    mediaWs.onmessage?.(new MessageEvent("message", { data: frame1.buffer }));
    mediaWs.onmessage?.(new MessageEvent("message", { data: frame2.buffer }));
    mediaWs.onmessage?.(new MessageEvent("message", { data: frame3.buffer }));
    // Non-congestion ownerChanged discard must NOT increment replacedFrames
    mediaWs.onmessage?.(
      new MessageEvent("message", { data: wrongOwnerFrame.buffer }),
    );

    vi.advanceTimersByTime(12);
    resolveDecode1!({
      width: 640,
      height: 480,
      close: vi.fn(),
    } as unknown as ImageBitmap);
    await Promise.resolve();
    await Promise.resolve();

    vi.advanceTimersByTime(8);
    resolveDecode3!({
      width: 640,
      height: 480,
      close: vi.fn(),
    } as unknown as ImageBitmap);
    await Promise.resolve();
    await Promise.resolve();

    const snapBeforeHb = controller.getTelemetrySnapshot();
    expect(snapBeforeHb.windowDecodedFrames).toBe(2);
    expect(snapBeforeHb.windowReplacedFrames).toBe(1);
    expect(snapBeforeHb.lastDecodeMs).toBeGreaterThanOrEqual(0);
    expect(snapBeforeHb.decodeMsEwma).toBeGreaterThanOrEqual(0);

    // Trigger 5s heartbeat and verify bounded telemetry payload
    vi.advanceTimersByTime(5000);
    const hbMsg = mediaWs.sentMessages
      .map((raw) => JSON.parse(raw))
      .find((m) => m.kind === "heartbeat");
    expect(hbMsg).toEqual({
      kind: "heartbeat",
      subscriptionEpoch: "sub-epoch-uuid-1",
      visible: true,
      telemetry: {
        sampleMs: expect.any(Number),
        decodedFrames: 2,
        replacedFrames: 1,
        decodeMsEwma: expect.any(Number),
      },
    });
    expect(hbMsg.telemetry.sampleMs).toBeGreaterThan(0);
    expect(hbMsg.telemetry.sampleMs).toBeLessThanOrEqual(60_000);

    // Window counters reset after heartbeat while EWMA persists until run/owner rotation
    const snapAfterHb = controller.getTelemetrySnapshot();
    expect(snapAfterHb.windowDecodedFrames).toBe(0);
    expect(snapAfterHb.windowReplacedFrames).toBe(0);
    expect(snapAfterHb.decodeMsEwma).not.toBeNull();

    // Start an in-flight decode and a pending frame on the old run, then rotate producerRun BEFORE decode resolves!
    let resolveStaleRunDecode: ((bitmap: ImageBitmap) => void) | null = null;
    let resolveNewRunDecode: ((bitmap: ImageBitmap) => void) | null = null;
    let runSwitchCall = 0;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockImplementation(() => {
        runSwitchCall += 1;
        const { promise, resolve } = Promise.withResolvers<ImageBitmap>();
        if (runSwitchCall === 1) {
          resolveStaleRunDecode = resolve;
        } else {
          resolveNewRunDecode = resolve;
        }
        return promise;
      }),
    );
    const oldRunActive = packBhjfFrame(makeHeader("5"), jpeg);
    const oldRunPending = packBhjfFrame(makeHeader("6"), jpeg);
    mediaWs.onmessage?.(
      new MessageEvent("message", { data: oldRunActive.buffer }),
    );
    mediaWs.onmessage?.(
      new MessageEvent("message", { data: oldRunPending.buffer }),
    );

    // Rotate producerRun while oldRunActive is decoding and oldRunPending is queued
    const nextRunFrame = packBhjfFrame(
      {
        ...makeHeader("1"),
        producerRun: "11111111-2222-4333-8444-555555555555",
      },
      jpeg,
    );
    mediaWs.onmessage?.(
      new MessageEvent("message", { data: nextRunFrame.buffer }),
    );
    // oldRunPending must be discarded as "obsolete", NOT counted as congestion "replaced"
    const stalePendingDiscard = JSON.parse(mediaWs.sentMessages.at(-1)!);
    expect(stalePendingDiscard).toMatchObject({
      kind: "frameDiscarded",
      frameSeq: "6",
      reason: "obsolete",
    });
    expect(controller.getTelemetrySnapshot().windowReplacedFrames).toBe(0);

    // Resolve stale old-run active decode: must be discarded as "obsolete" and MUST NOT contaminate new-run telemetry!
    const closeStale = vi.fn();
    resolveStaleRunDecode!({
      width: 640,
      height: 480,
      close: closeStale,
    } as unknown as ImageBitmap);
    await Promise.resolve();
    await Promise.resolve();
    expect(closeStale).toHaveBeenCalled();
    expect(controller.getTelemetrySnapshot()).toEqual({
      windowDecodedFrames: 0,
      windowReplacedFrames: 0,
      totalDecodedFrames: 0,
      totalReplacedFrames: 0,
      lastDecodeMs: null,
      decodeMsEwma: null,
    });

    // Resolve new-run pending frame that drained after old-run finished
    resolveNewRunDecode!({
      width: 640,
      height: 480,
      close: vi.fn(),
    } as unknown as ImageBitmap);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getTelemetrySnapshot().windowDecodedFrames).toBe(1);
    vi.useRealTimers();
  });

  it("enforces MediaClientControl validator bounds and <=1KiB cap", () => {
    const maxValidAck = {
      kind: "frameAck" as const,
      subscriptionEpoch: "s".repeat(128),
      producerRun: "fedcba98-7654-4321-8901-abcdef012345",
      viewportEpoch: "18446744073709551615",
      frameSeq: "18446744073709551615",
      reason: "r".repeat(64),
      decodeMs: MAX_CLIENT_DECODE_MS,
    };
    expect(isValidMediaClientControl(maxValidAck)).toBe(true);
    expect(
      new TextEncoder().encode(JSON.stringify(maxValidAck)).byteLength,
    ).toBeLessThanOrEqual(MAX_MEDIA_CONTROL_BYTES);

    const maxValidHeartbeat = {
      kind: "heartbeat" as const,
      subscriptionEpoch: "s".repeat(128),
      visible: true,
      telemetry: {
        sampleMs: MAX_HEARTBEAT_SAMPLE_MS,
        decodedFrames: MAX_HEARTBEAT_FRAME_COUNT,
        replacedFrames: MAX_HEARTBEAT_FRAME_COUNT,
        decodeMsEwma: MAX_CLIENT_DECODE_MS,
      },
    };
    expect(isValidMediaClientControl(maxValidHeartbeat)).toBe(true);
    expect(
      new TextEncoder().encode(JSON.stringify(maxValidHeartbeat)).byteLength,
    ).toBeLessThanOrEqual(MAX_MEDIA_CONTROL_BYTES);

    // Reject NaN, Infinity, negative, overflow, fractional integers, and unknown keys
    expect(
      isValidMediaClientControl({ ...maxValidAck, decodeMs: Number.NaN }),
    ).toBe(false);
    expect(
      isValidMediaClientControl({
        ...maxValidAck,
        decodeMs: Number.POSITIVE_INFINITY,
      }),
    ).toBe(false);
    expect(isValidMediaClientControl({ ...maxValidAck, decodeMs: -0.01 })).toBe(
      false,
    );
    expect(
      isValidMediaClientControl({
        ...maxValidAck,
        decodeMs: MAX_CLIENT_DECODE_MS + 0.01,
      }),
    ).toBe(false);
    expect(
      isValidMediaClientControl({
        ...maxValidHeartbeat,
        telemetry: {
          ...maxValidHeartbeat.telemetry,
          sampleMs: MAX_HEARTBEAT_SAMPLE_MS + 1,
        },
      }),
    ).toBe(false);
    expect(
      isValidMediaClientControl({
        ...maxValidHeartbeat,
        telemetry: { ...maxValidHeartbeat.telemetry, decodedFrames: 1.5 },
      }),
    ).toBe(false);
    expect(
      isValidMediaClientControl({
        ...maxValidHeartbeat,
        telemetry: {
          ...maxValidHeartbeat.telemetry,
          extraField: 1,
        } as unknown as typeof maxValidHeartbeat.telemetry,
      }),
    ).toBe(false);
    expect(
      isValidMediaClientControl({
        kind: "frameDiscarded",
        subscriptionEpoch: "sub-1",
        producerRun: "fedcba98-7654-4321-8901-abcdef012345",
        viewportEpoch: "1",
        frameSeq: "1",
        reason: "toString" as unknown as "replaced",
      }),
    ).toBe(false);
  });

  it("parses BHJF header once per incoming frame even when queued as pending", async () => {
    let resolveDecode1: ((bitmap: ImageBitmap) => void) | null = null;
    let resolveDecode2: ((bitmap: ImageBitmap) => void) | null = null;
    let decodeCall = 0;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockImplementation(() => {
        decodeCall += 1;
        const { promise, resolve } = Promise.withResolvers<ImageBitmap>();
        if (decodeCall === 1) {
          resolveDecode1 = resolve;
        } else {
          resolveDecode2 = resolve;
        }
        return promise;
      }),
    );

    const jsonParseSpy = vi.spyOn(JSON, "parse");
    controller.attach(mockCreds);
    const mediaWs = MockWebSocket.instances[0];
    mediaWs.onopen?.();

    const jpeg = createMockJpeg(640, 480);
    const frame1 = packBhjfFrame(makeHeader("1"), jpeg);
    const frame2 = packBhjfFrame(makeHeader("2"), jpeg);

    jsonParseSpy.mockClear();
    mediaWs.onmessage?.(new MessageEvent("message", { data: frame1.buffer }));
    mediaWs.onmessage?.(new MessageEvent("message", { data: frame2.buffer }));

    // Exactly 2 JSON.parse calls (one per incoming binary message), never re-parsed during decode/drain
    expect(jsonParseSpy).toHaveBeenCalledTimes(2);

    resolveDecode1!({
      width: 640,
      height: 480,
      close: vi.fn(),
    } as unknown as ImageBitmap);
    await Promise.resolve();
    await Promise.resolve();

    resolveDecode2!({
      width: 640,
      height: 480,
      close: vi.fn(),
    } as unknown as ImageBitmap);
    await Promise.resolve();
    await Promise.resolve();

    expect(jsonParseSpy).toHaveBeenCalledTimes(2);
  });

  it("reports unsupported/error and discards without frameAck or trusted hit rectangle when createImageBitmap is absent or draw fails", async () => {
    const statuses: string[] = [];
    const errors: Error[] = [];
    const onPresentFrame = vi.fn();
    controller.dispose();
    controller = new BrowserStreamController({
      canvas,
      onStatusChange: (s) => statuses.push(s),
      onError: (e) => errors.push(e),
      onPresentFrame,
    });

    // 1. Absent createImageBitmap -> unsupported status + decodeFailed discard + null drawnRect
    vi.stubGlobal("createImageBitmap", undefined);
    controller.attach(mockCreds);
    const mediaWs = MockWebSocket.instances[0];
    mediaWs.onopen?.();

    const jpeg = createMockJpeg(640, 480);
    const frame1 = packBhjfFrame(makeHeader("1"), jpeg);
    mediaWs.onmessage?.(new MessageEvent("message", { data: frame1.buffer }));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getStatus()).toBe("unsupported");
    expect(controller.getDrawnRect()).toBeNull();
    expect(onPresentFrame).not.toHaveBeenCalled();
    expect(controller.getTelemetrySnapshot().totalDecodedFrames).toBe(0);
    expect(JSON.parse(mediaWs.sentMessages.at(-1)!)).toEqual({
      kind: "frameDiscarded",
      subscriptionEpoch: "sub-epoch-uuid-1",
      producerRun: "fedcba98-7654-4321-8901-abcdef012345",
      viewportEpoch: "1",
      frameSeq: "1",
      reason: "decodeFailed",
    });

    // 2. Throwing drawImage -> error status + bitmap closed + decodeFailed discard + null drawnRect
    const closeSpy = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockImplementation(async () => ({
        width: 640,
        height: 480,
        close: closeSpy,
      })),
    );
    vi.spyOn(ctx, "drawImage").mockImplementation(() => {
      throw new Error("GPU context lost");
    });

    const frame2 = packBhjfFrame(makeHeader("2"), jpeg);
    mediaWs.onmessage?.(new MessageEvent("message", { data: frame2.buffer }));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getStatus()).toBe("error");
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(controller.getDrawnRect()).toBeNull();
    expect(onPresentFrame).not.toHaveBeenCalled();
    expect(controller.getTelemetrySnapshot().totalDecodedFrames).toBe(0);
    expect(JSON.parse(mediaWs.sentMessages.at(-1)!)).toEqual({
      kind: "frameDiscarded",
      subscriptionEpoch: "sub-epoch-uuid-1",
      producerRun: "fedcba98-7654-4321-8901-abcdef012345",
      viewportEpoch: "1",
      frameSeq: "2",
      reason: "decodeFailed",
    });

    // 3. Zero-sized canvas -> error status + decodeFailed discard + null drawnRect
    vi.spyOn(ctx, "drawImage").mockImplementation(() => {});
    canvas.width = 0;
    canvas.height = 0;
    const frame3 = packBhjfFrame(makeHeader("3"), jpeg);
    mediaWs.onmessage?.(new MessageEvent("message", { data: frame3.buffer }));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getDrawnRect()).toBeNull();
    expect(JSON.parse(mediaWs.sentMessages.at(-1)!)).toMatchObject({
      kind: "frameDiscarded",
      frameSeq: "3",
      reason: "decodeFailed",
    });
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
  it("fences decode failure: stale-socket decode failure leaves status/hit rect/onError untouched while discarding on originating socket, and current-owner failure reports error and clears hit geometry", async () => {
    const statuses: StreamStatus[] = [];
    const errors: Error[] = [];
    controller = new BrowserStreamController({
      canvas,
      onStatusChange: (s) => statuses.push(s),
      onError: (e) => errors.push(e),
    });

    // 1. Establish valid streaming session and non-null hit geometry
    controller.attach(mockCreds);
    const mediaWs1 = MockWebSocket.instances[0];
    mediaWs1.onopen?.();
    expect(controller.getStatus()).toBe("streaming");

    const jpeg = createMockJpeg(640, 480);
    const frame1 = packBhjfFrame(makeHeader("1"), jpeg);
    mediaWs1.onmessage?.(new MessageEvent("message", { data: frame1.buffer }));
    await Promise.resolve();
    await Promise.resolve();

    const initialDrawnRect = controller.getDrawnRect();
    expect(initialDrawnRect).not.toBeNull();
    expect(errors.length).toBe(0);

    // 2. Queue in-flight decode for frame 2 on socket 1
    let rejectDecodeFrame2: ((err: Error) => void) | null = null;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockImplementation(() => {
        const { promise, reject } = Promise.withResolvers<ImageBitmap>();
        rejectDecodeFrame2 = reject;
        return promise;
      }),
    );

    const frame2 = packBhjfFrame(makeHeader("2"), jpeg);
    mediaWs1.onmessage?.(new MessageEvent("message", { data: frame2.buffer }));

    // 3. Reattach with new subscription epoch to make socket 1 stale
    const mockCreds2: ViewerAttachmentCredentials = {
      ...mockCreds,
      subscriptionEpoch: "sub-epoch-uuid-2",
      mediaTicket: "med-tok-2",
      controlTicket: "ctrl-tok-2",
    };
    controller.attach(mockCreds2);
    const mediaWs2 = MockWebSocket.instances[2];
    // Keep socket 1 open so discard delivery on originating socket can be observed
    mediaWs1.readyState = MockWebSocket.OPEN;
    mediaWs2.onopen?.();

    expect(controller.getStatus()).toBe("streaming");
    expect(controller.getDrawnRect()).toEqual(initialDrawnRect);

    // 4. Reject decode for frame 2 on now-stale socket 1
    expect(rejectDecodeFrame2).not.toBeNull();
    rejectDecodeFrame2!(new Error("Corrupt jpeg on stale socket 1"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Verify stale socket failure leaves status, hit rect, and onError untouched
    expect(errors.length).toBe(0);
    expect(controller.getStatus()).toBe("streaming");
    expect(controller.getDrawnRect()).toEqual(initialDrawnRect);

    // Verify originating socket 1 received the decodeFailed discard
    const staleDiscardMsg = JSON.parse(mediaWs1.sentMessages.at(-1)!);
    expect(staleDiscardMsg).toEqual({
      kind: "frameDiscarded",
      subscriptionEpoch: "sub-epoch-uuid-1",
      producerRun: "fedcba98-7654-4321-8901-abcdef012345",
      viewportEpoch: "1",
      frameSeq: "2",
      reason: "decodeFailed",
    });

    // 5. Test current-owner failure on socket 2: reports error and clears hit geometry
    let rejectDecodeFrame3: ((err: Error) => void) | null = null;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockImplementation(() => {
        const { promise, reject } = Promise.withResolvers<ImageBitmap>();
        rejectDecodeFrame3 = reject;
        return promise;
      }),
    );

    const frame3 = packBhjfFrame(makeHeader("3"), jpeg);
    mediaWs2.onmessage?.(new MessageEvent("message", { data: frame3.buffer }));

    expect(rejectDecodeFrame3).not.toBeNull();
    rejectDecodeFrame3!(new Error("Corrupt jpeg on current owner socket 2"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("Corrupt jpeg on current owner socket 2");
    expect(controller.getStatus()).toBe("error");
    expect(controller.getDrawnRect()).toBeNull();

    const currentDiscardMsg = JSON.parse(mediaWs2.sentMessages.at(-1)!);
    expect(currentDiscardMsg).toEqual({
      kind: "frameDiscarded",
      subscriptionEpoch: "sub-epoch-uuid-2",
      producerRun: "fedcba98-7654-4321-8901-abcdef012345",
      viewportEpoch: "1",
      frameSeq: "3",
      reason: "decodeFailed",
    });
  });


  it("paces high-rate pointerMove and wheel bursts to <=40 Hz while immediately flushing before discrete pointerUp/keyDown", async () => {
    vi.useFakeTimers();
    vi.spyOn(canvas, "getBoundingClientRect").mockImplementation(() => ({
      left: 0,
      top: 0,
      width: 640,
      height: 480,
      right: 640,
      bottom: 480,
      x: 0,
      y: 0,
      toJSON: () => {},
    }));
    canvas.width = 640;
    canvas.height = 480;
    controller.attach(mockCreds);
    const mediaWs = MockWebSocket.instances[0];
    const controlWs = MockWebSocket.instances[1];
    mediaWs.onopen?.();
    controlWs.onopen?.();

    const header = makeHeader("1");
    const frame = packBhjfFrame(header, createMockJpeg(640, 480));
    mediaWs.onmessage?.(new MessageEvent("message", { data: frame.buffer }));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getDrawnRect()).not.toBeNull();

    let currentLease: string | null = "lease-1";
    const input = new BrowserInputController({
      getSessionId: () => header.browserSessionId,
      getIncarnation: () => header.browserIncarnation,
      getProfileEpoch: () => 1,
      getSubscriptionEpoch: () => mockCreds.subscriptionEpoch,
      getLeaseToken: () => currentLease,
      getViewportEpoch: () => 1,
      getDrawnRect: () => controller.getDrawnRect(),
      getControlSocket: () => controller.getControlSocket(),
    });

    // 1. Burst 200 pointerMove events over 250ms (800Hz raw input rate)
    for (let i = 1; i <= 200; i++) {
      input.handlePointerMove({
        currentTarget: canvas,
        clientX: Math.min(639, i * 3),
        clientY: 240,
        button: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      });
      if (i % 20 === 0) {
        await vi.advanceTimersByTimeAsync(25);
      }
    }
    await vi.advanceTimersByTimeAsync(30);

    const sentMoves = controlWs.sentMessages.map((m) => JSON.parse(m));
    // At 25ms min spacing over ~250ms, at most ~12 messages are sent (<=40/s cadence)
    expect(sentMoves.length).toBeGreaterThanOrEqual(7);
    expect(sentMoves.length).toBeLessThanOrEqual(13);
    sentMoves.forEach((msg, idx) => {
      expect(msg.inputSeq).toBe(idx + 1);
      expect(msg.event.kind).toBe("pointerMove");
    });
    // Latest coordinates are preserved in the final coalesced move
    expect(sentMoves.at(-1)!.event.u).toBeCloseTo(600 / 640, 3);

    // 2. Pending pointerMove immediately flushes BEFORE discrete pointerDown / pointerUp with contiguous inputSeq
    const countBeforeDiscrete = controlWs.sentMessages.length;
    input.handlePointerMove({
      currentTarget: canvas,
      clientX: 160,
      clientY: 120,
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    // Within the 16ms window, the move is still buffered
    expect(controlWs.sentMessages.length).toBe(countBeforeDiscrete);

    // Discrete pointerDown must flush the pending move first, then send pointerDown
    input.handlePointerDown({
      currentTarget: canvas,
      clientX: 320,
      clientY: 240,
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    expect(controlWs.sentMessages.length).toBe(countBeforeDiscrete + 2);
    const flushedMove = JSON.parse(controlWs.sentMessages[countBeforeDiscrete]);
    const discreteDown = JSON.parse(controlWs.sentMessages[countBeforeDiscrete + 1]);
    expect(flushedMove.event).toMatchObject({ kind: "pointerMove", u: 0.25, v: 0.25 });
    expect(discreteDown.event).toMatchObject({ kind: "pointerDown", u: 0.5, v: 0.5 });
    expect(discreteDown.inputSeq).toBe(flushedMove.inputSeq + 1);

    // 3. Wheel burst coalescing sums deltas across the pacing window
    const countBeforeWheel = controlWs.sentMessages.length;
    input.handleWheel({
      currentTarget: canvas,
      clientX: 320,
      clientY: 240,
      deltaX: 5,
      deltaY: 10,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    } as unknown as WheelEvent);
    input.handleWheel({
      currentTarget: canvas,
      clientX: 320,
      clientY: 240,
      deltaX: 7,
      deltaY: 15,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    } as unknown as WheelEvent);
    expect(controlWs.sentMessages.length).toBe(countBeforeWheel);
    await vi.advanceTimersByTimeAsync(25);
    expect(controlWs.sentMessages.length).toBe(countBeforeWheel + 1);
    const wheelMsg = JSON.parse(controlWs.sentMessages.at(-1)!);
    expect(wheelMsg.event).toMatchObject({
      kind: "wheel",
      deltaX: 12,
      deltaY: 25,
      delta_x: 12,
      delta_y: 25,
    });

    // 4. Lease loss cancels pending timer without leaking stale events
    input.handlePointerMove({
      currentTarget: canvas,
      clientX: 100,
      clientY: 100,
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    currentLease = null;
    input.dispose();
    const countAfterDispose = controlWs.sentMessages.length;
    await vi.advanceTimersByTimeAsync(50);
    expect(controlWs.sentMessages.length).toBe(countAfterDispose);
    vi.useRealTimers();
  });

  it("rejects cleartext non-loopback ws:// URLs in attach() before constructing WebSockets", () => {
    const errors: Error[] = [];
    controller.dispose();
    controller = new BrowserStreamController({
      canvas,
      onError: (err) => errors.push(err),
    });

    MockWebSocket.instances = [];
    controller.attach({
      ...mockCreds,
      mediaWsUrl: "ws://192.168.1.99:4801/api/browser/media",
      controlWsUrl: "ws://192.168.1.99:4801/api/browser/control",
    });

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(controller.getStatus()).toBe("error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("wss:// or loopback ws://");
  });
});
