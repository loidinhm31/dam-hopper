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

function sha256Fallback(bytes: Uint8Array): Uint8Array {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const len = bytes.length;
  const bitLen = len * 8;
  const paddedLen = ((len + 9 + 63) >>> 6) << 6;
  const words = new Uint32Array(paddedLen >>> 2);
  for (let i = 0; i < len; i++) {
    words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8);
  }
  words[len >>> 2] |= 0x80 << (24 - (len % 4) * 8);
  words[words.length - 1] = bitLen >>> 0;
  words[words.length - 2] = Math.floor(bitLen / 0x100000000);
  const W = new Uint32Array(64);
  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 16; t++) W[t] = words[i + t];
    for (let t = 16; t < 64; t++) {
      const s0 = rightRotate(W[t - 15], 7) ^ rightRotate(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rightRotate(W[t - 2], 17) ^ rightRotate(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const result = new Uint8Array(32);
  const hashWords = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    result[i * 4] = (hashWords[i] >>> 24) & 0xff;
    result[i * 4 + 1] = (hashWords[i] >>> 16) & 0xff;
    result[i * 4 + 2] = (hashWords[i] >>> 8) & 0xff;
    result[i * 4 + 3] = hashWords[i] & 0xff;
  }
  return result;
}

async function digestBytes(bytes: Uint8Array): Promise<{
  hex: string;
  base64: string;
}> {
  const stableBytes: Uint8Array<ArrayBuffer> =
    bytes.buffer instanceof ArrayBuffer
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : Uint8Array.from(bytes);
  let digest: Uint8Array;
  if (typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.digest === "function") {
    digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", stableBytes),
    );
  } else {
    digest = sha256Fallback(stableBytes);
  }
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
