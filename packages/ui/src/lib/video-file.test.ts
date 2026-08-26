import { describe, expect, it } from "vitest";
import { fileTier } from "./file-tier.js";
import {
  isVideoFile,
  isVideoPreviewCandidate,
  videoMimeType,
} from "./video-file.js";

describe("video file routing", () => {
  it.each([
    ["clip.mp4", "video/mp4"],
    ["clip.M4V", "video/x-m4v"],
    ["clip.webm", "video/webm"],
    ["clip.ogv", "video/ogg"],
    ["clip.ogg", "video/ogg"],
    ["clip.mov", "video/quicktime"],
  ])("recognizes %s with its exact MIME hint", (name, mime) => {
    expect(videoMimeType(name)).toBe(mime);
    expect(isVideoFile(name)).toBe(true);
    expect(fileTier(name, 3 * 1024 * 1024 * 1024, true)).toBe("video");
  });

  it("uses only the final extension and preserves non-video tiers", () => {
    expect(videoMimeType("clip.mp4.exe")).toBeUndefined();
    expect(videoMimeType("clip")).toBeUndefined();
    expect(videoMimeType("recordings.mp4/clip.txt")).toBeUndefined();
    expect(videoMimeType("recordings.mp4/clip.OGG")).toBe("video/ogg");
    expect(videoMimeType(".mp4")).toBeUndefined();
    expect(fileTier("archive.zip", 1, true)).toBe("binary");
    expect(fileTier("large.txt", 6 * 1024 * 1024, false)).toBe("large");
  });

  it("does not replace a video-file diff tab with a player", () => {
    expect(isVideoPreviewCandidate("large", "clip.mp4")).toBe(true);
    expect(isVideoPreviewCandidate("diff", "Diff: clip.mp4")).toBe(false);
  });
});
