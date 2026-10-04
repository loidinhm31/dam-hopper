/**
 * Unified capture policy for Playwright and browser runners.
 *
 * Rules:
 * - If E2E_CAPTURE is "1" or "true", explicitly enabled.
 * - If E2E_CAPTURE is "0" or "false", explicitly disabled.
 * - If E2E_CAPTURE is any other non-empty value, throws an actionable error.
 * - If E2E_CAPTURE is unset / empty:
 *     - If CI is set and not "0" and not "false", disabled by default in CI.
 *     - Otherwise, enabled by default for local runs.
 */
export function shouldCaptureE2E(): boolean {
  const e2eCapture = process.env.E2E_CAPTURE?.trim();
  if (e2eCapture !== undefined && e2eCapture !== "") {
    if (e2eCapture === "1" || e2eCapture.toLowerCase() === "true") {
      return true;
    }
    if (e2eCapture === "0" || e2eCapture.toLowerCase() === "false") {
      return false;
    }
    throw new Error(
      `Invalid E2E_CAPTURE value: "${e2eCapture}". Expected "1", "true", "0", or "false".`,
    );
  }

  const ci = process.env.CI?.trim();
  if (
    ci !== undefined &&
    ci !== "" &&
    ci !== "0" &&
    ci.toLowerCase() !== "false"
  ) {
    return false;
  }

  return true;
}
