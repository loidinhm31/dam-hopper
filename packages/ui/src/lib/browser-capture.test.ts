// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserSelectionV1 } from "@dam-hopper/browser-bridge";
import {
  browserCaptureSupport,
  captureBrowserSelection,
  mapBrowserCaptureRect,
  prepareManualBrowserImage,
} from "./browser-capture.js";

const selection: BrowserSelectionV1 = {
  version: 1,
  tag: "button",
  role: "button",
  accessibleName: "Save",
  text: "Save",
  attributes: {},
  locator: "button",
  bounds: { x: 20, y: 30, width: 100, height: 50 },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mapBrowserCaptureRect", () => {
  it("uses captured dimensions rather than an assumed device pixel ratio", () => {
    expect(
      mapBrowserCaptureRect({
        selection: selection.bounds,
        targetFrame: { left: 100, top: 50, width: 800, height: 600 },
        sourceSize: { width: 1000, height: 800 },
        capturedSize: { width: 2000, height: 1600 },
      }),
    ).toEqual({ left: 240, top: 160, width: 200, height: 100 });
  });

  it("clamps a partially off-screen selection to the captured frame", () => {
    expect(
      mapBrowserCaptureRect({
        selection: {
          ...selection.bounds,
          x: -50,
          y: 30,
          width: 100,
          height: 50,
        },
        targetFrame: { left: 0, top: 0, width: 800, height: 600 },
        sourceSize: { width: 800, height: 600 },
        capturedSize: { width: 800, height: 600 },
      }),
    ).toEqual({ left: 0, top: 30, width: 50, height: 50 });
  });

  it("rejects zero-area and out-of-frame selections", () => {
    expect(
      mapBrowserCaptureRect({
        selection: { ...selection.bounds, width: 0 },
        targetFrame: { left: 0, top: 0, width: 800, height: 600 },
        sourceSize: { width: 800, height: 600 },
        capturedSize: { width: 800, height: 600 },
      }),
    ).toBeNull();
    expect(
      mapBrowserCaptureRect({
        selection: selection.bounds,
        targetFrame: { left: 0, top: 0, width: 0, height: 600 },
        sourceSize: { width: 800, height: 600 },
        capturedSize: { width: 800, height: 600 },
      }),
    ).toBeNull();
    expect(
      mapBrowserCaptureRect({
        selection: { ...selection.bounds, x: 900 },
        targetFrame: { left: 0, top: 0, width: 800, height: 600 },
        sourceSize: { width: 800, height: 600 },
        capturedSize: { width: 800, height: 600 },
      }),
    ).toBeNull();
  });

  it("clips selection bounds to the live iframe after a scroll or resize", () => {
    expect(
      mapBrowserCaptureRect({
        selection: {
          ...selection.bounds,
          x: 760,
          y: 560,
          width: 100,
          height: 100,
        },
        targetFrame: { left: 80, top: 40, width: 800, height: 600 },
        sourceSize: { width: 1000, height: 800 },
        capturedSize: { width: 2000, height: 1600 },
      }),
    ).toEqual({ left: 1680, top: 1200, width: 80, height: 80 });
  });
});

describe("prepareManualBrowserImage", () => {
  it("keeps a manual PNG fallback available without screen-capture support", async () => {
    vi.stubGlobal("isSecureContext", false);
    const png = new Blob(["png"], { type: "image/png" });
    await expect(prepareManualBrowserImage(png)).resolves.toEqual({
      kind: "manual-image",
      png,
    });
  });

  it("rejects an oversized manual PNG before it is retained", async () => {
    const png = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], {
      type: "image/png",
    });
    await expect(prepareManualBrowserImage(png)).resolves.toEqual({
      kind: "too-large",
    });
  });

  it("converts a valid manual JPEG to the PNG-only artifact format", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 12, height: 8, close }),
    );
    const png = new Blob(["converted"], { type: "image/png" });
    vi.stubGlobal("document", {
      createElement: (tag: string) =>
        tag === "canvas"
          ? {
              width: 0,
              height: 0,
              getContext: () => ({ drawImage: vi.fn() }),
              toBlob: (callback: (blob: Blob) => void) => callback(png),
            }
          : {},
    });

    const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
    await expect(prepareManualBrowserImage(jpeg)).resolves.toEqual({
      kind: "manual-image",
      png,
    });
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("captureBrowserSelection", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
  });

  it("keeps semantic selection usable when display capture is unsupported", async () => {
    vi.stubGlobal("isSecureContext", false);
    expect(browserCaptureSupport()).toBe(false);
    await expect(
      captureBrowserSelection(selection, {
        left: 0,
        top: 0,
        width: 1,
        height: 1,
      }),
    ).resolves.toEqual({ kind: "unsupported" });
  });

  it.each(["NotAllowedError", "NotFoundError", "NotReadableError"])(
    "returns a safe outcome for %s",
    async (name) => {
      vi.stubGlobal("isSecureContext", true);
      vi.stubGlobal("navigator", {
        mediaDevices: {
          getDisplayMedia: vi
            .fn()
            .mockRejectedValue(new DOMException("no", name)),
        },
      });
      const outcome = await captureBrowserSelection(selection, {
        left: 0,
        top: 0,
        width: 1,
        height: 1,
      });
      expect(outcome.kind).toBe(
        name === "NotAllowedError" ? "denied" : "unsupported",
      );
    },
  );

  it("rejects a chosen window or screen and cleans up its tracks", async () => {
    vi.stubGlobal("isSecureContext", true);
    const stop = vi.fn();
    const track = {
      getSettings: () => ({ displaySurface: "window" }),
      stop,
    } as unknown as MediaStreamTrack;
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockResolvedValue({
          getVideoTracks: () => [track],
          getTracks: () => [track],
        }),
      },
    });

    await expect(
      captureBrowserSelection(selection, {
        left: 0,
        top: 0,
        width: 1,
        height: 1,
      }),
    ).resolves.toEqual({ kind: "wrong-surface" });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("fails closed when the browser omits the selected surface type", async () => {
    vi.stubGlobal("isSecureContext", true);
    const stop = vi.fn();
    const track = {
      getSettings: () => ({}),
      stop,
    } as unknown as MediaStreamTrack;
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockResolvedValue({
          getVideoTracks: () => [track],
          getTracks: () => [track],
        }),
      },
    });

    await expect(
      captureBrowserSelection(selection, {
        left: 0,
        top: 0,
        width: 1,
        height: 1,
      }),
    ).resolves.toEqual({ kind: "wrong-surface" });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("cleans up when a chosen browser-tab track ends before a frame is ready", async () => {
    vi.stubGlobal("isSecureContext", true);
    const stop = vi.fn();
    const track = {
      getSettings: () => ({ displaySurface: "browser" }),
      stop,
      addEventListener: (_name: string, listener: () => void) => listener(),
      removeEventListener: vi.fn(),
    } as unknown as MediaStreamTrack;
    const video = {
      muted: false,
      playsInline: false,
      srcObject: null,
      onloadedmetadata: null,
      onerror: null,
      play: vi.fn(),
    } as unknown as HTMLVideoElement;
    vi.stubGlobal("document", {
      createElement: (tag: string) =>
        tag === "canvas" ? { getContext: () => ({}) } : video,
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockResolvedValue({
          getVideoTracks: () => [track],
          getTracks: () => [track],
        }),
      },
    });

    await expect(
      captureBrowserSelection(selection, {
        left: 0,
        top: 0,
        width: 1,
        height: 1,
      }),
    ).resolves.toEqual({ kind: "unsupported" });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("rejects an oversized PNG emitted by the crop canvas", async () => {
    vi.stubGlobal("isSecureContext", true);
    const stop = vi.fn();
    const track = {
      getSettings: () => ({ displaySurface: "browser" }),
      stop,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaStreamTrack;
    const video = {
      muted: false,
      playsInline: false,
      videoWidth: 1000,
      videoHeight: 800,
      onloadedmetadata: null as (() => void) | null,
      onerror: null,
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;
    Object.defineProperty(video, "srcObject", {
      set: () => queueMicrotask(() => video.onloadedmetadata?.()),
    });
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback: (blob: Blob) => void) =>
        callback(
          new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], {
            type: "image/png",
          }),
        ),
    };
    vi.stubGlobal("document", {
      createElement: (tag: string) => (tag === "canvas" ? canvas : video),
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockResolvedValue({
          getVideoTracks: () => [track],
          getTracks: () => [track],
        }),
      },
    });

    await expect(
      captureBrowserSelection(selection, {
        left: 0,
        top: 0,
        width: 800,
        height: 600,
      }),
    ).resolves.toEqual({ kind: "too-large" });
    expect(stop).toHaveBeenCalledOnce();
  });
});

describe("stopCaptureStream", () => {
  it("stops every track when a Browser surface closes", async () => {
    const { stopCaptureStream } = await import("./browser-capture.js");
    const first = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const second = { stop: vi.fn() } as unknown as MediaStreamTrack;

    stopCaptureStream({ getTracks: () => [first, second] } as MediaStream);

    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });
});
