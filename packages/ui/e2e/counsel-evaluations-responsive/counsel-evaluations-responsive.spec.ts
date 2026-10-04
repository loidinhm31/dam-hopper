import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_DIR = __dirname;

test.describe("Counsel Evaluations Responsive Layout Real Application Journey (A06)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  test.use({ viewport: { width: 1440, height: 900 } });

  test("discovers real evaluation descriptors, inspects and compares them, and preserves responsive bounds at 320px docked width", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    // 1. Enable Native Advisor in Settings
    await page.goto(`${appServices.appOrigin}/settings`);
    // Choose matching Settings profile
    const targetSelect = page.locator("#settings-target-select");
    await expect(targetSelect).toBeVisible({ timeout: 15_000 });
    const options = await targetSelect.locator("option").all();
    if (options.length > 1) {
      const val = await options[1].getAttribute("value");
      if (val) {
        await targetSelect.selectOption(val);
      }
    }

    const advisorAccordionBtn = page.locator(
      "button:has-text('Native Advisor')",
    );
    await expect(advisorAccordionBtn).toBeVisible({ timeout: 15_000 });
    await advisorAccordionBtn.click();

    const toggleSwitch = page.locator(
      'button[aria-label="Toggle native advisor"]',
    );
    await expect(toggleSwitch).toBeVisible({ timeout: 10_000 });
    const isChecked = await toggleSwitch.getAttribute("aria-checked");
    if (isChecked !== "true") {
      await toggleSwitch.click();
      await expect(toggleSwitch).toHaveAttribute("aria-checked", "true", {
        timeout: 10_000,
      });
    }

    // 2. Open actual Workspace Advisor and choose Evaluations tab
    await page.goto(`${appServices.appOrigin}/workspace`);

    const advisorActivityBtn = page
      .locator('button[aria-label="Advisor"]')
      .first();
    await expect(advisorActivityBtn).toBeVisible({ timeout: 15_000 });
    await advisorActivityBtn.click();

    const evalsTab = page.locator("#tab-evaluations");
    await expect(evalsTab).toBeVisible({ timeout: 10_000 });
    await evalsTab.click();

    // 3. Observe two known descriptor identities from seeded evaluation documents
    const evalsHeader = page.locator(".evaluations-header");
    await expect(evalsHeader).toBeVisible({ timeout: 10_000 });
    await expect(evalsHeader.locator(".view-title")).toContainText(
      "2 descriptor",
    );

    const cards = page.locator(".descriptor-card");
    await expect(cards).toHaveCount(2, { timeout: 10_000 });

    // Assert descriptor identities from seeded documents
    const cardTexts = await cards.allTextContents();
    const combinedCardText = cardTexts.join(" ");
    expect(
      combinedCardText.includes("eval-group-a") &&
        combinedCardText.includes("eval-group-b"),
    ).toBe(true);

    // Check wide layout bounds before resizing
    const advisorHost = page.locator(".native-advisor").first();
    await expect(advisorHost).toBeVisible();
    const wideHostBox = await advisorHost.boundingBox();
    expect(wideHostBox).not.toBeNull();
    const wideCardBox = await cards.first().boundingBox();
    if (wideCardBox && wideHostBox) {
      expect(wideCardBox.x + wideCardBox.width).toBeLessThanOrEqual(
        wideHostBox.x + wideHostBox.width + 2,
      );
    }
    const wideHeaderBox = await evalsHeader.boundingBox();
    if (wideHeaderBox && wideHostBox) {
      expect(wideHeaderBox.x + wideHeaderBox.width).toBeLessThanOrEqual(
        wideHostBox.x + wideHostBox.width + 2,
      );
    }
    const wideDocOverflow = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
      );
    });
    expect(wideDocOverflow).toBe(true);

    // Verify inspect action on descriptor and detail provenance
    const inspectBtn = cards
      .first()
      .locator('button:has-text("Inspect Descriptor")');
    await expect(inspectBtn).toBeVisible();
    await inspectBtn.click();

    const inspectedCard = page.locator(".inspected-evaluation-card");
    await expect(inspectedCard).toBeVisible({ timeout: 10_000 });
    await expect(inspectedCard).toContainText("Evaluation ID");

    // Verify compare action and resulting comparison groups
    const compareBtn = page.locator(
      'button[aria-label^="Compare available descriptors"]',
    );
    await expect(compareBtn).toBeVisible();
    await compareBtn.click();
    const wideCompareBox = await compareBtn.boundingBox();
    if (wideCompareBox && wideHostBox) {
      expect(wideCompareBox.x + wideCompareBox.width).toBeLessThanOrEqual(
        wideHostBox.x + wideHostBox.width + 2,
      );
    }
    await expect(evalsHeader.locator(".view-title")).toContainText(
      "comparable group",
      { timeout: 10_000 },
    );
    // IdeShell default width is 260px; right panel drag is reversed (-delta increases width)
    const resizeHandle = page.locator(".cursor-col-resize").last();
    await expect(resizeHandle).toBeVisible();

    const handleBox = await resizeHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (handleBox) {
      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      // Move 60px to the left to grow right dock from 260px to 320px
      await page.mouse.move(startX - 60, startY, { steps: 10 });
      await page.mouse.up();
    }

    // Measure actual rendered width of native advisor host in narrow layout
    const hostBox = await advisorHost.boundingBox();
    expect(hostBox).not.toBeNull();
    if (hostBox) {
      expect(Math.abs(hostBox.width - 320)).toBeLessThanOrEqual(1.5);
    }

    // Assert cards remain within narrow panel horizontal bounds
    const narrowCardBox = await cards.first().boundingBox();
    if (narrowCardBox && hostBox) {
      expect(narrowCardBox.x + narrowCardBox.width).toBeLessThanOrEqual(
        hostBox.x + hostBox.width + 2,
      );
    }
    const narrowCompareBox = await compareBtn.boundingBox();
    if (narrowCompareBox && hostBox) {
      expect(narrowCompareBox.x + narrowCompareBox.width).toBeLessThanOrEqual(
        hostBox.x + hostBox.width + 2,
      );
    }
    const narrowHeaderBox = await evalsHeader.boundingBox();
    if (narrowHeaderBox && hostBox) {
      expect(narrowHeaderBox.x + narrowHeaderBox.width).toBeLessThanOrEqual(
        hostBox.x + hostBox.width + 2,
      );
    }
    const narrowDetailBox = await inspectedCard.boundingBox();
    if (narrowDetailBox && hostBox) {
      expect(narrowDetailBox.x + narrowDetailBox.width).toBeLessThanOrEqual(
        hostBox.x + hostBox.width + 2,
      );
    }
    const docOverflow = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
      );
    });
    expect(docOverflow).toBe(true);

    // Assert vertical scrollability operates within panel
    await advisorHost.evaluate((el) => {
      el.scrollTop = 50;
    });

    // 6. Capture complete application viewport at narrow checkpoint (screenshot.png)
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
    });
  });
});
