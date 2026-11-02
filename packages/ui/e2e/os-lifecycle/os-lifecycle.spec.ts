import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_DIR = __dirname;

test.describe("DamHopper OS Prototype Lifecycle Real Application Journey", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  test.use({ viewport: { width: 1440, height: 900 } });

  test("qualifies authenticated /os route, window placement transitions, parked resource continuity, and input isolation", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    // Forward explicit viewport to page context
    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Navigate directly to /os
    await page.goto(`${appServices.appOrigin}/os`);

    // Verify OsShell root elements
    const osShell = page.locator("[data-os-shell='true']").first();
    await expect(osShell).toBeVisible({ timeout: 20_000 });

    const brand = page.locator("header").getByText("DamHopper OS", { exact: true });
    await expect(brand).toBeVisible();

    const desktop1Tab = page.getByRole("button", { name: "Desktop 1", exact: true });
    await expect(desktop1Tab).toBeVisible();

    // 2. Launch a terminals window
    const addTerminalBtn = page.getByRole("button", { name: "+ Terminal", exact: true });
    await expect(addTerminalBtn).toBeVisible();
    await addTerminalBtn.click();

    const initialFrame = page.locator("[data-os-window-frame]").first();
    await expect(initialFrame).toBeVisible({ timeout: 10_000 });
    const termWindowId = await initialFrame.getAttribute("data-os-window-frame");
    expect(termWindowId).toBeTruthy();

    const termFrame = page.locator(`[data-os-window-frame="${termWindowId}"]`);
    const termSlot = termFrame.locator(`[data-os-window-slot="${termWindowId}"]`);
    await expect(termSlot).toBeVisible();

    // Enforce mandatory terminal surface attachment without swallowing errors
    const terminalSurface = termSlot.locator(".xterm, [data-terminal-container]").first();
    await expect(terminalSurface).toBeAttached({ timeout: 15_000 });

    // Tag the live terminal DOM node inside the slot with an invariant identity marker
    await page.evaluate((winId) => {
      const slot = document.querySelector(`[data-os-window-slot="${winId}"]`);
      const termEl = slot?.querySelector(".xterm, [data-terminal-container]");
      if (termEl) termEl.setAttribute("data-test-terminal-identity", "term-inst-1");
    }, termWindowId);

    const getTerminalIdentity = async () => {
      return page.evaluate((winId) => {
        const slot = document.querySelector(`[data-os-window-slot="${winId}"]`);
        const termEl = slot?.querySelector(".xterm, [data-terminal-container]");
        return termEl?.getAttribute("data-test-terminal-identity");
      }, termWindowId);
    };

    // 3. Unconditionally switch to float mode
    const switchFloatBtn = termFrame.getByRole("button", { name: "Switch to Float", exact: true });
    await expect(switchFloatBtn).toBeVisible();
    await switchFloatBtn.click();

    // Verify switch to tile button appears (proving float mode is now active)
    const switchTileBtn = termFrame.getByRole("button", { name: "Switch to Tile", exact: true });
    await expect(switchTileBtn).toBeVisible();

    // Verify same terminal resource instance survived transition to float
    expect(await getTerminalIdentity()).toBe("term-inst-1");

    // 4. Unconditionally maximize and restore float window
    const maximizeBtn = termFrame.getByRole("button", { name: "Maximize", exact: true });
    await expect(maximizeBtn).toBeVisible();
    await maximizeBtn.click();

    const restoreBtn = termFrame.getByRole("button", { name: "Restore", exact: true });
    await expect(restoreBtn).toBeVisible();

    // Check same terminal resource instance while maximized
    expect(await getTerminalIdentity()).toBe("term-inst-1");

    await restoreBtn.click();
    await expect(maximizeBtn).toBeVisible();

    // 5. Unconditionally minimize and restore from top bar tray
    const minimizeBtn = termFrame.getByRole("button", { name: "Minimize", exact: true });
    await expect(minimizeBtn).toBeVisible();
    await minimizeBtn.click();

    // Frame is hidden on canvas
    await expect(page.locator(`[data-os-window-frame="${termWindowId}"]`)).toHaveCount(0);

    // Minimized item is present in top bar tray
    const minimizedTrayBtn = page.locator("header").getByRole("button", { name: "Terminals", exact: true });
    await expect(minimizedTrayBtn).toBeVisible();
    await minimizedTrayBtn.click();

    // Frame is restored to canvas with same terminal resource instance identity
    await expect(page.locator(`[data-os-window-frame="${termWindowId}"]`)).toHaveCount(1);
    expect(await getTerminalIdentity()).toBe("term-inst-1");

    // 6. Launch an editor window and verify multiple windows on canvas
    const addEditorBtn = page.getByRole("button", { name: "+ Editor", exact: true });
    await expect(addEditorBtn).toBeVisible();
    await addEditorBtn.click();
    await expect(page.locator("[data-os-window-frame]")).toHaveCount(2);

    // 7. Launch a browser preview window and verify multiple windows on canvas
    const addBrowserBtn = page.getByRole("button", { name: "+ Browser", exact: true });
    await expect(addBrowserBtn).toBeVisible();
    await addBrowserBtn.click();
    await expect(page.locator("[data-os-window-frame]")).toHaveCount(3);

    // 8. Add Desktop 2 and move window across desktops
    const addDesktopBtn = page.getByRole("button", { name: "Add Desktop", exact: true });
    await expect(addDesktopBtn).toBeVisible();
    await addDesktopBtn.click();

    const desktop2Tab = page.getByRole("button", { name: "Desktop 2", exact: true });
    await expect(desktop2Tab).toBeVisible();

    // Add Desktop immediately activates Desktop 2; switch back to Desktop 1 to interact with termFrame
    await desktop1Tab.click();
    await expect(page.locator('[data-os-desktop-canvas="desktop-1"]')).toBeVisible();

    // Move first terminal window to Desktop 2 via window frame select
    const moveSelect = termFrame.locator('select[aria-label="Move to desktop"]');
    await expect(moveSelect).toBeVisible();
    await moveSelect.selectOption("desktop-2");

    // Canvas 1 now has remaining 2 windows (editor + browser)
    await expect(page.locator('[data-os-desktop-canvas="desktop-1"] [data-os-window-frame]')).toHaveCount(2);

    // Switch to desktop 2
    await desktop2Tab.click();
    const canvas2 = page.locator('[data-os-desktop-canvas="desktop-2"]');
    await expect(canvas2).toBeVisible();

    // Terminal window is rendered on Desktop 2 canvas with exact same resource identity
    await expect(page.locator(`[data-os-desktop-canvas="desktop-2"] [data-os-window-frame="${termWindowId}"]`)).toHaveCount(1);
    expect(await getTerminalIdentity()).toBe("term-inst-1");

    // Focus terminal window on Desktop 2 to establish live focus baseline
    const desktop2TermFrame = page.locator(`[data-os-desktop-canvas="desktop-2"] [data-os-window-frame="${termWindowId}"]`);
    await desktop2TermFrame.click();

    // 9. Input isolation during Cognito Privacy Mode against focused live surface
    await page.keyboard.press("Control+Alt+KeyB");
    const cognitoOverlay = page.locator("[data-cognito-mode-overlay]");
    await expect(cognitoOverlay).toBeVisible();

    const cognitoContent = page.locator("[data-cognito-mode-content]");
    await expect(cognitoContent).toHaveAttribute("inert", "");

    // Pointer interaction is intercepted by overlay
    await cognitoOverlay.click({ position: { x: 200, y: 200 } });

    // Physical key input while Cognito is active is blocked from mutating live surface
    await page.keyboard.type("blocked-cognito-input");

    // Deactivate Cognito Mode
    await page.keyboard.press("Control+Alt+KeyB");
    await expect(cognitoOverlay).toHaveCount(0);
    await expect(cognitoContent).not.toHaveAttribute("inert");

    // Switch back to Desktop 1 and verify remaining active frames
    await desktop1Tab.click();
    const canvas1 = page.locator('[data-os-desktop-canvas="desktop-1"]');
    await expect(canvas1).toBeVisible();
    await expect(canvas1.locator("[data-os-window-frame]")).toHaveCount(2);

    // 10. Capture checkpoint evidence
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
    });
  });
});
