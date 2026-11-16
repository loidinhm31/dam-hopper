/**
 * BHJF Binary Frame Protocol Parser and Packer.
 *
 * Implements strict binary framing and validation for host browser JPEG screencast
 * per architecture-contracts.md §6.
 */

import {
  BHJF_FLAGS_NONE,
  BHJF_MAGIC,
  BHJF_PREFIX_LEN,
  BHJF_VERSION,
  FrameProtocolError,
  MAX_FRAME_MESSAGE_BYTES,
  MAX_IMAGE_HEIGHT,
  MAX_IMAGE_WIDTH,
  MAX_JPEG_PAYLOAD_BYTES,
  MAX_JSON_HEADER_BYTES,
  MAX_PIXELS,
  MAX_VIEWPORT_CSS_HEIGHT,
  MAX_VIEWPORT_CSS_WIDTH,
  type ParsedFrame,
  type TargetFrameHeader,
  type TargetGeometry,
} from "../api/browser-host-types.js";

const CANONICAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DECIMAL_SEQUENCE_RE = /^[1-9][0-9]{0,19}$/;
const U64_MAX = 18446744073709551615n;
const MAX_SAFE_JS_INT = 9007199254740991; // 2^53 - 1
const MAX_OFFSET = 10_000_000;

export function validateDecimalSequence(
  field: string,
  val: string,
): bigint {
  if (typeof val !== "string" || !DECIMAL_SEQUENCE_RE.test(val)) {
    throw new FrameProtocolError(
      `Field ${field} must be a canonical positive decimal without leading zeros: "${val}"`,
      "INVALID_DECIMAL_SEQUENCE",
    );
  }
  const big = BigInt(val);
  if (big > U64_MAX) {
    throw new FrameProtocolError(
      `Field ${field} exceeds u64::MAX: "${val}"`,
      "DECIMAL_OVERFLOW",
    );
  }
  return big;
}

export function validateCanonicalUuid(field: string, val: string): void {
  if (typeof val !== "string" || !CANONICAL_UUID_RE.test(val)) {
    throw new FrameProtocolError(
      `Field ${field} must be a canonical lowercase UUID: "${val}"`,
      "INVALID_UUID",
    );
  }
}

export function validateGeometry(geom: TargetGeometry): void {
  if (!geom || typeof geom !== "object") {
    throw new FrameProtocolError(
      "Missing or invalid geometry object",
      "INVALID_GEOMETRY",
    );
  }

  const fields: (keyof TargetGeometry)[] = [
    "cssWidth",
    "cssHeight",
    "offsetTop",
    "scrollX",
    "scrollY",
    "pageScale",
    "visualOffsetX",
    "visualOffsetY",
    "dpr",
  ];

  for (const f of fields) {
    const val = geom[f];
    if (typeof val !== "number" || !Number.isFinite(val)) {
      throw new FrameProtocolError(
        `Geometry field ${f} must be a finite number: ${val}`,
        "NON_FINITE_GEOMETRY",
      );
    }
  }

  if (
    geom.cssWidth <= 0 ||
    geom.cssWidth > MAX_VIEWPORT_CSS_WIDTH ||
    geom.cssHeight <= 0 ||
    geom.cssHeight > MAX_VIEWPORT_CSS_HEIGHT
  ) {
    throw new FrameProtocolError(
      `cssWidth (${geom.cssWidth}) must be in (0, ${MAX_VIEWPORT_CSS_WIDTH}] and cssHeight (${geom.cssHeight}) in (0, ${MAX_VIEWPORT_CSS_HEIGHT}]`,
      "GEOMETRY_OUT_OF_BOUNDS",
    );
  }

  if (geom.pageScale < 0.1 || geom.pageScale > 10.0) {
    throw new FrameProtocolError(
      `pageScale (${geom.pageScale}) must be in [0.1, 10.0]`,
      "GEOMETRY_OUT_OF_BOUNDS",
    );
  }

  if (geom.dpr < 0.1 || geom.dpr > 10.0) {
    throw new FrameProtocolError(
      `dpr (${geom.dpr}) must be in [0.1, 10.0]`,
      "GEOMETRY_OUT_OF_BOUNDS",
    );
  }

  if (
    Math.abs(geom.offsetTop) > MAX_OFFSET ||
    Math.abs(geom.scrollX) > MAX_OFFSET ||
    Math.abs(geom.scrollY) > MAX_OFFSET ||
    Math.abs(geom.visualOffsetX) > MAX_OFFSET ||
    Math.abs(geom.visualOffsetY) > MAX_OFFSET
  ) {
    throw new FrameProtocolError(
      "Geometry offsets exceed maximum 10,000,000 CSS pixels",
      "GEOMETRY_OUT_OF_BOUNDS",
    );
  }
}

export function validateTargetFrameHeader(header: TargetFrameHeader): void {
  if (!header || typeof header !== "object") {
    throw new FrameProtocolError(
      "Missing or invalid frame header",
      "INVALID_HEADER",
    );
  }

  validateCanonicalUuid("browserSessionId", header.browserSessionId);
  validateCanonicalUuid("browserIncarnation", header.browserIncarnation);
  validateCanonicalUuid("producerRun", header.producerRun);

  validateDecimalSequence("profileEpoch", header.profileEpoch);
  validateDecimalSequence("viewportEpoch", header.viewportEpoch);
  validateDecimalSequence("frameSeq", header.frameSeq);

  if (
    typeof header.captureTimeUnixMs !== "number" ||
    !Number.isFinite(header.captureTimeUnixMs) ||
    header.captureTimeUnixMs < 0 ||
    header.captureTimeUnixMs > MAX_SAFE_JS_INT
  ) {
    throw new FrameProtocolError(
      `captureTimeUnixMs exceeds safe JS integer range: ${header.captureTimeUnixMs}`,
      "INVALID_CAPTURE_TIME",
    );
  }

  if (typeof header.inputTrusted !== "boolean") {
    throw new FrameProtocolError(
      "inputTrusted must be a boolean",
      "INVALID_HEADER",
    );
  }

  if (
    typeof header.width !== "number" ||
    typeof header.height !== "number" ||
    !Number.isInteger(header.width) ||
    !Number.isInteger(header.height) ||
    header.width <= 0 ||
    header.width > MAX_IMAGE_WIDTH ||
    header.height <= 0 ||
    header.height > MAX_IMAGE_HEIGHT
  ) {
    throw new FrameProtocolError(
      `Image dimensions out of bounds: ${header.width}x${header.height}`,
      "DIMENSIONS_OUT_OF_BOUNDS",
    );
  }

  const pixels = header.width * header.height;
  if (pixels > MAX_PIXELS) {
    throw new FrameProtocolError(
      `Pixel count ${pixels} exceeds safety ceiling ${MAX_PIXELS}`,
      "PIXEL_CEILING_EXCEEDED",
    );
  }

  validateGeometry(header.geometry);
}

/**
 * Parses JPEG SOF (Start of Frame) marker to inspect image dimensions.
 */
export function parseJpegDimensions(
  data: Uint8Array,
): { width: number; height: number } {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    throw new FrameProtocolError(
      "Not a valid JPEG stream (missing SOI)",
      "INVALID_JPEG",
    );
  }

  let idx = 2;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  while (idx + 4 <= data.length) {
    if (data[idx] !== 0xff) {
      idx += 1;
      continue;
    }
    const marker = data[idx + 1];
    idx += 2;

    // Ignore fill bytes
    if (marker === 0xff || marker === 0x00) {
      continue;
    }

    // Standalone markers without length
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (idx + 2 > data.length) {
      break;
    }

    const segLen = view.getUint16(idx, false);
    if (segLen < 2 || idx + segLen > data.length) {
      throw new FrameProtocolError(
        "Malformed JPEG segment length",
        "INVALID_JPEG",
      );
    }

    // SOF0 (Baseline 0xC0), SOF1 (Extended 0xC1), SOF2 (Progressive 0xC2)
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (segLen < 7) {
        throw new FrameProtocolError(
          "SOF segment too short",
          "INVALID_JPEG",
        );
      }
      // Layout: [len: 2] [precision: 1] [height: 2] [width: 2]
      const height = view.getUint16(idx + 3, false);
      const width = view.getUint16(idx + 5, false);
      return { width, height };
    }

    idx += segLen;
  }

  throw new FrameProtocolError("SOF marker not found in JPEG", "INVALID_JPEG");
}

/**
 * Unpacks and validates a BHJF frame from raw binary WebSocket data.
 */
export function unpackBhjfFrame(
  buffer: ArrayBuffer | Uint8Array,
): ParsedFrame {
  const bytes =
    buffer instanceof Uint8Array
      ? buffer
      : new Uint8Array(buffer);

  if (bytes.length < BHJF_PREFIX_LEN) {
    throw new FrameProtocolError(
      `Message too short: ${bytes.length} < ${BHJF_PREFIX_LEN}`,
      "MESSAGE_TOO_SHORT",
    );
  }

  if (bytes.length > MAX_FRAME_MESSAGE_BYTES) {
    throw new FrameProtocolError(
      `Message exceeds maximum frame size: ${bytes.length} > ${MAX_FRAME_MESSAGE_BYTES}`,
      "MESSAGE_TOO_LARGE",
    );
  }

  // Check Magic "BHJF"
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== BHJF_MAGIC[i]) {
      throw new FrameProtocolError("Invalid BHJF magic", "INVALID_MAGIC");
    }
  }

  // Version 1
  if (bytes[4] !== BHJF_VERSION) {
    throw new FrameProtocolError(
      `Unsupported protocol version: ${bytes[4]}`,
      "UNSUPPORTED_VERSION",
    );
  }

  // Flags 0
  if (bytes[5] !== BHJF_FLAGS_NONE) {
    throw new FrameProtocolError(
      `Unsupported flags: ${bytes[5]}`,
      "UNSUPPORTED_FLAGS",
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Reserved 0 (bytes 12..16)
  const reserved = view.getUint32(12, false);
  if (reserved !== 0) {
    throw new FrameProtocolError(
      `Reserved field must be 0, got ${reserved}`,
      "UNSUPPORTED_FLAGS",
    );
  }

  const headerLen = view.getUint16(6, false);
  if (headerLen === 0 || headerLen > MAX_JSON_HEADER_BYTES) {
    throw new FrameProtocolError(
      `Invalid header length: ${headerLen}`,
      "INVALID_HEADER_LENGTH",
    );
  }

  const payloadLen = view.getUint32(8, false);
  if (payloadLen === 0 || payloadLen > MAX_JPEG_PAYLOAD_BYTES) {
    throw new FrameProtocolError(
      `Invalid payload length: ${payloadLen}`,
      "INVALID_PAYLOAD_LENGTH",
    );
  }

  const expectedTotal = BHJF_PREFIX_LEN + headerLen + payloadLen;
  if (expectedTotal !== bytes.length) {
    throw new FrameProtocolError(
      `Message length mismatch: expected ${expectedTotal}, got ${bytes.length}`,
      "LENGTH_MISMATCH",
    );
  }

  const headerStart = BHJF_PREFIX_LEN;
  const headerEnd = headerStart + headerLen;
  const headerBytes = bytes.subarray(headerStart, headerEnd);
  const jpegPayload = bytes.subarray(headerEnd);

  let header: TargetFrameHeader;
  try {
    const textDecoder = new TextDecoder("utf-8", { fatal: true });
    const jsonStr = textDecoder.decode(headerBytes);
    header = JSON.parse(jsonStr) as TargetFrameHeader;
  } catch (err) {
    throw new FrameProtocolError(
      `Failed to parse JSON header: ${err instanceof Error ? err.message : String(err)}`,
      "INVALID_JSON_HEADER",
    );
  }

  validateTargetFrameHeader(header);

  // Validate actual JPEG payload dimensions against header
  const { width: realW, height: realH } = parseJpegDimensions(jpegPayload);
  if (realW !== header.width || realH !== header.height) {
    throw new FrameProtocolError(
      `Header dimensions (${header.width}x${header.height}) do not match JPEG SOF (${realW}x${realH})`,
      "DIMENSION_MISMATCH",
    );
  }

  return { header, jpegPayload };
}

/**
 * Packs a target-scoped header and JPEG payload into an atomic BHJF buffer.
 */
export function packBhjfFrame(
  header: TargetFrameHeader,
  jpegPayload: Uint8Array,
): Uint8Array {
  validateTargetFrameHeader(header);

  if (jpegPayload.length === 0 || jpegPayload.length > MAX_JPEG_PAYLOAD_BYTES) {
    throw new FrameProtocolError(
      `Invalid JPEG payload length: ${jpegPayload.length}`,
      "INVALID_PAYLOAD_LENGTH",
    );
  }

  const { width: realW, height: realH } = parseJpegDimensions(jpegPayload);
  if (realW !== header.width || realH !== header.height) {
    throw new FrameProtocolError(
      `Header dimensions (${header.width}x${header.height}) do not match JPEG SOF (${realW}x${realH})`,
      "DIMENSION_MISMATCH",
    );
  }

  const textEncoder = new TextEncoder();
  const headerBytes = textEncoder.encode(JSON.stringify(header));
  if (headerBytes.length === 0 || headerBytes.length > MAX_JSON_HEADER_BYTES) {
    throw new FrameProtocolError(
      `Header JSON length ${headerBytes.length} exceeds limit ${MAX_JSON_HEADER_BYTES}`,
      "INVALID_HEADER_LENGTH",
    );
  }

  const totalLen = BHJF_PREFIX_LEN + headerBytes.length + jpegPayload.length;
  if (totalLen > MAX_FRAME_MESSAGE_BYTES) {
    throw new FrameProtocolError(
      `Total frame message length ${totalLen} exceeds limit ${MAX_FRAME_MESSAGE_BYTES}`,
      "MESSAGE_TOO_LARGE",
    );
  }

  const out = new Uint8Array(totalLen);
  // 0..4: ASCII "BHJF"
  out.set(BHJF_MAGIC, 0);
  // 4: version 1
  out[4] = BHJF_VERSION;
  // 5: flags 0
  out[5] = BHJF_FLAGS_NONE;

  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  // 6..8: header length
  view.setUint16(6, headerBytes.length, false);
  // 8..12: jpeg payload length
  view.setUint32(8, jpegPayload.length, false);
  // 12..16: reserved 0
  view.setUint32(12, 0, false);

  // Header JSON
  out.set(headerBytes, BHJF_PREFIX_LEN);
  // JPEG Payload
  out.set(jpegPayload, BHJF_PREFIX_LEN + headerBytes.length);

  return out;
}
