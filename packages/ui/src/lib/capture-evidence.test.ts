import { describe, expect, it } from "vitest";
import * as path from "node:path";
import {
  validatePngBuffer,
  resolveCaseDestination,
  computeSourceFingerprint,
  REPO_ROOT,
} from "../../e2e/fixtures/capture-evidence.js";

function createMinimalPngBuffer(width = 1440, height = 900): Buffer {
  const buffer = Buffer.alloc(24);
  // PNG signature
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  // Chunk length (13 bytes for IHDR)
  buffer.writeUInt32BE(13, 8);
  // Chunk type 'IHDR'
  buffer.write("IHDR", 12, "ascii");
  // Width and height
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe("validatePngBuffer", () => {
  it("decodes width and height from valid PNG IHDR chunk", () => {
    const png = createMinimalPngBuffer(1440, 900);
    const dimensions = validatePngBuffer(png);
    expect(dimensions).toEqual({ width: 1440, height: 900 });
  });

  it("decodes custom viewport dimensions", () => {
    const png = createMinimalPngBuffer(800, 600);
    const dimensions = validatePngBuffer(png);
    expect(dimensions).toEqual({ width: 800, height: 600 });
  });

  it("throws on buffer smaller than 24 bytes", () => {
    const truncated = Buffer.alloc(20);
    expect(() => validatePngBuffer(truncated)).toThrowError(
      /Buffer too small to be a valid PNG/,
    );
  });

  it("throws on invalid PNG magic signature", () => {
    const corrupted = createMinimalPngBuffer();
    corrupted[0] = 0x00;
    expect(() => validatePngBuffer(corrupted)).toThrowError(
      /Invalid PNG header signature/,
    );
  });

  it("throws if chunk type is not IHDR", () => {
    const nonIhdr = createMinimalPngBuffer();
    nonIhdr.write("IDAT", 12, "ascii");
    expect(() => validatePngBuffer(nonIhdr)).toThrowError(
      /Expected IHDR chunk, got IDAT/,
    );
  });

  it("throws if dimensions are zero or negative", () => {
    const zeroDim = createMinimalPngBuffer(0, 900);
    expect(() => validatePngBuffer(zeroDim)).toThrowError(
      /Invalid PNG dimensions/,
    );
  });
});

describe("resolveCaseDestination", () => {
  const validCaseDir = path.resolve(REPO_ROOT, "packages/ui/e2e/privacy-heavy-blur");

  it("resolves default screenshot.png inside allowlisted case folder", () => {
    const res = resolveCaseDestination(validCaseDir);
    expect(res.fileName).toBe("screenshot.png");
    expect(res.caseName).toBe("privacy-heavy-blur");
    expect(res.destinationPath).toBe(path.join(validCaseDir, "screenshot.png"));
  });

  it("resolves named checkpoint file name", () => {
    const res = resolveCaseDestination(validCaseDir, "narrow-viewport");
    expect(res.fileName).toBe("narrow-viewport.png");
    expect(res.destinationPath).toBe(path.join(validCaseDir, "narrow-viewport.png"));
  });

  it("rejects path traversal in checkpoint name", () => {
    expect(() =>
      resolveCaseDestination(validCaseDir, "../evil"),
    ).toThrowError(/Invalid checkpoint name/);
    expect(() =>
      resolveCaseDestination(validCaseDir, "evil/nested"),
    ).toThrowError(/Invalid checkpoint name/);
  });

  it("rejects case directory outside packages/ui/e2e", () => {
    const invalidDir = path.resolve(REPO_ROOT, "packages/ui/src");
    expect(() => resolveCaseDestination(invalidDir)).toThrowError(
      /Case directory must be a subfolder inside packages\/ui\/e2e/,
    );
  });

  it("rejects packages/ui/e2e root directory as a case destination", () => {
    const e2eRoot = path.resolve(REPO_ROOT, "packages/ui/e2e");
    expect(() => resolveCaseDestination(e2eRoot)).toThrowError(
      /Case directory must be a subfolder inside packages\/ui\/e2e/,
    );
  });
});

describe("computeSourceFingerprint", () => {
  it("returns gitHead string and SHA-256 sourceFingerprint hex", () => {
    const res = computeSourceFingerprint(REPO_ROOT);
    expect(res.gitHead).toMatch(/^[0-9a-f]{40}$/);
    expect(res.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
