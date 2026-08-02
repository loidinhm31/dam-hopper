import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatPercent,
  formatTokenTotal,
  formatUsageNumber,
  hasTokenTotal,
} from "./UsageFormatters.js";

describe("usage formatters", () => {
  it("formats aggregate numbers and unavailable values", () => {
    expect(formatUsageNumber(12_345)).toBe("12,345");
    expect(formatUsageNumber(null)).toBe("—");
  });

  it("formats compact, readable durations", () => {
    expect(formatDuration(923)).toBe("923ms");
    expect(formatDuration(12_000)).toBe("12s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatDuration(null)).toBe("—");
  });

  it("does not produce a misleading percentage when the denominator is zero", () => {
    expect(formatPercent(4, 5)).toBe("80%");
    expect(formatPercent(0, 0)).toBe("—");
  });

  it("sums only available token aggregates", () => {
    expect(
      formatTokenTotal({
        inputTokens: 1_000,
        cachedInputTokens: null,
        outputTokens: 500,
        reasoningTokens: 100,
      }),
    ).toMatch(/1\.6K|1,600/);
    expect(formatTokenTotal(null)).toBe("—");
  });

  it("subtracts cached input from the primary token total", () => {
    expect(
      formatTokenTotal({
        inputTokens: 1_000,
        cachedInputTokens: 400,
        outputTokens: 500,
        reasoningTokens: 100,
      }),
    ).toMatch(/1\.2K|1,200/);
  });

  it("keeps zero token components visible and all-unavailable totals blank", () => {
    expect(
      formatTokenTotal({
        inputTokens: 0,
        cachedInputTokens: 10,
        outputTokens: 0,
        reasoningTokens: 0,
      }),
    ).toBe("0");
    expect(
      formatTokenTotal({
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
      }),
    ).toBe("—");
    expect(
      hasTokenTotal({
        inputTokens: 0,
        cachedInputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
      }),
    ).toBe(true);
  });
});
