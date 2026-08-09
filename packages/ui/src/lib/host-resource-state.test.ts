import { describe, expect, it } from "vitest";
import {
  formatAlertState,
  formatAvailability,
  formatOptionalBytes,
  formatOptionalPercent,
  severityClass,
} from "./host-resource-state.js";

describe("host resource state formatting", () => {
  it("keeps alert and limited-data states explicit", () => {
    expect(formatAlertState("reclaimableCacheHigh")).toBe(
      "High reclaimable cache",
    );
    expect(formatAlertState("limitedData")).toBe("Limited data");
  });

  it("never turns unavailable source data into a number", () => {
    expect(
      formatAvailability({
        state: "stale",
        sampledAt: 1,
        detailCode: "monitorStale",
      }),
    ).toBe("Stale data (monitorStale)");
    expect(formatOptionalBytes(undefined)).toBe("Unavailable");
    expect(formatOptionalPercent(undefined)).toBe("Unavailable");
  });

  it("maps severity to the existing semantic color tokens", () => {
    expect(severityClass("critical")).toContain("color-danger");
    expect(severityClass("warning")).toContain("color-warning");
  });
});
