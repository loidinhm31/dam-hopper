import { describe, expect, it } from "vitest";
import {
  formatAlertState,
  formatAvailability,
  formatBatteryCapacity,
  formatBatteryEnergy,
  formatBatteryPower,
  formatBatteryStatus,
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
    expect(formatOptionalBytes(null)).toBe("Unavailable");
    expect(formatOptionalPercent(null)).toBe("Unavailable");
  });

  it("maps severity to the existing semantic color tokens", () => {
    expect(severityClass("critical")).toContain("color-danger");
    expect(severityClass("warning")).toContain("color-warning");
  });

  it("formats finite battery measurements with stable explicit units", () => {
    expect(formatBatteryStatus("notCharging")).toBe("Not charging");
    expect(formatBatteryStatus(null)).toBeUndefined();
    expect(formatBatteryStatus("BROKEN" as never)).toBeUndefined();
    expect(formatBatteryCapacity(62.5)).toBe("62.5%");
    expect(formatBatteryCapacity(101)).toBeUndefined();
    expect(formatBatteryEnergy(12.5)).toBe("12.5 Wh");
    expect(formatBatteryPower(3.256)).toBe("3.26 W");
    expect(formatBatteryEnergy(Number.NaN)).toBeUndefined();
    expect(formatBatteryPower(-1)).toBeUndefined();
  });
});
