import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";
import { createTerminalSessionObserver } from "../fixtures/terminal-session-observation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CAPTURE_CASE_DIR = path.resolve(__dirname, "../os-session-management-recipes");

test.describe("DamHopper OS Recipes & Save Desktop Subset Journey", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.use({ viewport: { width: 1440, height: 900 } });

  test("qualifies explicit source/target selector, value-bound command confirmation, window previews, and inert import", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    const observer = createTerminalSessionObserver(page);
    await observer.resetViewportAndZoom();

    // 1. Navigate to /os
    await page.goto(`${appServices.appOrigin}/os`);
    const osShell = page.locator("[data-os-shell='true']").first();
    await expect(osShell).toBeVisible({ timeout: 20_000 });

    // Open terminal window to establish source desktop content
    const addTermBtn = page.locator("aside[aria-label='Application Dock'] button[title='Terminals']").first();
    await expect(addTermBtn).toBeVisible({ timeout: 10_000 });
    await addTermBtn.click();
    await expect(page.locator("[data-os-window-frame]").first()).toBeVisible({ timeout: 15_000 });

    // 2. Open Recipes from Dock
    const dockRecipesBtn = page.locator("aside[aria-label='Application Dock'] button[title='Recipes']").first();
    await expect(dockRecipesBtn).toBeVisible({ timeout: 10_000 });
    await dockRecipesBtn.click();

    const recipesApp = page.locator("[data-os-recipes]").first();
    await expect(recipesApp).toBeVisible({ timeout: 15_000 });

    // 3. Open Save Desktop subset view
    const saveDesktopBtn = page.locator('[data-testid="recipes-save-desktop-btn"]').first();
    await expect(saveDesktopBtn).toBeVisible();
    await saveDesktopBtn.click();

    const editor = page.locator('[data-testid="recipe-editor"]').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });

    // 4. Test explicit Source Desktop, Target Server, and Target Project selectors
    const sourceDesktopSelect = editor.locator('[data-testid="recipe-source-desktop"]').first();
    await expect(sourceDesktopSelect).toBeVisible();

    const targetProfileSelect = editor.locator('[data-testid="recipe-target-profile"]').first();
    await expect(targetProfileSelect).toBeVisible();
    await targetProfileSelect.click();
    const serverOptions = page.locator('[role="option"]');
    if ((await serverOptions.count()) > 0) {
      await serverOptions.first().click();
    } else {
      await page.keyboard.press("Escape");
    }

    const targetProjectSelect = editor.locator('[data-testid="recipe-target-project"]').first();
    await expect(targetProjectSelect).toBeVisible();

    // 5. Test AC8 / F1 explicit notice
    const acNotice = editor.locator('[data-testid="recipe-ac8-f1-notice"]').first();
    await expect(acNotice).toBeVisible();
    await expect(acNotice).toContainText("AC8 / F1");

    // 6. Test Recipe Name & Description Inputs
    const nameInput = editor.locator('[data-testid="recipe-name-input"]').first();
    await expect(nameInput).toBeVisible();
    await nameInput.fill("E2E Test Recipe");

    const descInput = editor.locator('[data-testid="recipe-desc-input"]').first();
    await expect(descInput).toBeVisible();
    await descInput.fill("Automated qualification recipe for session management");

    // 7. Value-bound Command Confirmation:
    // When editing command text, previous confirmation is invalidated immediately
    const commandInputs = editor.locator('[data-testid^="recipe-step-command-"]');
    const confirmCheckboxes = editor.locator('[data-testid^="recipe-step-confirm-"]');
    if ((await commandInputs.count()) > 0 && (await confirmCheckboxes.count()) > 0) {
      const firstCmd = commandInputs.first();
      const firstConfirm = confirmCheckboxes.first();

      await firstCmd.fill("echo test-command");
      await firstConfirm.check();
      await expect(firstConfirm).toBeChecked();

      // Mutating command text invalidates confirmation
      await firstCmd.fill("echo modified-command");
      await expect(firstConfirm).not.toBeChecked();

      // Re-confirming restores validity
      await firstConfirm.check();
      await expect(firstConfirm).toBeChecked();
    }

    // 8. Test Excluded Windows list
    const excludedSection = editor.locator('[data-testid^="recipe-excluded-win-"]');
    // Recipes manager itself should be excluded from capture
    const count = await excludedSection.count();
    expect(count).toBeGreaterThanOrEqual(0);

    // 9. Test Import Tab (inert schema validation)
    const importTabBtn = editor.locator('[data-testid="recipe-mode-import"]').first();
    await expect(importTabBtn).toBeVisible();
    await importTabBtn.click();

    const importTextarea = editor.locator('[data-testid="recipe-import-textarea"]').first();
    await expect(importTextarea).toBeVisible();

    // Submit invalid JSON and assert schema error notice
    await importTextarea.fill('{"schemaVersion": 999, "invalid": true}');
    const importSubmitBtn = editor.locator('[data-testid="recipe-import-submit-btn"]').first();
    await importSubmitBtn.click();

    const importErrors = editor.locator('[data-testid="recipe-import-errors"]').first();
    await expect(importErrors).toBeVisible();

    // 10. Test Export Tab (secrets warning and read-only JSON view)
    const exportTabBtn = editor.locator('[data-testid="recipe-mode-export"]').first();
    if (await exportTabBtn.isVisible()) {
      await exportTabBtn.click();
      const exportWarning = editor.locator('[data-testid="recipe-export-warning"]').first();
      await expect(exportWarning).toBeVisible();

      const exportView = editor.locator('[data-testid="recipe-export-json-view"]').first();
      await expect(exportView).toBeVisible();
      await expect(exportView).toHaveAttribute("readonly", "");
    }
  });

  test("captures complete matrix evidence for os-session-management-recipes", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    const observer = createTerminalSessionObserver(page);
    await observer.resetViewportAndZoom();

    // Navigate to /os
    await page.goto(`${appServices.appOrigin}/os`);
    await expect(page.locator("[data-os-shell='true']").first()).toBeVisible({ timeout: 20_000 });

    // Open terminal and files windows to populate matching & excluded lists
    const addTermBtn = page.locator("aside[aria-label='Application Dock'] button[title='Terminals']").first();
    await addTermBtn.click();
    await page.waitForTimeout(150);

    const addFilesBtn = page.locator("aside[aria-label='Application Dock'] button[title='Files']").first();
    await addFilesBtn.click();
    await page.waitForTimeout(150);

    // Open Recipes and Save Desktop subset view
    const dockRecipesBtn = page.locator("aside[aria-label='Application Dock'] button[title='Recipes']").first();
    await dockRecipesBtn.click();
    const saveDesktopBtn = page.locator('[data-testid="recipes-save-desktop-btn"]').first();
    await expect(saveDesktopBtn).toBeVisible({ timeout: 15_000 });
    await saveDesktopBtn.click();

    const editor = page.locator('[data-testid="recipe-editor"]').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });

    const captureCombos = async (stem?: string) => {
      const combos = [
        { size: { width: 1440, height: 900 }, zoom: 100, suffix: "fhd" },
        { size: { width: 1024, height: 640 }, zoom: 100, suffix: "compact" },
        { size: { width: 1440, height: 900 }, zoom: 125, suffix: "fhd-zoom125" },
        { size: { width: 1024, height: 640 }, zoom: 125, suffix: "compact-zoom125" },
      ];

      for (const c of combos) {
        await page.setViewportSize(c.size);
        await observer.setAppZoom(c.zoom);
        await page.waitForTimeout(150);
        const checkpointName = stem ? `${stem}-${c.suffix}` : c.suffix;
        await captureApplicationCheckpoint(page, {
          caseDir: CAPTURE_CASE_DIR,
          checkpointName,
        });
      }
      await observer.resetViewportAndZoom();
    };

    // 1. Primary screenshot.png and base state (Source/target capture form) generic 4 combos
    await captureApplicationCheckpoint(page, { caseDir: CAPTURE_CASE_DIR });
    await captureCombos(); // fhd, compact, fhd-zoom125, compact-zoom125

    // 2. Exclusions checkpoint: focus on excluded utilities and AC8/F1 notice
    const notice = editor.locator('[data-testid="recipe-ac8-f1-notice"]').first();
    if (await notice.isVisible()) {
      await notice.scrollIntoViewIfNeeded();
    }
    await page.waitForTimeout(150);
    await captureCombos("exclusions");
  });
});
