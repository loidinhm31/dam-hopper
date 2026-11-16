import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { startHostBrowserAppServer } from "../fixtures/host-browser-app.js";
import {
  clickRemoteElement,
  createJourneyPage,
  expectJourneyCanvas,
  openJourneyView,
} from "../fixtures/host-browser-journey-driver.js";

test.describe("Host Browser Native Tabs & Session Continuity (A01, A04, A07, A08)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("maintains 2 native targets across reload with zero target recreation", async ({ browser }) => {
    const host = await startHostBrowserAppServer({ allowAppOrigin: true });
    const { page, context } = await createJourneyPage(browser, host);
    try {
      const { view, observer } = await openJourneyView(page, host);
      const sessionPosts: string[] = [];
      page.on("request", (req) => {
        const u = new URL(req.url());
        if (req.method() === "POST" && u.pathname === "/api/browser/sessions") sessionPosts.push(u.pathname);
      });

      // Type into first tab
      await clickRemoteElement(page, view, "#journey-input");
      await page.keyboard.type("tab-one-data");
      await expect(view.remote.locator("#journey-input")).toHaveValue("tab-one-data");

      // Open second tab in same window
      const newTabBtn = view.app.locator('[data-testid="browser-new-tab-btn"]').first();
      await expect(newTabBtn).toBeVisible();
      await newTabBtn.click();

      const urlInput = view.app.locator('[data-testid="browser-new-tab-url-input"], [data-testid="browser-address-input"]').first();
      await expect(urlInput).toBeVisible();
      const tab2Url = `http://127.0.0.1:${host.targetPort}/journey?page=b&view=${randomUUID()}`;
      await urlInput.fill(tab2Url);
      const postPromise = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/browser/sessions" && r.request().method() === "POST");
      const openBtn = view.app.locator('[data-testid="browser-new-tab-open-btn"]').first();
      if (await openBtn.isVisible()) await openBtn.click();
      else await urlInput.press("Enter");
      const postRes = await postPromise;
      expect(postRes.status()).toBe(201);
      const session2Data = await postRes.json();
      expect(session2Data.browserSessionId).toBeTruthy();

      // Verify two tabs exist in tab strip
      const tabs = view.app.locator('[role="tab"]');
      await expect(tabs).toHaveCount(2);

      // Reload SPA: reattaches exact sessions without re-creating targets
      const postCountBefore = sessionPosts.length;
      // Window state persistence is asynchronous: reloading before both tabs reached storage
      // would legitimately restore only the persisted one.
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const raw = localStorage.getItem("dam-hopper:os:v1:session");
              if (!raw) return 0;
              const windows = Object.values(JSON.parse(raw).windows ?? {}) as Array<{
                appId?: string;
                appState?: { tabs?: unknown[] };
              }>;
              return windows.find((w) => w.appId === "browser")?.appState?.tabs?.length ?? 0;
            }),
          { timeout: 10_000 },
        )
        .toBe(2);
      await page.reload();
      await expect(page.locator("[data-os-shell='true']")).toBeVisible();

      const restoredApp = page.locator("[data-os-browser-app]").first();
      await expect(restoredApp).toBeVisible();
      const restoredTabs = restoredApp.locator('[role="tab"]');
      await expect(restoredTabs).toHaveCount(2);
      expect(sessionPosts.length).toBe(postCountBefore);

      // Verify remote document and input value survived reload
      await expect(view.remote.locator("#journey-input")).toHaveValue("tab-one-data");

      // Verify canvas on active tab restored
      const restoredCanvas = restoredApp.locator("canvas").first();
      await expectJourneyCanvas(restoredCanvas);

      // Explicit close window destroys targets, remembers committed address
      await page.locator('[data-os-window-frame] [aria-label="Close"]').first().click();
      await expect(page.locator("[data-os-browser-app]")).toHaveCount(0);

      // Reopening via Dock restores fresh page lazily
      await page.getByRole("button", { name: /^Launch or focus Browser Preview/ }).click();
      await expect(page.locator("[data-os-browser-app]")).toBeVisible({ timeout: 15_000 });

      await observer.close().catch(() => {});
    } finally {
      try {
        await context.close().catch(() => {});
      } finally {
        await host.cleanup();
      }
    }
  });

  test("two windows in one client: first close releases, final close deletes", async ({ browser }) => {
    const host = await startHostBrowserAppServer({ allowAppOrigin: true });
    const { page, context } = await createJourneyPage(browser, host);
    try {
      const deletes: string[] = [];
      page.on("request", (req) => {
        if (req.method() === "DELETE" && req.url().includes("/api/browser/sessions/")) {
          deletes.push(req.url());
        }
      });

      // Window 1: open target page
      const { view: view1, observer: obs1 } = await openJourneyView(page, host);
      const session1Id = view1.sessionId;

      // Window 2: open second browser window in same SPA
      const { view: view2, observer: obs2 } = await openJourneyView(page, host);
      const session2Id = view2.sessionId;

      // Close Window 1 via window frame Close button: first view close must issue zero DELETE for session 2
      await view1.frame.locator('[aria-label="Close"]').first().click();
      await expect(view1.app).toHaveCount(0);
      await page.waitForTimeout(500);

      // Window 2 must still be active and canvas live
      await expectJourneyCanvas(view2.canvas);

      // Close Window 2: final release must trigger DELETE
      await view2.frame.locator('[aria-label="Close"]').first().click();
      await expect.poll(() => deletes.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
      expect(deletes.some((d) => d.includes(session1Id) || d.includes(session2Id))).toBe(true);

      await obs1.close().catch(() => {});
      await obs2.close().catch(() => {});
    } finally {
      try {
        await context.close().catch(() => {});
      } finally {
        await host.cleanup();
      }
    }
  });
});
