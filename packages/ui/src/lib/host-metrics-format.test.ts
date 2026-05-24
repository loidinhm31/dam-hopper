import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatPercent,
  formatUsage,
} from "./host-metrics-format.js";

describe("host metrics formatting", () => {
  it("formats byte values compactly", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });

  it("formats invalid and bounded percentages", () => {
    expect(formatPercent(undefined)).toBe("0%");
    expect(formatPercent(Number.NaN)).toBe("0%");
    expect(formatPercent(-10)).toBe("0%");
    expect(formatPercent(42.4)).toBe("42%");
    expect(formatPercent(120)).toBe("100%");
  });

  it("marks usage unavailable when totals are zero", () => {
    expect(formatUsage(100, 0)).toBe("unavailable");
    expect(formatUsage(1024, 2048)).toBe("1.0 KB / 2.0 KB");
  });
});
