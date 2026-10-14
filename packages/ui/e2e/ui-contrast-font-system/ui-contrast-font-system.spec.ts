import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";

const CASE_DIR = path.dirname(fileURLToPath(import.meta.url));

test.describe("UI Selection Contrast & Adaptive System Typography E2E", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  test.use({ servicesConfig: { authBackend: "sqlite" } });

  test("verifies high-contrast selection markers and adaptive system typography across desktop and compact viewports", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    // 1. Navigate to Workspace
    await page.goto(`${appServices.appOrigin}/workspace`);

    // 2. Switch to Traditional Terminal view
    await page.getByTestId("top-nav-workspace-mode-switch").getByRole("button", { name: "Terminal", exact: true }).click();
    await page.getByRole("button", { name: /^traditional$/i }).click();

    // 3. Open terminal in fixture project
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /^fixture-project\b/ }).click();
    await page.getByRole("button", { name: "Open terminal in fixture-project", exact: true }).click();

    // 4. Verify left sidebar navigation and high-contrast selection styling
    const navigator = page.getByRole("navigation", { name: "Terminal projects and agents", exact: true });
    await expect(navigator).toBeVisible();

    // Locate the active project tab
    const activeProjectTab = navigator.getByRole("tab", { name: /fixture-project\b/ });
    await expect(activeProjectTab).toBeVisible();
    await expect(activeProjectTab).toHaveAttribute("aria-selected", "true");

    // Verify parent presentation container has workbench-selection class and inset marker
    const selectedRowContainer = navigator.locator(".workbench-selection").first();
    await expect(selectedRowContainer).toBeVisible();

    const computedStyles = await selectedRowContainer.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        boxShadow: s.boxShadow,
        backgroundColor: s.backgroundColor,
        color: s.color,
      };
    });

    expect(computedStyles.boxShadow).toContain("3px 0px 0px 0px inset");
    expect(computedStyles.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");

    // Capture primary desktop checkpoint (screenshot.png at 1440x900)
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "screenshot",
    });

    // 5. Navigate to Settings -> Appearance and test system font size scaling
    await page.goto(`${appServices.appOrigin}/settings`);
    const appearanceHeader = page.getByRole("button", { name: /^Appearance\b/i });
    await expect(appearanceHeader).toBeVisible();
    await appearanceHeader.click();

    // Verify System font size stepper is present
    const appearanceSection = page.locator("section", { hasText: "Appearance" });
    await expect(appearanceSection.getByText("System font size", { exact: true })).toBeVisible();

    // Increase system font size using the stepper
    const increaseBtn = appearanceSection.locator("button", { hasText: "+" }).first();
    await expect(increaseBtn).toBeVisible();

    // Click 4 times to increase font size from 14 to 18
    await increaseBtn.click();
    await increaseBtn.click();
    await increaseBtn.click();
    await increaseBtn.click();

    // Verify root CSS variable --app-font-size updated
    await expect.poll(async () => {
      return await page.evaluate(() => document.documentElement.style.getPropertyValue("--app-font-size"));
    }).toBe("18px");

    // 6. Return to Workspace to observe adaptive typography scaling
    await page.goto(`${appServices.appOrigin}/workspace`);
    await expect(navigator).toBeVisible();

    // Capture font-size-scaled checkpoint at 1440x900
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "font-size-scaled",
    });

    // 7. Verify compact viewport (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    const opener = page.getByRole("button", { name: "Projects + Agents", exact: true });
    await expect(opener).toBeVisible();
    await opener.click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // Capture compact mobile checkpoint
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "compact",
    });

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });
});
