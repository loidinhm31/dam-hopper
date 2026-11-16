import { describe, expect, it } from "vitest";
import {
  BHJF_PREFIX_LEN,
  FrameProtocolError,
  MAX_FRAME_MESSAGE_BYTES,
  MAX_IMAGE_HEIGHT,
  MAX_IMAGE_WIDTH,
  type TargetFrameHeader,
} from "../api/browser-host-types.js";
import {
  packBhjfFrame,
  parseJpegDimensions,
  unpackBhjfFrame,
  validateDecimalSequence,
  validateGeometry,
} from "./frame-protocol.js";

/** Creates a minimal valid JPEG byte buffer with SOF0 marker containing given width/height */
export function createMockJpeg(width: number, height: number): Uint8Array {
  // SOI (2 bytes) + DQT (69 bytes) + SOF0 (19 bytes) + EOI (2 bytes)
  const sofLength = 17; // 2 + 1 + 2 + 2 + 1 + 3*3 = 17
  const buf = new Uint8Array(4 + sofLength);

  // SOI
  buf[0] = 0xff;
  buf[1] = 0xd8;

  // SOF0 Marker
  buf[2] = 0xff;
  buf[3] = 0xc0;
  // Segment length (be u16)
  buf[4] = 0x00;
  buf[5] = sofLength;
  // Precision: 8 bits
  buf[6] = 0x08;
  // Height (be u16)
  buf[7] = (height >> 8) & 0xff;
  buf[8] = height & 0xff;
  // Width (be u16)
  buf[9] = (width >> 8) & 0xff;
  buf[10] = width & 0xff;
  // Components: 3 (YCbCr)
  buf[11] = 0x03;

  // Component specs (3 bytes each)
  buf[12] = 0x01; // ID 1
  buf[13] = 0x22; // 2x2 sampling
  buf[14] = 0x00; // Quant table 0

  buf[15] = 0x02; // ID 2
  buf[16] = 0x11;
  buf[17] = 0x01;

  buf[18] = 0x03; // ID 3
  buf[19] = 0x11;
  buf[20] = 0x01;

  return buf;
}

const validHeader: TargetFrameHeader = {
  browserSessionId: "12345678-1234-4234-8234-123456789abc",
  browserIncarnation: "abcdef01-2345-4678-8901-234567890abc",
  profileEpoch: "1",
  producerRun: "fedcba98-7654-4321-8901-abcdef012345",
  viewportEpoch: "1",
  frameSeq: "42",
  width: 800,
  height: 600,
  captureTimeUnixMs: 1700000000000,
  geometry: {
    cssWidth: 800,
    cssHeight: 600,
    offsetTop: 0,
    scrollX: 0,
    scrollY: 0,
    pageScale: 1,
    visualOffsetX: 0,
    visualOffsetY: 0,
    dpr: 1,
  },
  inputTrusted: true,
};

describe("frame-protocol", () => {
  describe("parseJpegDimensions", () => {
    it("parses valid JPEG SOF0 width and height", () => {
      const jpeg = createMockJpeg(1280, 720);
      const dims = parseJpegDimensions(jpeg);
      expect(dims).toEqual({ width: 1280, height: 720 });
    });

    it("rejects data without JPEG SOI marker", () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      expect(() => parseJpegDimensions(data)).toThrow(FrameProtocolError);
    });

    it("rejects truncated JPEG before SOF marker", () => {
      const jpeg = createMockJpeg(640, 480).subarray(0, 3);
      expect(() => parseJpegDimensions(jpeg)).toThrow(FrameProtocolError);
    });
  });

  describe("validateDecimalSequence", () => {
    it("accepts valid positive canonical decimals", () => {
      expect(validateDecimalSequence("seq", "1")).toBe(1n);
      expect(validateDecimalSequence("seq", "42")).toBe(42n);
      expect(validateDecimalSequence("seq", "18446744073709551615")).toBe(
        18446744073709551615n,
      );
    });

    it("rejects zero, leading zeros, signs, whitespace and non-ASCII digits", () => {
      expect(() => validateDecimalSequence("seq", "0")).toThrow(FrameProtocolError);
      expect(() => validateDecimalSequence("seq", "01")).toThrow(FrameProtocolError);
      expect(() => validateDecimalSequence("seq", "+1")).toThrow(FrameProtocolError);
      expect(() => validateDecimalSequence("seq", "-1")).toThrow(FrameProtocolError);
      expect(() => validateDecimalSequence("seq", " 1")).toThrow(FrameProtocolError);
      expect(() => validateDecimalSequence("seq", "1a")).toThrow(FrameProtocolError);
      expect(() => validateDecimalSequence("seq", "")).toThrow(FrameProtocolError);
      expect(() => validateDecimalSequence("seq", "18446744073709551616")).toThrow(
        FrameProtocolError,
      );
    });
  });

  describe("validateGeometry", () => {
    it("accepts valid geometry within bounds", () => {
      expect(() => validateGeometry(validHeader.geometry)).not.toThrow();
    });

    it("rejects non-finite values", () => {
      expect(() =>
        validateGeometry({ ...validHeader.geometry, cssWidth: NaN }),
      ).toThrow(FrameProtocolError);
      expect(() =>
        validateGeometry({ ...validHeader.geometry, dpr: Infinity }),
      ).toThrow(FrameProtocolError);
    });

    it("rejects out of bounds cssWidth or cssHeight", () => {
      expect(() =>
        validateGeometry({ ...validHeader.geometry, cssWidth: 0 }),
      ).toThrow(FrameProtocolError);
      expect(() =>
        validateGeometry({ ...validHeader.geometry, cssWidth: 1921 }),
      ).toThrow(FrameProtocolError);
      expect(() =>
        validateGeometry({ ...validHeader.geometry, cssHeight: 1081 }),
      ).toThrow(FrameProtocolError);
    });

    it("rejects out of bounds scale and offsets", () => {
      expect(() =>
        validateGeometry({ ...validHeader.geometry, pageScale: 0.05 }),
      ).toThrow(FrameProtocolError);
      expect(() =>
        validateGeometry({ ...validHeader.geometry, pageScale: 10.5 }),
      ).toThrow(FrameProtocolError);
      expect(() =>
        validateGeometry({ ...validHeader.geometry, scrollX: 10_000_001 }),
      ).toThrow(FrameProtocolError);
    });
  });

  describe("packBhjfFrame and unpackBhjfFrame", () => {
    it("round-trips a valid frame accurately", () => {
      const jpeg = createMockJpeg(800, 600);
      const packed = packBhjfFrame(validHeader, jpeg);

      expect(packed.length).toBeGreaterThan(BHJF_PREFIX_LEN);
      const unpacked = unpackBhjfFrame(packed);

      expect(unpacked.header).toEqual(validHeader);
      expect(unpacked.jpegPayload).toEqual(jpeg);
    });

    it("rejects packets with invalid magic", () => {
      const jpeg = createMockJpeg(800, 600);
      const packed = packBhjfFrame(validHeader, jpeg);
      packed[0] = 0x58; // 'X'
      expect(() => unpackBhjfFrame(packed)).toThrow("Invalid BHJF magic");
    });

    it("rejects packets with unsupported version or flags", () => {
      const jpeg = createMockJpeg(800, 600);
      const packed = packBhjfFrame(validHeader, jpeg);

      const badVer = new Uint8Array(packed);
      badVer[4] = 2;
      expect(() => unpackBhjfFrame(badVer)).toThrow("Unsupported protocol version");

      const badFlags = new Uint8Array(packed);
      badFlags[5] = 1;
      expect(() => unpackBhjfFrame(badFlags)).toThrow("Unsupported flags");

      const badReserved = new Uint8Array(packed);
      badReserved[12] = 1;
      expect(() => unpackBhjfFrame(badReserved)).toThrow("Reserved field must be 0");
    });

    it("rejects packet length mismatch", () => {
      const jpeg = createMockJpeg(800, 600);
      const packed = packBhjfFrame(validHeader, jpeg);
      // Truncate 10 bytes off the end
      const truncated = packed.subarray(0, packed.length - 10);
      expect(() => unpackBhjfFrame(truncated)).toThrow("Message length mismatch");
    });

    it("rejects header dimension mismatch against JPEG SOF", () => {
      const jpeg = createMockJpeg(800, 600);
      const mismatchedHeader = { ...validHeader, width: 1024, height: 768 };
      expect(() => packBhjfFrame(mismatchedHeader, jpeg)).toThrow(
        "do not match JPEG SOF",
      );
    });

    it("rejects non-canonical UUIDs", () => {
      const jpeg = createMockJpeg(800, 600);
      const badUuidHeader = {
        ...validHeader,
        browserSessionId: "UPPERCASE-1234-4234-8234-123456789ABC",
      };
      expect(() => packBhjfFrame(badUuidHeader, jpeg)).toThrow(
        "must be a canonical lowercase UUID",
      );
    });

    it("rejects pixel ceiling violations", () => {
      const jpeg = createMockJpeg(1920, 1080);
      const badPixelsHeader: TargetFrameHeader = {
        ...validHeader,
        width: 1920,
        height: 1080,
      };
      // 1920 * 1080 = 2,073,600 (within ceiling)
      expect(() => packBhjfFrame(badPixelsHeader, jpeg)).not.toThrow();

      // Over ceiling (e.g. 1920 * 1081)
      const overCeilingHeader: TargetFrameHeader = {
        ...validHeader,
        width: 1920,
        height: 1081,
      };
      expect(() =>
        packBhjfFrame(overCeilingHeader, createMockJpeg(1920, 1081)),
      ).toThrow();
    });
  });
});
