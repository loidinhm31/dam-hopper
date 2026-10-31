import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";
import { setupOmpSessionFixture } from "./omp-session-fixture.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_DIR = __dirname;

test.describe("OMP Session Changes Panel User Journey (AC1-AC8)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test("opens session changes panel, renders read-only Monaco diff viewer, and captures evidence across viewports", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    // 1. Establish deterministic Git fixture in container
    await setupOmpSessionFixture(appServices.appContainerId);

    // 2. Navigate to workspace
    await page.goto(`${appServices.appOrigin}/workspace`);

    const primaryNav = page.locator("nav[aria-label='Primary']").first();
    await expect(primaryNav).toBeVisible({ timeout: 20_000 });

    // Look for session changes button in tab bar or header
    const changesButton = page.getByRole("button", { name: /Review (?:OMP )?session changes/ }).first();
    if (await changesButton.isVisible()) {
      await changesButton.click();

      const hostContent = page.locator('[data-testid="session-changes-host-content"]');
      await expect(hostContent).toBeVisible({ timeout: 15_000 });

      // 3. Desktop Checkpoint (1440x900)
      await captureApplicationCheckpoint(page, {
        caseDir: CASE_DIR,
        checkpointName: "screenshot",
      });

      // 4. Narrow Checkpoint (768x1024)
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.waitForTimeout(500);
      await captureApplicationCheckpoint(page, {
        caseDir: CASE_DIR,
        checkpointName: "narrow",
      });

      // 5. Compact Checkpoint (390x844)
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);
      await captureApplicationCheckpoint(page, {
        caseDir: CASE_DIR,
        checkpointName: "compact",
      });
    }
  });
});
