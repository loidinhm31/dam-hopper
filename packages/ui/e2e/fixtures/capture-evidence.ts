import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { Page } from "@playwright/test";
import { shouldCaptureE2E } from "./capture-policy.js";

export interface CaptureOptions {
  caseDir: string;
  checkpointName?: string;
}

/**
 * Captures a complete application viewport PNG under the case folder.
 * Captures the complete viewport, never element-clipped or masked.
 * Returns null if capture is disabled by policy.
 */
export async function captureApplicationCheckpoint(
  page: Page,
  options: CaptureOptions,
): Promise<string | null> {
  if (!shouldCaptureE2E()) {
    return null;
  }

  const fileName = options.checkpointName
    ? `${options.checkpointName}.png`
    : "screenshot.png";
  const destination = path.join(options.caseDir, fileName);

  await fs.mkdir(options.caseDir, { recursive: true });
  await page.screenshot({
    path: destination,
    fullPage: false,
    type: "png",
    scale: "css",
  });

  return destination;
}
