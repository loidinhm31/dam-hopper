import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasView } from "@/browser-host/canvas-view.js";
import { BrowserStreamController } from "@/browser-host/stream-controller.js";
import {
  packBhjfFrame,
  parseJpegDimensions,
} from "@/browser-host/frame-protocol.js";
import type { TargetFrameHeader } from "@/api/browser-host-types.js";
import type { ViewerAttachmentCredentials } from "@/api/browser-host-client.js";
import "@/index.css";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

async function createRealJpeg(
  width: number,
  height: number,
): Promise<Uint8Array> {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0000ff";
  ctx.fillRect(0, 0, width, height);

  const { promise, resolve } = Promise.withResolvers<Uint8Array>();
  c.toBlob(
    async (blob) => {
      const buf = await blob!.arrayBuffer();
      resolve(new Uint8Array(buf));
    },
    "image/jpeg",
    0.85,
  );
  return promise;
}

describe("host-browser-decoder in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;
  let canvasElement: HTMLCanvasElement | null = null;
  let controller: BrowserStreamController | null = null;

  const makeHeader = (seq: string): TargetFrameHeader => ({
    browserSessionId: "12345678-1234-4234-8234-123456789abc",
    browserIncarnation: "abcdef01-2345-4678-8901-234567890abc",
    profileEpoch: "1",
    producerRun: "fedcba98-7654-4321-8901-abcdef012345",
    viewportEpoch: "1",
    frameSeq: seq,
    width: 320,
    height: 240,
    captureTimeUnixMs: 1700000000000,
    geometry: {
      cssWidth: 320,
      cssHeight: 240,
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

  const creds1: ViewerAttachmentCredentials = {
    owner: { profileId: "profile-1", generation: 1 },
    browserSessionId: "12345678-1234-4234-8234-123456789abc",
    browserIncarnation: "abcdef01-2345-4678-8901-234567890abc",
    profileEpoch: 1,
    viewerId: "viewer-1",
    subscriptionEpoch: "sub-1",
    mediaTicket: "t-1",
    controlTicket: "ct-1",
    mediaWsUrl: "ws://127.0.0.1:4801/api/browser/media",
    controlWsUrl: "ws://127.0.0.1:4801/api/browser/control",
    mediaSubprotocols: ["damhopper.browser.media.v1", "damhopper.ticket.t-1"],
    controlSubprotocols: ["damhopper.browser.control.v1", "damhopper.ticket.ct-1"],
  };

  const creds2: ViewerAttachmentCredentials = {
    owner: { profileId: "profile-1", generation: 1 },
    browserSessionId: "12345678-1234-4234-8234-123456789abc",
    browserIncarnation: "abcdef01-2345-4678-8901-234567890abc",
    profileEpoch: 1,
    viewerId: "viewer-2",
    subscriptionEpoch: "sub-2",
    mediaTicket: "t-2",
    controlTicket: "ct-2",
    mediaWsUrl: "ws://127.0.0.1:4801/api/browser/media",
    controlWsUrl: "ws://127.0.0.1:4801/api/browser/control",
    mediaSubprotocols: ["damhopper.browser.media.v1", "damhopper.ticket.t-2"],
    controlSubprotocols: ["damhopper.browser.control.v1", "damhopper.ticket.ct-2"],
  };

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);

    container = document.createElement("div");
    container.style.width = "640px";
    container.style.height = "480px";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (controller) {
      controller.dispose();
      controller = null;
    }
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("mounts real canvas, decodes BHJF frame, and ACKs captured subscription", async () => {
    act(() => {
      root.render(
        <CanvasView
          ref={(node) => {
            canvasElement = node;
          }}
          controller={null}
        />,
      );
    });

    await vi.waitFor(() => expect(canvasElement).not.toBeNull());
    expect(canvasElement!.tagName.toLowerCase()).toBe("canvas");

    controller = new BrowserStreamController({
      canvas: canvasElement!,
    });

    controller.attach(creds1);
    const mediaWs = MockWebSocket.instances[0];
    mediaWs.onopen?.();

    const jpeg = await createRealJpeg(320, 240);
    const dims = parseJpegDimensions(jpeg);
    expect(dims).toEqual({ width: 320, height: 240 });

    const frame = packBhjfFrame(makeHeader("1"), jpeg);

    // Feed message
    mediaWs.onmessage?.(new MessageEvent("message", { data: frame.buffer }));

    // Wait for frame decode and draw
    await vi.waitFor(() => {
      expect(mediaWs.sentMessages.length).toBe(1);
    });

    const ack = JSON.parse(mediaWs.sentMessages[0]);
    expect(ack).toEqual({
      kind: "frameAck",
      subscriptionEpoch: "sub-1",
      producerRun: "fedcba98-7654-4321-8901-abcdef012345",
      viewportEpoch: "1",
      frameSeq: "1",
      decodeMs: expect.any(Number),
    });

    // Check drawn rect metrics
    const drawnRect = controller.getDrawnRect();
    expect(drawnRect).not.toBeNull();
    expect(drawnRect!.imageWidth).toBe(320);
    expect(drawnRect!.imageHeight).toBe(240);
  });

  it("clears black canvas on privacy, blocks late old-socket decode, and rebinds fresh socket", async () => {
    act(() => {
      root.render(
        <CanvasView
          ref={(node) => {
            canvasElement = node;
          }}
          controller={null}
        />,
      );
    });

    await vi.waitFor(() => expect(canvasElement).not.toBeNull());

    controller = new BrowserStreamController({
      canvas: canvasElement!,
    });

    // Intercept createImageBitmap to hold decode in-flight
    let resolveDelayedDecode: ((bitmap: ImageBitmap) => void) | null = null;
    const originalCreateImageBitmap = window.createImageBitmap;
    let intercepted = false;

    window.createImageBitmap = vi.fn().mockImplementation((blob: Blob) => {
      if (!intercepted) {
        intercepted = true;
        const { promise, resolve } = Promise.withResolvers<ImageBitmap>();
        resolveDelayedDecode = (b) => resolve(b);
        return promise;
      }
      return originalCreateImageBitmap(blob);
    });

    controller.attach(creds1);
    const mediaWs1 = MockWebSocket.instances[0];
    mediaWs1.onopen?.();

    const jpeg = await createRealJpeg(320, 240);
    const frame1 = packBhjfFrame(makeHeader("1"), jpeg);

    // Send frame 1 -> enters intercepted decode
    mediaWs1.onmessage?.(new MessageEvent("message", { data: frame1.buffer }));

    // Trigger privacy mode BEFORE decode resolves
    controller.setPrivacyMode(true);
    expect(controller.getStatus()).toBe("privacy");

    // Inspect real canvas pixel data: must be solid black (0, 0, 0, 255)
    const ctx = canvasElement!.getContext("2d")!;
    const pixel = ctx.getImageData(10, 10, 1, 1).data;
    expect(pixel[0]).toBe(0);
    expect(pixel[1]).toBe(0);
    expect(pixel[2]).toBe(0);

    // Old media socket 1 must be closed
    expect(mediaWs1.readyState).toBe(MockWebSocket.CLOSED);

    // Now resolve the late decode
    const realBitmap = await originalCreateImageBitmap(
      new Blob([jpeg], { type: "image/jpeg" }),
    );
    const closeSpy = vi.spyOn(realBitmap, "close");
    resolveDelayedDecode!(realBitmap);

    await Promise.resolve();
    await Promise.resolve();

    // Late bitmap MUST be closed and cannot draw
    expect(closeSpy).toHaveBeenCalled();
    expect(mediaWs1.sentMessages.length).toBe(0);

    // Rebind with fresh credentials (creds2)
    controller.setPrivacyMode(false);
    controller.attach(creds2);
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
    const mediaWs2 = MockWebSocket.instances[MockWebSocket.instances.length - 2];
    mediaWs2.onopen?.();

    // Send fresh frame on fresh socket
    const frame2 = packBhjfFrame(makeHeader("2"), jpeg);
    mediaWs2.onmessage?.(new MessageEvent("message", { data: frame2.buffer }));

    await vi.waitFor(() => {
      expect(mediaWs2.sentMessages.length).toBe(1);
    });

    const ack2 = JSON.parse(mediaWs2.sentMessages[0]);
    expect(ack2).toEqual({
      kind: "frameAck",
      subscriptionEpoch: "sub-2",
      producerRun: "fedcba98-7654-4321-8901-abcdef012345",
      viewportEpoch: "1",
      frameSeq: "2",
      decodeMs: expect.any(Number),
    });

    // Restore original window.createImageBitmap
    window.createImageBitmap = originalCreateImageBitmap;
  });

  it("never emits frameAck or trusted hit geometry when createImageBitmap is unavailable or drawImage throws", async () => {
    act(() => {
      root.render(
        <CanvasView
          ref={(node) => {
            canvasElement = node;
          }}
          controller={null}
        />,
      );
    });
    await vi.waitFor(() => expect(canvasElement).not.toBeNull());

    const statuses: string[] = [];
    controller = new BrowserStreamController({
      canvas: canvasElement!,
      onStatusChange: (s) => statuses.push(s),
    });
    controller.attach(creds1);
    const mediaWs = MockWebSocket.instances[0];
    mediaWs.onopen?.();

    const jpeg = await createRealJpeg(320, 240);
    const originalCreateImageBitmap = window.createImageBitmap;

    try {
      // Case 1: absent createImageBitmap
      Reflect.set(window, "createImageBitmap", undefined);
      const frame1 = packBhjfFrame(makeHeader("1"), jpeg);
      mediaWs.onmessage?.(new MessageEvent("message", { data: frame1.buffer }));

      await vi.waitFor(() => expect(mediaWs.sentMessages.length).toBe(1));
      expect(JSON.parse(mediaWs.sentMessages[0])).toEqual({
        kind: "frameDiscarded",
        subscriptionEpoch: "sub-1",
        producerRun: "fedcba98-7654-4321-8901-abcdef012345",
        viewportEpoch: "1",
        frameSeq: "1",
        reason: "decodeFailed",
      });
      expect(controller.getStatus()).toBe("unsupported");
      expect(controller.getDrawnRect()).toBeNull();

      // Case 2: throwing drawImage
      window.createImageBitmap = originalCreateImageBitmap;
      const ctx = canvasElement!.getContext("2d")!;
      const drawSpy = vi.spyOn(ctx, "drawImage").mockImplementation(() => {
        throw new Error("drawImage failure");
      });
      const frame2 = packBhjfFrame(makeHeader("2"), jpeg);
      mediaWs.onmessage?.(new MessageEvent("message", { data: frame2.buffer }));

      await vi.waitFor(() => expect(mediaWs.sentMessages.length).toBe(2));
      expect(JSON.parse(mediaWs.sentMessages[1])).toEqual({
        kind: "frameDiscarded",
        subscriptionEpoch: "sub-1",
        producerRun: "fedcba98-7654-4321-8901-abcdef012345",
        viewportEpoch: "1",
        frameSeq: "2",
        reason: "decodeFailed",
      });
      expect(controller.getStatus()).toBe("error");
      expect(controller.getDrawnRect()).toBeNull();
      drawSpy.mockRestore();
    } finally {
      window.createImageBitmap = originalCreateImageBitmap;
    }
  });
});
