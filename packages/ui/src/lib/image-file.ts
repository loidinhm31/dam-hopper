/** Browser routing contract for the server's closed image preview allowlist. */
const IMAGE_MIME_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
} as const;

export type ImageMimeType =
  (typeof IMAGE_MIME_BY_EXTENSION)[keyof typeof IMAGE_MIME_BY_EXTENSION];

/** Returns a MIME hint for an exact final extension, or undefined otherwise. */
export function imageMimeType(name: string): ImageMimeType | undefined {
  const fileName = name.split(/[\\/]/).at(-1) ?? "";
  const dot = fileName.lastIndexOf(".");
  // Match Path::extension semantics: dotfiles have no extension.
  if (dot <= 0 || dot === fileName.length - 1) return undefined;
  const extension = fileName.slice(dot + 1).toLowerCase();
  return IMAGE_MIME_BY_EXTENSION[
    extension as keyof typeof IMAGE_MIME_BY_EXTENSION
  ];
}

export function isImageFile(name: string): boolean {
  return imageMimeType(name) !== undefined;
}

/** Diff tabs retain their dedicated viewer even when named like an image. */
export function isImagePreviewCandidate(tier: string, name: string): boolean {
  // Recheck the name so stale persisted tier metadata cannot route an
  // excluded format into the capability-only preview.
  return tier !== "diff" && isImageFile(name);
}
