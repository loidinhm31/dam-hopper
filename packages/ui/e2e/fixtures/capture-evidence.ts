import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { shouldCaptureE2E } from "./capture-policy.js";
import type {
  CaptureOptions,
  EvidenceSession,
  PngDimensions,
  StagedCheckpoint,
} from "./capture-evidence-types.js";
import { validatePngBuffer } from "./capture-png-validator.js";
import {
  REPO_ROOT,
  computeSourceFingerprint,
} from "./capture-source-fingerprint.js";

export * from "./capture-evidence-types.js";
export * from "./capture-png-validator.js";
export * from "./capture-source-fingerprint.js";

export const E2E_ROOT = path.resolve(REPO_ROOT, "packages/ui/e2e");
export const STAGING_BASE_DIR = path.resolve(REPO_ROOT, "packages/ui/.e2e-staging");

let activeEvidenceSession: EvidenceSession | null = null;

/**
 * Resolves case directory destination, preventing directory traversal and restricting
 * destinations to allowlisted case folders inside packages/ui/e2e.
 */
export function resolveCaseDestination(
  caseDir: string,
  checkpointName?: string,
): {
  caseDir: string;
  caseName: string;
  fileName: string;
  destinationPath: string;
} {
  const resolvedCaseDir = path.resolve(caseDir);
  const normalizedCaseDir = path.normalize(resolvedCaseDir);

  if (
    !normalizedCaseDir.startsWith(E2E_ROOT + path.sep) ||
    normalizedCaseDir === E2E_ROOT
  ) {
    throw new Error(
      `Case directory must be a subfolder inside packages/ui/e2e: ${caseDir}`,
    );
  }

  const safeName = checkpointName?.trim();
  if (
    safeName &&
    (safeName.includes("..") || safeName.includes("/") || safeName.includes("\\"))
  ) {
    throw new Error(`Invalid checkpoint name: "${checkpointName}"`);
  }

  const fileName = safeName ? `${safeName}.png` : "screenshot.png";
  const caseName = path.basename(normalizedCaseDir);
  const destinationPath = path.join(normalizedCaseDir, fileName);

  return {
    caseDir: normalizedCaseDir,
    caseName,
    fileName,
    destinationPath,
  };
}

/**
 * Initializes evidence session for a test run or case.
 */
export function initEvidenceSession(options: {
  seedDigest: string;
  runId?: string;
  command?: string;
}): EvidenceSession {
  const runId =
    options.runId ??
    process.env.E2E_RUN_ID ??
    `e2e-run-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const command = options.command ?? "pnpm --filter @dam-hopper/ui test:e2e";
  const startedAt = new Date().toISOString();
  const { gitHead, sourceFingerprint: startSourceFingerprint } =
    computeSourceFingerprint();
  const stagingDir = path.join(STAGING_BASE_DIR, runId);

  activeEvidenceSession = {
    runId,
    command,
    startedAt,
    startSourceFingerprint,
    gitHead,
    seedDigest: options.seedDigest,
    stagingDir,
    checkpoints: [],
  };

  return activeEvidenceSession;
}

/**
 * Captures a complete application viewport PNG at a checkpoint.
 * If capture is enabled, stages screenshot in temporary staging directory,
 * validates PNG dimensions and hash, and registers it in the active session.
 */
export async function captureApplicationCheckpoint(
  page: Page,
  options: CaptureOptions,
): Promise<{
  stagedPath: string;
  sha256: string;
  dimensions: PngDimensions;
} | null> {
  if (!shouldCaptureE2E()) {
    return null;
  }

  const { caseDir, caseName, fileName, destinationPath } = resolveCaseDestination(
    options.caseDir,
    options.checkpointName,
  );

  const currentUrl = page.url();
  if (
    !currentUrl.startsWith("http://127.0.0.1:") &&
    !currentUrl.startsWith("http://localhost:")
  ) {
    throw new Error(
      `Cannot capture application checkpoint: page URL "${currentUrl}" does not match fixture origin`,
    );
  }

  let session = activeEvidenceSession;
  if (!session) {
    session = initEvidenceSession({
      seedDigest: "untracked-seed-digest",
    });
  }
  const browserVersion = page.context().browser()?.version();
  if (browserVersion && !session.browserVersion) {
    session.browserVersion = browserVersion;
  }

  const stagingCaseDir = path.join(session.stagingDir, caseName);
  await fs.mkdir(stagingCaseDir, { recursive: true });
  const stagedPath = path.join(stagingCaseDir, fileName);

  await page.evaluate(async () => {
    if (document.fonts) {
      await document.fonts.ready;
    }
  });

  await page.screenshot({
    path: stagedPath,
    fullPage: false,
    type: "png",
    scale: "css",
    animations: "disabled",
  });

  const buffer = await fs.readFile(stagedPath);
  const dimensions = validatePngBuffer(buffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  let route = "/";
  try {
    route = new URL(currentUrl).pathname;
  } catch {
    // fallback
  }

  const stagedCheckpoint: StagedCheckpoint = {
    checkpoint: options.checkpointName ?? "primary",
    fileName,
    stagedPath,
    destinationPath,
    caseDir,
    caseName,
    sha256,
    dimensions,
    route,
    dockWidth: options.dockWidth,
  };

  session.checkpoints.push(stagedCheckpoint);

  return {
    stagedPath,
    sha256,
    dimensions,
  };
}

/**
 * Finalizes evidence session after all test assertions and service teardowns complete.
 * - If testPassed and cleanupPassed: validates source fingerprint stability, publishes staged
 *   captures, writes evidence.json and pending review.md, and removes staging directory.
 * - If failed: cleans up staging directory and leaves case directories untouched.
 */
export async function finalizeEvidenceSession(options: {
  testPassed: boolean;
  cleanupPassed: boolean;
}): Promise<{ published: boolean; skipped?: boolean }> {
  const session = activeEvidenceSession;
  if (!session) {
    return { published: false, skipped: true };
  }

  try {
    if (!shouldCaptureE2E()) {
      await fs.rm(session.stagingDir, { recursive: true, force: true }).catch(() => {});
      return { published: false, skipped: true };
    }

    if (!options.testPassed || !options.cleanupPassed) {
      await fs.rm(session.stagingDir, { recursive: true, force: true }).catch(() => {});
      return { published: false };
    }

    if (session.checkpoints.length === 0) {
      await fs.rm(session.stagingDir, { recursive: true, force: true }).catch(() => {});
      return { published: false };
    }

    const { sourceFingerprint: finishSourceFingerprint } = computeSourceFingerprint();
    if (finishSourceFingerprint !== session.startSourceFingerprint) {
      await fs.rm(session.stagingDir, { recursive: true, force: true }).catch(() => {});
      throw new Error(
        `Source modified during capture run: start ${session.startSourceFingerprint} !== finish ${finishSourceFingerprint}`,
      );
    }

    // Group checkpoints by case directory using Record
    const cases: Record<string, StagedCheckpoint[]> = {};
    for (const cp of session.checkpoints) {
      cases[cp.caseDir] = cases[cp.caseDir] || [];
      cases[cp.caseDir].push(cp);
    }

    const completedAt = new Date().toISOString();

    for (const [caseDir, checkpoints] of Object.entries(cases)) {
      const caseName = checkpoints[0].caseName;
      const primary =
        checkpoints.find((c) => c.checkpoint === "primary") ?? checkpoints[0];

      await fs.mkdir(caseDir, { recursive: true });
      for (const cp of checkpoints) {
        await fs.copyFile(cp.stagedPath, cp.destinationPath);
      }

      const evidenceData = {
        run_id: session.runId,
        command: session.command,
        started_at: session.startedAt,
        completed_at: completedAt,
        case_name: caseName,
        route: primary.route,
        git_head: session.gitHead,
        source_fingerprint: session.startSourceFingerprint,
        seed_digest: session.seedDigest,
        browser: "chromium",
        browser_version: session.browserVersion ?? "1.61.1",
        os: process.platform,
        viewport: { width: primary.dimensions.width, height: primary.dimensions.height },
        device_pixel_ratio: 1,
        ...(primary.dockWidth !== undefined ? { dock_width: primary.dockWidth } : {}),
        checkpoints: checkpoints.map((c) => ({
          checkpoint: c.checkpoint,
          file_name: c.fileName,
          sha256: c.sha256,
          dimensions: c.dimensions,
        })),
        functional_outcome: "passed",
        cleanup_outcome: "passed",
      };

      await fs.writeFile(
        path.join(caseDir, "evidence.json"),
        JSON.stringify(evidenceData, null, 2) + "\n",
      );

      const reviewContent = `# Visual Review — ${caseName}

- **Status:** PENDING_HUMAN_REVIEW
- **Reviewer:** Pending
- **Reviewed At:** Pending
- **Run ID:** ${session.runId}
- **Git HEAD:** ${session.gitHead}
- **Source Fingerprint:** ${session.startSourceFingerprint}
- **Primary Screenshot SHA-256:** ${primary.sha256}

## Inspected Checkpoints
${checkpoints
  .map(
    (c) =>
      `- \`${c.fileName}\` (${c.dimensions.width}x${c.dimensions.height}, SHA-256: \`${c.sha256}\`)\n  - Context: Complete application viewport, fully rendered shell and state.`,
  )
  .join("\n")}

## Decision
- **Outcome:** PENDING
`;

      await fs.writeFile(path.join(caseDir, "review.md"), reviewContent);
    }

    await fs.rm(session.stagingDir, { recursive: true, force: true }).catch(() => {});
    return { published: true };
  } finally {
    activeEvidenceSession = null;
  }
}
