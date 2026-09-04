import { describe, expect, it } from "vitest";
import fixtures from "../../../shared/src/ssh-forward-contract-fixtures.json";
import {
  incrementWireCounter,
  parseUtcTimestamp,
  parseWireCounter,
  wireCounterToBigInt,
} from "./ssh-forward-host.js";

describe("ssh forwarding wire scalars", () => {
  it("strictly parses canonical u64 decimal counters numerically", () => {
    for (const value of fixtures.wireCounters)
      expect(parseWireCounter(value)).toBe(value);
    for (const value of fixtures.invalidWireCounters)
      expect(parseWireCounter(value)).toBeNull();
    expect(wireCounterToBigInt(parseWireCounter("9")!)).toBeLessThan(
      wireCounterToBigInt(parseWireCounter("10")!),
    );
    expect(incrementWireCounter(parseWireCounter("99")!)).toBe("100");
    expect(
      incrementWireCounter(parseWireCounter("18446744073709551615")!),
    ).toBeNull();
  });
  it("allowlists complete redacted native errors", async () => {
    const { parseSshForwardError } = await import("./ssh-forward-host.js");
    expect(
      parseSshForwardError({
        code: "MANAGER_SESSION_MISMATCH",
        message: "fixed",
        retryable: true,
        currentGeneration: "100",
        raw: "discarded",
      }),
    ).toEqual({
      code: "MANAGER_SESSION_MISMATCH",
      message: "fixed",
      retryable: true,
      currentGeneration: "100",
    });
    for (const code of [
      "INVALID_COUNTER",
      "INVALID_TIMESTAMP",
      "INVALID_PROFILE",
      "IDENTITY_CORRUPT",
      "STALE_CLIENT",
      "STORAGE_UNAVAILABLE",
    ]) {
      expect(
        parseSshForwardError({ code, message: "fixed", retryable: false }),
      ).toMatchObject({ code });
    }
    expect(
      parseSshForwardError({
        code: "UNKNOWN",
        message: "raw",
        retryable: true,
      }),
    ).toBeNull();
    expect(
      parseSshForwardError({
        code: "INTERNAL",
        message: "raw",
        retryable: "yes",
      }),
    ).toBeNull();
  });
  it("accepts only exact UTC millisecond timestamps", () => {
    for (const value of fixtures.timestamps)
      expect(parseUtcTimestamp(value)).toBe(value);
    for (const value of fixtures.invalidTimestamps)
      expect(parseUtcTimestamp(value)).toBeNull();
  });
});
