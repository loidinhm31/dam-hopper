/**
 * Browser routing contract for the server's closed video extension allowlist.
 * This is intentionally extension-only: it is a player hint, not codec proof.
 */
const VIDEO_MIME_BY_EXTENSION = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  webm: "video/webm",
  ogv: "video/ogg",
  ogg: "video/ogg",
  mov: "video/quicktime",
} as const;

export type VideoMimeType =
  (typeof VIDEO_MIME_BY_EXTENSION)[keyof typeof VIDEO_MIME_BY_EXTENSION];

/** Returns a MIME hint for an exact final extension, or undefined for non-video files. */
export function videoMimeType(name: string): VideoMimeType | undefined {
  const extension = name.trim().split(".").at(-1)?.toLowerCase();
  if (!extension || extension === name.trim().toLowerCase()) return undefined;
  return VIDEO_MIME_BY_EXTENSION[
    extension as keyof typeof VIDEO_MIME_BY_EXTENSION
  ];
}

export function isVideoFile(name: string): boolean {
  return videoMimeType(name) !== undefined;
}

/** Diff tabs retain their dedicated viewer even when their display name is a video file. */
export function isVideoPreviewCandidate(tier: string, name: string): boolean {
  return tier === "video" || (tier !== "diff" && isVideoFile(name));
}
