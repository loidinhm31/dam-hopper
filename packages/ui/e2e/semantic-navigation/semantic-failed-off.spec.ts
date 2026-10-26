import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/application-fixture.js";

test.describe("F12: Failed OFF Status Refresh & Mismatch Presentation", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test.use({
    servicesConfig: {
      authBackend: "mongo",
      username: "admin",
      semanticEngine: false,
      seedSemanticFixtures: false,
    },
  });

  async function openSettingsPage(page: Page): Promise<void> {
    const origin = new URL(page.url()).origin;
    await page.goto(`${origin}/settings`);
    await expect(page.locator("text=Enable Semantic Navigation")).toBeVisible({ timeout: 25_000 });
  }

  test("failed OFF automatically refetches status, displaying mismatch banner and retained action error without remount", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    let patchCalled = false;
    let safeDisabledDelivered = false;

    // Route interceptor to simulate failed OFF and subsequent safe-disabled state
    await page.route("**/api/semantic/settings", async (route) => {
      const request = route.request();
      if (request.method() === "PATCH") {
        patchCalled = true;
        // Simulate backend failure during teardown transitioning to safe-disabled
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Failed to teardown child language server; runtime safe-disabled",
          }),
        });
        return;
      }

      if (request.method() === "GET") {
        if (patchCalled) {
          safeDisabledDelivered = true;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              configuredEnabled: true,
              runtimeEnabled: false,
              runtimeState: "safe-disabled",
              integrityStatus: "Valid",
              toolchainReady: true,
              tupleIdentifier: "node-24.16.0-ts-5.9.3-tsls-6.0.2-linux-x64",
              policyCapability: "portable-only",
              resourceWarning: undefined,
              activeTrees: 0,
              openDocuments: 0,
              totalOverlayBytes: 0,
              generation: 2,
              transitionError: "Backend supervisor safe-disabled during teardown",
              canMutate: true,
            }),
          });
          return;
        }

        // Initial healthy enabled state
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            configuredEnabled: true,
            runtimeEnabled: true,
            runtimeState: "ready",
            integrityStatus: "Valid",
            toolchainReady: true,
            tupleIdentifier: "node-24.16.0-ts-5.9.3-tsls-6.0.2-linux-x64",
            policyCapability: "portable-only",
            resourceWarning: undefined,
            activeTrees: 0,
            openDocuments: 0,
            totalOverlayBytes: 0,
            generation: 1,
            transitionError: undefined,
            canMutate: true,
          }),
        });
        return;
      }

      await route.continue();
    });

    await openSettingsPage(page);

    // Initial state: toggle is ON, no mismatch banner
    const toggle = page.locator('button[role="switch"][aria-label="Enable semantic navigation"]');
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("text=Configuration / Runtime Mismatch")).not.toBeVisible();

    // Trigger toggle OFF
    await toggle.click();

    // Action error must be visible
    await expect(
      page.locator("text=Failed to teardown child language server; runtime safe-disabled"),
    ).toBeVisible({ timeout: 10_000 });

    // The automatic onSettled refetch must have refreshed the status to safe-disabled
    await expect(
      page.locator("text=Configuration / Runtime Mismatch"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator("text=effective runtime state is safe-disabled"),
    ).toBeVisible();
    await expect(
      page.locator("text=Backend supervisor safe-disabled during teardown"),
    ).toBeVisible();

    expect(patchCalled).toBe(true);
    expect(safeDisabledDelivered).toBe(true);
  });
});
