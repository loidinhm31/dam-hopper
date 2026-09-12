/** Browser routing contract for HTML preview. */
const HTML_MIME_BY_EXTENSION = {
  html: "text/html",
  htm: "text/html",
  xhtml: "application/xhtml+xml",
} as const;

export type HtmlMimeType =
  (typeof HTML_MIME_BY_EXTENSION)[keyof typeof HTML_MIME_BY_EXTENSION];

/** Returns a MIME hint for an exact final HTML extension, or undefined otherwise. */
export function htmlMimeType(name: string): HtmlMimeType | undefined {
  const fileName = name.split(/[\\/]/).at(-1) ?? "";
  const dot = fileName.lastIndexOf(".");
  // Match Path::extension semantics: dotfiles (.html) have no extension.
  if (dot <= 0 || dot === fileName.length - 1) return undefined;
  const extension = fileName.slice(dot + 1).toLowerCase();
  return HTML_MIME_BY_EXTENSION[
    extension as keyof typeof HTML_MIME_BY_EXTENSION
  ];
}

export function isHtmlFile(name: string): boolean {
  return htmlMimeType(name) !== undefined;
}

/** Non-diff, non-binary, non-large HTML tabs can render HTML preview. */
export function isHtmlPreviewCandidate(tier: string, name: string): boolean {
  return (
    tier !== "diff" &&
    tier !== "large" &&
    tier !== "binary" &&
    isHtmlFile(name)
  );
}
