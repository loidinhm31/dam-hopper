import { isImageFile } from "./image-file.js";
import { isVideoFile } from "./video-file.js";
import { isHtmlFile } from "./html-file.js";

export type EditorFormat =
  | "image"
  | "video"
  | "large"
  | "binary"
  | "markdown"
  | "html"
  | "code";

const LARGE_FILE_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5 MB

export function isMarkdownFile(name: string): boolean {
  const fileName = name.split(/[\\/]/).at(-1) ?? "";
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return false;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return (
    ext === "md" ||
    ext === "markdown" ||
    ext === "mdown" ||
    ext === "mkdn" ||
    ext === "mkd"
  );
}

export function getEditorFormat(
  fileName: string,
  size?: number,
  tier?: string,
): EditorFormat {
  if (isVideoFile(fileName) || tier === "video") return "video";
  if (isImageFile(fileName) || tier === "image") return "image";
  if (
    (typeof size === "number" && size >= LARGE_FILE_THRESHOLD_BYTES) ||
    tier === "large"
  ) {
    return "large";
  }
  if (tier === "binary") return "binary";
  if (isHtmlFile(fileName)) return "html";
  if (isMarkdownFile(fileName)) return "markdown";
  return "code";
}

/** Returns true if the file should NOT be mounted in Monaco KeepAlive host. */
export function isNonMonacoFormat(
  fileName: string,
  size?: number,
  tier?: string,
): boolean {
  return getEditorFormat(fileName, size, tier) !== "code";
}
