import { describe, expect, it } from "vitest";
import { fileTier } from "./file-tier.js";
import {
  imageMimeType,
  isImageFile,
  isImagePreviewCandidate,
} from "./image-file.js";

describe("image file routing", () => {
  it.each([
    ["preview.png", "image/png"],
    ["preview.JPG", "image/jpeg"],
    ["preview.jpeg", "image/jpeg"],
    ["preview.gif", "image/gif"],
    ["preview.webp", "image/webp"],
  ])("recognizes %s with its exact MIME hint", (name, mime) => {
    expect(imageMimeType(name)).toBe(mime);
    expect(isImageFile(name)).toBe(true);
    expect(fileTier(name, 3 * 1024 * 1024 * 1024, true)).toBe("image");
  });

  it("uses only the final extension and keeps excluded formats out", () => {
    expect(imageMimeType("preview.png.exe")).toBeUndefined();
    expect(imageMimeType("preview")).toBeUndefined();
    expect(imageMimeType("photos.webp/preview.txt")).toBeUndefined();
    expect(imageMimeType("photos\\preview.PNG")).toBe("image/png");
    expect(imageMimeType(".png")).toBeUndefined();
    expect(imageMimeType("preview.png ")).toBeUndefined();
    for (const name of ["icon.svg", "photo.avif", "scan.bmp", "old.tiff"]) {
      expect(isImageFile(name)).toBe(false);
      expect(fileTier(name, 3 * 1024 * 1024 * 1024, false)).toBe("large");
      expect(isImagePreviewCandidate("large", name)).toBe(false);
    }
  });

  it("does not replace a diff tab with an image preview", () => {
    expect(isImagePreviewCandidate("large", "preview.png")).toBe(true);
    expect(isImagePreviewCandidate("diff", "Diff: preview.png")).toBe(false);
  });

  it("does not trust stale image tiers for excluded formats", () => {
    expect(isImagePreviewCandidate("image", "preview.png")).toBe(true);
    for (const name of ["icon.svg", "photo.avif", "scan.bmp", "old.tiff"]) {
      expect(isImagePreviewCandidate("image", name)).toBe(false);
    }
  });
});
