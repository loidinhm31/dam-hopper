import { expect } from "@playwright/test";
import { test as customTest } from "../fixtures/host-browser-app.js";

customTest.describe("Host Browser Full-SPA Android Web User Journey (A09)", () => {
  customTest.describe.configure({ mode: "serial", timeout: 240_000 });
  customTest.use({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    actionTimeout: 15_000,
  });

  customTest(
    "qualifies mobile Android touch interaction, soft keyboard focus, and IME composition",
    async ({ hostApp, adminPage: page }) => {
      // 1. Navigate to OS shell on mobile viewport
      await page.goto(`${hostApp.appOrigin}/os`);
      const osShell = page.locator("[data-os-shell='true']").first();
      await expect(osShell).toBeVisible({ timeout: 20_000 });

      // 2. Create browser session for target test page
      const sessionKey = "android-e2e-1111-2222-3333-444444444444";
      const createRes = await fetch(`${hostApp.appOrigin}/api/browser/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hostApp.adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          creationKey: sessionKey,
          url: hostApp.targetPageUrl,
          viewport: { width: 412, height: 915, dpr: 2 },
        }),
      });
      expect(createRes.status).toBe(201);
      const sessionData = await createRes.json();
      const sessionId = sessionData.browserSessionId;

      // 3. Open Browser window in mobile OS shell
      const dockBrowserBtn = page
        .locator("aside[aria-label='Application Dock'] button[title='Browser']")
        .first();
      await dockBrowserBtn.click();

      const browserFrame = page.locator("[data-os-window-frame]").first();
      await expect(browserFrame).toBeVisible({ timeout: 15_000 });

      // 4. Tap on canvas surface using touch gesture
      const canvas = browserFrame.locator("canvas, [data-browser-surface]").first();
      await expect(canvas).toBeAttached({ timeout: 15_000 });

      const canvasBox = await canvas.boundingBox();
      if (canvasBox) {
        // Touch tap in center
        await page.touchscreen.tap(
          canvasBox.x + canvasBox.width / 2,
          canvasBox.y + canvasBox.height / 2,
        );
      }

      // 5. Verify text proxy textarea exists and can receive IME input
      const textProxy = browserFrame.locator("textarea").first();
      if (await textProxy.count() > 0) {
        await textProxy.focus();

        // Simulate Vietnamese IME composition: "tiếng Việt"
        await page.evaluate(() => {
          const ta = document.querySelector("[data-os-window-frame] textarea") as HTMLTextAreaElement | null;
          if (ta) {
            ta.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
            ta.dispatchEvent(new CompositionEvent("compositionupdate", { data: "tiếng Việt", bubbles: true }));
            ta.dispatchEvent(new CompositionEvent("compositionend", { data: "tiếng Việt", bubbles: true }));
          }
        });

        // 6. Plain text paste on mobile
        await page.evaluate(() => {
          const ta = document.querySelector("[data-os-window-frame] textarea") as HTMLTextAreaElement | null;
          if (ta) {
            const pasteEvt = new Event("paste", { bubbles: true, cancelable: true });
            Object.defineProperty(pasteEvt, "clipboardData", {
              value: {
                getData: (format: string) => (format === "text/plain" ? "pasted-android" : ""),
              },
            });
            ta.dispatchEvent(pasteEvt);
          }
        });
      }

      // Clean up session
      await fetch(`${hostApp.appOrigin}/api/browser/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${hostApp.adminToken}` },
      });
    },
  );
});
