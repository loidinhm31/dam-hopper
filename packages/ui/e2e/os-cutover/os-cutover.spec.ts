import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_DIR = __dirname;

test.describe("DamHopper OS Root Cutover & Legacy Translation Journey", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  test.use({ viewport: { width: 1440, height: 900 } });

  test("qualifies root shell cutover, legacy route translation, retired notices, and placement continuity", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Navigate to root / and verify OsShell mounts as default web experience
    await page.goto(`${appServices.appOrigin}/`);

    const osShell = page.locator("[data-os-shell='true']").first();
    await expect(osShell).toBeVisible({ timeout: 20_000 });

    const brand = page.locator("header").getByText("DH//OS", { exact: true });
    await expect(brand).toBeVisible();

    const desktopTab = page.locator("[role='tablist'][aria-label='Virtual Desktops']").locator("[role='tab']").first();
    await expect(desktopTab).toBeVisible();
    // 2. Test legacy route translation: /workspace redirect to OS
    await page.goto(`${appServices.appOrigin}/workspace`);
    await expect(osShell).toBeVisible({ timeout: 15_000 });

    // 3. Test retired routes display zero-mutation notice: /usage and /ssh-forwarding
    await page.goto(`${appServices.appOrigin}/usage`);
    const usageNotice = page.getByText("Usage & Telemetry Retired", { exact: false });
    await expect(usageNotice).toBeVisible({ timeout: 10_000 });

    await page.goto(`${appServices.appOrigin}/ssh-forwarding`);
    const sshNotice = page.getByText("SSH Port Forwarding Retired", { exact: false });
    await expect(sshNotice).toBeVisible({ timeout: 10_000 });

    // 4. Return to /os and test window placement continuity (zero additional attach/reset)
    await page.goto(`${appServices.appOrigin}/os`);
    await expect(osShell).toBeVisible({ timeout: 15_000 });

    const dockTerminalBtn = page.locator("aside[aria-label='Application Dock'] button[title='Terminals']").first();
    await expect(dockTerminalBtn).toBeVisible({ timeout: 10_000 });
    await dockTerminalBtn.click();

    const initialFrame = page.locator("[data-os-window-frame]").first();
    await expect(initialFrame).toBeVisible({ timeout: 15_000 });
    const termWindowId = await initialFrame.getAttribute("data-os-window-frame");
    expect(termWindowId).toBeTruthy();

    const termFrame = page.locator(`[data-os-window-frame="${termWindowId}"]`);
    const termSlot = termFrame.locator(`[data-os-window-slot="${termWindowId}"]`);
    await expect(termSlot).toBeVisible();

    const terminalSurface = termSlot.locator(".xterm, [data-terminal-container]").first();
    await expect(terminalSurface).toBeAttached({ timeout: 15_000 });

    // Tag the live terminal instance with an invariant identity marker
    await page.evaluate((winId) => {
      const slot = document.querySelector(`[data-os-window-slot="${winId}"]`);
      const termEl = slot?.querySelector(".xterm, [data-terminal-container]");
      if (termEl) termEl.setAttribute("data-test-terminal-identity", "cutover-term-inst-1");
    }, termWindowId);

    const getTerminalIdentity = async () => {
      return page.evaluate((winId) => {
        const slot = document.querySelector(`[data-os-window-slot="${winId}"]`);
        const termEl = slot?.querySelector(".xterm, [data-terminal-container]");
        return termEl?.getAttribute("data-test-terminal-identity");
      }, termWindowId);
    };

    // Transition: Tile -> Float
    const switchFloatBtn = termFrame.locator("button[aria-label='Switch to Float']").first();
    await expect(switchFloatBtn).toBeVisible();
    await switchFloatBtn.click();

    const switchTileBtn = termFrame.locator("button[aria-label='Switch to Tile']").first();
    await expect(switchTileBtn).toBeVisible();
    expect(await getTerminalIdentity()).toBe("cutover-term-inst-1");

    // Transition: Float -> Tile
    await switchTileBtn.click();
    await expect(switchFloatBtn).toBeVisible();
    expect(await getTerminalIdentity()).toBe("cutover-term-inst-1");

    // Transition: Maximize -> Restore
    const maximizeBtn = termFrame.locator("button[aria-label='Maximize']").first();
    await expect(maximizeBtn).toBeVisible();
    await maximizeBtn.click();

    const restoreBtn = termFrame.locator("button[aria-label='Restore']").first();
    await expect(restoreBtn).toBeVisible();
    expect(await getTerminalIdentity()).toBe("cutover-term-inst-1");

    await restoreBtn.click();
    await expect(maximizeBtn).toBeVisible();
    expect(await getTerminalIdentity()).toBe("cutover-term-inst-1");
    // 5. Capture visual checkpoint evidence for review.md
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
    });
  });
});
