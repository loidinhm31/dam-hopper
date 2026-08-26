import type { BrowserSelectionV1 } from "@dam-hopper/browser-bridge";
import {
  mapBrowserCaptureRect,
  type CaptureRect,
} from "./browser-capture-rect.js";

export {
  mapBrowserCaptureRect,
  type CaptureRect,
  type CaptureRectInput,
} from "./browser-capture-rect.js";

export const MAX_BROWSER_CAPTURE_BYTES = 4 * 1024 * 1024;
const MAX_BROWSER_CAPTURE_PIXELS = 16_000_000;

export type BrowserCaptureOutcome =
  | { kind: "captured"; png: Blob }
  | { kind: "manual-image"; png: Blob }
  | { kind: "denied" }
  | { kind: "wrong-surface" }
  | { kind: "unsupported" }
  | { kind: "invalid-rect" }
  | { kind: "too-large" };

export function browserCaptureSupport(): boolean {
  if (
    typeof navigator === "undefined" ||
    typeof document === "undefined" ||
    !globalThis.isSecureContext
  )
    return false;
  const mediaDevices = (navigator as { mediaDevices?: unknown }).mediaDevices;
  return Boolean(
    mediaDevices &&
    typeof (mediaDevices as { getDisplayMedia?: unknown }).getDisplayMedia ===
      "function" &&
    document.createElement("canvas").getContext("2d"),
  );
}

function imageCanvasSupport(): boolean {
  return Boolean(
    typeof document !== "undefined" &&
    document.createElement("canvas").getContext("2d"),
  );
}

export async function captureBrowserSelection(
  selection: BrowserSelectionV1,
  targetFrame: CaptureRect | null,
  onStream?: (stream: MediaStream | null) => void,
): Promise<BrowserCaptureOutcome> {
  if (!targetFrame || !browserCaptureSupport()) return { kind: "unsupported" };
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser" },
      audio: false,
      preferCurrentTab: true,
    } as MediaStreamConstraints);
    onStream?.(stream);
    const track = stream.getVideoTracks()[0];
    if (!track) return { kind: "unsupported" };
    if (track.getSettings().displaySurface !== "browser")
      return { kind: "wrong-surface" };

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await waitForVideoMetadata(video, track);
    await video.play();
    const rect = mapBrowserCaptureRect({
      selection: selection.bounds,
      targetFrame,
      capturedSize: { width: video.videoWidth, height: video.videoHeight },
      sourceSize: { width: window.innerWidth, height: window.innerHeight },
    });
    if (!rect) return { kind: "invalid-rect" };
    return canvasCrop(video, rect, "captured");
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError")
      return { kind: "denied" };
    return { kind: "unsupported" };
  } finally {
    stopCaptureStream(stream);
    onStream?.(null);
  }
}

/** Converts an explicitly selected PNG/JPEG into the PNG-only artifact format. */
export async function prepareManualBrowserImage(
  file: Blob,
): Promise<BrowserCaptureOutcome> {
  if (file.type === "image/png" && file.size <= MAX_BROWSER_CAPTURE_BYTES)
    return { kind: "manual-image", png: file };
  if (file.type !== "image/jpeg" || file.size > MAX_BROWSER_CAPTURE_BYTES)
    return { kind: "too-large" };
  if (!imageCanvasSupport()) return { kind: "unsupported" };
  try {
    const image = await createImageBitmap(file);
    try {
      return await canvasCrop(
        image,
        { left: 0, top: 0, width: image.width, height: image.height },
        "manual-image",
      );
    } finally {
      image.close();
    }
  } catch {
    return { kind: "unsupported" };
  }
}

export function stopCaptureStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function waitForVideoMetadata(
  video: HTMLVideoElement,
  track: MediaStreamTrack,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanUp = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      track.removeEventListener("ended", onEnded);
    };
    const onEnded = () => {
      cleanUp();
      reject(new Error("capture track ended before a frame was available"));
    };
    video.onloadedmetadata = () => {
      cleanUp();
      resolve();
    };
    video.onerror = () => {
      cleanUp();
      reject(new Error("capture video metadata unavailable"));
    };
    track.addEventListener("ended", onEnded, { once: true });
  });
}

async function canvasCrop(
  image: CanvasImageSource,
  rect: CaptureRect,
  kind: "captured" | "manual-image",
): Promise<BrowserCaptureOutcome> {
  if (rect.width * rect.height > MAX_BROWSER_CAPTURE_PIXELS)
    return { kind: "too-large" };
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;
  const context = canvas.getContext("2d");
  if (!context) return { kind: "unsupported" };
  context.drawImage(
    image,
    rect.left,
    rect.top,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  );
  const png = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!png) return { kind: "unsupported" };
  return png.size <= MAX_BROWSER_CAPTURE_BYTES
    ? { kind, png }
    : { kind: "too-large" };
}
