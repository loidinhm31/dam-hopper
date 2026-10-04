import type { PngDimensions } from "./capture-evidence-types.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Validates that buffer starts with PNG magic number and decodes width/height from IHDR chunk.
 */
export function validatePngBuffer(buffer: Buffer): PngDimensions {
  if (buffer.length < 24) {
    throw new Error(`Buffer too small to be a valid PNG: ${buffer.length} bytes`);
  }
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Invalid PNG header signature");
  }
  const chunkType = buffer.toString("ascii", 12, 16);
  if (chunkType !== "IHDR") {
    throw new Error(`Expected IHDR chunk, got ${chunkType}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid PNG dimensions: ${width}x${height}`);
  }
  return { width, height };
}
