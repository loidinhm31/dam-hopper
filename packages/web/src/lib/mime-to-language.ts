/** Maps a MIME type string to a Monaco language identifier. */
export function mimeToLanguage(mime?: string): string {
  if (!mime) return "plaintext";
  if (mime.includes("typescript") || mime.includes("tsx")) return "TypeScript";
  if (mime.includes("javascript") || mime.includes("jsx")) return "JavaScript";
  if (mime.includes("json")) return "JSON";
  if (mime.includes("html")) return "HTML";
  if (mime.includes("css")) return "CSS";
  if (mime.includes("xml")) return "XML";
  if (mime.includes("markdown")) return "Markdown";
  if (mime.includes("rust")) return "Rust";
  if (mime.includes("python")) return "Python";
  if (mime.includes("yaml")) return "YAML";
  if (mime.includes("toml")) return "TOML";
  return "Plain Text";
}

/** Maps a MIME type to a Monaco editor language ID (lowercase, for Monaco's language prop). */
export function mimeToMonacoLanguage(mime?: string): string {
  if (!mime) return "plaintext";
  if (mime.includes("typescript") || mime.includes("tsx")) return "typescript";
  if (mime.includes("javascript") || mime.includes("jsx")) return "javascript";
  if (mime.includes("json")) return "json";
  if (mime.includes("html")) return "html";
  if (mime.includes("css")) return "css";
  if (mime.includes("xml")) return "xml";
  if (mime.includes("markdown")) return "markdown";
  if (mime.includes("rust")) return "rust";
  if (mime.includes("python")) return "python";
  if (mime.includes("yaml")) return "yaml";
  if (mime.includes("toml")) return "toml";
  return "plaintext";
}
