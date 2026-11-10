// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserStreamController } from "./stream-controller.js";
import { BrowserInputController } from "./input-controller.js";
import { packBhjfFrame } from "./frame-protocol.js";
import { createMockJpeg } from "./frame-protocol.test.js";
import type { TargetFrameHeader } from "../api/browser-host-types.js";
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
});
