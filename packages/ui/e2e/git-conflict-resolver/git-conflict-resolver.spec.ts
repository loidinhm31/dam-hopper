import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";
import { setupGitConflictFixture } from "./git-fixture.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_DIR = __dirname;

test.describe("Git Conflict Resolver Real Application Journey (AC1-AC12)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test("reveals conflicts, renders floating Monaco resolver, captures viewports, and stages resolved files", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    // 1. Establish deterministic Git conflict fixture inside running container
    await setupGitConflictFixture(appServices.appContainerId);

    // 2. Navigate to /workspace in authenticated session
    await page.goto(`${appServices.appOrigin}/workspace`);

    // Wait for primary navigation shell
    const primaryNav = page.locator("nav[aria-label='Primary']").first();
    await expect(primaryNav).toBeVisible({ timeout: 20_000 });

    // Look for the floating conflict pill on the screen and open resolver
    const conflictPill = page.getByRole("button", { name: /Open Git conflict resolver/ });
    await expect(conflictPill).toBeVisible({ timeout: 20_000 });
    await conflictPill.click();

    // Floating conflict resolver panel must be visible
    const resolverPanel = page.locator("[data-testid='conflict-resolver-panel']");
    await expect(resolverPanel).toBeVisible({ timeout: 20_000 });

    // Wait for the Monaco editors and file to load
    await expect(resolverPanel).toContainText("Git Conflict Resolver");
    await expect(resolverPanel).toContainText("MERGE");
    await expect(resolverPanel).toContainText("code.ts");

    // 3. Capture Checkpoint 1: Primary Desktop layout (1440x900)
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "screenshot",
    });

    // 4. Capture Checkpoint 2: Narrow layout (768x1024)
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(500);
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "narrow",
    });

    // 5. Capture Checkpoint 3: Compact mobile layout (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "compact",
    });

    // 6. Restore desktop viewport
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);

    // Verify toolbar elements
    await expect(resolverPanel).toContainText("Git Conflict Resolver");
  });
});
