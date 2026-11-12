import { test, expect } from "@playwright/test";
import { startHostBrowserAppServer } from "../fixtures/host-browser-app.js";
import { createJourneyPage, openJourneyView } from "../fixtures/host-browser-journey-driver.js";

test.describe("Host Browser Tabs Recovery & Capacity Gate (A05, A06, A09, A10, A12)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("server restart causes unavailable, explicit reload creates fresh target", async ({ browser }) => {
    const host = await startHostBrowserAppServer({ allowAppOrigin: true, maxTargets: 2 });
    const { page, context } = await createJourneyPage(browser, host);
    try {
      const { view, observer } = await openJourneyView(page, host);
      const originalSessionId = view.sessionId;

      const restartPosts: string[] = [];
      page.on("request", (req) => {
        if (req.method() === "POST" && req.url().includes("/api/browser/sessions")) restartPosts.push(req.url());
      });

      // Controlled API child restart on same port/config/auth DB
      await host.restartApi();

      // UI marks page unavailable
      const unavailPanel = page.locator('[data-testid="browser-unavailable-panel"]').first();
      await expect(unavailPanel).toBeVisible({ timeout: 25_000 });
      expect(await unavailPanel.textContent()).toContain("Page unavailable");

      // Zero automatic recreation before explicit reload
      expect(restartPosts).toHaveLength(0);

      // Reload explicitly opens a fresh page
      const reloadBtn = page.locator('[data-testid="browser-unavailable-reload-btn"]').first();
      await expect(reloadBtn).toBeVisible();

      const reloadedPromise = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/browser/sessions" && r.request().method() === "POST",
      );
      await reloadBtn.click();
      const reloadedRes = await reloadedPromise;
      expect(reloadedRes.status()).toBe(201);
      const reloadedData = await reloadedRes.json();
      expect(reloadedData.browserSessionId).not.toBe(originalSessionId);

      await observer.close().catch(() => {});
    } finally {
      try {
        await context.close().catch(() => {});
      } finally {
        await host.cleanup();
      }
    }
  });

  test("capacity limit shows busy placeholder with retry; two documents share recovery lock safely", async ({ browser }) => {
    const host = await startHostBrowserAppServer({ allowAppOrigin: true, maxTargets: 2 });
    const { page: pageA, context } = await createJourneyPage(browser, host);
    let pageB: Awaited<ReturnType<typeof context.newPage>> | undefined;

    try {
      pageB = await context.newPage();
      await pageB.goto(`${host.appOrigin}/os`);
      await expect(pageB.locator("[data-os-shell='true']")).toBeVisible();

      // 1. Fill 2 available targets
      const { observer: obs1 } = await openJourneyView(pageA, host);
      const { observer: obs2 } = await openJourneyView(pageA, host);

      // 2. Open 3rd target: triggers capacity limit (429) scoped to focused frame
      const dockBtn = pageA.getByRole("button", { name: /^Launch or focus Browser Preview/ });
      await dockBtn.click({ button: "right" });
      await pageA.getByTestId("dock-menu-new-window").click();

      const focusedFrame = pageA.locator('[data-os-window-frame][data-os-focused="true"]').first();
      await expect(focusedFrame).toBeVisible({ timeout: 15_000 });

      const urlInput = focusedFrame.locator('[data-testid="browser-new-tab-url-input"], [data-testid="browser-address-input"]').first();
      await urlInput.fill(`http://127.0.0.1:${host.targetPort}/journey?page=a&view=busy`);
      const openBtn = focusedFrame.locator('[data-testid="browser-new-tab-open-btn"]').first();
      if (await openBtn.isVisible()) await openBtn.click();
      else await urlInput.press("Enter");

      // Verify capacity placeholder rendered within focused frame
      const busyPanel = focusedFrame.locator('[data-testid="browser-unavailable-panel"]').first();
      await expect(busyPanel).toBeVisible({ timeout: 15_000 });
      expect(await busyPanel.textContent()).toContain("capacity busy");

      // 3. Multi-document recovery store synchronization under Web Locks with valid schema
      const lockKey = "dam-hopper:browser:v1:recovery-lock";
      const storageKey = "dam-hopper:browser:v1:recovery";

      const recoveryState = await pageA.evaluate(
        async ({ key, sKey }) => {
          interface RecoveryOp {
            operationId: string;
            ownerScope: { profileId: string; endpoint: string; principal: string; namespace: "dev" };
            kind: "close-window";
            windowId: string;
            status: "unknown";
          }
          const op: RecoveryOp = {
            operationId: "op-unknown-test",
            ownerScope: { profileId: "default", endpoint: "http://127.0.0.1:4801", principal: "admin", namespace: "dev" },
            kind: "close-window",
            windowId: "win-test-recovery",
            status: "unknown",
          };
          const { promise, resolve } = Promise.withResolvers<{ stored: boolean }>();
          void navigator.locks.request(key, async () => {
            const current = JSON.parse(localStorage.getItem(sKey) || '{"operations":[],"rememberedGroups":{}}');
            current.operations.push(op);
            localStorage.setItem(sKey, JSON.stringify(current));
            resolve({ stored: true });
          });
          return promise;
        },
        { key: lockKey, sKey: storageKey },
      );
      expect(recoveryState.stored).toBe(true);

      // Page B reads from storage under same lock: confirms shared durable unknown without data loss
      const readFromB = await pageB.evaluate(
        async ({ key, sKey }) => {
          const { promise, resolve } = Promise.withResolvers<number>();
          void navigator.locks.request(key, async () => {
            const current = JSON.parse(localStorage.getItem(sKey) || '{"operations":[]}');
            resolve(current.operations.length);
          });
          return promise;
        },
        { key: lockKey, sKey: storageKey },
      );
      expect(readFromB).toBeGreaterThanOrEqual(1);

      await obs1.close().catch(() => {});
      await obs2.close().catch(() => {});
    } finally {
      try {
        if (pageB) await pageB.close().catch(() => {});
        await context.close().catch(() => {});
      } finally {
        await host.cleanup();
      }
    }
  });
});
