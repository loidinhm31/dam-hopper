import { UI_BRIDGE_VERSION } from "./bridge-validators.js";

export const MAX_PLUGIN_UI_BYTES = 5 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const FORBIDDEN_ELEMENTS = new Set([
  "base",
  "embed",
  "form",
  "frame",
  "frameset",
  "iframe",
  "img",
  "link",
  "object",
  "portal",
  "source",
  "track",
  "video",
  "audio",
]);
const URL_ATTRIBUTES = new Set([
  "action",
  "cite",
  "data",
  "formaction",
  "href",
  "manifest",
  "ping",
  "poster",
  "src",
  "srcdoc",
  "srcset",
  "xlink:href",
]);
const SCRIPT_FORBIDDEN_PATTERN =
  /\b(?:eval\s*\(|new\s+Function\s*\(|import\s*\(|importScripts\s*\(|new\s+(?:Shared)?Worker\s*\(|serviceWorker\s*\.)/;
const STYLE_FORBIDDEN_PATTERN = /(?:@import\b|url\s*\(|expression\s*\()/i;

export interface BuildPluginDocumentInput {
  bytes: Uint8Array;
  expectedDigest: string;
  frameSession: string;
  activationGeneration: number;
}

export interface VerifiedPluginDocument {
  srcdoc: string;
  digest: string;
  byteLength: number;
}

export class PluginDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginDocumentError";
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function digestBytes(bytes: Uint8Array): Promise<{
  hex: string;
  base64: string;
}> {
  const stableBytes: Uint8Array<ArrayBuffer> =
    bytes.buffer instanceof ArrayBuffer
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : Uint8Array.from(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", stableBytes),
  );
  return {
    hex: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    base64: bytesToBase64(digest),
  };
}

function htmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function validateElement(element: Element): void {
  const tag = element.localName.toLowerCase();
  if (
    element.namespaceURI !== HTML_NAMESPACE ||
    FORBIDDEN_ELEMENTS.has(tag) ||
    tag === "meta"
  ) {
    throw new PluginDocumentError(`Forbidden plugin document element: ${tag}`);
  }
  for (const attribute of element.attributes) {
    const name = attribute.name.toLowerCase();
    if (
      name.startsWith("on") ||
      URL_ATTRIBUTES.has(name) ||
      (name === "style" && STYLE_FORBIDDEN_PATTERN.test(attribute.value))
    ) {
      throw new PluginDocumentError(
        `Forbidden plugin document attribute: ${name}`,
      );
    }
  }
}
function validateDocumentShape(document: Document): {
  script: HTMLScriptElement;
  style: HTMLStyleElement;
  title: string;
  bodyMarkup: string;
} {
  if (document.doctype?.name.toLowerCase() !== "html") {
    throw new PluginDocumentError("Plugin UI must start with an HTML doctype");
  }
  const scripts = [...document.querySelectorAll("script")];
  const styles = [...document.querySelectorAll("style")];
  if (scripts.length !== 1 || styles.length !== 1) {
    throw new PluginDocumentError(
      "Plugin UI must contain exactly one inline script and one inline style",
    );
  }
  const [script] = scripts;
  const [style] = styles;
  if (
    script.attributes.length > (script.hasAttribute("type") ? 1 : 0) ||
    (script.hasAttribute("type") &&
      !["text/javascript", "application/javascript"].includes(
        script.getAttribute("type")!.toLowerCase(),
      ))
  ) {
    throw new PluginDocumentError(
      "Plugin UI script must be a classic inline script",
    );
  }
  if (style.attributes.length !== 0) {
    throw new PluginDocumentError(
      "Plugin UI style must be inline and unqualified",
    );
  }
  if (
    SCRIPT_FORBIDDEN_PATTERN.test(script.textContent ?? "") ||
    STYLE_FORBIDDEN_PATTERN.test(style.textContent ?? "")
  ) {
    throw new PluginDocumentError(
      "Plugin UI contains a forbidden dynamic-code or external-resource primitive",
    );
  }

  const charset = [...document.head.querySelectorAll("meta")].filter(
    (meta) => meta.getAttribute("charset")?.toLowerCase() === "utf-8",
  );
  if (charset.length !== 1) {
    throw new PluginDocumentError(
      "Plugin UI must declare exactly one UTF-8 charset",
    );
  }
  for (const meta of document.head.querySelectorAll("meta")) {
    const name = meta.getAttribute("name")?.toLowerCase();
    if (meta !== charset[0] && name !== "viewport") {
      throw new PluginDocumentError("Plugin UI contains unsupported metadata");
    }
  }
  for (const child of document.head.children) {
    if (!["meta", "title", "style"].includes(child.localName.toLowerCase())) {
      throw new PluginDocumentError(
        "Plugin UI head has an unsupported element",
      );
    }
  }

  for (const element of document.querySelectorAll("*")) {
    if (
      element === script ||
      element === style ||
      element.localName === "meta"
    ) {
      continue;
    }
    validateElement(element);
  }

  const body = document.body.cloneNode(true) as HTMLBodyElement;
  body.querySelectorAll("script, style").forEach((element) => element.remove());
  return {
    script,
    style,
    title: document.title.trim() || "Plugin",
    bodyMarkup: body.innerHTML,
  };
}

export async function buildVerifiedPluginDocument(
  input: BuildPluginDocumentInput,
): Promise<VerifiedPluginDocument> {
  if (
    input.bytes.byteLength === 0 ||
    input.bytes.byteLength > MAX_PLUGIN_UI_BYTES
  ) {
    throw new PluginDocumentError("Plugin UI exceeds the 5 MiB document limit");
  }
  if (!SHA256_PATTERN.test(input.expectedDigest)) {
    throw new PluginDocumentError("Plugin UI digest is invalid");
  }
  const assetDigest = await digestBytes(input.bytes);
  if (assetDigest.hex !== input.expectedDigest) {
    throw new PluginDocumentError(
      "Plugin UI digest does not match active metadata",
    );
  }

  let html: string;
  try {
    html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      input.bytes,
    );
  } catch {
    throw new PluginDocumentError("Plugin UI is not strict UTF-8");
  }
  if (html.includes("\0")) {
    throw new PluginDocumentError("Plugin UI contains a NUL byte");
  }

  const parsed = new DOMParser().parseFromString(html, "text/html");
  const shape = validateDocumentShape(parsed);
  const bootstrap =
    `var __FRAME_SESSION__=${JSON.stringify(input.frameSession)};` +
    `var __ACTIVATION_GENERATION__=${input.activationGeneration};` +
    `var __DAM_HOPPER_BRIDGE_VERSION__=${JSON.stringify(UI_BRIDGE_VERSION)};`;
  const script = bootstrap + (shape.script.textContent ?? "");
  const [scriptDigest, styleDigest] = await Promise.all([
    digestBytes(new TextEncoder().encode(script)),
    digestBytes(new TextEncoder().encode(shape.style.textContent ?? "")),
  ]);
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${scriptDigest.base64}'`,
    `style-src 'sha256-${styleDigest.base64}'`,
    "connect-src 'none'",
    "img-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
  ].join("; ");

  const srcdoc =
    '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8">' +
    `<meta http-equiv=\"Content-Security-Policy\" content=\"${htmlAttribute(csp)}\">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${htmlAttribute(shape.title)}</title>` +
    `<style>${shape.style.textContent ?? ""}</style>` +
    "</head><body>" +
    shape.bodyMarkup +
    `<script>${script}</script>` +
    "</body></html>";

  return {
    srcdoc,
    digest: assetDigest.hex,
    byteLength: input.bytes.byteLength,
  };
}
