import { describe, expect, it } from "vitest";
import { shouldCaptureE2E } from "../../e2e/fixtures/capture-policy.js";

describe("shouldCaptureE2E capture policy", () => {
  it("defaults to true for local runs when E2E_CAPTURE and CI are unset", () => {
    expect(shouldCaptureE2E({})).toBe(true);
    expect(shouldCaptureE2E({ E2E_CAPTURE: "", CI: "" })).toBe(true);
  });

  it("defaults to false in CI when CI is truthy and E2E_CAPTURE is unset", () => {
    expect(shouldCaptureE2E({ CI: "true" })).toBe(false);
    expect(shouldCaptureE2E({ CI: "1" })).toBe(false);
    expect(shouldCaptureE2E({ CI: "ci" })).toBe(false);
  });

  it("treats CI='0' and CI='false' as non-CI (defaults to true)", () => {
    expect(shouldCaptureE2E({ CI: "0" })).toBe(true);
    expect(shouldCaptureE2E({ CI: "false" })).toBe(true);
    expect(shouldCaptureE2E({ CI: "FALSE" })).toBe(true);
  });

  it("honors explicit E2E_CAPTURE=1 or true even in CI", () => {
    expect(shouldCaptureE2E({ E2E_CAPTURE: "1", CI: "true" })).toBe(true);
    expect(shouldCaptureE2E({ E2E_CAPTURE: "true", CI: "1" })).toBe(true);
    expect(shouldCaptureE2E({ E2E_CAPTURE: "TRUE", CI: "true" })).toBe(true);
    expect(shouldCaptureE2E({ E2E_CAPTURE: " 1 ", CI: "true" })).toBe(true);
  });

  it("honors explicit E2E_CAPTURE=0 or false for local runs", () => {
    expect(shouldCaptureE2E({ E2E_CAPTURE: "0" })).toBe(false);
    expect(shouldCaptureE2E({ E2E_CAPTURE: "false" })).toBe(false);
    expect(shouldCaptureE2E({ E2E_CAPTURE: "FALSE" })).toBe(false);
    expect(shouldCaptureE2E({ E2E_CAPTURE: " 0 " })).toBe(false);
  });

  it("throws clear actionable error on invalid non-empty E2E_CAPTURE values", () => {
    expect(() => shouldCaptureE2E({ E2E_CAPTURE: "yes" })).toThrowError(
      /Invalid E2E_CAPTURE value: "yes"/,
    );
    expect(() => shouldCaptureE2E({ E2E_CAPTURE: "2" })).toThrowError(
      /Invalid E2E_CAPTURE value: "2"/,
    );
    expect(() => shouldCaptureE2E({ E2E_CAPTURE: "disabled" })).toThrowError(
      /Invalid E2E_CAPTURE value: "disabled"/,
    );
  });
});
