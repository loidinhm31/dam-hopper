/** File size / binary thresholds for editor tier selection. */

export type FileTier = "normal" | "degraded" | "large" | "binary";

const NORMAL_MAX = 1 * 1024 * 1024;   // 1 MB
const DEGRADED_MAX = 5 * 1024 * 1024; // 5 MB

/**
 * Determine which editor tier to use for a given file.
 *
 * - binary  → BinaryPreview (hex dump)
 * - large   → LargeFileViewer (IntersectionObserver-based range-read)
 * - degraded → Monaco without minimap/folding (1–5 MB)
 * - normal  → full Monaco (<1 MB)
 */
export function fileTier(size: number, isBinary: boolean): FileTier {
  if (isBinary) return "binary";
  if (size >= DEGRADED_MAX) return "large";
  if (size >= NORMAL_MAX) return "degraded";
  return "normal";
}
