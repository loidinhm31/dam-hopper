import { describe, it, expect } from "vitest";
import fixture from "../../../../server/tests/fixtures/session-changes-wire.json";
import {
  decodeStatus,
  decodeComparison,
  decodeFilePage,
  decodeFileDetail,
  decodeErrorBody,
  decodeRetainedSessionList,
  compareDecimalStrings,
  validateStatusInvariants,
  Status,
} from "./session-changes-types";

describe("session-changes-types", () => {
  it("decodes valid status vectors and passes invariant validation", () => {
    const valid = fixture.valid;
    const statusKeys = [
      "statusSessionStartInitializing",
      "statusSessionStartReady",
      "statusSessionStartIncomplete",
      "statusSessionStartUnavailablePending",
      "statusSessionStartUnavailableReceived",
      "statusFromNowInitializing",
      "statusFromNowReady",
      "statusFromNowIncomplete",
      "statusFromNowUnavailable",
      "statusNullOriginMissing",
      "statusNullOriginUnavailable",
    ] as const;

    for (const key of statusKeys) {
      const raw = valid[key];
      expect(raw, `Missing valid vector ${key}`).toBeDefined();
      const decoded = decodeStatus(raw);
      expect(() => validateStatusInvariants(decoded)).not.toThrow();
    }
  });

  it("rejects invalid status combinations and invalid decimal strings", () => {
    const invalid = fixture.invalid;
    for (const [key, raw] of Object.entries(invalid)) {
      expect(() => {
        const decoded = decodeStatus(raw);
        validateStatusInvariants(decoded);
      }, `Expected ${key} to fail validation`).toThrow();
    }
  });

  it("decodes file page and detail vectors", () => {
    const page = decodeFilePage(fixture.valid.filePage);
    expect(page.version).toBe(1);
    expect(page.files.length).toBe(1);
    expect(page.files[0].path).toBe("src/main.rs");
    expect(page.comparison.changedFileCount).toBe(1);

    const detail = decodeFileDetail(fixture.valid.fileDetail);
    expect(detail.version).toBe(1);
    expect(detail.file.path).toBe("src/main.rs");
    expect(detail.original.content).toContain("fn main()");
    expect(detail.current.content).toContain("println!");
    expect(detail.renderable).toBe(true);
  });

  it("decodes error body and retained session list", () => {
    const errorBody = decodeErrorBody(fixture.valid.errorBody);
    expect(errorBody.code).toBe("refreshRequired");
    expect(errorBody.retryable).toBe(true);

    const retained = decodeRetainedSessionList(fixture.valid.retainedSessionList);
    expect(retained.sessions.length).toBe(1);
    expect(retained.sessions[0].ompSessionId).toBe("omp-session-456");
  });

  it("compares decimal strings safely above 2^53", () => {
    expect(compareDecimalStrings("1", "2")).toBe(-1);
    expect(compareDecimalStrings("2", "1")).toBe(1);
    expect(compareDecimalStrings("10", "10")).toBe(0);

    // Beyond 2^53 - 1 (9007199254740991)
    const large1 = "9007199254740992";
    const large2 = "9007199254740993";
    expect(compareDecimalStrings(large1, large2)).toBe(-1);
    expect(compareDecimalStrings(large2, large1)).toBe(1);
    expect(compareDecimalStrings(large1, large1)).toBe(0);

    expect(() => compareDecimalStrings("01", "1")).toThrow();
    expect(() => compareDecimalStrings("1.5", "2")).toThrow();
    expect(() => compareDecimalStrings("", "2")).toThrow();
  });

  it("performs vector round-trip serialization and decoding", () => {
    const statusReadyRaw = fixture.valid.statusSessionStartReady;
    const decoded = decodeStatus(statusReadyRaw);
    const serialized = JSON.stringify(decoded);
    const roundTripped = decodeStatus(JSON.parse(serialized));
    expect(roundTripped).toEqual(decoded);
  });
});
