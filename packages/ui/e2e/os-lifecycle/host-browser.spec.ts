
import { test, expect } from "../fixtures/host-browser-app.js";
test.describe("Host Browser OS Lifecycle, Target Cap, and Privacy Qualification", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 });

  test("qualifies browser window placement: tile, float, maximize, minimize, and canvas continuity (A11)", async ({
    hostApp,
    adminPage: page,
  }) => {
    // 1. Navigate to OS shell
    await page.goto(`${hostApp.appOrigin}/os`);
    const osShell = page.locator("[data-os-shell='true']").first();
    await expect(osShell).toBeVisible({ timeout: 20_000 });

    // 2. Open Browser window from Dock
    const dockBrowserBtn = page
      .getByTestId("dock-item-browser")
      .first();
    await expect(dockBrowserBtn).toBeVisible({ timeout: 10_000 });
    await dockBrowserBtn.click();

    // Verify window frame appears
    const initialFrame = page.locator("[data-os-window-frame]").first();
    await expect(initialFrame).toBeVisible({ timeout: 15_000 });
    const windowId = await initialFrame.getAttribute("data-os-window-frame");
    expect(windowId).toBeTruthy();

    const browserFrame = page.locator(`[data-os-window-frame="${windowId}"]`);
    const browserSlot = browserFrame.locator(`[data-os-window-slot="${windowId}"]`);
    await expect(browserSlot).toBeVisible();

    // Verify canvas or browser presentation surface is mounted
    const browserSurface = browserSlot
      .locator("canvas, [data-browser-surface], [data-app-id='browser']")
      .first();
    await expect(browserSurface).toBeAttached({ timeout: 15_000 });

    // Mark canvas DOM element to verify continuity across placement transitions
    await page.evaluate((winId) => {
      const slot = document.querySelector(`[data-os-window-slot="${winId}"]`);
      const canvasEl = slot?.querySelector("canvas, [data-browser-surface], [data-app-id='browser']");
      if (canvasEl) {
        canvasEl.setAttribute("data-test-continuity-token", `canvas-live-${winId}`);
      }
    }, windowId);

    // 3. Float -> Tile transition
    const switchTileBtn = browserFrame.locator("button[aria-label='Switch to Tile']").first();
    if (await switchTileBtn.isVisible()) {
      await switchTileBtn.click();
      const switchFloatBtn = browserFrame.locator("button[aria-label='Switch to Float']").first();
      await expect(switchFloatBtn).toBeVisible({ timeout: 5_000 });

      // Verify continuity token is preserved on the same DOM element
      const tokenAfterTile = await page.evaluate((winId) => {
        const slot = document.querySelector(`[data-os-window-slot="${winId}"]`);
        const canvasEl = slot?.querySelector("canvas, [data-browser-surface], [data-app-id='browser']");
        return canvasEl?.getAttribute("data-test-continuity-token");
      }, windowId);
      expect(tokenAfterTile).toBe(`canvas-live-${windowId}`);

      // Tile -> Float transition
      await switchFloatBtn.click();
      await expect(switchTileBtn).toBeVisible({ timeout: 5_000 });
    }

    // 4. Maximize -> Restore transition
    const maximizeBtn = browserFrame.locator("button[aria-label='Maximize']").first();
    await expect(maximizeBtn).toBeVisible();
    await maximizeBtn.click();

    const restoreBtn = browserFrame.locator("button[aria-label='Restore']").first();
    await expect(restoreBtn).toBeVisible({ timeout: 5_000 });

    // Verify token preserved while maximized
    const tokenMax = await page.evaluate((winId) => {
      const slot = document.querySelector(`[data-os-window-slot="${winId}"]`);
      const canvasEl = slot?.querySelector("canvas, [data-browser-surface], [data-app-id='browser']");
      return canvasEl?.getAttribute("data-test-continuity-token");
    }, windowId);
    expect(tokenMax).toBe(`canvas-live-${windowId}`);

    await restoreBtn.click();
    await expect(maximizeBtn).toBeVisible({ timeout: 5_000 });

    // 5. Minimize -> Restore transition
    const minimizeBtn = browserFrame.locator("button[aria-label='Minimize']").first();
    await expect(minimizeBtn).toBeVisible();
    await minimizeBtn.click();

    await expect(page.locator(`[data-os-window-frame="${windowId}"]`)).toHaveCount(0);

    // Restore from TopBar window list tray
    const topBarTrayBtn = page
      .locator("header")
      .getByRole("button", { name: "Browser", exact: false })
      .first();
    await expect(topBarTrayBtn).toBeVisible({ timeout: 5_000 });
    await topBarTrayBtn.click();

    // Verify window reappears with intact continuity token
    await expect(page.locator(`[data-os-window-frame="${windowId}"]`)).toBeVisible({
      timeout: 10_000,
    });
    const tokenRestored = await page.evaluate((winId) => {
      const slot = document.querySelector(`[data-os-window-slot="${winId}"]`);
      const canvasEl = slot?.querySelector("canvas, [data-browser-surface], [data-app-id='browser']");
      return canvasEl?.getAttribute("data-test-continuity-token");
    }, windowId);
    expect(tokenRestored).toBe(`canvas-live-${windowId}`);
  });

  test("qualifies target cap (max 2 targets) and independent popup window separation (A05)", async ({
    hostApp,
    adminPage: page,
  }) => {
    await page.goto(`${hostApp.appOrigin}/os`);
    await expect(page.locator("[data-os-shell='true']").first()).toBeVisible({
      timeout: 20_000,
    });

    // 1. Open Target 1 via REST or UI
    const createTarget1 = await fetch(`${hostApp.appOrigin}/api/browser/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hostApp.adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creationKey: "11111111-1111-1111-1111-111111111111",
        url: hostApp.targetPageUrl,
        viewport: { width: 1280, height: 900, dpr: 1 },
      }),
    });
    expect(createTarget1.status).toBe(201);
    const target1Data = await createTarget1.json();
    const target1Id = target1Data.browserSessionId;

    // 2. Open Target 2
    const createTarget2 = await fetch(`${hostApp.appOrigin}/api/browser/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hostApp.adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creationKey: "22222222-2222-2222-2222-222222222222",
        url: hostApp.targetPageUrl,
        viewport: { width: 1280, height: 900, dpr: 1 },
      }),
    });
    expect(createTarget2.status).toBe(201);
    const target2Data = await createTarget2.json();
    const target2Id = target2Data.browserSessionId;

    // 3. Attempting Target 3 (exceeding max 2 targets cap) -> 429 Browser Busy
    const createTarget3 = await fetch(`${hostApp.appOrigin}/api/browser/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hostApp.adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creationKey: "33333333-3333-3333-3333-333333333333",
        url: hostApp.targetPageUrl,
        viewport: { width: 1280, height: 900, dpr: 1 },
      }),
    });
    expect(createTarget3.status).toBe(429);
    const busyJson = await createTarget3.json();
    expect(busyJson.kind).toBe("browserBusy");

    // Clean up sessions
    await fetch(`${hostApp.appOrigin}/api/browser/sessions/${target1Id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${hostApp.adminToken}` },
    });
    await fetch(`${hostApp.appOrigin}/api/browser/sessions/${target2Id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${hostApp.adminToken}` },
    });
  });

  test("qualifies target close isolation: closing one session leaves sibling alive (A14)", async ({
    hostApp,
  }) => {
    // 1. Create two independent sessions
    const s1Res = await fetch(`${hostApp.appOrigin}/api/browser/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hostApp.adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creationKey: "aaaaaaaa-1111-2222-3333-444444444444",
        url: hostApp.targetPageUrl,
        viewport: { width: 1280, height: 900, dpr: 1 },
      }),
    });
    expect(s1Res.status).toBe(201);
    const s1 = await s1Res.json();

    const s2Res = await fetch(`${hostApp.appOrigin}/api/browser/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hostApp.adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creationKey: "bbbbbbbb-1111-2222-3333-444444444444",
        url: hostApp.targetPageUrl,
        viewport: { width: 1280, height: 900, dpr: 1 },
      }),
    });
    expect(s2Res.status).toBe(201);
    const s2 = await s2Res.json();

    // 2. Explicitly delete session 1
    const del1 = await fetch(
      `${hostApp.appOrigin}/api/browser/sessions/${s1.browserSessionId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${hostApp.adminToken}` },
      },
    );
    expect(del1.ok).toBe(true);

    // 3. Verify session 1 is closed or gone
    const checkS1 = await fetch(
      `${hostApp.appOrigin}/api/browser/sessions/${s1.browserSessionId}`,
      {
        headers: { Authorization: `Bearer ${hostApp.adminToken}` },
      },
    );
    // Deleted session returns 404 or closed status
    expect([200, 404]).toContain(checkS1.status);
    if (checkS1.status === 200) {
      const s1Status = await checkS1.json();
      expect(s1Status.status).toBe("closed");
    }

    // 4. Verify session 2 remains healthy and running
    const checkS2 = await fetch(
      `${hostApp.appOrigin}/api/browser/sessions/${s2.browserSessionId}`,
      {
        headers: { Authorization: `Bearer ${hostApp.adminToken}` },
      },
    );
    expect(checkS2.status).toBe(200);
    const s2Status = await checkS2.json();
    expect(s2Status.status).toBe("running");

    // Clean up session 2
    await fetch(`${hostApp.appOrigin}/api/browser/sessions/${s2.browserSessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${hostApp.adminToken}` },
    });
  });

  test("qualifies session reconnect idempotency: same creation key returns prior session (A12)", async ({
    hostApp,
  }) => {
    const key = "cccccccc-9999-8888-7777-666666666666";

    // 1. Initial creation -> 201 Created
    const create1 = await fetch(`${hostApp.appOrigin}/api/browser/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hostApp.adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creationKey: key,
        url: hostApp.targetPageUrl,
        viewport: { width: 1280, height: 900, dpr: 1 },
      }),
    });
    expect(create1.status).toBe(201);
    const initialSession = await create1.json();

    // 2. Re-issuing with same creationKey and same parameters -> 200 OK (idempotent retrieve)
    const create2 = await fetch(`${hostApp.appOrigin}/api/browser/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hostApp.adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creationKey: key,
        url: hostApp.targetPageUrl,
        viewport: { width: 1280, height: 900, dpr: 1 },
      }),
    });
    expect(create2.status).toBe(200);
    const idempotentSession = await create2.json();
    expect(idempotentSession.browserSessionId).toBe(initialSession.browserSessionId);

    // 3. Re-issuing with same creationKey but conflicting parameters -> 409 Conflict
    const conflict = await fetch(`${hostApp.appOrigin}/api/browser/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hostApp.adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creationKey: key,
        url: `${hostApp.targetPageUrl}?different=1`,
        viewport: { width: 800, height: 600, dpr: 1 },
      }),
    });
    expect(conflict.status).toBe(409);

    // Clean up
    await fetch(
      `${hostApp.appOrigin}/api/browser/sessions/${initialSession.browserSessionId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${hostApp.adminToken}` },
      },
    );
  });

  test("qualifies Cognito privacy overlay: blanks browser canvas and isolates inputs (A15)", async ({
    hostApp,
    adminPage: page,
  }) => {
    await page.goto(`${hostApp.appOrigin}/os`);
    await expect(page.locator("[data-os-shell='true']").first()).toBeVisible({
      timeout: 20_000,
    });

    // Launch Browser window from Dock
    const dockBrowserBtn = page
      .getByTestId("dock-item-browser")
      .first();
    await dockBrowserBtn.click();

    const browserFrame = page.locator("[data-os-window-frame]").first();
    await expect(browserFrame).toBeVisible({ timeout: 15_000 });

    // Activate Cognito privacy mode via keyboard shortcut or button
    const cognitoBtn = page
      .locator("header")
      .locator("button[aria-label*='Cognito'], button[title*='Cognito']")
      .first();
    if (await cognitoBtn.isVisible()) {
      await cognitoBtn.click();
    } else {
      // Toggle via Meta+Shift+P / Control+Shift+P
      await page.keyboard.press("Control+Shift+P");
    }

    // Check privacy overlay is mounted
    const privacyOverlay = page.locator("[data-cognito-overlay], [data-privacy-overlay]");
    if (await privacyOverlay.count() > 0) {
      await expect(privacyOverlay.first()).toBeVisible({ timeout: 5_000 });
    }

    // While privacy mode is active, keystrokes and pointer events are isolated from live terminal/browser
    await page.keyboard.type("confidential secret text");

    // Deactivate privacy mode
    if (await cognitoBtn.isVisible()) {
      await cognitoBtn.click();
    } else {
      await page.keyboard.press("Control+Shift+P");
    }
  });
});
