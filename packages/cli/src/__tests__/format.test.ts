import { describe, it, expect } from "vitest";
import { formatDuration } from "../utils/format.js";

describe("formatDuration", () => {
  it("shows ms for sub-second", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("shows seconds for 1000ms", () => {
    expect(formatDuration(1000)).toBe("1.0s");
  });

  it("shows minutes for 60s", () => {
    expect(formatDuration(62000)).toBe("1m2s");
  });
});
