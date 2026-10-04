import fs from "node:fs/promises";
import path from "node:path";

/**
 * Determines whether full-screen E2E screenshot evidence should be captured.
 *
 * Rules (following web-testing skill CI artifact policy):
 * - If E2E_CAPTURE is explicitly "0" or "false", bypass capture.
 * - If running in CI (process.env.CI is truthy) and E2E_CAPTURE is not explicitly enabled ("1" or "true"),
 *   bypass capture to eliminate disk I/O, memory overhead, and CPU load during CI quality gates.
 * - Otherwise (local runs, manual verification, or explicit E2E_CAPTURE=1), capture is active.
 */
export function shouldCaptureE2E(): boolean {
  if (process.env.E2E_CAPTURE === "0" || process.env.E2E_CAPTURE === "false") {
    return false;
  }
  if (
    process.env.CI &&
    process.env.E2E_CAPTURE !== "1" &&
    process.env.E2E_CAPTURE !== "true"
  ) {
    return false;
  }
  return true;
}

/**
 * Saves a full application screen capture to the specified per-test-case folder.
 * Captures the complete viewport/application screen, never a cropped region.
 */
export async function saveE2EScreenshot(
  buffer: Buffer | Uint8Array,
  targetDirectory: string,
  fileName = "screenshot.png",
): Promise<string | null> {
  if (!shouldCaptureE2E()) {
    return null;
  }
  await fs.mkdir(targetDirectory, { recursive: true });
  const destination = path.join(targetDirectory, fileName);
  await fs.writeFile(destination, buffer);
  return destination;
}
