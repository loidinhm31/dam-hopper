import { test, expect } from "@playwright/test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { startHostBrowserAppServer } from "../fixtures/host-browser-app.js";
import { createJourneyPage, openJourneyView } from "../fixtures/host-browser-journey-driver.js";
import {
  captureApplicationCheckpoint,
  finalizeEvidenceSession,
  initEvidenceSession,
} from "../fixtures/capture-evidence.js";

const caseDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "tabs-visual");

test.describe("Host Browser Native Tabs Visual Evidence (A13)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("captures 1440x900, 640x900, 400x800 viewports and privacy masking into colocated review directory", async ({ browser }) => {
    const host = await startHostBrowserAppServer({ allowAppOrigin: true });
    let testPassed = false;
    let cleanupPassed = false;

    initEvidenceSession({
      seedDigest: "isolated-browser-native-tabs-visual-fixture",
      command: "E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e os-host-browser/tabs-visual.spec.ts",
    });

    let contextHandle: Awaited<ReturnType<typeof browser.newContext>> | undefined;

    try {
      const { page, context } = await createJourneyPage(browser, host);
      contextHandle = context;

      // 1. 1440x900 Desktop Viewport with open tabs and live canvas
      await page.setViewportSize({ width: 1440, height: 900 });
      const { view, observer } = await openJourneyView(page, host);

      // Add a second tab to display native tab strip
      const newTabBtn = view.app.locator('[data-testid="browser-new-tab-btn"]').first();
      await expect(newTabBtn).toBeVisible();
      await newTabBtn.click();
      const urlInput = view.app.locator('[data-testid="browser-new-tab-url-input"], [data-testid="browser-address-input"]').first();
      await urlInput.fill(`http://127.0.0.1:${host.targetPort}/journey?page=b&view=${randomUUID()}`);
      const openBtn = view.app.locator('[data-testid="browser-new-tab-open-btn"]').first();
      if (await openBtn.isVisible()) await openBtn.click();
      else await urlInput.press("Enter");

      await expect(view.app.locator('[role="tab"]')).toHaveCount(2);
      await captureApplicationCheckpoint(page, { caseDir, checkpointName: "1440x900-tabs" });

      // 2. 640x900 Compact Tablet Viewport: compact navigation & tab scrolling
      await page.setViewportSize({ width: 640, height: 900 });
      await expect(view.app.locator('[data-testid^="browser-tab-strip-"]')).toBeVisible();
      await captureApplicationCheckpoint(page, { caseDir, checkpointName: "640x900-compact" });

      // 3. 400x800 Mobile / Coarse Pointer Viewport: touch-friendly controls
      await page.setViewportSize({ width: 400, height: 800 });
      await expect(view.app.locator('[data-testid^="browser-toolbar-"]')).toBeVisible();
      await captureApplicationCheckpoint(page, { caseDir, checkpointName: "400x800-coarse" });

      // 4. Tools, Recovery, and Cognito Privacy Mode
      await page.setViewportSize({ width: 1440, height: 900 });
      const toolsBtn = view.app.locator('[data-testid="browser-tools-toggle-btn"]').first();
      await expect(toolsBtn).toBeVisible();
      await toolsBtn.click();
      await expect(view.app.locator('[data-testid="browser-tools-panel"]')).toBeVisible();

      // Trigger Cognito Privacy mode
      await page.keyboard.press("Control+Alt+B");
      const addrInput = view.app.locator('[data-testid="browser-address-input"]').first();
      await expect(addrInput).toHaveValue("●●●●●●");
      await captureApplicationCheckpoint(page, { caseDir, checkpointName: "tools-recovery-privacy" });

      await observer.close().catch(() => {});
      testPassed = true;
    } finally {
      try {
        if (contextHandle) await contextHandle.close().catch(() => {});
        await host.cleanup();
        cleanupPassed = true;
      } finally {
        await finalizeEvidenceSession({ testPassed, cleanupPassed });
      }
    }
  });
});
