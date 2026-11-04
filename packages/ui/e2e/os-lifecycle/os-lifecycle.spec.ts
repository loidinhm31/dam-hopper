import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";
import {
  createTerminalSessionObserver,
  type TerminalSessionObserver,
} from "../fixtures/terminal-session-observation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CAPTURE_CASE_DIR = path.resolve(__dirname, "../os-session-management-lifecycle");

test.describe("DamHopper OS Prototype Lifecycle & Placement Continuity", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.use({ viewport: { width: 1440, height: 900 } });

  test("qualifies authenticated /os route, window placement transitions, float preference, and zero-delta continuity", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    const observer = createTerminalSessionObserver(page);
    await observer.resetViewportAndZoom();

    // 1. Navigate to /os
    await page.goto(`${appServices.appOrigin}/os`);

    const osShell = page.locator("[data-os-shell='true']").first();
    await expect(osShell).toBeVisible({ timeout: 20_000 });

    const brand = page.locator("header").getByText("DH//OS", { exact: true });
    await expect(brand).toBeVisible();

    const desktop1Tab = page.locator("[role='tablist'][aria-label='Virtual Desktops']").locator("[role='tab']").first();
    await expect(desktop1Tab).toBeVisible();

    // 2. Launch terminals window from Dock
    const addTerminalBtn = page.locator("aside[aria-label='Application Dock'] button[title='Terminals']").first();
    await expect(addTerminalBtn).toBeVisible({ timeout: 10_000 });
    await addTerminalBtn.click();

    const initialFrame = page.locator("[data-os-window-frame]").first();
    await expect(initialFrame).toBeVisible({ timeout: 15_000 });
    const termWindowId = await initialFrame.getAttribute("data-os-window-frame");
    expect(termWindowId).toBeTruthy();

    const termFrame = page.locator(`[data-os-window-frame="${termWindowId}"]`);
    const termSlot = termFrame.locator(`[data-os-window-slot="${termWindowId}"]`);
    await expect(termSlot).toBeVisible();

    const terminalSurface = termSlot.locator(".xterm, [data-terminal-container]").first();
    await expect(terminalSurface).toBeAttached({ timeout: 15_000 });

    // Assert new-window float preference: new window starts in float mode by default
    const switchTileBtn = termFrame.locator("button[aria-label='Switch to Tile']").first();
    await expect(switchTileBtn).toBeVisible({ timeout: 5_000 });

    // Tag live terminal DOM node with invariant identity marker as supporting evidence
    await page.evaluate((winId) => {
      const slot = document.querySelector(`[data-os-window-slot="${winId}"]`);
      const termEl = slot?.querySelector(".xterm, [data-terminal-container]");
      if (termEl) termEl.setAttribute("data-test-terminal-identity", `term-live-${winId}`);
    }, termWindowId);

    // Capture initial baseline observation
    const { sessionId: termSessionId } = await observer.resolveActiveTerminalSessionId();
    const baseline = await observer.snapshot(termSessionId);
    expect(baseline.token).toBeTruthy();

    // 3. Transition: Float -> Tile
    await switchTileBtn.click();
    const switchFloatBtn = termFrame.locator("button[aria-label='Switch to Float']").first();
    await expect(switchFloatBtn).toBeVisible();
    const snapTile = await observer.snapshot(termWindowId!);
    observer.assertZeroDelta(baseline, snapTile, "float -> tile");

    // Transition: Tile -> Float
    await switchFloatBtn.click();
    await expect(switchTileBtn).toBeVisible();
    const snapFloat = await observer.snapshot(termWindowId!);
    observer.assertZeroDelta(baseline, snapFloat, "tile -> float");

    // 4. Transition: Maximize -> Restore
    const maximizeBtn = termFrame.locator("button[aria-label='Maximize']").first();
    await expect(maximizeBtn).toBeVisible();
    await maximizeBtn.click();

    const restoreBtn = termFrame.locator("button[aria-label='Restore']").first();
    await expect(restoreBtn).toBeVisible();
    const snapMaximized = await observer.snapshot(termWindowId!);
    observer.assertZeroDelta(baseline, snapMaximized, "maximize");

    await restoreBtn.click();
    await expect(maximizeBtn).toBeVisible();
    const snapRestored = await observer.snapshot(termWindowId!);
    observer.assertZeroDelta(baseline, snapRestored, "restore");

    // 5. Titlebar background double-click mode toggle
    const titlebarHeader = termFrame.locator(".border-b.select-none").first();
    await expect(titlebarHeader).toBeVisible();
    // Primary-button double click on noninteractive area toggles mode to tile
    await titlebarHeader.dblclick({ position: { x: 80, y: 10 } });
    await expect(switchFloatBtn).toBeVisible();
    const snapDblTile = await observer.snapshot(termWindowId!);
    observer.assertZeroDelta(baseline, snapDblTile, "titlebar dblclick to tile");

    // Double click again toggles back to float
    await titlebarHeader.dblclick({ position: { x: 80, y: 10 } });
    await expect(switchTileBtn).toBeVisible();
    const snapDblFloat = await observer.snapshot(termWindowId!);
    observer.assertZeroDelta(baseline, snapDblFloat, "titlebar dblclick to float");

    // 6. Transition: Minimize -> Restore from top bar tray
    const minimizeBtn = termFrame.locator("button[aria-label='Minimize']").first();
    await expect(minimizeBtn).toBeVisible();
    await minimizeBtn.click();

    await expect(page.locator(`[data-os-window-frame="${termWindowId}"]`)).toHaveCount(0);
    const minimizedTrayBtn = page.locator("header").getByRole("button", { name: "Terminals", exact: false }).first();
    await expect(minimizedTrayBtn).toBeVisible();
    await minimizedTrayBtn.click();

    await expect(page.locator(`[data-os-window-frame="${termWindowId}"]`)).toHaveCount(1);
    const snapMinimizedRestore = await observer.snapshot(termWindowId!);
    observer.assertZeroDelta(baseline, snapMinimizedRestore, "minimize -> restore");

    // 7. Desktop move via Radix Select
    const addDesktopBtn = page.locator("[role='tablist'][aria-label='Virtual Desktops'] button[aria-label='New desktop']").first();
    await expect(addDesktopBtn).toBeVisible();
    await addDesktopBtn.click();

    const desktop2Tab = page.locator("[role='tablist'][aria-label='Virtual Desktops']").locator("[role='tab']").nth(1);
    await expect(desktop2Tab).toBeVisible();

    // Switch back to Desktop 1
    await desktop1Tab.click();
    await expect(page.locator('[data-os-desktop-canvas="desktop-1"]')).toBeVisible();

    // Use actual Radix Select trigger and option
    const moveTrigger = termFrame.locator('button[aria-label="Move to desktop"]').first();
    await expect(moveTrigger).toBeVisible();
    await moveTrigger.click();

    const desktop2Option = page.locator('[role="option"]').filter({ hasText: "Desktop 2" }).first();
    await expect(desktop2Option).toBeVisible();
    await desktop2Option.click();

    // Switch to desktop 2 and verify terminal survives with zero delta
    await desktop2Tab.click();
    const canvas2 = page.locator('[data-os-desktop-canvas="desktop-2"]');
    await expect(canvas2).toBeVisible();
    await expect(canvas2.locator(`[data-os-window-frame="${termWindowId}"]`)).toHaveCount(1);

    const snapDesktop2 = await observer.snapshot(termWindowId!);
    observer.assertZeroDelta(baseline, snapDesktop2, "move to desktop 2");

    // 8. Launch Editor and Files to test cascade geometry (consecutive 28px offset)
    const addEditorBtn = page.locator("aside[aria-label='Application Dock'] button[title='Editor']").first();
    await expect(addEditorBtn).toBeVisible();
    await addEditorBtn.click();

    const addFilesBtn = page.locator("aside[aria-label='Application Dock'] button[title='Files']").first();
    await expect(addFilesBtn).toBeVisible();
    await addFilesBtn.click();

    await expect(page.locator("[data-os-window-frame]")).toHaveCount(3);

    // Verify float positions cascade with deterministic ~28px offset
    const frames = page.locator("[data-os-window-frame]");
    const bounds = await frames.evaluateAll((elements) =>
      elements.map((el) => {
        const rect = el.getBoundingClientRect();
        return { x: Math.round(rect.x), y: Math.round(rect.y) };
      }),
    );
    if (bounds.length >= 2) {
      const deltaX = Math.abs(bounds[1].x - bounds[0].x);
      const deltaY = Math.abs(bounds[1].y - bounds[0].y);
      expect(deltaX).toBe(28);
      expect(deltaY).toBe(28);
    }

    // 9. Repeat cycles (at least three cycles of mode/restore)
    for (let i = 0; i < 3; i++) {
      const frameEl = page.locator(`[data-os-window-frame="${termWindowId}"]`);
      const btn = frameEl.locator("button[aria-label='Switch to Tile'], button[aria-label='Switch to Float']").first();
      await btn.click();
      await page.waitForTimeout(50);
      await btn.click();
      await page.waitForTimeout(50);
    }
    const snapCycles = await observer.snapshot(termWindowId!);
    observer.assertZeroDelta(baseline, snapCycles, "repeated 3x placement cycles");

    // 10. Shrink viewport then widen back, verify geometry restoration
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.waitForTimeout(100);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(100);
    const snapViewport = await observer.snapshot(termWindowId!);
    observer.assertZeroDelta(baseline, snapViewport, "shrink -> widen viewport restoration");

    // 11. Cognito Privacy Mode input isolation
    await page.keyboard.press("Control+Alt+KeyB");
    const cognitoOverlay = page.locator("[data-cognito-mode-overlay]");
    await expect(cognitoOverlay).toBeVisible();

    const cognitoContent = page.locator("[data-cognito-mode-content]");
    await expect(cognitoContent).toHaveAttribute("inert", "");

    // Backdrop click does not activate terminal
    await cognitoOverlay.click({ position: { x: 300, y: 300 } });
    await page.keyboard.type("cognito-blocked-input");

    // Deactivate Cognito
    await page.keyboard.press("Control+Alt+KeyB");
    await expect(cognitoOverlay).toHaveCount(0);
    await expect(cognitoContent).not.toHaveAttribute("inert");

    const snapCognito = await observer.snapshot(termWindowId!);
    observer.assertZeroDelta(baseline, snapCognito, "cognito mode activation/deactivation");
  });

  test("captures complete matrix evidence for os-session-management-lifecycle", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    const observer = createTerminalSessionObserver(page);
    await observer.resetViewportAndZoom();

    // Navigate to /os
    await page.goto(`${appServices.appOrigin}/os`);
    await expect(page.locator("[data-os-shell='true']").first()).toBeVisible({ timeout: 20_000 });

    // Launch initial terminal
    const addTerminalBtn = page.locator("aside[aria-label='Application Dock'] button[title='Terminals']").first();
    await addTerminalBtn.click();
    const termFrame = page.locator("[data-os-window-frame]").first();
    await expect(termFrame).toBeVisible({ timeout: 15_000 });
    const termWindowId = await termFrame.getAttribute("data-os-window-frame");

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

    // 1. Primary screenshot.png and base state (live placement) generic 4 combos
    await captureApplicationCheckpoint(page, { caseDir: CAPTURE_CASE_DIR });
    await captureCombos(); // fhd, compact, fhd-zoom125, compact-zoom125

    // 2. Cascade checkpoint: launch editor and files to show visible cascading float placement
    const addEditorBtn = page.locator("aside[aria-label='Application Dock'] button[title='Editor']").first();
    await addEditorBtn.click();
    await page.waitForTimeout(200);

    const addFilesBtn = page.locator("aside[aria-label='Application Dock'] button[title='Files']").first();
    await addFilesBtn.click();
    await page.waitForTimeout(200);

    await captureCombos("cascade");

    // 3. Titlebar checkpoint: maximize or toggle terminal to show titlebar controls and state
    if (termWindowId) {
      const frame = page.locator(`[data-os-window-frame="${termWindowId}"]`);
      const maxBtn = frame.locator("button[aria-label='Maximize']").first();
      if (await maxBtn.isVisible()) {
        await maxBtn.click();
      }
    }
    await page.waitForTimeout(150);
    await captureCombos("titlebar");
  });
});
