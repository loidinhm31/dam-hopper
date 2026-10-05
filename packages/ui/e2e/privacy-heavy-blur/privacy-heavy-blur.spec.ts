import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_DIR = __dirname;

test.describe("Privacy Heavy Blur Real Application Journey (A04)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test("activates heavy blur privacy overlay through app controls, isolates input, and restores interaction", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    // 1. Load connected fixture project in actual Workspace
    await page.goto(`${appServices.appOrigin}/workspace`);

    // Wait for the workspace shell and top navigation to be visible
    const topNav = page.locator("nav[aria-label='Primary']").first();
    await expect(topNav).toBeVisible({ timeout: 15_000 });

    const contentRoot = page.locator("[data-cognito-mode-content]");
    await expect(contentRoot).toBeVisible();

    // Confirm original content and surrounding shell before masking
    await expect(page.locator("body")).toBeVisible();
    const initialFileContent = await appServices.readContainerFile(
      "/e2e/workspace/fixture-project/sample.txt",
    );
    expect(initialFileContent).toContain(
      "Hello from E2E isolated environment.",
    );

    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "unmasked-before",
    });

    // 2. Navigate /settings → Appearance; select Heavy Blur
    await page.goto(`${appServices.appOrigin}/settings`);

    // Expand Appearance accordion if collapsed
    const appearanceAccordionBtn = page.locator(
      "button:has-text('Appearance')",
    );
    await expect(appearanceAccordionBtn).toBeVisible({ timeout: 15_000 });
    const isExpanded = await appearanceAccordionBtn.getAttribute("aria-expanded");
    if (isExpanded !== "true") {
      await appearanceAccordionBtn.click();
    }

    const cognitoStyleTrigger = page.locator(
      'button[aria-label="Cognito Mode style"]',
    );
    await expect(cognitoStyleTrigger).toBeVisible({ timeout: 15_000 });
    await cognitoStyleTrigger.click();

    // Select "Heavy Blur" option in the dropdown with auto-wait
    await page.getByRole("option", { name: "Heavy Blur" }).click();

    // Return to /workspace
    await page.goto(`${appServices.appOrigin}/workspace`);
    await expect(contentRoot).toBeVisible();

    // 3. Activate configured Mod+Alt+KeyB chord using Playwright keyboard
    await page.keyboard.press("Control+Alt+KeyB");

    const overlay = page.locator("[data-cognito-mode-overlay]");
    await expect(overlay).toBeVisible({ timeout: 10_000 });

    // Assert overlay covers entire viewport
    const viewportSize = page.viewportSize();
    expect(viewportSize).not.toBeNull();
    const box = await overlay.boundingBox();
    expect(box).not.toBeNull();
    if (box && viewportSize) {
      expect(box.x).toBeLessThanOrEqual(0);
      expect(box.y).toBeLessThanOrEqual(0);
      expect(box.width).toBeGreaterThanOrEqual(viewportSize.width);
      expect(box.height).toBeGreaterThanOrEqual(viewportSize.height);
    }

    // Underlying routed content stays mounted and is inert
    await expect(contentRoot).toHaveAttribute("inert");
    await expect(contentRoot).toHaveAttribute("aria-hidden", "true");

    // Focus trapped at mask sink
    const isOverlayFocused = await page.evaluate(() => {
      const overlayEl = document.querySelector("[data-cognito-mode-overlay]");
      return document.activeElement === overlayEl;
    });
    expect(isOverlayFocused).toBe(true);

    // 4. Attempt coordinate pointer input, printable typing and navigation shortcuts
    // Use actual coordinate events to exercise guard without forceful DOM dispatch
    await page.mouse.click(150, 150);
    await page.keyboard.type("malicious or unintended typing payload");

    // Try application navigation shortcut
    await page.keyboard.press("Control+Alt+KeyO");

    // Assert underlying route and observable state unchanged
    expect(page.url()).toContain("/workspace");
    await expect(contentRoot).toHaveAttribute("inert");
    const afterBlockedContent = await appServices.readContainerFile(
      "/e2e/workspace/fixture-project/sample.txt",
    );
    expect(afterBlockedContent).toBe(initialFileContent);
    // 5. Wrong chord / Escape must not dismiss
    await page.keyboard.press("Escape");
    await expect(overlay).toBeVisible();

    await page.keyboard.press("Control+KeyB");
    await expect(overlay).toBeVisible();

    // Capture full masked application at primary checkpoint (screenshot.png)
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
    });

    // 6. Original chord dismisses; real interaction restored
    await page.keyboard.press("Control+Alt+KeyB");
    await expect(overlay).toBeHidden({ timeout: 10_000 });
    await expect(contentRoot).not.toHaveAttribute("inert");

    // Reload starts inactive
    await page.reload();
    await expect(overlay).toBeHidden();
    await expect(contentRoot).not.toHaveAttribute("inert");
  });
});
