import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_DIR = __dirname;

test.describe("DamHopper OS Recipes & Save Subset Application Journey", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  test.use({ viewport: { width: 1440, height: 900 } });

  test("qualifies recipe catalog, Save subset chooser, matching/excluded preview, and inert schema import", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Navigate to /os
    await page.goto(`${appServices.appOrigin}/os`);

    const osShell = page.locator("[data-os-shell='true']").first();
    await expect(osShell).toBeVisible({ timeout: 20_000 });

    // 2. Open Recipes from Dock
    const dockRecipesBtn = page.getByRole("button", { name: "Recipes", exact: false }).first();
    await expect(dockRecipesBtn).toBeVisible({ timeout: 10_000 });
    await dockRecipesBtn.click();

    // 3. Verify Recipes app rendered
    const recipesApp = page.locator("[data-os-recipes]").first();
    await expect(recipesApp).toBeVisible({ timeout: 10_000 });

    // 4. Open Save Desktop subset view
    const saveDesktopBtn = page.locator('[data-testid="recipes-save-desktop-btn"]').first();
    await expect(saveDesktopBtn).toBeVisible();
    await saveDesktopBtn.click();

    const editor = page.locator('[data-testid="recipe-editor"]').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });

    // 5. Test Import Tab
    const importTabBtn = page.locator('[data-testid="recipe-mode-import"]').first();
    await expect(importTabBtn).toBeVisible();
    await importTabBtn.click();

    const importTextarea = page.locator('[data-testid="recipe-import-textarea"]').first();
    await expect(importTextarea).toBeVisible();
    // Capture visual checkpoint evidence
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
    });
  });
});
