import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { computeSourceFingerprint } from "./capture-source-fingerprint.ts";
import { getContainerEngine, runEngine } from "./container-client.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../..");

export const APP_IMAGE_NAME = "dam-hopper:production-test";
export const APP_BUILDER_IMAGE = "dam-hopper:server-builder";
export const APP_BASE_IMAGE = "dam-hopper:production";
const FINGERPRINT_LABEL = "dam-hopper.source-fingerprint";

/**
 * Inspects whether the test runtime image already exists with a matching source fingerprint.
 */
export async function isImageUpToDate(fingerprint: string): Promise<boolean> {
  if (process.env.E2E_SKIP_BUILD === "1") {
    return true;
  }
  try {
    const labelsRaw = await runEngine([
      "inspect",
      "--format",
      `{{index .Config.Labels "${FINGERPRINT_LABEL}"}}`,
      APP_IMAGE_NAME,
    ]);
    return labelsRaw.trim() === fingerprint;
  } catch {
    return false;
  }
}

/**
 * Ensures the production app and E2E runtime images are built with the current source fingerprint.
 */
export async function ensureApplicationImagesBuilt(force = false): Promise<string> {
  const { sourceFingerprint: fingerprint } = computeSourceFingerprint();

  if (!force && (await isImageUpToDate(fingerprint))) {
    return APP_IMAGE_NAME;
  }

  const engine = await getContainerEngine();
  console.log(`[e2e-image-builder] Building E2E images using ${engine} (fingerprint: ${fingerprint.slice(0, 12)})...`);

  // 1. Build server-builder target
  await runEngine([
    "build",
    "--target",
    "server-builder",
    "-t",
    APP_BUILDER_IMAGE,
    "-f",
    path.join(REPO_ROOT, "Dockerfile"),
    REPO_ROOT,
  ]);

  // 2. Build full production image (web SPA + server)
  await runEngine([
    "build",
    "-t",
    APP_BASE_IMAGE,
    "-f",
    path.join(REPO_ROOT, "Dockerfile"),
    REPO_ROOT,
  ]);

  // 3. Build test runtime image with seed executable
  await runEngine([
    "build",
    "--build-arg",
    `BUILDER_IMAGE=${APP_BUILDER_IMAGE}`,
    "--build-arg",
    `BASE_IMAGE=${APP_BASE_IMAGE}`,
    "--label",
    `${FINGERPRINT_LABEL}=${fingerprint}`,
    "-t",
    APP_IMAGE_NAME,
    "-f",
    path.join(REPO_ROOT, "packages/ui/e2e/fixtures/application-runtime.Dockerfile"),
    REPO_ROOT,
  ]);

  console.log(`[e2e-image-builder] Successfully built ${APP_IMAGE_NAME}`);
  return APP_IMAGE_NAME;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  ensureApplicationImagesBuilt(true)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
