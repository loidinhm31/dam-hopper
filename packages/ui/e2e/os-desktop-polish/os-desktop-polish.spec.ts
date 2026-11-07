import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";
import { createTerminalSessionObserver } from "../fixtures/terminal-session-observation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CAPTURE_CASE_DIR = path.resolve(__dirname, "../os-desktop-polish");

test.describe("DamHopper OS Desktop Polish User Journey (P08)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.use({ viewport: { width: 1440, height: 900 } });

  test("qualifies floating dock, canvas maximize continuity, background context menu, and command palette", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    const observer = createTerminalSessionObserver(page);
    await observer.resetViewportAndZoom();

    // 1. Navigate to /os
    await page.goto(`${appServices.appOrigin}/os`);
    const osShell = page.locator("[data-os-shell='true']").first();
    await expect(osShell).toBeVisible({ timeout: 20_000 });

    // 2. Verify floating dock and applications trigger
    const dock = page.locator('[data-testid="dock-panel"]').first();
    await expect(dock).toBeVisible({ timeout: 10_000 });

    const appsTrigger = page.locator('[data-testid="dock-apps-trigger"]').first();
    await expect(appsTrigger).toBeVisible({ timeout: 10_000 });
    await appsTrigger.click();

    const appLauncher = page.locator('[data-testid="app-launcher-panel"]').first();
    await expect(appLauncher).toBeVisible({ timeout: 5_000 });

    const closeLauncherBtn = page.locator('[data-testid="app-launcher-close"]').first();
    await closeLauncherBtn.click();
    await expect(appLauncher).not.toBeVisible();

    // 3. Launch a window from the dock
    const termBtn = page.locator("button[data-testid='dock-item-terminals']").first();
    await expect(termBtn).toBeVisible({ timeout: 10_000 });
    await termBtn.click();

    const windowFrame = page.locator("[data-os-window-frame]").first();
    await expect(windowFrame).toBeVisible({ timeout: 15_000 });

    // 4. Maximize window and restore
    const maximizeBtn = windowFrame.locator("button[aria-label='Maximize window']").first();
    if (await maximizeBtn.isVisible()) {
      await maximizeBtn.click();
      const maximizedLayer = page.locator('[data-os-maximized-layer="true"]').first();
      await expect(maximizedLayer).toBeVisible({ timeout: 5_000 });

      const restoreBtn = windowFrame.locator("button[aria-label='Restore window']").first();
      await expect(restoreBtn).toBeVisible();
      await restoreBtn.click();
      await expect(maximizedLayer).not.toBeVisible();
    }

    // 5. Open desktop background context menu
    const bgTrigger = page.locator('[data-os-desktop-trigger]').first();
    await expect(bgTrigger).toBeVisible();
    await bgTrigger.click({ button: "right", position: { x: 50, y: 50 } });

    const contextMenu = page.locator('[data-testid="desktop-context-menu"]').first();
    await expect(contextMenu).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
    await expect(contextMenu).not.toBeVisible();

    // 6. Open command palette
    const paletteTrigger = page.locator('button[aria-label^="Open command palette"]').first();
    await expect(paletteTrigger).toBeVisible();
    await paletteTrigger.click();

    const commandPalette = page.locator('[role="dialog"][aria-label="Command Palette"]').first();
    await expect(commandPalette).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
    await expect(commandPalette).not.toBeVisible();
  });
});
