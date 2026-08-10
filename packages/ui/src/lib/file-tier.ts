import { imageMimeType } from "./image-file.js";
import { isImageFile } from "./image-file.js";
import { isVideoFile, videoMimeType } from "./video-file.js";

/** File size / binary thresholds for editor tier selection. */

export type FileTier =
  | "normal"
  | "degraded"
  | "large"
  | "binary"
  | "video"
  | "image";

const NORMAL_MAX = 1 * 1024 * 1024; // 1 MB
const DEGRADED_MAX = 5 * 1024 * 1024; // 5 MB

/**
 * Determine which editor tier to use for a given file.
 *
 * - binary  → BinaryPreview (hex dump)
 * - large   → LargeFileViewer (IntersectionObserver-based range-read)
 * - image   → native browser ImagePreview
 * - degraded → Monaco without minimap/folding (1–5 MB)
 * - normal  → full Monaco (<1 MB)
 */
export function fileTier(
  name: string,
  size: number,
  isBinary: boolean,
): FileTier {
  if (videoMimeType(name)) return "video";
  if (imageMimeType(name)) return "image";
  if (isBinary) return "binary";
  if (size >= DEGRADED_MAX) return "large";
  if (size >= NORMAL_MAX) return "degraded";
  return "normal";
}

/** Preview-only files never enter editor byte reads or write paths. */
export function isPreviewOnlyFile(tier: string, name: string): boolean {
  return (
    tier === "video" ||
    (tier !== "diff" && (isVideoFile(name) || isImageFile(name)))
  );
}
