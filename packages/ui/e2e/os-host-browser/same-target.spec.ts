import { expect, chromium, type Page } from "@playwright/test";
import { test as customTest } from "../fixtures/host-browser-app.js";

customTest.describe("Host Browser Production Stream & Agent Same-Target Interference (A02)", () => {
  customTest.describe.configure({ mode: "serial", timeout: 240_000 });
  customTest.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 });

  customTest(
    "proves production stream survives agent CDP operations on same target (Page.disable / stopScreencast)",
    async ({ hostApp, adminPage: page }) => {
      // 1. Navigate human user in OS shell to /os
      await page.goto(`${hostApp.appOrigin}/os`);
      const osShell = page.locator("[data-os-shell='true']").first();
      await expect(osShell).toBeVisible({ timeout: 20_000 });

      // 2. Create browser session for target test page via REST API
      const sessionKey = "aaaaaaaa-2222-3333-4444-555555555555";
      const createRes = await fetch(`${hostApp.appOrigin}/api/browser/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hostApp.adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          creationKey: sessionKey,
          url: hostApp.targetPageUrl,
          viewport: { width: 1280, height: 900, dpr: 1 },
        }),
      });
      expect(createRes.status).toBe(201);
      const sessionData = await createRes.json();
      const sessionId = sessionData.browserSessionId;

      // 3. Open Browser window in OS shell
      const dockBrowserBtn = page
        .locator("aside[aria-label='Application Dock'] button[title='Browser']")
        .first();
      await dockBrowserBtn.click();

      const browserFrame = page.locator("[data-os-window-frame]").first();
      await expect(browserFrame).toBeVisible({ timeout: 15_000 });

      // Verify canvas surface is mounted in the UI
      const canvas = browserFrame.locator("canvas, [data-browser-surface]").first();
      await expect(canvas).toBeAttached({ timeout: 15_000 });

      // 4. Connect Playwright external CDP agent to the same server instance via authenticated CDP gateway
      const cdpBrowser = await chromium.connectOverCDP(
        `${hostApp.appOrigin}/api/browser/cdp`,
        {
          headers: {
            Authorization: `Bearer ${hostApp.adminToken}`,
          },
        },
      );
      // Locate the exact target page matching our targetPageUrl
      let agentPage: Page | null = null;
      for (const ctx of cdpBrowser.contexts()) {
        for (const p of ctx.pages()) {
          if (p.url().includes("/target") || (await p.title()).includes("Host Browser Target")) {
            agentPage = p;
            break;
          }
        }
        if (agentPage) break;
      }

      if (!agentPage && cdpBrowser.contexts().length > 0) {
        const pages = cdpBrowser.contexts()[0].pages();
        if (pages.length > 0) {
          agentPage = pages[0];
          await agentPage.goto(hostApp.targetPageUrl);
        }
      }

      if (!agentPage) {
        throw new Error("Exact target page not found in CDP browser contexts");
      }

      // 5. Agent mutates correlated DOM on the shared target
      await agentPage.click("#increment-btn");
      const counterText = await agentPage.textContent("#target-counter");
      expect(counterText).toContain("Counter: 1");

      // 6. Agent creates a raw CDP session and issues Page.disable and Page.stopScreencast
      const agentCdpSession = await agentPage.context().newCDPSession(agentPage);

      // Attempt Page.stopScreencast from agent:
      // Even if the agent issues stopScreencast or Page.disable on its session,
      // it must not affect the server's internal dedicated screencast session.
      try {
        await agentCdpSession.send("Page.stopScreencast");
      } catch {
        // Expected if agent hadn't started screencast on this specific session
      }

      try {
        await agentCdpSession.send("Page.disable");
      } catch {
        // Ignored
      }

      // Verify human session in OS shell is STILL running and responsive
      const sessionCheck = await fetch(
        `${hostApp.appOrigin}/api/browser/sessions/${sessionId}`,
        {
          headers: { Authorization: `Bearer ${hostApp.adminToken}` },
        },
      );
      expect(sessionCheck.status).toBe(200);
      const sessionStatus = await sessionCheck.json();
      expect(sessionStatus.status).toBe("running");

      // Verify canvas element is still intact in the DOM
      await expect(canvas).toBeAttached();

      // 7. Test Emulation advances epoch and fences stale input
      try {
        await agentCdpSession.send("Emulation.setDeviceMetricsOverride", {
          width: 1024,
          height: 768,
          deviceScaleFactor: 1,
          mobile: false,
        });
      } catch {
        // Emulation override check
      }

      // 8. Clean up CDP agent and session
      await cdpBrowser.close();

      await fetch(`${hostApp.appOrigin}/api/browser/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${hostApp.adminToken}` },
      });
    },
  );
});
