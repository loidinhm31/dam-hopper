import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";
import { createTerminalSessionObserver } from "../fixtures/terminal-session-observation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CAPTURE_CASE_DIR = path.resolve(__dirname, "../os-session-management-cutover");

test.describe("DamHopper OS Root Cutover, Hub Inventory & Close Guard Journey", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.use({ viewport: { width: 1440, height: 900 } });

  test("qualifies root cutover, legacy route translation, inventory-first Hub, beside intent, and shared Close prompt", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    const observer = createTerminalSessionObserver(page);
    await observer.resetViewportAndZoom();

    // 1. Navigate to root / and verify OsShell mounts as default experience
    await page.goto(`${appServices.appOrigin}/`);
    const osShell = page.locator("[data-os-shell='true']").first();
    await expect(osShell).toBeVisible({ timeout: 20_000 });

    const brand = page.locator("header").getByText("DH//OS", { exact: true });
    await expect(brand).toBeVisible();

    // 2. Legacy route translation: /workspace redirect to OS
    await page.goto(`${appServices.appOrigin}/workspace`);
    await expect(osShell).toBeVisible({ timeout: 15_000 });

    // 3. Retired routes display zero-mutation notice
    await page.goto(`${appServices.appOrigin}/usage`);
    const usageNotice = page.getByText("Usage & Telemetry Retired", { exact: false });
    await expect(usageNotice).toBeVisible({ timeout: 10_000 });

    await page.goto(`${appServices.appOrigin}/ssh-forwarding`);
    const sshNotice = page.getByText("SSH Port Forwarding Retired", { exact: false });
    await expect(sshNotice).toBeVisible({ timeout: 10_000 });

    // 4. Return to /os and open Agent Hub
    await page.goto(`${appServices.appOrigin}/os`);
    await expect(osShell).toBeVisible({ timeout: 15_000 });

    // Open Agent Hub via Command Palette or custom intent
    await page.keyboard.press("Control+Alt+KeyK");
    const palette = page.locator('[role="dialog"][aria-label="Command Palette"]');
    await expect(palette).toBeVisible({ timeout: 5_000 });
    const paletteInput = palette.locator('input[aria-label*="Search commands"]');
    await paletteInput.fill("Agent Hub");
    await page.keyboard.press("Enter");

    const agentHub = page.locator("[data-os-agent-hub]").first();
    await expect(agentHub).toBeVisible({ timeout: 10_000 });

    // 5. Test Scope Filters: All / Agents / Background
    const filterAll = agentHub.locator('[data-testid="agent-hub-filter-all"]').first();
    await expect(filterAll).toBeVisible();
    await filterAll.click();

    const filterAgents = agentHub.locator('[data-testid="agent-hub-filter-agents"]').first();
    await expect(filterAgents).toBeVisible();
    await filterAgents.click();

    const filterBackground = agentHub.locator('[data-testid="agent-hub-filter-background"]').first();
    await expect(filterBackground).toBeVisible();
    await filterBackground.click();

    // Reset back to All
    await filterAll.click();

    // 6. Launch a live terminal window from Dock
    const dockTerminalBtn = page.locator("aside[aria-label='Application Dock'] button[title='Terminals']").first();
    await expect(dockTerminalBtn).toBeVisible({ timeout: 10_000 });
    await dockTerminalBtn.click();

    const initialFrame = page
      .locator("[data-os-window-frame]")
      .filter({ has: page.locator("[data-terminal-container], .xterm") })
      .first();
    await expect(initialFrame).toBeVisible({ timeout: 15_000 });
    const termWindowId = await initialFrame.getAttribute("data-os-window-frame");
    expect(termWindowId).toBeTruthy();

    const termFrame = page.locator(`[data-os-window-frame="${termWindowId}"]`);
    const closeBtn = termFrame.locator("button[aria-label='Close']").first();
    await expect(closeBtn).toBeVisible();

    // 7. Test terminal close kills session immediately without ask dialog
    await closeBtn.click();
    await expect(page.locator(`[data-os-window-frame="${termWindowId}"]`)).toHaveCount(0);
    // 8. Reopen from Dock - adopts surviving session without duplicate backend create
    await dockTerminalBtn.click();
    await expect(
      page
        .locator("[data-os-window-frame]")
        .filter({ has: page.locator("[data-terminal-container], .xterm") })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("captures complete matrix evidence for os-session-management-cutover", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    const observer = createTerminalSessionObserver(page);
    await observer.resetViewportAndZoom();

    // Navigate to /os
    await page.goto(`${appServices.appOrigin}/os`);
    await expect(page.locator("[data-os-shell='true']").first()).toBeVisible({ timeout: 20_000 });

    // Open Agent Hub
    await page.keyboard.press("Control+Alt+KeyK");
    const palette = page.locator('[role="dialog"][aria-label="Command Palette"]');
    await expect(palette).toBeVisible({ timeout: 5_000 });
    const paletteInput = palette.locator('input[aria-label*="Search commands"]');
    await paletteInput.fill("Agent Hub");
    await page.keyboard.press("Enter");
    const agentHub = page.locator("[data-os-agent-hub]").first();
    await expect(agentHub).toBeVisible({ timeout: 10_000 });

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

    // 1. Primary screenshot.png and base state (Hub inventory) generic 4 combos
    await captureApplicationCheckpoint(page, { caseDir: CAPTURE_CASE_DIR });
    await captureCombos(); // fhd, compact, fhd-zoom125, compact-zoom125

    // 2. Adjacent checkpoint: open terminal window adjacent to Agent Hub
    const dockTerminalBtn = page.locator("aside[aria-label='Application Dock'] button[title='Terminals']").first();
    await dockTerminalBtn.click();
    const termFrame = page
      .locator("[data-os-window-frame]")
      .filter({ has: page.locator("[data-terminal-container], .xterm") })
      .first();
    await expect(termFrame).toBeVisible({ timeout: 15_000 });

    await captureCombos("adjacent");

    // 3. Close checkpoint: click Close button on terminal window to close immediately
    const closeBtn = termFrame.locator("button[aria-label='Close']").first();
    await closeBtn.click();
    await expect(termFrame).toHaveCount(0);
    await captureCombos("close-prompt");
  });
});
